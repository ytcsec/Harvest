#![cfg(test)]
//! Full-lifecycle tests wiring together the three contracts and a real proof.
//!
//! These are integration tests in the honest sense: the verifier really runs a
//! BN254 pairing over artefacts from `circuits/`, and the vault really holds
//! the escrow. Nothing about the privacy or yield claims is stubbed.

use super::*;
use ark_bn254::Fq;
use ark_ff::{BigInteger, PrimeField};
use harvest_verifier::{HarvestVerifier, HarvestVerifierClient};
use mock_defindex_vault::{MockDefindexVault, MockDefindexVaultClient};
use serde::Deserialize;
use soroban_sdk::{
    crypto::bn254::{BN254_G1_SERIALIZED_SIZE, BN254_G2_SERIALIZED_SIZE},
    testutils::{Address as _, Ledger as _},
    token, Address, Env, String as SorobanString,
};
use std::str::FromStr;
use std::string::String as StdString;
use std::vec::Vec as StdVec;

// ---------------------------------------------------------------------------
// Fixture loading (shares the artefacts generated for the verifier's tests)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct VkJson {
    vk_alpha_1: [StdString; 3],
    vk_beta_2: [[StdString; 2]; 3],
    vk_gamma_2: [[StdString; 2]; 3],
    vk_delta_2: [[StdString; 2]; 3],
    #[serde(rename = "IC")]
    ic: StdVec<[StdString; 3]>,
}

#[derive(Deserialize)]
struct ProofJson {
    pi_a: [StdString; 3],
    pi_b: [[StdString; 2]; 3],
    pi_c: [StdString; 3],
}

#[derive(Deserialize)]
struct ClaimJson {
    issuer_ax: StdString,
    issuer_ay: StdString,
    threshold_kg: u64,
    season: u32,
    nullifier: StdString,
    address_binding: StdString,
}

#[derive(Deserialize)]
struct FixtureJson {
    #[serde(rename = "farmerAddress")]
    farmer_address: StdString,
    claim: ClaimJson,
    proof: ProofJson,
}

fn fixture(name: &str) -> FixtureJson {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("harvest-verifier")
        .join("tests")
        .join("data")
        .join(name);
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!("missing {}: {e}\nRun `node export-fixtures.mjs` in circuits/", path.display())
    });
    serde_json::from_str(&raw).expect("bad fixture json")
}

/// Big-endian, flag bits clear. See harvest-verifier/tests/common for why.
fn fq_be(decimal: &str) -> [u8; 32] {
    let be = Fq::from_str(decimal).expect("bad Fq").into_bigint().to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - be.len()..].copy_from_slice(&be);
    out
}

fn g1(env: &Env, x: &str, y: &str) -> Bn254G1Affine {
    let mut buf = [0u8; BN254_G1_SERIALIZED_SIZE];
    buf[0..32].copy_from_slice(&fq_be(x));
    buf[32..64].copy_from_slice(&fq_be(y));
    Bn254G1Affine::from_array(env, &buf)
}

/// Imaginary part first, opposite to snarkjs' ordering.
fn g2(env: &Env, x0: &str, x1: &str, y0: &str, y1: &str) -> Bn254G2Affine {
    let mut buf = [0u8; BN254_G2_SERIALIZED_SIZE];
    buf[0..32].copy_from_slice(&fq_be(x1));
    buf[32..64].copy_from_slice(&fq_be(x0));
    buf[64..96].copy_from_slice(&fq_be(y1));
    buf[96..128].copy_from_slice(&fq_be(y0));
    Bn254G2Affine::from_array(env, &buf)
}

fn hex32(env: &Env, hex: &str) -> BytesN<32> {
    let mut out = [0u8; 32];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap();
    }
    BytesN::from_array(env, &out)
}

fn proof_of(env: &Env, p: &ProofJson) -> Proof {
    Proof {
        a: g1(env, &p.pi_a[0], &p.pi_a[1]),
        b: g2(env, &p.pi_b[0][0], &p.pi_b[0][1], &p.pi_b[1][0], &p.pi_b[1][1]),
        c: g1(env, &p.pi_c[0], &p.pi_c[1]),
    }
}

