/**
 * Membership enrolment, end to end against the live cooperative and testnet.
 *
 *   node scripts/enrol-on-testnet.mjs        (needs `npm run issuer` running)
 *
 * The point of this script is the gate, not the green tick. Before enrolment
 * existed, the cooperative's `/attest` endpoint signed a harvest attestation
 * for whoever typed a membership number, so two browsers could each open a
 * campaign against the same grower's harvest. Every step below is a check that
 * the door is now shut, and that it shuts for the right reason.
 *
 * The chain calls are simulations against the deployed contracts: they run the
 * real BN254 pairing in the Soroban host without submitting a transaction, so
 * the script needs no funded account. The app does the real submission when a
 * farmer actually registers.
 */

import * as snarkjs from "snarkjs";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";

import {
  addressBinding,
  farmerCommitment,
  issuerPublicKey,
  randomFarmerSecret,
  verifyAttestation,
} from "../packages/sdk/src/attestation.mjs";
import {
  DOC,
  REQUIRED_MASK,
  buildEnrolmentInput,
  computeEnrolmentNullifier,
  docsInMask,
  DOC_LABELS,
} from "../packages/sdk/src/enrolment.mjs";
import { encodeClaim, encodeProof } from "../packages/sdk/src/encoding.mjs";
import {
  SorobanClient,
  addressToScVal,
  bytesN,
  claimToScVal,
  proofToScVal,
} from "../packages/sdk/src/soroban.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WASM = join(ROOT, "circuits", "build", "harvest_enrolment_js", "harvest_enrolment.wasm");
const ZKEY = join(ROOT, "circuits", "build", "harvest_enrolment_final.zkey");
const VKEY_PATH = join(ROOT, "circuits", "build", "harvest_enrolment_verification_key.json");
const ISSUER = process.env.ISSUER_URL ?? "http://localhost:8787";

const d = JSON.parse(readFileSync(join(ROOT, "deployments.json"), "utf8"));
if (!d.enrolmentVerifier) throw new Error("no enrolmentVerifier -- run node scripts/deploy-enrolment.mjs");
if (!existsSync(ZKEY)) throw new Error("no enrolment proving key -- run npm run circuit:build");

const soroban = new SorobanClient();

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${extra ? `  ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? `  ${extra}` : ""}`);
  }
};

