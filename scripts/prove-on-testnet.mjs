/**
 * Prove a capacity claim against the *live* testnet verifier.
 *
 *   node scripts/prove-on-testnet.mjs
 *
 * Generates a fresh cooperative-signed attestation, proves "at least T kg"
 * in-process, and asks the deployed verifier about it -- then asks about a
 * deliberately false claim and a replay from another account, and shows the
 * chain reject both.
 *
 * The second half matters more than the first. Anyone can show a green tick;
 * showing the network refuse a proof that does not hold is what demonstrates
 * the verification is real.
 *
 * Every check is a simulation against the live contract: it runs the real
 * BN254 pairing in the Soroban host without submitting a transaction, so the
 * script needs no funded account and no Stellar CLI identity. The farmer is a
 * fresh random address, which is all the address binding needs.
 */

import * as snarkjs from "snarkjs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";

import {
  addressBinding,
  buildCircuitInput,
  cropCodeOf,
  issuerPublicKey,
  parcelIdOf,
  randomFarmerSecret,
  signAttestation,
} from "../packages/sdk/src/attestation.mjs";
import { encodeClaim, encodeProof } from "../packages/sdk/src/encoding.mjs";
import {
  SorobanClient,
  addressToScVal,
  claimToScVal,
  proofToScVal,
} from "../packages/sdk/src/soroban.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WASM = join(ROOT, "circuits", "build", "harvest_capacity_js", "harvest_capacity.wasm");
const ZKEY = join(ROOT, "circuits", "build", "harvest_capacity_final.zkey");

const deployments = JSON.parse(readFileSync(join(ROOT, "deployments.json"), "utf8"));
if (!deployments.verifier) throw new Error("no verifier in deployments.json -- run npm run deploy");
if (!existsSync(ZKEY)) throw new Error("no proving key -- run npm run circuit:build");

const soroban = new SorobanClient();

/** Simulate a verifier call. Reads need *an* existing account as the source. */
const ask = (method, caller, claim, proof) =>
  soroban.read({
    contractId: deployments.verifier,
    method,
    args: [addressToScVal(caller), claimToScVal(claim), proofToScVal(proof)],
    source: deployments.deployer,
  });

// ---------------------------------------------------------------------------

const farmerAddress = Keypair.random().publicKey();
console.log(`\nverifier : ${deployments.verifier}`);
console.log(`farmer   : ${farmerAddress} (fresh)\n`);

const issuerKeyPath = join(ROOT, ".harvest", "issuer-key.json");
if (!existsSync(issuerKeyPath)) throw new Error("no cached issuer key -- run npm run deploy first");
const issuerKey = Buffer.from(JSON.parse(readFileSync(issuerKeyPath, "utf8")).secret, "hex");
const issuerPub = await issuerPublicKey(issuerKey);

// The scenario -------------------------------------------------------------
const SEASON = 2026n;
const REAL_YIELD = 48_500n; // never leaves this process
const THRESHOLD = 40_000n; // the only number that reaches the chain
const farmerSecret = randomFarmerSecret();
const parcelId = parcelIdOf("Giresun/Bulancak ada 214 parsel 7");
const cropCode = cropCodeOf("findik");

console.log("the cooperative signs an attestation");
console.log(`    real expected harvest : ${REAL_YIELD} kg   <- stays private`);
console.log(`    claimed threshold     : ${THRESHOLD} kg   <- goes on chain`);

const signature = await signAttestation(issuerKey, {
  yieldKg: REAL_YIELD, parcelId, cropCode, seasonId: SEASON, farmerSecret,
});

console.log("\ngenerating the proof ...");
const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  await buildCircuitInput({
    issuerPub, threshold: THRESHOLD, seasonId: SEASON, farmerSecret,
    yieldKg: REAL_YIELD, parcelId, cropCode, signature, binding: addressBinding(farmerAddress),
  }),
  WASM,
  ZKEY,
);
console.log(`    done in ${Date.now() - t0} ms`);

const claim = encodeClaim(publicSignals);
const encoded = encodeProof(proof);
if (JSON.stringify({ claim, proof: encoded }).includes(REAL_YIELD.toString())) {
  throw new Error("the real yield leaked into the on-chain payload");
}
console.log("    confirmed: the real figure is absent from everything being submitted");

let failures = 0;

// 1. the honest proof -------------------------------------------------------
console.log("\nasking the live contract (verify_capacity) ...");
try {
  await ask("verify_capacity", farmerAddress, claim, encoded);
  console.log("    ACCEPTED by the on-chain BN254 pairing check");
} catch (err) {
  console.log(`    REJECTED (unexpected): ${err.message}`);
  failures++;
}

// 2. a claim the proof does not support ------------------------------------
console.log("\nnow the same proof, with the threshold inflated to 90 tonnes ...");
const inflated = await ask("check_capacity", farmerAddress, { ...claim, threshold_kg: 90_000 }, encoded);
if (inflated === false) {
  console.log("    REJECTED, as it must be");
} else {
  console.log(`    unexpected verdict: ${JSON.stringify(inflated)}`);
  failures++;
}

// 3. the same proof replayed from a different account -----------------------
console.log("\nand replayed from an unrelated account ...");
const replayed = await ask("check_capacity", Keypair.random().publicKey(), claim, encoded);
if (replayed === false) {
  console.log("    REJECTED -- the proof is bound to the farmer's address");
} else {
  console.log(`    unexpected verdict: ${JSON.stringify(replayed)}`);
  failures++;
}

console.log(
  failures
    ? `\n${failures} check(s) did not behave as expected.`
    : `
on-chain verification confirmed.

  what the chain learned : harvest >= ${claim.threshold_kg} kg, season ${claim.season}
  what it never saw      : ${REAL_YIELD} kg, the parcel, the farmer's identity

  contract: https://stellar.expert/explorer/testnet/contract/${deployments.verifier}
`,
);

// snarkjs leaves the BN128 worker pool running, which keeps the event loop
// alive after the report has printed. Shut it down so the script exits.
await globalThis.curve_bn128?.terminate();
process.exitCode = failures ? 1 : 0;