fn claim_of(env: &Env, c: &ClaimJson) -> CapacityClaim {
    CapacityClaim {
        issuer_ax: hex32(env, &c.issuer_ax),
        issuer_ay: hex32(env, &c.issuer_ay),
        threshold_kg: c.threshold_kg,
        season: c.season,
        nullifier: hex32(env, &c.nullifier),
        address_binding: hex32(env, &c.address_binding),
    }
}

fn verifier_vk(env: &Env) -> harvest_verifier::VerificationKey {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("harvest-verifier")
        .join("tests")
        .join("data")
        .join("verification_key.json");
    let j: VkJson = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let mut ic = Vec::new(env);
    for p in &j.ic {
        ic.push_back(g1(env, &p[0], &p[1]));
    }
    harvest_verifier::VerificationKey {
        alpha: g1(env, &j.vk_alpha_1[0], &j.vk_alpha_1[1]),
        beta: g2(env, &j.vk_beta_2[0][0], &j.vk_beta_2[0][1], &j.vk_beta_2[1][0], &j.vk_beta_2[1][1]),
        gamma: g2(env, &j.vk_gamma_2[0][0], &j.vk_gamma_2[0][1], &j.vk_gamma_2[1][0], &j.vk_gamma_2[1][1]),
        delta: g2(env, &j.vk_delta_2[0][0], &j.vk_delta_2[0][1], &j.vk_delta_2[1][0], &j.vk_delta_2[1][1]),
        ic,
    }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

/// USDC carries 7 decimals on Stellar.
const UNIT: i128 = 10_000_000;

struct World<'a> {
    env: Env,
    campaign: HarvestCampaignClient<'a>,
    vault: MockDefindexVaultClient<'a>,
    token: token::Client<'a>,
    minter: token::StellarAssetClient<'a>,
    admin: Address,
}

fn world() -> World<'static> {
    let env = Env::default();
    env.mock_all_auths();
    env.cost_estimate().budget().reset_unlimited();
    env.ledger().with_mut(|l| l.timestamp = 1_700_000_000);

    let admin = Address::generate(&env);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token::Client::new(&env, &sac.address());
    let minter = token::StellarAssetClient::new(&env, &sac.address());

    let verifier_id = env.register(HarvestVerifier, ());
    let verifier = HarvestVerifierClient::new(&env, &verifier_id);
    verifier.initialize(&admin, &verifier_vk(&env));

    let fx = fixture("valid.json");
    verifier.accredit_issuer(
        &hex32(&env, &fx.claim.issuer_ax),
        &hex32(&env, &fx.claim.issuer_ay),
        &SorobanString::from_str(&env, "Giresun Findik Kooperatifi"),
    );

    let vault_id = env.register(MockDefindexVault, ());
    let vault = MockDefindexVaultClient::new(&env, &vault_id);
    vault.initialize(&sac.address(), &admin);

    let campaign_id = env.register(HarvestCampaign, ());
    let campaign = HarvestCampaignClient::new(&env, &campaign_id);
    campaign.initialize(&admin, &verifier_id, &vault_id, &sac.address());

    World { env, campaign, vault, token, minter, admin }
}

impl World<'_> {
    fn farmer(&self, fx: &FixtureJson) -> Address {
        Address::from_string(&SorobanString::from_str(&self.env, &fx.farmer_address))
    }

    fn funded_investor(&self, amount: i128) -> Address {
        let who = Address::generate(&self.env);
        self.minter.mint(&who, &amount);
        who
    }

    fn open_campaign(&self, fx: &FixtureJson, target: i128) -> u32 {
        self.open_campaign_min(fx, target, 10_000)
    }

    /// A campaign the farmer can start drawing once `min_bps` of it is raised.
    fn open_campaign_min(&self, fx: &FixtureJson, target: i128, min_bps: u32) -> u32 {
        self.campaign.create_campaign(
            &self.farmer(fx),
            &claim_of(&self.env, &fx.claim),
            &proof_of(&self.env, &fx.proof),
            &SorobanString::from_str(&self.env, "Giresun Tombul Findik"),
            &SorobanString::from_str(&self.env, "Giresun / Bulancak"),
            &target,
            &(self.env.ledger().timestamp() + 30 * 86_400),
            &1_500,
            &min_bps,
        )
    }

    /// Simulate a strategy earning: really mint the underlying to the vault, so
    /// the share price moves because the vault's balance moved.
    fn accrue(&self, amount: i128) {
        self.minter.mint(&self.vault.address, &amount);
        self.vault.accrue_yield(&amount);
    }

    fn past_deadline(&self) {
        self.env.ledger().with_mut(|l| l.timestamp += 31 * 86_400);
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn a_campaign_needs_a_valid_capacity_proof() {
    let w = world();
    let fx = fixture("valid.json");
    let id = w.open_campaign(&fx, 1_000 * UNIT);

    let c = w.campaign.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::Funding);
    // The chain knows "at least 40 tonnes" and nothing more precise.
    assert_eq!(c.threshold_kg, 40_000);
    assert_eq!(c.season, 2026);
}

