//! On-chain verification tests, driven by real artefacts from the circom
//! circuit in `circuits/`.
//!
//! These are the tests that decide whether the privacy claim is true. A proof
//! that only ever gets checked by the same JavaScript that produced it proves
//! nothing about the chain; here the pairing runs inside the Soroban host.

mod common;

use common::*;
use harvest_verifier::{HarvestVerifier, HarvestVerifierClient, VerifierError};
use soroban_sdk::{testutils::Address as _, Address, Env, String as SorobanString};

const COOP: &str = "Giresun Findik Tarim Satis Kooperatifi";

struct Harness<'a> {
    env: Env,
    client: HarvestVerifierClient<'a>,
    admin: Address,
}

fn setup() -> Harness<'static> {
    let env = Env::default();
    env.mock_all_auths();
    // A real Groth16 pairing costs well past the default test budget.
    env.cost_estimate().budget().reset_unlimited();

    let admin = Address::generate(&env);
    let id = env.register(HarvestVerifier, ());
    let client = HarvestVerifierClient::new(&env, &id);
    client.initialize(&admin, &load_vk(&env));
    Harness { env, client, admin }
}

/// Register the fixture's issuer key as accredited.
fn accredit_from(h: &Harness, fixture: &FixtureJson) {
    h.client.accredit_issuer(
        &hex32(&h.env, &fixture.claim.issuer_ax),
        &hex32(&h.env, &fixture.claim.issuer_ay),
        &SorobanString::from_str(&h.env, COOP),
    );
}

fn farmer_of(h: &Harness, fixture: &FixtureJson) -> Address {
    Address::from_string(&SorobanString::from_str(&h.env, &fixture.farmer_address))
}

#[test]
fn accepts_a_real_capacity_proof() {
    let h = setup();
    let fx = load_fixture("valid.json");
    accredit_from(&h, &fx);

    let farmer = farmer_of(&h, &fx);
    let claim = claim_of(&h.env, &fx.claim);
    let proof = proof_of(&h.env, &fx.proof);

    // The whole product in one assertion: the chain accepts "at least 40t"
    // while 48.5t never left the farmer's device.
    h.client.verify_capacity(&farmer, &claim, &proof);
    assert!(h.client.check_capacity(&farmer, &claim, &proof));
    assert_eq!(claim.threshold_kg, 40_000);
}

#[test]
fn address_binding_matches_the_one_the_circuit_committed_to() {
    let h = setup();
    let fx = load_fixture("valid.json");
    let farmer = farmer_of(&h, &fx);

    // The contract derives sha256(strkey) independently; if the client's
    // derivation ever drifts from the contract's, every proof stops verifying.
    assert_eq!(
        h.client.address_binding(&farmer),
        hex32(&h.env, &fx.claim.address_binding),
        "client and contract disagree on the address binding",
    );
}

#[test]
fn rejects_a_proof_of_a_different_statement() {
    let h = setup();
    let fx = load_fixture("invalid.json");
    accredit_from(&h, &fx);

    // The proof is internally valid -- it just proves a 45t threshold while the
    // claim says 40t. The pairing must notice.
    let err = h
        .client
        .try_verify_capacity(&farmer_of(&h, &fx), &claim_of(&h.env, &fx.claim), &proof_of(&h.env, &fx.proof))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VerifierError::InvalidProof);
}

#[test]
fn rejects_a_flawless_proof_from_an_unaccredited_issuer() {
    let h = setup();
    let fx = load_fixture("rogue-issuer.json");
    // Deliberately do NOT accredit this issuer.

    let err = h
        .client
        .try_verify_capacity(&farmer_of(&h, &fx), &claim_of(&h.env, &fx.claim), &proof_of(&h.env, &fx.proof))
        .unwrap_err()
        .unwrap();
    assert_eq!(
        err,
        VerifierError::IssuerNotAccredited,
        "a self-signed attestation must not buy capacity, however good the maths",
    );
}

#[test]
fn rejects_a_valid_proof_replayed_from_another_account() {
    let h = setup();
    let fx = load_fixture("valid.json");
    accredit_from(&h, &fx);

    let thief = Address::generate(&h.env);
    let err = h
        .client
        .try_verify_capacity(&thief, &claim_of(&h.env, &fx.claim), &proof_of(&h.env, &fx.proof))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, VerifierError::AddressBindingMismatch);
}

#[test]
fn revoking_an_issuer_invalidates_its_outstanding_proofs() {
    let h = setup();
    let fx = load_fixture("valid.json");
    accredit_from(&h, &fx);

    let farmer = farmer_of(&h, &fx);
    let claim = claim_of(&h.env, &fx.claim);
    let proof = proof_of(&h.env, &fx.proof);
    assert!(h.client.check_capacity(&farmer, &claim, &proof));

    h.client.revoke_issuer(
        &hex32(&h.env, &fx.claim.issuer_ax),
        &hex32(&h.env, &fx.claim.issuer_ay),
    );

    assert!(
        !h.client.check_capacity(&farmer, &claim, &proof),
        "a revoked cooperative's attestations must stop working immediately",
    );
    let _ = &h.admin;
}

#[test]
fn verification_key_must_match_the_public_signal_count() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(HarvestVerifier, ());
    let client = HarvestVerifierClient::new(&env, &id);

    let mut vk = load_vk(&env);
    vk.ic.pop_back(); // 6 points for 6 signals: one short of the required 7

    let err = client.try_initialize(&admin, &vk).unwrap_err().unwrap();
    assert_eq!(err, VerifierError::MalformedVerificationKey);
}
