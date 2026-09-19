/**
 * Emit deterministic enrolment-proof fixtures for the registry contract tests.
 *
 * Same reasoning as `export-fixtures.mjs`: the Rust side has no circom
 * toolchain, so the honest way to test the registry is to feed it real
 * artefacts produced here and assert the on-chain pairing check agrees.
 * Everything derives from fixed seeds, so the fixtures are reproducible and
 * reviewable in git.
 *
 * Writes into contracts/harvest-registry/tests/data/:
 *   verification_key.json  the enrolment circuit's VK
 *   valid.json             documents checked, land over the floor -> mask 11
 *   insufficient.json      a real proof whose mask lacks the land bit -> mask 3
 */

import * as snarkjs from "snarkjs";
import { StrKey } from "@stellar/stellar-sdk";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { addressBinding, farmerCommitment, issuerPublicKey, parcelIdOf } from "@harvest/sdk/attestation";
import {
  DOC,
  MIN_DECARES,
  applicantRefOf,
  buildEnrolmentInput,
  computeEnrolmentNullifier,
  docMaskFor,
  signEnrolmentForCommitment,
} from "@harvest/sdk/enrolment";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "build");
const OUT = join(HERE, "..", "contracts", "harvest-registry", "tests", "data");
const WASM = join(BUILD, "harvest_enrolment_js", "harvest_enrolment.wasm");
const ZKEY = join(BUILD, "harvest_enrolment_final.zkey");

mkdirSync(OUT, { recursive: true });

/** 32-byte big-endian hex, the shape `BytesN<32>` wants. */
const toBytes32Hex = (v) => BigInt(v).toString(16).padStart(64, "0");

// Deterministic actors -- the same cooperative key the capacity fixtures use,
// so a test can accredit one issuer and exercise both circuits.
const issuerKey = Buffer.alloc(32, 0x11);
const issuerPub = await issuerPublicKey(issuerKey);
const farmerSecret = 0x1234567890abcdefn;

// A contract address: farmers onboard through passkey smart wallets, and
// Stellar smart wallets are contracts.
const farmerAddress = StrKey.encodeContract(Buffer.alloc(32, 0x33));

const SEASON = 2026n;
const applicantRef = applicantRefOf("TCKN 10000000146 / demo applicant");
const parcelId = parcelIdOf("Giresun/Bulancak ada 214 parsel 7");
const binding = addressBinding(farmerAddress);

async function prove({ landDecares, attrMask }) {
  const commitment = await farmerCommitment(farmerSecret);
  const signature = await signEnrolmentForCommitment(issuerKey, {
    farmerCommitment: commitment,
    applicantRef,
    parcelId,
    landDecares,
    attrMask,
    seasonId: SEASON,
  });
  const input = await buildEnrolmentInput({
    issuerPub,
    seasonId: SEASON,
    farmerSecret,
    applicantRef,
    parcelId,
    landDecares,
    attrMask,
    signature,
    binding,
  });
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
  return { proof, publicSignals, docMask: docMaskFor(attrMask, landDecares) };
}

/**
 * The shape the contract's claim struct expects.
 *
 * `threshold_kg` is the verifier's name for "the one public scalar this circuit
 * reveals". For enrolment proofs that scalar is the document mask -- see the
 * note on `CapacityClaim` in the registry contract.
 */
const claimOf = async (docMask) => ({
  issuer_ax: toBytes32Hex(issuerPub.Ax),
  issuer_ay: toBytes32Hex(issuerPub.Ay),
  threshold_kg: Number(docMask),
  season: Number(SEASON),
  nullifier: toBytes32Hex(await computeEnrolmentNullifier(farmerSecret, SEASON)),
  address_binding: toBytes32Hex(binding),
});

console.log("generating enrolment fixtures ...");

// --- documents checked, land over the floor --------------------------------
const LAND_DECARES = 180n;
const good = await prove({ landDecares: LAND_DECARES, attrMask: BigInt(DOC.CKS | DOC.DEED) });
writeFileSync(
  join(OUT, "valid.json"),
  JSON.stringify(
    {
      note: "Real Groth16 enrolment proof: the cooperative checked ÇKS and the deed, and the circuit found 180 decares over the 10-decare floor. Published mask 11.",
      farmerAddress,
      issuerLabel: "Giresun Findik Tarim Satis Kooperatifi",
      docMask: good.docMask,
      claim: await claimOf(good.docMask),
      proof: good.proof,
      publicSignals: good.publicSignals,
      // Recorded only so a reader can see what the proof hides. None of this
      // is in the proof and none of it reaches the chain.
      secretsForDocumentationOnly: {
        landDecares: LAND_DECARES.toString(),
        applicantRef: applicantRef.toString(),
        parcelId: parcelId.toString(),
      },
    },
    null,
    2,
  ),
);

// --- a real proof that simply does not clear the requirement ---------------
// Nothing is forged here: the cooperative checked the same two documents, but
// the holding is under the floor so the circuit refuses to set the land bit.
// The registry must turn that into InsufficientDocuments rather than a pairing
// failure -- a different error for a different situation.
const small = await prove({ landDecares: MIN_DECARES - 1n, attrMask: BigInt(DOC.CKS | DOC.DEED) });
writeFileSync(
  join(OUT, "insufficient.json"),
  JSON.stringify(
    {
      note: "A valid proof whose holding is under the eligibility floor, so the circuit publishes mask 3. The registry must refuse it on the mask, not on the pairing.",
      farmerAddress,
      docMask: small.docMask,
      claim: await claimOf(small.docMask),
      proof: small.proof,
      publicSignals: small.publicSignals,
    },
    null,
    2,
  ),
);

copyFileSync(join(BUILD, "harvest_enrolment_verification_key.json"), join(OUT, "verification_key.json"));

console.log(`  farmer address : ${farmerAddress}`);
console.log(`  binding        : 0x${toBytes32Hex(binding)}`);
console.log(`  valid mask     : ${good.docMask} (ÇKS + deed + land)`);
console.log(`  refused mask   : ${small.docMask} (land bit withheld by the circuit)`);
console.log(`  wrote valid.json, insufficient.json, verification_key.json`);
console.log(`  -> ${OUT}`);

// snarkjs leaves its worker pool open, so node will not exit on its own.
process.exit(0);