#[test]
fn a_proof_of_the_wrong_statement_cannot_open_a_campaign() {
    let w = world();
    let fx = fixture("invalid.json");
    let err = w
        .campaign
        .try_create_campaign(
            &w.farmer(&fx),
            &claim_of(&w.env, &fx.claim),
            &proof_of(&w.env, &fx.proof),
            &SorobanString::from_str(&w.env, "Findik"),
            &SorobanString::from_str(&w.env, "Giresun"),
            &(1_000 * UNIT),
            &(w.env.ledger().timestamp() + 86_400),
            &1_500,
            &10_000,
        );
    assert!(err.is_err(), "a mismatched proof must not create a campaign");
    assert_eq!(w.campaign.campaign_count(), 0);
}

#[test]
fn one_attestation_cannot_open_two_campaigns() {
    let w = world();
    let fx = fixture("valid.json");
    w.open_campaign(&fx, 1_000 * UNIT);

    let err = w
        .campaign
        .try_create_campaign(
            &w.farmer(&fx),
            &claim_of(&w.env, &fx.claim),
            &proof_of(&w.env, &fx.proof),
            &SorobanString::from_str(&w.env, "Findik"),
            &SorobanString::from_str(&w.env, "Giresun"),
            &(500 * UNIT),
            &(w.env.ledger().timestamp() + 86_400),
            &1_500,
            &10_000,
        )
        .unwrap_err()
        .unwrap();
    assert_eq!(err, CampaignError::NullifierAlreadyUsed);
}

#[test]
fn contributions_land_in_the_vault_not_in_this_contract() {
    let w = world();
    let fx = fixture("valid.json");
    let id = w.open_campaign(&fx, 1_000 * UNIT);

    let investor = w.funded_investor(400 * UNIT);
    w.campaign.fund(&investor, &id, &(400 * UNIT));

    // The escrow *is* the vault position. Idle money in the campaign contract
    // would mean the yield story is decorative.
    assert_eq!(w.token.balance(&w.campaign.address), 0);
    assert_eq!(w.token.balance(&w.vault.address), 400 * UNIT);
    assert!(w.campaign.get_campaign(&id).shares > 0);
}

#[test]
fn a_missed_target_returns_principal_plus_the_yield_earned_while_waiting() {
    let w = world();
    let fx = fixture("valid.json");
    let id = w.open_campaign(&fx, 1_000 * UNIT);

    let alice = w.funded_investor(300 * UNIT);
    let bob = w.funded_investor(100 * UNIT);
    w.campaign.fund(&alice, &id, &(300 * UNIT));
    w.campaign.fund(&bob, &id, &(100 * UNIT));

    // 40 USDC earned over the funding window on 400 deposited.
    w.accrue(40 * UNIT);
    w.past_deadline();

    let recovered = w.campaign.close_unfunded(&id);
    assert_eq!(recovered, 440 * UNIT, "principal plus vault yield");
    assert_eq!(w.campaign.get_campaign(&id).status, CampaignStatus::Refunding);

    // This is the load-bearing claim for DeFindex: backing a campaign that
    // failed still left both investors better off than holding cash.
    assert_eq!(w.campaign.claim(&alice, &id), 330 * UNIT);
    assert_eq!(w.campaign.claim(&bob, &id), 110 * UNIT);
    assert_eq!(w.token.balance(&alice), 330 * UNIT);
    assert_eq!(w.token.balance(&bob), 110 * UNIT);
}

