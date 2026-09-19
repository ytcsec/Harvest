pragma circom 2.1.6;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/eddsaposeidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

/*
 * HarvestEnrolment
 * ----------------
 * Proves, in zero knowledge:
 *
 *   "An accredited cooperative examined my membership documents and signed off
 *    on them. Here is which checks passed. I am not showing you my identity
 *    document, my parcel, or how much land I hold."
 *
 * This is the gate in front of `harvest_capacity`. Without it the cooperative's
 * attestation service signs for whoever types a membership number, so the
 * "accredited issuer" chain is only as strong as knowing someone's member id.
 *
 * Revealed on chain : docMask (which checks passed), season, the issuer key,
 *                     an enrolment nullifier, and a binding to the caller.
 * Never revealed    : the identity document, the parcel, the land area, and
 *                     which member of the cooperative this is.
 *
 * Why each public signal exists
 * -----------------------------
 * issuerAx/issuerAy  Same accredited-issuer allow-list the capacity verifier
 *                    pins. A farmer cannot sign their own enrolment.
 * docMask            The selective disclosure. Bits 0-2 are the document
 *                    checks the cooperative performed; bit 3 is computed in
 *                    *this* circuit from a private figure (see below). The
 *                    registry contract reads it to decide whether the enrolment
 *                    clears the required set.
 * seasonId           Domain separation, as in the capacity circuit. A 2026
 *                    enrolment does not carry into 2027.
 * nullifier          Poseidon(farmerSecret, seasonId, ENROLMENT_TAG). Lets the
 *                    registry refuse a second enrolment for the same farmer
 *                    without learning who they are. The third input is what
 *                    keeps it from colliding with the capacity circuit's
 *                    Poseidon(farmerSecret, seasonId).
 * addressBinding     As in the capacity circuit: stops a bystander lifting a
 *                    valid enrolment proof and replaying it from their account.
 *
 * The private predicate
 * ---------------------
 * Land area is commercially sensitive for exactly the reason yield is: it tells
 * a buyer how much you can deliver. So the cooperative signs the real figure,
 * the circuit checks it against the eligibility floor, and only the *verdict*
 * -- one bit -- becomes public. `MIN_DECARES` is a template parameter, so it is
 * fixed in the circuit and auditable by anyone with the .circom file.
 *
 * Six public signals, in the order `CapacityClaim` declares its fields. That is
 * deliberate: the enrolment verifier is another instance of the same
 * `harvest-verifier` contract, holding this circuit's verification key instead.
 * The key is what keeps the two proof types from being interchangeable.
 */

template HarvestEnrolment(nBits, MIN_DECARES) {
    // ---- public ----
    signal input issuerAx;
    signal input issuerAy;
    signal input docMask;         // bits 0-2 documents, bit 3 land eligibility
    signal input seasonId;
    signal input nullifier;
    signal input addressBinding;

    // ---- private ----
    signal input farmerSecret;    // the same long-lived secret the capacity proof uses
    signal input applicantRef;    // Poseidon of the identity document reference
    signal input parcelId;
    signal input landDecares;     // the commercial secret this circuit protects
    signal input attrMask;        // bits 0-2 as signed by the cooperative
    signal input sigR8x;
    signal input sigR8y;
    signal input sigS;

    // 1. Rebuild the identity commitment the cooperative signed over. It sees
    //    Poseidon(farmerSecret), never the secret, so it cannot later link an
    //    enrolment to the campaigns that secret opens.
    component farmerCommit = Poseidon(1);
    farmerCommit.inputs[0] <== farmerSecret;

    // 2. Rebuild the membership credential digest. Tampering with any field --
    //    the land figure included -- breaks the signature check below.
    component msg = Poseidon(6);
    msg.inputs[0] <== farmerCommit.out;
    msg.inputs[1] <== applicantRef;
    msg.inputs[2] <== parcelId;
    msg.inputs[3] <== landDecares;
    msg.inputs[4] <== attrMask;
    msg.inputs[5] <== seasonId;

    // 3. The credential really was issued by the accredited cooperative.
    component sig = EdDSAPoseidonVerifier();
    sig.enabled <== 1;
    sig.Ax      <== issuerAx;
    sig.Ay      <== issuerAy;
    sig.R8x     <== sigR8x;
    sig.R8y     <== sigR8y;
    sig.S       <== sigS;
    sig.M       <== msg.out;

    // 4. The cooperative's own bits occupy 0-2 and nothing else. Without this
    //    a malicious prover could hand in attrMask = 8 and claim the land bit
    //    without ever satisfying the comparison in step 5.
    component aBits = Num2Bits(3);
    aBits.in <== attrMask;

    // 5. The eligibility floor, decided here rather than by the cooperative, so
    //    the chain does not have to take anyone's word for it. Range-guard the
    //    operand first: GreaterEqThan assumes its inputs fit in nBits, and a
    //    prover who can wrap the field could make a sliver of land compare as
    //    an estate.
    component lBits = Num2Bits(nBits);
    lBits.in <== landDecares;

    component ge = GreaterEqThan(nBits);
    ge.in[0] <== landDecares;
    ge.in[1] <== MIN_DECARES;

    // 6. The published mask: the cooperative's three document bits, plus the
    //    land verdict this circuit just computed.
    docMask === attrMask + 8 * ge.out;

    // 7. One enrolment per farmer per season, tagged so it can never be
    //    confused with a capacity nullifier.
    component nul = Poseidon(3);
    nul.inputs[0] <== farmerSecret;
    nul.inputs[1] <== seasonId;
    nul.inputs[2] <== 1;          // ENROLMENT_TAG
    nullifier === nul.out;

    // 8. Bind the proof to the caller's address. The signal has to take part in
    //    a constraint or the compiler prunes it and the binding is forgeable.
    signal bindingSq;
    bindingSq <== addressBinding * addressBinding;
}

// nBits = 32  ->  up to ~4.3e9 decares, far past any holding, comparator stays cheap.
// MIN_DECARES = 10  ->  one hectare, the floor for a productive member. Low on
// purpose: this is an eligibility check, not a way to shut smallholders out.
component main {public [issuerAx, issuerAy, docMask, seasonId, nullifier, addressBinding]}
    = HarvestEnrolment(32, 10);
