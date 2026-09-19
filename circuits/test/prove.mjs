/**
 * End-to-end proof test.
 *
 * The positive case is the easy half. The four negative cases are the point:
 * they are what separates a real proof system from a progress bar. Each one
 * asserts that the circuit *refuses* to help someone cheat.
 */

import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";

import {
  addressBinding,
  buildCircuitInput,
  computeNullifier,
  cropCodeOf,
  issuerPublicKey,
  parcelIdOf,
  randomFarmerSecret,
  randomIssuerKey,
  signAttestation,
  verifyAttestation,
} from "@harvest/sdk/attestation";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "..", "build");
const WASM = join(BUILD, "harvest_capacity_js", "harvest_capacity.wasm");
const ZKEY = join(BUILD, "harvest_capacity_final.zkey");
const VKEY = JSON.parse(readFileSync(join(BUILD, "verification_key.json"), "utf8"));

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${extra ? "  " + extra : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? "  " + extra : ""}`);
  }
};

/** Expect witness generation / proving to be impossible. */
async function expectProvingToFail(name, input) {
  try {
    await snarkjs.groth16.fullProve(input, WASM, ZKEY);
    ok(name, false, "-> a proof was produced, which must never happen");
  } catch (err) {
    const msg = String(err.message ?? err).split("\n")[0];
    ok(name, true, `-> circuit refused (${msg.slice(0, 60)})`);
  }
}

console.log("\nHARVEST capacity circuit -- end to end\n");

// ---------------------------------------------------------------------------
// Scenario: a Giresun hazelnut grower who really expects 48.5 tonnes wants to
// borrow against a *claim* of only 40 tonnes. The market must learn "40+" and
// nothing else.
// ---------------------------------------------------------------------------
const issuerKey = randomIssuerKey();                  // cooperative signing key
const issuerPub = await issuerPublicKey(issuerKey);
const farmerSecret = randomFarmerSecret();
const farmerAddress = Keypair.random().publicKey();    // a real Stellar strkey

const SEASON = 2026n;
const REAL_YIELD = 48_500n;                           // the commercial secret
const THRESHOLD = 40_000n;                            // the only number revealed
const parcelId = parcelIdOf("Giresun/Bulancak ada 214 parsel 7");
const cropCode = cropCodeOf("findik");
const binding = addressBinding(farmerAddress);

const attested = { yieldKg: REAL_YIELD, parcelId, cropCode, seasonId: SEASON, farmerSecret };
const signature = await signAttestation(issuerKey, attested);

ok(
  "issuer signature verifies off-circuit",
  await verifyAttestation(issuerPub, signature.digest, signature),
);

// --- 1. honest proof -------------------------------------------------------
const input = await buildCircuitInput({
  issuerPub, threshold: THRESHOLD, seasonId: SEASON, farmerSecret,
  yieldKg: REAL_YIELD, parcelId, cropCode, signature, binding,
});

const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
const provingMs = Date.now() - t0;

ok("honest proof verifies", await snarkjs.groth16.verify(VKEY, publicSignals, proof), `(${provingMs} ms)`);

// --- 2. the proof really is zero knowledge ---------------------------------
const leaked = JSON.stringify({ proof, publicSignals });
ok("real yield absent from proof payload", !leaked.includes(REAL_YIELD.toString()));
ok("parcel id absent from proof payload", !leaked.includes(parcelId.toString()));
ok("farmer secret absent from proof payload", !leaked.includes(farmerSecret.toString()));

// --- 3. public signal ordering matches what the contract will expect -------
const expectedNullifier = await computeNullifier(farmerSecret, SEASON);
const expected = [
  issuerPub.Ax, issuerPub.Ay, THRESHOLD, SEASON, expectedNullifier, binding,
].map(String);
ok(
  "public signals are [Ax, Ay, threshold, season, nullifier, binding]",
  JSON.stringify(publicSignals) === JSON.stringify(expected),
  `\n        got      ${JSON.stringify(publicSignals)}\n        expected ${JSON.stringify(expected)}`,
);

// --- 4. NEGATIVE: claiming more capacity than attested --------------------
await expectProvingToFail(
  "cannot claim 40t when the attestation says 30t",
  await buildCircuitInput({
    issuerPub, threshold: THRESHOLD, seasonId: SEASON, farmerSecret,
    yieldKg: 30_000n, parcelId, cropCode,
    signature: await signAttestation(issuerKey, { ...attested, yieldKg: 30_000n }),
    binding,
  }),
);

// --- 5. NEGATIVE: inflating the yield without a matching signature ---------
await expectProvingToFail(
  "cannot edit the yield field and keep the old signature",
  await buildCircuitInput({
    issuerPub, threshold: THRESHOLD, seasonId: SEASON, farmerSecret,
    yieldKg: 90_000n, parcelId, cropCode, signature, binding,
  }),
);

// --- 6. NEGATIVE: self-issued attestation ---------------------------------
const rogueKey = randomIssuerKey();
await expectProvingToFail(
  "cannot self-sign an attestation and pass it off as the cooperative's",
  await buildCircuitInput({
    issuerPub, // still claims to be the real cooperative
    threshold: THRESHOLD, seasonId: SEASON, farmerSecret,
    yieldKg: REAL_YIELD, parcelId, cropCode,
    signature: await signAttestation(rogueKey, attested),
    binding,
  }),
);

// --- 7. NEGATIVE: tampering with a public signal after proving ------------
const tampered = [...publicSignals];
tampered[2] = "90000"; // brag about a 90t threshold on a 40t proof
ok(
  "raising the threshold on an already-issued proof breaks verification",
  !(await snarkjs.groth16.verify(VKEY, tampered, proof)),
);

// --- 8. NEGATIVE: replaying someone else's proof from another account -----
const stolen = [...publicSignals];
stolen[5] = addressBinding(Keypair.random().publicKey()).toString();
ok(
  "re-pointing the address binding breaks verification",
  !(await snarkjs.groth16.verify(VKEY, stolen, proof)),
);

console.log(`\n  what the chain sees : threshold=${publicSignals[2]}kg  season=${publicSignals[3]}`);
console.log(`  what stays private  : yield=${REAL_YIELD}kg, parcel, identity`);
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
