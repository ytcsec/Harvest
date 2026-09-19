/**
 * snarkjs artefacts -> the byte layout Soroban's BN254 host functions expect.
 *
 * Two conventions here were expensive to discover and are cheap to get wrong,
 * so they are stated plainly and pinned by `checkEncodingAgainstFixture()`:
 *
 *   1. **Big-endian, no flag bits.** arkworks (which Soroban's host is built
 *      on) serializes field elements little-endian with point flags in the top
 *      bits of the final byte. The host's *deserializer* wants neither. Feeding
 *      it arkworks' native output fails with
 *      `bn254 G1 deserialize: the two flag bits must be unset`.
 *
 *   2. **G2 is imaginary-part first.** snarkjs emits `pi_b[0] = [x.c0, x.c1]`;
 *      the host wants `x.c1 || x.c0`. Getting this backwards sails past the
 *      flag check and then fails with `bn254 G2: point not on curve` -- which
 *      is the tell for exactly this mistake.
 *
 * Sizes: Fq and Fr are 32 bytes, G1 is 64, G2 is 128.
 */

import { bigIntToBytes, concat, sha256, toHex } from "./bytes.mjs";

export const G1_BYTES = 64;
export const G2_BYTES = 128;
export const FIELD_BYTES = 32;

/** A decimal (or bigint) field element as 32 big-endian bytes. */
export function fieldToBytes(value) {
  return bigIntToBytes(value, FIELD_BYTES);
}

export const fieldToHex = (value) => toHex(fieldToBytes(value));

/** `[x, y, z]` from snarkjs -> 64 bytes. The projective `z` is always 1. */
export function g1ToBytes(point) {
  return concat(fieldToBytes(point[0]), fieldToBytes(point[1]));
}

/** `[[x.c0, x.c1], [y.c0, y.c1], [1, 0]]` from snarkjs -> 128 bytes, c1 first. */
export function g2ToBytes(point) {
  return concat(
    fieldToBytes(point[0][1]),
    fieldToBytes(point[0][0]),
    fieldToBytes(point[1][1]),
    fieldToBytes(point[1][0]),
  );
}

/**
 * snarkjs `verification_key.json` -> the contract's `VerificationKey` struct,
 * as hex strings the Stellar CLI accepts for `BytesN` fields.
 */
export function encodeVerificationKey(vk) {
  if (vk.protocol !== "groth16") throw new Error(`expected groth16, got ${vk.protocol}`);
  if (vk.curve !== "bn128") throw new Error(`expected bn128 (BN254), got ${vk.curve}`);
  if (vk.IC.length !== vk.nPublic + 1) {
    throw new Error(`IC has ${vk.IC.length} points for ${vk.nPublic} public signals`);
  }
  return {
    alpha: toHex(g1ToBytes(vk.vk_alpha_1)),
    beta: toHex(g2ToBytes(vk.vk_beta_2)),
    gamma: toHex(g2ToBytes(vk.vk_gamma_2)),
    delta: toHex(g2ToBytes(vk.vk_delta_2)),
    ic: vk.IC.map((p) => toHex(g1ToBytes(p))),
  };
}

/** snarkjs `proof` -> the contract's `Proof` struct. */
export function encodeProof(proof) {
  return {
    a: toHex(g1ToBytes(proof.pi_a)),
    b: toHex(g2ToBytes(proof.pi_b)),
    c: toHex(g1ToBytes(proof.pi_c)),
  };
}

/**
 * Public signals -> the contract's `CapacityClaim`.
 *
 * The contract rebuilds the signal vector from these fields in a fixed order,
 * which is what stops a caller reordering them into a different statement than
 * the circuit was compiled for. Order here must match the circuit's
 * `component main {public [...]}`: issuerAx, issuerAy, threshold, season,
 * nullifier, addressBinding.
 */
export function encodeClaim(publicSignals) {
  if (publicSignals.length !== 6) {
    throw new Error(`expected 6 public signals, got ${publicSignals.length}`);
  }
  const [ax, ay, threshold, season, nullifier, binding] = publicSignals;
  return {
    issuer_ax: fieldToHex(ax),
    issuer_ay: fieldToHex(ay),
    threshold_kg: Number(threshold),
    season: Number(season),
    nullifier: fieldToHex(nullifier),
    address_binding: fieldToHex(binding),
  };
}

/**
 * The value `HarvestVerifier.address_binding()` computes on chain:
 * sha256 of the strkey, leading byte cleared so the 248-bit result is
 * unambiguously inside BN254's scalar field.
 *
 * Kept here as well as in `attestation.mjs` because the browser needs it
 * *before* proving, while the contract needs it to validate afterwards -- and
 * the two must agree byte for byte or nothing ever verifies.
 */
export function addressBindingHex(strkey) {
  if (typeof strkey !== "string" || strkey.length !== 56) {
    throw new Error(`expected a 56-character strkey, got ${JSON.stringify(strkey)}`);
  }
  return toHex(concat(new Uint8Array(1), sha256(strkey).subarray(0, 31)));
}

/**
 * Guard against silent encoding drift.
 *
 * The Rust tests already prove these bytes verify inside the host; this
 * re-derives them from the same fixture on the JavaScript side, so a change to
 * either encoder is caught at deploy time instead of as an unexplained
 * `InvalidProof` from a live contract.
 */
export function checkEncodingAgainstFixture(fixture) {
  const claim = encodeClaim(fixture.publicSignals);
  const problems = [];
  for (const [field, expected] of Object.entries(fixture.claim)) {
    if (String(claim[field]) !== String(expected)) {
      problems.push(`${field}: derived ${claim[field]}, fixture says ${expected}`);
    }
  }
  const binding = addressBindingHex(fixture.farmerAddress);
  if (binding !== fixture.claim.address_binding) {
    problems.push(`address binding: derived ${binding}, fixture says ${fixture.claim.address_binding}`);
  }
  if (problems.length) {
    throw new Error(`encoding drift detected:\n  ${problems.join("\n  ")}`);
  }
  return true;
}