#[test]
fn an_investor_cannot_claim_twice() {
    let w = world();
    let fx = fixture("valid.json");
    let id = w.open_campaign(&fx, 1_000 * UNIT);
    let alice = w.funded_investor(300 * UNIT);
    w.campaign.fund(&alice, &id, &(300 * UNIT));
    w.past_deadline();
    w.campaign.close_unfunded(&id);
    w.campaign.claim(&alice, &id);

    let err = w.campaign.try_claim(&alice, &id).unwrap_err().unwrap();
    assert_eq!(err, CampaignError::AlreadyClaimed);
}

#[test]
fn the_full_happy_path_pays_everyone_and_raises_the_anonymous_tier() {
    let w = world();
    let fx = fixture("valid.json");
    let farmer = w.farmer(&fx);
    let id = w.open_campaign(&fx, 1_000 * UNIT);

    let alice = w.funded_investor(600 * UNIT);
    let bob = w.funded_investor(400 * UNIT);
    w.campaign.fund(&alice, &id, &(600 * UNIT));
    w.campaign.fund(&bob, &id, &(400 * UNIT));
    assert_eq!(w.campaign.get_campaign(&id).status, CampaignStatus::Funded);

    // 20 USDC of vault yield accrues before the farmer draws.
    w.accrue(20 * UNIT);

    let advance = w.campaign.disburse(&id);
    assert_eq!(advance, 1_000 * UNIT);
    assert_eq!(w.token.balance(&farmer), 1_000 * UNIT, "farmer draws the advance");

    let c = w.campaign.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::Disbursed);
    assert_eq!(c.investor_pool, 20 * UNIT, "funding-window yield is kept for investors");

    // Harvest comes in; the farmer repays principal + 15%.
    let due = w.campaign.amount_due(&id);
    assert_eq!(due, 1_150 * UNIT);
    w.minter.mint(&farmer, &(150 * UNIT)); // proceeds of the sale
    let tier = w.campaign.repay(&id);
    assert_eq!(tier, 1);

    // Pool = 20 yield + 1150 repayment, split by contribution.
    assert_eq!(w.campaign.claim(&alice, &id), 702 * UNIT);
    assert_eq!(w.campaign.claim(&bob, &id), 468 * UNIT);

    // Anonymous reputation moved, and it is keyed to the nullifier -- there is
    // no address anywhere in this lookup.
    assert_eq!(w.campaign.reputation_of(&c.nullifier), 1);
    assert_eq!(w.campaign.quoted_rate_bps(&c.nullifier), 1_300);
    let _ = &w.admin;
}

#[test]
fn repeat_seasons_price_cheaper_without_revealing_who_the_farmer_is() {
    let w = world();
    let fx = fixture("valid.json");
    let nullifier = hex32(&w.env, &fx.claim.nullifier);

    assert_eq!(w.campaign.quoted_rate_bps(&nullifier), 1_500, "first season");

    let id = w.open_campaign(&fx, 100 * UNIT);
    let alice = w.funded_investor(100 * UNIT);
    w.campaign.fund(&alice, &id, &(100 * UNIT));
    w.campaign.disburse(&id);
    w.minter.mint(&w.farmer(&fx), &(15 * UNIT));
    w.campaign.repay(&id);

    assert_eq!(w.campaign.quoted_rate_bps(&nullifier), 1_300, "one season of history");
}

#[test]
fn funding_cannot_overshoot_the_target_or_outlive_the_deadline() {
    let w = world();
    let fx = fixture("valid.json");
    let id = w.open_campaign(&fx, 100 * UNIT);
    let alice = w.funded_investor(500 * UNIT);

    let err = w
        .campaign
        .try_fund(&alice, &id, &(101 * UNIT))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, CampaignError::ExceedsTarget);

    w.past_deadline();
    let err = w
        .campaign
        .try_fund(&alice, &id, &(50 * UNIT))
        .unwrap_err()
        .unwrap();
    assert_eq!(err, CampaignError::DeadlinePassed);
}

// ---------------------------------------------------------------------------
// Minimum threshold: draw from half, keep drawing as money arrives
// ---------------------------------------------------------------------------

#[test]
fn the_farmer_cannot_draw_before_the_minimum_is_met() {
    let w = world();
    let fx = fixture("valid.json");
    let id = w.open_campaign_min(&fx, 1_000 * UNIT, 5_000);

    let alice = w.funded_investor(499 * UNIT);
    w.campaign.fund(&alice, &id, &(499 * UNIT));

    let err = w.campaign.try_disburse(&id).unwrap_err().unwrap();
    assert_eq!(err, CampaignError::BelowMinimum);
}