async function api(path, init) {
  const res = await fetch(`${ISSUER}${path}`, init).catch(() => {
    throw new Error(`cannot reach the cooperative at ${ISSUER} -- is \`npm run issuer\` running?`);
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const post = (path, body) =>
  api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// ---------------------------------------------------------------------------

console.log("\nHarvest membership enrolment -- end to end\n");
console.log(`  cooperative : ${ISSUER}`);
console.log(`  verifier    : ${d.enrolmentVerifier}`);
console.log(`  registry    : ${d.registry ?? "(not deployed)"}\n`);

/**
 * The paperwork the demo growers are holding. The ÇKS number is the key the
 * cooperative looks the applicant up by -- it is the state's own farmer
 * registry, so it exists whether or not anyone has joined a cooperative. The
 * membership number is what comes back, which is why none appears here.
 */
const PAPERWORK = [
  { cks: "CKS-2026-104271", deed: "Giresun/Bulancak ada 214 parsel 7" , fullName: "Ahmet Yilmaz", nationalId: "10000000146" },
  { cks: "CKS-2026-118840", deed: "Balikesir/Edremit ada 88 parsel 12" , fullName: "Ayse Demir", nationalId: "20000000232" },
  { cks: "CKS-2026-127503", deed: "Aydin/Soke ada 51 parsel 3" , fullName: "Mehmet Kaya", nationalId: "30000000328" },
  { cks: "CKS-2026-133964", deed: "Tokat/Merkez ada 132 parsel 5" , fullName: "Kemal Guler", nationalId: "40000000414" },
];

const farmerSecret = randomFarmerSecret();
const commitment = (await farmerCommitment(farmerSecret)).toString();
const farmerAddress = Keypair.random().publicKey();

// A throwaway identity per probe. One membership per identity is a rule now,
// so a probe that succeeds would otherwise lock the ones after it out.
const freshCommitment = async () => (await farmerCommitment(randomFarmerSecret())).toString();

// --- what the cooperative asks for -----------------------------------------
const reqs = await api("/enrolment");
ok("the cooperative publishes its document requirements", reqs.status === 200);
ok(
  "the required set matches the SDK",
  reqs.body.requiredMask === REQUIRED_MASK,
  docsInMask(REQUIRED_MASK).map((b) => DOC_LABELS[b].en).join(" + "),
);

// --- nothing publishes the membership --------------------------------------
// This is the check that would have caught the leak that used to live here:
// `GET /members` answered anyone, with every grower's expected yield attached.
const listing = await api("/members");
ok(
  "there is no endpoint that lists the membership",
  listing.status === 404,
  `GET /members -> HTTP ${listing.status}`,
);
const strangerRecord = await post("/my-membership", { farmerCommitment: commitment });
ok(
  "an unenrolled commitment gets no record, and no yield",
  strangerRecord.status === 200 &&
    strangerRecord.body.membershipId === null &&
    strangerRecord.body.expectedYieldKg === undefined,
  JSON.stringify(strangerRecord.body).slice(0, 60),
);

// --- a ÇKS number the cooperative has never seen ---------------------------
// It opens a record rather than turning the grower away -- that is what a
// cooperative is for. What it will not do is take their word for the numbers.
const newcomer = await post("/apply", {
  farmerCommitment: await freshCommitment(),
  crop: "findik",
  applicant: { fullName: "Yeni Uye", nationalId: "99988877766" },
  documents: { cks: "CKS-2026-909090", deed: "Ordu/Altinordu ada 91 parsel 4" },
});
ok(
  "an unknown ÇKS number opens a new membership",
  newcomer.status === 200 && /^GFK-\d{4}-\d{4}$/.test(newcomer.body.membership?.membershipId ?? ""),
  `${newcomer.body.membership?.membershipId ?? newcomer.body.code}`,
);
ok(
  "the applicant keeps their own name",
  newcomer.body.display?.farmer === "Yeni Uye",
  newcomer.body.display?.farmer,
);
ok(
  "the cooperative books the land, not the applicant",
  Number(newcomer.body.credential?.landDecares) >= 60 && Number(newcomer.body.credential?.landDecares) <= 600,
  `${newcomer.body.credential?.landDecares} decares, derived from the ÇKS number`,
);

// A malformed one is still refused: this is a registry number, not free text.
const malformed = await post("/apply", {
  farmerCommitment: await freshCommitment(),
  crop: "findik",
  applicant: { fullName: "Yeni Uye", nationalId: "99988877766" },
  documents: { cks: "not-a-cks-number", deed: "Ordu/Altinordu ada 91 parsel 4" },
});
ok(
  "a malformed ÇKS number is refused",
  malformed.status === 422 && malformed.body.code === "CKS_MALFORMED",
  `HTTP ${malformed.status} ${malformed.body.code ?? ""}`,
);

// --- a real ÇKS number claimed by the wrong person -------------------------
// Everything on the paperwork checks out; the applicant is simply not the
// grower it belongs to. Without this the name and national id fields would be
// decorative, and the identity the credential commits to would be whatever the
// applicant typed rather than whoever the cooperative has on file.
const impostor = await post("/apply", {
  farmerCommitment: await freshCommitment(),
  applicant: { fullName: "Zeynep Kara", nationalId: "55555555555" },
  documents: { cks: PAPERWORK[0].cks, deed: PAPERWORK[0].deed },
});
ok(
  "someone else's paperwork does not make you that grower",
  impostor.status === 422 && impostor.body.code === "IDENTITY_MISMATCH",
  `HTTP ${impostor.status} ${impostor.body.code ?? ""}`,
);

// --- a real ÇKS number with the wrong deed ---------------------------------
const wrongDeed = await post("/apply", {
  farmerCommitment: commitment,
  applicant: { fullName: "Ahmet Yilmaz", nationalId: "10000000146" },
  documents: { cks: PAPERWORK[0].cks, deed: "Nowhere ada 1 parsel 1" },
});
ok(
  "a real ÇKS number with a mismatched deed is refused",
  wrongDeed.status === 422 && wrongDeed.body.code === "DOCUMENTS_REJECTED",
  `HTTP ${wrongDeed.status}`,
);

// --- the real application ---------------------------------------------------
// Walk the demo growers until one has not been claimed yet, so the script can
// be re-run without clearing the cooperative's records first. Nothing reports
// which are free any more -- the cooperative answers that one application at a
// time, which is the point.
let applied = null;
let papers = null;
for (const p of PAPERWORK) {
  const res = await post("/apply", {
    farmerCommitment: commitment,
    applicant: { fullName: p.fullName, nationalId: p.nationalId },
    documents: { cks: p.cks, deed: p.deed, tarsim: "TRS-2026-40188" },
  });
  if (res.status === 409) continue; // already enrolled to someone else
  applied = res;
  papers = p;
  break;
}
if (!applied) {
  throw new Error(
    "every demo grower is already enrolled -- delete .harvest/enrolments.json " +
      "and restart `npm run issuer` to start over",
  );
}
ok("the application is approved", applied.status === 200, `HTTP ${applied.status}`);
if (applied.status !== 200) {
  console.log("\n  cannot continue:", JSON.stringify(applied.body).slice(0, 300), "\n");
  process.exit(1);
}

const MEMBERSHIP = applied.body.membership.membershipId;
ok(
  "the membership number comes back as a result, not an input",
  /^GFK-\d{4}-\d{4}$/.test(MEMBERSHIP),
  `${papers.cks} -> ${MEMBERSHIP}`,
);

const { credential, signature, issuer, review } = applied.body;
ok(
  "the published mask is what the registry needs",
  review.sufficient && (review.docMask & REQUIRED_MASK) === REQUIRED_MASK,
  `mask ${review.docMask} (${docsInMask(review.docMask).map((b) => DOC_LABELS[b].en).join(", ")})`,
);
ok(
  "the optional TARSİM check is recorded separately",
  (review.docMask & DOC.TARSIM) === DOC.TARSIM,
);

// --- the credential really is the cooperative's -----------------------------
const issuerPub = { Ax: BigInt(issuer.ax), Ay: BigInt(issuer.ay) };
ok(
  "the credential verifies under the cooperative's key",
  await verifyAttestation(issuerPub, BigInt(signature.digest), {
    sigR8x: BigInt(signature.sigR8x),
    sigR8y: BigInt(signature.sigR8y),
    sigS: BigInt(signature.sigS),
  }),
);
ok(
  "the accredited key is the one the chain knows",
  issuer.ax === BigInt(`0x${d.issuer.ax}`).toString(),
  `${issuer.ax.slice(0, 12)}…`,
);

// --- prove it ---------------------------------------------------------------
console.log("\n  generating the enrolment proof ...");
const input = await buildEnrolmentInput({
  issuerPub,
  seasonId: BigInt(credential.season),
  farmerSecret,
  applicantRef: BigInt(credential.applicantRef),
  parcelId: BigInt(credential.parcelId),
  landDecares: BigInt(credential.landDecares),
  attrMask: BigInt(credential.attrMask),
  signature: {
    sigR8x: BigInt(signature.sigR8x),
    sigR8y: BigInt(signature.sigR8y),
    sigS: BigInt(signature.sigS),
  },
  binding: addressBinding(farmerAddress),
});

const t0 = Date.now();
const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM, ZKEY);
const provingMs = Date.now() - t0;
const vkey = JSON.parse(readFileSync(VKEY_PATH, "utf8"));
ok("the proof verifies locally", await snarkjs.groth16.verify(vkey, publicSignals, proof), `${provingMs} ms`);

const serialized = JSON.stringify({ proof, publicSignals });
ok(
  "the land area never leaves the device",
  !publicSignals.some((s) => BigInt(s) === BigInt(credential.landDecares)),
  `${credential.landDecares} decares stayed private`,
);
ok("the identity reference never leaves the device", !serialized.includes(credential.applicantRef));
ok("the parcel never leaves the device", !serialized.includes(credential.parcelId));

// --- the chain's verdict ----------------------------------------------------
// Straight off the public signals, so the claim the chain sees is exactly what
// the circuit published. `threshold_kg` is the verifier's name for "the one
// public scalar this circuit reveals" -- the document mask, for enrolment.
const claim = encodeClaim(publicSignals);
const encodedProof = encodeProof(proof);

ok(
  "the claim's scalar slot carries the document mask",
  claim.threshold_kg === review.docMask,
  `threshold_kg = ${claim.threshold_kg}`,
);
ok(
  "the claim's nullifier is the enrolment one",
  BigInt(`0x${claim.nullifier}`) === (await computeEnrolmentNullifier(farmerSecret, BigInt(credential.season))),
);

const askVerifier = (contractId) =>
  soroban.read({
    contractId,
    method: "check_capacity",
    args: [addressToScVal(farmerAddress), claimToScVal(claim), proofToScVal(encodedProof)],
    source: d.deployer,
  });

console.log("\n  asking the deployed contracts ...");
ok("the enrolment verifier accepts it", (await askVerifier(d.enrolmentVerifier)) === true);

// The circuits publish six signals in the same order, so this claim reaches the
// capacity verifier intact. Only the verification key stands between the two.
ok(
  "the capacity verifier rejects the very same proof",
  (await askVerifier(d.verifier)) === false,
  "different circuit, different key",
);

if (d.registry) {
  const seen = await soroban.read({
    contractId: d.registry,
    method: "is_registered",
    args: [bytesN(claim.nullifier)],
    source: d.deployer,
  });
  ok("the registry has not spent this nullifier yet", seen === false);

  const required = await soroban.read({
    contractId: d.registry,
    method: "config",
    args: [],
    source: d.deployer,
  });
  ok(
    "the registry demands the same mask the SDK does",
    Number(required[2]) === REQUIRED_MASK,
    `required ${required[2]}`,
  );
}

// --- the gate, after enrolment ---------------------------------------------
const after = await post("/attest", { membershipId: MEMBERSHIP, farmerCommitment: commitment });
ok("the enrolled commitment now gets its attestation", after.status === 200, `HTTP ${after.status}`);

// --- and nobody else can take it over ---------------------------------------
// The squatter has everything short of the farmer's secret: the ÇKS number, the
// deed, and now the membership number too. None of it is worth anything.
const otherSecret = randomFarmerSecret();
const otherCommitment = (await farmerCommitment(otherSecret)).toString();

const squatter = await post("/apply", {
  farmerCommitment: otherCommitment,
  applicant: { fullName: papers.fullName, nationalId: papers.nationalId },
  documents: { cks: papers.cks, deed: papers.deed, tarsim: "TRS-2026-40188" },
});
ok(
  "the same paperwork cannot enrol a second applicant",
  squatter.status === 409 && squatter.body.code === "ALREADY_ENROLLED",
  `HTTP ${squatter.status}`,
);

const squatterAttest = await post("/attest", {
  membershipId: MEMBERSHIP,
  farmerCommitment: otherCommitment,
});
ok(
  "knowing the membership number is not enough to get an attestation",
  squatterAttest.status === 403,
  `HTTP ${squatterAttest.status} -- this is the hole that is now closed`,
);

const squatterRecord = await post("/my-membership", { farmerCommitment: otherCommitment });
ok(
  "and not enough to read the grower's expected yield",
  squatterRecord.body.expectedYieldKg === undefined,
  "no yield without the secret that enrolled",
);

const mine = await post("/my-membership", { farmerCommitment: commitment });
ok(
  "the farmer's own record does come back, yield included",
  mine.body.membershipId === MEMBERSHIP && Number(mine.body.expectedYieldKg) > 0,
  `${mine.body.expectedYieldKg} kg, to the commitment that enrolled`,
);

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
