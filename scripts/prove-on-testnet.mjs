/**
 * Prove a capacity claim against the *live* testnet verifier.
 *
 *   node scripts/prove-on-testnet.mjs
 *
 * Generates a fresh cooperative-signed attestation, proves "at least T kg"
 * in-process, and submits it to the deployed contract -- then submits a
 * deliberately false claim and shows the chain reject it.
 *
 * The second half matters more than the first. Anyone can show a green tick;
 * showing the network refuse a proof that does not hold is what demonstrates
 * the verification is real.
 */

import * as snarkjs from "snarkjs";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STELLAR = process.env.STELLAR_BIN ?? join(homedir(), ".harvest-bin", "stellar.exe");
const NETWORK = "testnet";
const IDENTITY = "harvest-deployer";

const WASM = join(ROOT, "circuits", "build", "harvest_capacity_js", "harvest_capacity.wasm");
const ZKEY = join(ROOT, "circuits", "build", "harvest_capacity_final.zkey");

const deployments = JSON.parse(readFileSync(join(ROOT, "deployments.json"), "utf8"));
if (!deployments.verifier) throw new Error("no verifier in deployments.json -- run npm run deploy");

function stellar(args) {
  try {
    return execFileSync(STELLAR, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    return { error: [err.stdout, err.stderr].filter(Boolean).join("\n").trim() };
  }
}

const invoke = (fn, args) =>
  stellar([
    "contract", "invoke",
    "--id", deployments.verifier,
    "--network", NETWORK,
    "--source-account", IDENTITY,
    "--", fn, ...args,
  ]);

// ---------------------------------------------------------------------------

const farmerAddress = stellar(["keys", "address", IDENTITY]);
console.log(`\nverifier : ${deployments.verifier}`);
console.log(`farmer   : ${farmerAddress}\n`);

const issuerKeyPath = join(ROOT, ".harvest", "issuer-key.json");
if (!existsSync(issuerKeyPath)) throw new Error("no cached issuer key -- run npm run deploy first");
const issuerKey = Buffer.from(JSON.parse(readFileSync(issuerKeyPath, "utf8")).secret, "hex");
const issuerPub = await issuerPublicKey(issuerKey);

// The scenario -------------------------------------------------------------
const SEASON = 2026n;
const REAL_YIELD = 48_500n;   // never leaves this process
const THRESHOLD = 40_000n;    // the only number that reaches the chain
const farmerSecret = randomFarmerSecret();
const parcelId = parcelIdOf("Giresun/Bulancak ada 214 parsel 7");
const cropCode = cropCodeOf("findik");
const binding = addressBinding(farmerAddress);

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
    yieldKg: REAL_YIELD, parcelId, cropCode, signature, binding,
  }),
  WASM,
  ZKEY,
);
console.log(`    done in ${Date.now() - t0} ms`);

const payload = JSON.stringify({ claim: encodeClaim(publicSignals), proof: encodeProof(proof) });
if (payload.includes(REAL_YIELD.toString())) {
  throw new Error("the real yield leaked into the on-chain payload");
}
console.log("    confirmed: the real figure is absent from everything being submitted");

// 1. the honest proof -------------------------------------------------------
console.log("\nsubmitting to the live contract ...");
const claim = encodeClaim(publicSignals);
const encoded = encodeProof(proof);

const accepted = invoke("verify_capacity", [
  "--caller", farmerAddress,
  "--claim", JSON.stringify(claim),
  "--proof", JSON.stringify(encoded),
]);
if (accepted.error) {
  console.log(`    REJECTED (unexpected):\n${accepted.error}`);
  process.exit(1);
}
console.log("    ACCEPTED by the on-chain BN254 pairing check");

// 2. a claim the proof does not support ------------------------------------
console.log("\nnow the same proof, with the threshold inflated to 90 tonnes ...");
const lie = { ...claim, threshold_kg: 90_000 };
const rejected = invoke("check_capacity", [
  "--caller", farmerAddress,
  "--claim", JSON.stringify(lie),
  "--proof", JSON.stringify(encoded),
]);
const verdict = typeof rejected === "string" ? rejected.trim() : "error";
if (verdict === "false") {
  console.log("    REJECTED, as it must be");
} else {
  console.log(`    unexpected verdict: ${JSON.stringify(rejected)}`);
  process.exit(1);
}

// 3. the same proof replayed from a different account -----------------------
console.log("\nand replayed from an unrelated account ...");
const thief = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const replayed = invoke("check_capacity", [
  "--caller", thief,
  "--claim", JSON.stringify(claim),
  "--proof", JSON.stringify(encoded),
]);
console.log(
  String(replayed).trim() === "false"
    ? "    REJECTED -- the proof is bound to the farmer's address"
    : `    unexpected verdict: ${JSON.stringify(replayed)}`,
);

console.log(`
on-chain verification confirmed.

  what the chain learned : harvest >= ${publicSignals[2]} kg, season ${publicSignals[3]}
  what it never saw      : ${REAL_YIELD} kg, the parcel, the farmer's identity

  contract: https://stellar.expert/explorer/testnet/contract/${deployments.verifier}
`);
