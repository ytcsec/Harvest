/**
 * Membership enrolment primitives.
 *
 * The cooperative examines a farmer's documents once, signs a membership
 * credential over a commitment to the farmer, and from then on the farmer can
 * prove -- to the chain, to anyone -- that an accredited body checked those
 * documents, without handing over the documents or their own identity.
 *
 * This is the gate in front of `attestation.mjs`. Before it existed the
 * cooperative's `/attest` endpoint signed a harvest attestation for whoever
 * typed a membership number, so "an accredited cooperative vouched for this"
 * meant no more than "this person knew a member id".
 *
 * Everything here mirrors `harvest_enrolment.circom` field for field: if a
 * signature verifies here the circuit accepts it, and if it does not the
 * witness calculator refuses.
 */

import { poseidonHash, signDigest } from "./attestation.mjs";
import { bytesToBigInt, sha256 } from "./bytes.mjs";

/**
 * The document checks, as bits of the mask the enrolment proof publishes.
 *
 * Bits 0-2 are the cooperative's verdicts: it saw the paperwork and says so.
 * Bit 3 is different -- the circuit computes it from a figure the cooperative
 * signed but nobody else sees. See `LAND` below.
 */
export const DOC = {
  /** Çiftçi Kayıt Sistemi registration, the state's own farmer registry. */
  CKS: 1,
  /** Title deed or a registered lease for the parcel being farmed. */
  DEED: 2,
  /** TARSİM crop insurance policy. Optional: not every crop is insurable. */
  TARSIM: 4,
  /**
   * Land area clears the eligibility floor. Not a document check -- the
   * cooperative signs the real area privately and the *circuit* decides this
   * bit, so the chain does not have to take the cooperative's word for it.
   */
  LAND: 8,
};

/** What the registry contract insists on. TARSİM is deliberately not in here. */
export const REQUIRED_MASK = DOC.CKS | DOC.DEED | DOC.LAND;

/** Must match `MIN_DECARES` in harvest_enrolment.circom. One hectare. */
export const MIN_DECARES = 10n;

/**
 * Domain separator in the enrolment nullifier. Without it the enrolment and
 * capacity nullifiers would both be Poseidon(farmerSecret, seasonId) and a
 * capacity nullifier could be presented as an enrolment.
 */
export const ENROLMENT_TAG = 1n;

/** Human-readable labels, for UIs and logs. */
export const DOC_LABELS = {
  [DOC.CKS]: { tr: "ÇKS kaydı", en: "ÇKS farmer registration" },
  [DOC.DEED]: { tr: "Tapu / kira sözleşmesi", en: "Title deed or lease" },
  [DOC.TARSIM]: { tr: "TARSİM poliçesi", en: "TARSİM insurance policy" },
  [DOC.LAND]: { tr: "Arazi eşiği (ZK)", en: "Land threshold (ZK)" },
};

/** Decompose a mask into the bits it carries. */
export const docsInMask = (mask) =>
  [DOC.CKS, DOC.DEED, DOC.TARSIM, DOC.LAND].filter((bit) => (Number(mask) & bit) === bit);

/** Does this mask clear what the registry requires? */
export const maskIsSufficient = (mask) => (Number(mask) & REQUIRED_MASK) === REQUIRED_MASK;

/**
 * An identity document reduced to a field element.
 *
 * The cooperative holds the document; this is the only form of it that ever
 * enters the credential, and it stays a private circuit input even then. It
 * exists so the cooperative can bind the credential to a specific applicant
 * without that binding being visible on chain.
 */
export function applicantRefOf(text) {
  return bytesToBigInt(sha256(String(text).trim()).subarray(0, 31));
}

/**
 * The public mask for a given credential: the cooperative's bits, plus the
 * land verdict. Computed the same way the circuit computes it, so the issuer
 * and the UI can show what the proof is going to publish before proving.
 */
export function docMaskFor(attrMask, landDecares) {
  const land = BigInt(landDecares) >= MIN_DECARES ? DOC.LAND : 0;
  return (Number(attrMask) & 0b111) | land;
}

/**
 * The digest the cooperative signs. Mirrors component `msg` in the circuit:
 * Poseidon(farmerCommitment, applicantRef, parcelId, landDecares, attrMask, seasonId).
 */
export async function enrolmentDigestFromCommitment({
  farmerCommitment: commitment,
  applicantRef,
  parcelId,
  landDecares,
  attrMask,
  seasonId,
}) {
  return poseidonHash([commitment, applicantRef, parcelId, landDecares, attrMask, seasonId]);
}

/** Issuer side: sign a membership credential without seeing the farmer's secret. */
export async function signEnrolmentForCommitment(privKey, fields) {
  return signDigest(privKey, await enrolmentDigestFromCommitment(fields));
}

/**
 * Enrolment nullifier: stable per (farmer, season), unlinkable to the farmer,
 * and tagged so it can never collide with a capacity nullifier.
 */
export async function computeEnrolmentNullifier(farmerSecret, seasonId) {
  return poseidonHash([farmerSecret, seasonId, ENROLMENT_TAG]);
}

/**
 * Assemble the witness input for `harvest_enrolment.circom`.
 * Public signal order must match `component main {public [...]}`.
 */
export async function buildEnrolmentInput({
  issuerPub,
  seasonId,
  farmerSecret,
  applicantRef,
  parcelId,
  landDecares,
  attrMask,
  signature,
  binding,
}) {
  return {
    issuerAx: issuerPub.Ax.toString(),
    issuerAy: issuerPub.Ay.toString(),
    docMask: String(docMaskFor(attrMask, landDecares)),
    seasonId: BigInt(seasonId).toString(),
    nullifier: (await computeEnrolmentNullifier(farmerSecret, seasonId)).toString(),
    addressBinding: binding.toString(),
    farmerSecret: farmerSecret.toString(),
    applicantRef: BigInt(applicantRef).toString(),
    parcelId: BigInt(parcelId).toString(),
    landDecares: BigInt(landDecares).toString(),
    attrMask: BigInt(attrMask).toString(),
    sigR8x: signature.sigR8x.toString(),
    sigR8y: signature.sigR8y.toString(),
    sigS: signature.sigS.toString(),
  };
}
