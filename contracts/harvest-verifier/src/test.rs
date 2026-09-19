#![cfg(test)]
use super::*;
use soroban_sdk::testutils::Address as _;

#[test]
fn address_binding_is_deterministic_and_field_safe() {
    let env = Env::default();
    let id = env.register(HarvestVerifier, ());
    let client = HarvestVerifierClient::new(&env, &id);

    let who = Address::generate(&env);
    let a = client.address_binding(&who);
    let b = client.address_binding(&who);
    assert_eq!(a, b, "binding must be deterministic");
    assert_eq!(a.to_array()[0], 0, "high byte must be cleared to fit BN254");

    let other = Address::generate(&env);
    assert_ne!(a, client.address_binding(&other), "must be per-address");
}
