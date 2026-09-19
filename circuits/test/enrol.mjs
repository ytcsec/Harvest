/**
 * End-to-end proof test for the membership-enrolment circuit.
 *
 * The positive case is the easy half. The negative cases are the point: an
 * enrolment proof is what the registry contract trusts when it decides that an
 * accredited cooperative really did check someone's paperwork, so every way of
 * faking that verdict has to be shown to fail.
 */

import * as snarkjs from "snarkjs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";

import {
  addressBinding,
  farmerCommitment,
  issuerPublicKey,
  parcelIdOf,
  randomFarmerSecret,
  randomIssuerKey,
} from "@harvest/sdk/attestation";
import {
  DOC,
  MIN_DECARES,
  REQUIRED_MASK,
  applicantRefOf,
  buildEnrolmentInput,
  computeEnrolmentNullifier,
  docMaskFor,
  maskIsSufficient,
  signEnrolmentForCommitment,
} from "@harvest/sdk/enrolment";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "..", "build");
const WASM = join(BUILD, "harvest_enrolment_js", "harvest_enrolment.wasm");
const ZKEY = join(BUILD, "harvest_enrolment_final.zkey");
const VKEY = JSON.parse(readFileSync(join(BUILD, "harvest_enrolment_verification_key.json"), "utf8"));

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

console.log("\nHARVEST enrolment circuit -- end to end\n");

// ---------------------------------------------------------------------------
// Scenario: a grower applies to the Giresun cooperative. The cooperative sees
// their ÇKS registration, their title deed and their TARSİM policy, and records
// that the parcel is 180 decares. The chain must learn that those checks passed
// -- and nothing about the identity, the parcel or the 180.
// ---------------------------------------------------------------------------
const issuerKey = randomIssuerKey();
const issuerPub = await issuerPublicKey(issuerKey);
const farmerSecret = randomFarmerSecret();
const farmerAddress = Keypair.random().publicKey();

const SEASON = 2026n;
const LAND_DECARES = 180n; // the commercial secret this circuit protects
const applicantRef = applicantRefOf("TCKN 1234567890 / Kemal Guler");
const parcelId = parcelIdOf("Tokat/Merkez ada 132 parsel 5");
// Only the two mandatory checks. TARSİM is left off on purpose: it is the
// optional bit, which makes it the one to try to forge further down.
const attrMask = BigInt(DOC.CKS | DOC.DEED);
const binding = addressBinding(farmerAddress);

const commitment = await farmerCommitment(farmerSecret);
const signature = await signEnrolmentForCommitment(issuerKey, {
  farmerCommitment: commitment,
  applicantRef,
  parcelId,
  landDecares: LAND_DECARES,
  attrMask,
  seasonId: SEASON,
});

const base = {
  issuerPub,
  seasonId: SEASON,
  farmerSecret,
  applicantRef,
  parcelId,
  landDecares: LAND_DECARES,
  attrMask,
  signature,
  binding,
};

// --- 1. the honest enrolment ------------------------------------------------
const input = await buildEnrolmentInput(base);
const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
const provingMs = Date.now() - t0;

ok("honest enrolment verifies", await snarkjs.groth16.verify(VKEY, publicSignals, proof), `(${provingMs} ms)`);

// Public signal order: issuerAx, issuerAy, docMask, seasonId, nullifier, addressBinding
const [, , pubMask, pubSeason, pubNullifier] = publicSignals;

ok(
  "the published mask is the two documents plus the land verdict",
  Number(pubMask) === (DOC.CKS | DOC.DEED | DOC.LAND),
  `mask ${pubMask}`,
);
ok("the mask clears what the registry requires", maskIsSufficient(Number(pubMask)));
ok("the optional TARSİM bit is not claimed", (Number(pubMask) & DOC.TARSIM) === 0);
ok("season is published", BigInt(pubSeason) === SEASON);
ok(
  "nullifier matches the one computed off-circuit",
  BigInt(pubNullifier) === (await computeEnrolmentNullifier(farmerSecret, SEASON)),
);

