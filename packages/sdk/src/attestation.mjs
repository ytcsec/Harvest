/**
 * Harvest attestation primitives.
 *
 * Shared by the issuer service (which signs), the browser (which proves) and
 * the tests (which do both). Everything here is real EdDSA-Poseidon over Baby
 * Jubjub -- the same curve arithmetic the circom circuit re-executes inside the
 * proof. If a signature verifies here, the circuit accepts it; if it does not,
 * the circuit refuses to produce a witness.
 */

import { buildEddsa, buildPoseidon } from "circomlibjs";
import { bytesToBigInt, randomBytes, sha256 } from "./bytes.mjs";

let _crypto = null;

/** Lazily build (and cache) the WASM-backed curve + hash implementations. */
export async function getCrypto() {
  if (!_crypto) {
    const [eddsa, poseidon] = await Promise.all([buildEddsa(), buildPoseidon()]);
    _crypto = { eddsa, poseidon, F: poseidon.F };
  }
  return _crypto;
}

/** Poseidon over BigInts -> BigInt. */
export async function poseidonHash(inputs) {
  const { poseidon, F } = await getCrypto();
  return F.toObject(poseidon(inputs.map((x) => BigInt(x))));
}

/**
 * Derive the issuer's Baby Jubjub public key from a 32-byte private key.
 * In production this private key lives in the cooperative's HSM; for the
 * hackathon it is an env var on the issuer service.
 */
export async function issuerPublicKey(privKey) {
  const { eddsa, F } = await getCrypto();
  const [Ax, Ay] = eddsa.prv2pub(privKey);
  return { Ax: F.toObject(Ax), Ay: F.toObject(Ay) };
}

export function randomIssuerKey() {
  return randomBytes(32);
}

/**
 * The farmer's long-lived secret. Never leaves the device, never reaches the
 * issuer in the clear -- the issuer only ever sees Poseidon(farmerSecret).
 */
export function randomFarmerSecret() {
  // Reduce into the BN254 scalar field by taking 31 bytes (248 bits).
  return bytesToBigInt(randomBytes(31));
}

/** The commitment the issuer binds the attestation to. */
export async function farmerCommitment(farmerSecret) {
  return poseidonHash([farmerSecret]);
}

/**
 * The digest the issuer signs. Mirrors component `msg` in the circuit exactly:
 * Poseidon(yieldKg, parcelId, cropCode, seasonId, farmerCommitment).
 *
 * This is the commitment-first form, and it is the one the issuer service uses:
 * the cooperative signs over `Poseidon(farmerSecret)` and never learns the
 * secret itself. Two farmers cannot be linked across seasons from anything the
 * issuer holds.
 */
export async function attestationDigestFromCommitment({
  yieldKg,
  parcelId,
  cropCode,
  seasonId,
  farmerCommitment: commitment,
}) {
  return poseidonHash([yieldKg, parcelId, cropCode, seasonId, commitment]);
}

/** Convenience wrapper for callers that hold the secret (tests, local demos). */
export async function attestationDigest({ yieldKg, parcelId, cropCode, seasonId, farmerSecret }) {
  return attestationDigestFromCommitment({
    yieldKg,
    parcelId,
    cropCode,
    seasonId,
    farmerCommitment: await farmerCommitment(farmerSecret),
  });
}

/** Sign a precomputed digest with the issuer key. */
export async function signDigest(privKey, digest) {
  const { eddsa, F } = await getCrypto();
  const sig = eddsa.signPoseidon(privKey, F.e(digest));
  return {
    digest,
    sigR8x: F.toObject(sig.R8[0]),
    sigR8y: F.toObject(sig.R8[1]),
    sigS: BigInt(sig.S),
  };
}

/**
 * Issuer side, commitment form: sign an attestation without ever seeing the
 * farmer's secret. This is what the cooperative service actually calls.
 */
export async function signAttestationForCommitment(privKey, fields) {
  return signDigest(privKey, await attestationDigestFromCommitment(fields));
}

/**
 * Issuer side, secret form. Convenient for tests and the local demo, where the
 * same process plays both roles.
 */
export async function signAttestation(privKey, fields) {
  return signDigest(privKey, await attestationDigest(fields));
}

/** Off-circuit sanity check; the circuit is the real gate. */
export async function verifyAttestation(pub, digest, sig) {
  const { eddsa, F } = await getCrypto();
  return eddsa.verifyPoseidon(
    F.e(digest),
    { R8: [F.e(sig.sigR8x), F.e(sig.sigR8y)], S: sig.sigS },
    [F.e(pub.Ax), F.e(pub.Ay)],
  );
}

/** Nullifier: stable per (farmer, season), reveals nothing about either. */
export async function computeNullifier(farmerSecret, seasonId) {
  return poseidonHash([farmerSecret, seasonId]);
}

/**
 * Bind a proof to the Stellar account that will submit it.
 *
 * `sha256(strkey ASCII)` truncated to the leading 31 bytes, so the result is
 * guaranteed to sit inside BN254's ~254-bit scalar field. `HarvestVerifier.
 * address_binding()` recomputes exactly this on chain and rejects the proof
 * unless the public signal matches -- which is what stops a proof being lifted
 * off the network and replayed from someone else's account.
 *
 * Hashing the strkey rather than the XDR encoding keeps the browser side to a
 * single WebCrypto call with no XDR dependency.
 *
 * @param {string} strkey A Stellar address, e.g. "GABC..." or "CBQ...".
 */
export function addressBinding(strkey) {
  if (typeof strkey !== "string" || strkey.length !== 56) {
    throw new Error(`expected a 56-character strkey, got ${JSON.stringify(strkey)}`);
  }
  return bytesToBigInt(sha256(strkey).subarray(0, 31));
}

/**
 * Assemble the full witness input for the circuit.
 * Public signal order here must match `component main {public [...]}`.
 */
export async function buildCircuitInput({
  issuerPub,
  threshold,
  seasonId,
  farmerSecret,
  yieldKg,
  parcelId,
  cropCode,
  signature,
  binding,
}) {
  return {
    issuerAx: issuerPub.Ax.toString(),
    issuerAy: issuerPub.Ay.toString(),
    threshold: BigInt(threshold).toString(),
    seasonId: BigInt(seasonId).toString(),
    nullifier: (await computeNullifier(farmerSecret, seasonId)).toString(),
    addressBinding: binding.toString(),
    yieldKg: BigInt(yieldKg).toString(),
    parcelId: BigInt(parcelId).toString(),
    cropCode: BigInt(cropCode).toString(),
    farmerSecret: farmerSecret.toString(),
    sigR8x: signature.sigR8x.toString(),
    sigR8y: signature.sigR8y.toString(),
    sigS: signature.sigS.toString(),
  };
}

/** Stable numeric code for a crop, so the circuit can bind to it. */
export function cropCodeOf(name) {
  return bytesToBigInt(sha256(name.toLowerCase().trim()).subarray(0, 8));
}

/** Parcel identifier ("ada/parsel") reduced to a field element. Stays private. */
export function parcelIdOf(text) {
  return bytesToBigInt(sha256(text.trim()).subarray(0, 31));
}