#[test]
fn half_funded_the_farmer_draws_and_keeps_drawing_as_money_arrives() {
    let w = world();
    let fx = fixture("valid.json");
    let farmer = w.farmer(&fx);
    let id = w.open_campaign_min(&fx, 1_000 * UNIT, 5_000);

    let alice = w.funded_investor(500 * UNIT);
    w.campaign.fund(&alice, &id, &(500 * UNIT));
    w.accrue(10 * UNIT);

    // Half the target is in: the farmer does not wait for the rest.
    assert_eq!(w.campaign.disburse(&id), 500 * UNIT);
    assert_eq!(w.token.balance(&farmer), 500 * UNIT);
    let c = w.campaign.get_campaign(&id);
    assert_eq!(c.status, CampaignStatus::Funding, "funding stays open");
    assert_eq!(c.disbursed, 500 * UNIT);
    assert_eq!(c.investor_pool, 10 * UNIT, "yield so far is kept for investors");

    // Nothing new yet.
    let err = w.campaign.try_disburse(&id).unwrap_err().unwrap();
    assert_eq!(err, CampaignError::NothingToDisburse);

    // The rest arrives and the farmer draws it too.
    let bob = w.funded_investor(500 * UNIT);
    w.campaign.fund(&bob, &id, &(500 * UNIT));
    assert_eq!(w.campaign.get_campaign(&id).status, CampaignStatus::Funded);
    assert_eq!(w.campaign.disburse(&id), 500 * UNIT);
    assert_eq!(w.token.balance(&farmer), 1_000 * UNIT);
    assert_eq!(w.campaign.get_campaign(&id).status, CampaignStatus::Disbursed);

    // Repay on everything drawn: 1000 + 15%.
    assert_eq!(w.campaign.amount_due(&id), 1_150 * UNIT);
    w.minter.mint(&farmer, &(150 * UNIT));
    w.campaign.repay(&id);

    // Pool = 10 yield + 1150, split by contribution.
    assert_eq!(w.campaign.claim(&alice, &id), 580 * UNIT);
    assert_eq!(w.campaign.claim(&bob, &id), 580 * UNIT);
}

#[test]
fn if_the_rest_never_comes_the_farmer_carries_on_with_what_was_raised() {
    let w = world();
    let fx = fixture("valid.json");
    let farmer = w.farmer(&fx);
    let id = w.open_campaign_min(&fx, 1_000 * UNIT, 5_000);

    let alice = w.funded_investor(600 * UNIT);
    w.campaign.fund(&alice, &id, &(600 * UNIT));
    assert_eq!(w.campaign.disburse(&id), 600 * UNIT);

    // The deadline passes short of the target. Refunding is not an option:
    // the minimum was met and the farmer already has the money.
    w.past_deadline();
    let err = w.campaign.try_close_unfunded(&id).unwrap_err().unwrap();
    assert_eq!(err, CampaignError::WrongStatus);

    // Closing the draw opens repayment on the 600 actually drawn.
    assert_eq!(w.campaign.disburse(&id), 0);
    assert_eq!(w.campaign.get_campaign(&id).status, CampaignStatus::Disbursed);
    assert_eq!(w.campaign.amount_due(&id), 690 * UNIT);

    w.minter.mint(&farmer, &(90 * UNIT));
    w.campaign.repay(&id);
    assert_eq!(w.campaign.claim(&alice, &id), 690 * UNIT);
}

#[test]
fn below_the_minimum_investors_are_refunded_and_the_farmer_may_try_again() {
    let w = world();
    let fx = fixture("valid.json");
    let id = w.open_campaign_min(&fx, 1_000 * UNIT, 5_000);

    let alice = w.funded_investor(300 * UNIT);
    w.campaign.fund(&alice, &id, &(300 * UNIT));
    w.past_deadline();

    assert_eq!(w.campaign.close_unfunded(&id), 300 * UNIT);
    assert_eq!(w.campaign.claim(&alice, &id), 300 * UNIT);

    // The farmer was never financed on this attestation, so the same proof
    // can back a smaller campaign in the same season.
    let retry = w.open_campaign_min(&fx, 400 * UNIT, 5_000);
    assert_eq!(w.campaign.get_campaign(&retry).status, CampaignStatus::Funding);
}