// --- 2. nothing private survives into the proof payload ---------------------
// The land area is a small integer, so searching for it as a substring of the
// 77-digit group elements would fire on coincidence. What actually matters is
// that it is not one of the values the contract reads: the public signals.
ok(
  "land area is not a public signal",
  !publicSignals.some((s) => BigInt(s) === LAND_DECARES),
  `${LAND_DECARES} decares stayed private`,
);
// These three are 248-bit values, so a substring hit would be a real leak.
const leaked = JSON.stringify({ proof, publicSignals });
ok("identity reference absent from proof payload", !leaked.includes(applicantRef.toString()));
ok("parcel id absent from proof payload", !leaked.includes(parcelId.toString()));
ok("farmer secret absent from proof payload", !leaked.includes(farmerSecret.toString()));

// --- 3. the enrolment nullifier cannot collide with a capacity nullifier ----
const { computeNullifier } = await import("@harvest/sdk/attestation");
ok(
  "enrolment nullifier is domain separated from the capacity one",
  (await computeEnrolmentNullifier(farmerSecret, SEASON)) !== (await computeNullifier(farmerSecret, SEASON)),
);

// --- 4. a farmer who does not clear the land floor cannot claim that bit ----
// The cooperative signs the real (small) area; the circuit is what decides the
// bit, so the only mask it will prove is one without DOC.LAND.
const smallLand = MIN_DECARES - 1n;
const smallSig = await signEnrolmentForCommitment(issuerKey, {
  farmerCommitment: commitment,
  applicantRef,
  parcelId,
  landDecares: smallLand,
  attrMask,
  seasonId: SEASON,
});
const smallInput = await buildEnrolmentInput({ ...base, landDecares: smallLand, signature: smallSig });
ok(
  "a holding under the floor does not get the land bit",
  Number(smallInput.docMask) === (DOC.CKS | DOC.DEED),
  `mask ${smallInput.docMask}`,
);
ok("...and that mask does not clear the registry", !maskIsSufficient(Number(smallInput.docMask)));

// ...and asking the circuit for the land bit anyway is unsatisfiable.
await expectProvingToFail("claiming the land bit without the land", {
  ...smallInput,
  docMask: String(Number(smallInput.docMask) | DOC.LAND),
});

// --- 5. the cooperative's own bits cannot be inflated ----------------------
await expectProvingToFail("adding a document check the cooperative did not sign", {
  ...input,
  docMask: String(Number(input.docMask) | DOC.TARSIM),
  attrMask: String(BigInt(input.attrMask) | BigInt(DOC.TARSIM)),
});

// --- 6. an unaccredited issuer cannot enrol anyone -------------------------
const rogueKey = randomIssuerKey();
const roguePub = await issuerPublicKey(rogueKey);
const rogueSig = await signEnrolmentForCommitment(rogueKey, {
  farmerCommitment: commitment,
  applicantRef,
  parcelId,
  landDecares: LAND_DECARES,
  attrMask,
  seasonId: SEASON,
});
// The circuit will happily prove this -- it proves "signed by (Ax, Ay)", and the
// allow-list lives on chain. What must NOT happen is the rogue signature
// verifying against the real cooperative's key.
await expectProvingToFail("a rogue signature cannot pass as the cooperative's", {
  ...input,
  sigR8x: rogueSig.sigR8x.toString(),
  sigR8y: rogueSig.sigR8y.toString(),
  sigS: rogueSig.sigS.toString(),
});
ok(
  "the rogue issuer's own key is a different key the chain will not know",
  roguePub.Ax !== issuerPub.Ax,
);

// --- 7. a stolen credential cannot be re-pointed at someone else's secret ---
const thiefSecret = randomFarmerSecret();
await expectProvingToFail("another farmer cannot reuse this credential", {
  ...input,
  farmerSecret: thiefSecret.toString(),
  nullifier: (await computeEnrolmentNullifier(thiefSecret, SEASON)).toString(),
});

// --- 8. the credential does not carry into another season ------------------
await expectProvingToFail("a 2026 enrolment cannot be replayed into 2027", {
  ...input,
  seasonId: "2027",
  nullifier: (await computeEnrolmentNullifier(farmerSecret, 2027n)).toString(),
});

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
