pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 * HarvestCapacity
 * ---------------
 * Proves, in zero knowledge:
 *
 *   "I hold an attestation signed by issuer (Ax, Ay) stating that my expected
 *    harvest is E kilograms for parcel P, crop C, season S -- and E >= T."
 *
 * Revealed on chain : T (threshold), S (season), the issuer key, a nullifier,
 *                     and a binding to the caller's Stellar address.
 * Never revealed    : E (actual yield), P (parcel), the farmer's identity,
 *                     and the attestation signature itself.
 *
 * Why each public signal exists
 * -----------------------------
 * issuerAx/issuerAy  The contract pins an allow-list of accredited issuers
 *                    (cooperative / TARSIM). Without this, a farmer could sign
 *                    their own attestation.
 * threshold          The only fact the market learns. A campaign is created
 *                    against this number, not against the real capacity.
 * seasonId           Domain separation. A 2026 attestation cannot be replayed
 *                    to fund a 2027 campaign.
 * nullifier          Poseidon(farmerSecret, seasonId). Stable per farmer per
 *                    season, so the contract can (a) stop one farmer opening
 *                    ten campaigns off one attestation and (b) accumulate an
 *                    anonymous repayment reputation -- without ever learning
 *                    who the farmer is.
 * addressBinding     First 248 bits of sha256(caller Stellar address). Stops a
 *                    bystander from lifting a valid proof out of the mempool
 *                    and replaying it from their own account.
 *
 * Field note: BN254's scalar field is ~254 bits, so a 32-byte Stellar address
 * does not fit. The contract truncates the digest to 31 bytes (248 bits),
 * which is inside the field and still collision-resistant for this purpose.
 */

template HarvestCapacity(nBits) {
    // ---- public ----
    signal input issuerAx;
    signal input issuerAy;
    signal input threshold;       // kilograms, the only capacity fact revealed
    signal input seasonId;
    signal input nullifier;
    signal input addressBinding;

    // ---- private ----
    signal input yieldKg;         // the commercial secret
    signal input parcelId;
    signal input cropCode;
    signal input farmerSecret;
    signal input sigR8x;
    signal input sigR8y;
    signal input sigS;

    // 1. Rebuild the identity commitment the issuer signed over.
    //    The issuer signs a commitment to the farmer, never the raw secret.
    component farmerCommit = Poseidon(1);
    farmerCommit.inputs[0] <== farmerSecret;

    // 2. Rebuild the attestation digest.
    //    Any tampering with yield/parcel/crop/season breaks signature check.
    component msg = Poseidon(5);
    msg.inputs[0] <== yieldKg;
    msg.inputs[1] <== parcelId;
    msg.inputs[2] <== cropCode;
    msg.inputs[3] <== seasonId;
    msg.inputs[4] <== farmerCommit.out;

    // 3. The attestation really was signed by the accredited issuer.
    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax      <== issuerAx;
    sig.Ay      <== issuerAy;
    sig.R8x     <== sigR8x;
    sig.R8y     <== sigR8y;
    sig.S       <== sigS;
    sig.M       <== msg.out;

    // 4. The capacity claim: yieldKg >= threshold.
    //    This is the whole product in one constraint block.
    component ge = GreaterEqThan(nBits);
    ge.in[0] <== yieldKg;
    ge.in[1] <== threshold;
    ge.out === 1;

    // 5. Range-guard both operands so a malicious prover cannot wrap the field
    //    and make a tiny yield compare as huge. GreaterEqThan assumes inputs
    //    fit in nBits; we enforce that assumption explicitly.
    component yBits = Num2Bits(nBits);
    yBits.in <== yieldKg;
    component tBits = Num2Bits(nBits);
    tBits.in <== threshold;

    // 6. The nullifier is bound to this farmer and this season.
    component nul = Poseidon(2);
    nul.inputs[0] <== farmerSecret;
    nul.inputs[1] <== seasonId;
    nullifier === nul.out;

    // 7. Bind the proof to the caller's address. The signal must take part in
    //    at least one constraint, otherwise the compiler prunes it and the
    //    binding becomes forgeable.
    signal bindingSq;
    bindingSq <== addressBinding * addressBinding;
}

// nBits = 40  ->  up to ~1.1e12 kg of headroom, far beyond any real parcel,
// while keeping the comparator cheap.
component main {public [issuerAx, issuerAy, threshold, seasonId, nullifier, addressBinding]}
    = HarvestCapacity(40);
