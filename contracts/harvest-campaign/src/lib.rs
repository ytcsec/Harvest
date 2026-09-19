#![no_std]
//! # Harvest Campaign
//!
//! Pre-harvest financing whose escrow is a DeFindex vault position.
//!
//! ## The two integrations, and why neither is decoration
//!
//! **Zero-knowledge.** A campaign cannot be created without a Groth16 proof
//! that an accredited cooperative attested to at least `threshold_kg`. The
//! proof is verified by [`HarvestVerifier`] on chain, and the real figure never
//! reaches the network. Remove this and the farmer has to publish their
//! capacity to raise money, which is the exact harm the product exists to
//! prevent.
//!
//! **DeFindex.** Contributions do not sit in this contract. They are deposited
//! into a vault the moment they arrive and only come back out at settlement.
//! In an economy running high inflation, money parked for a 45-day funding
//! window that then fails to reach its goal is a real loss, and rational
//! investors respond by waiting until a campaign is nearly funded -- which
//! means nothing ever gets funded. Yield-bearing escrow removes the penalty
//! for committing early. Remove it and the crowdfunding mechanic stalls.
//!
//! ## Settlement
//!
//! Every terminal path converts the vault position into a fixed `investor_pool`
//! and then lets investors claim pro rata, rather than pushing funds to a list
//! of addresses. Pull-based payouts keep settlement O(1) and mean one hostile
//! or unfunded account cannot brick everyone else's exit.
//!
//! - **Minimum missed.** If the deadline passes before `min_bps` of the target
//!   is raised, the whole position is withdrawn and becomes the pool, so
//!   investors get principal *plus* whatever the vault earned while waiting.
//!   The nullifier is released, so the farmer can try again this season with a
//!   smaller target.
//! - **Minimum met.** From that moment the farmer can draw what has been
//!   raised, and draw again as more arrives, until the target is reached or
//!   the deadline passes. The yield earned while waiting stays behind for
//!   investors. `min_bps = 10_000` is the classic all-or-nothing campaign.
//! - **Repayment.** The farmer repays what was actually drawn plus the agreed
//!   return; it is added to the pool, and the anonymous reputation tier behind
//!   the campaign's nullifier goes up.

use soroban_sdk::{
    auth::{ContractContext, InvokerContractAuthEntry, SubContractInvocation},
    contract, contractclient, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine},
    symbol_short, token, vec, Address, BytesN, Env, IntoVal, String, Symbol, Val, Vec,
};

// ---------------------------------------------------------------------------
// External interfaces
// ---------------------------------------------------------------------------

/// The slice of `paltalabs/defindex`'s `VaultTrait` that Harvest uses.
///
/// Signatures match the real contract exactly, so the vault address can point
/// at a live DeFindex vault or at `mock-defindex-vault` with no code change.
/// `deposit`'s third return slot is a per-strategy report whose type lives in
/// DeFindex's own crates; decoding it as an opaque [`Val`] avoids vendoring
/// those types just to throw the value away.
#[contractclient(name = "DefindexVaultClient")]
pub trait DefindexVault {
    fn deposit(
        env: Env,
        amounts_desired: Vec<i128>,
        amounts_min: Vec<i128>,
        from: Address,
        invest: bool,
    ) -> (Vec<i128>, i128, Val);

    fn withdraw(env: Env, df_amount: i128, min_amounts_out: Vec<i128>, from: Address) -> Vec<i128>;
}

/// Mirrors `harvest_verifier`'s public types.
///
/// Deliberately re-declared rather than imported: depending on the verifier
/// crate would compile its `#[contractimpl]` exports into this wasm too, and a
/// contract that exports another contract's entry points is a real hazard.
/// Soroban's encoding is structural, so identical field names and types are
/// wire-compatible -- and `campaign.rs`'s integration test proves it by calling
/// the actual verifier contract with a real proof.
#[contracttype]
#[derive(Clone)]
pub struct CapacityClaim {
    pub issuer_ax: BytesN<32>,
    pub issuer_ay: BytesN<32>,
    pub threshold_kg: u64,
    pub season: u32,
    pub nullifier: BytesN<32>,
    pub address_binding: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

#[contractclient(name = "VerifierClient")]
pub trait CapacityVerifier {
    fn verify_capacity(env: Env, caller: Address, claim: CapacityClaim, proof: Proof);
}

// ---------------------------------------------------------------------------
// Errors and state
// ---------------------------------------------------------------------------

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum CampaignError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotFound = 3,
    /// This farmer already has a campaign for this season.
    NullifierAlreadyUsed = 4,
    InvalidAmount = 5,
    /// Funding is closed, or the action does not match the current status.
    WrongStatus = 6,
    DeadlineNotReached = 7,
    DeadlinePassed = 8,
    /// Contribution would take the campaign past its target.
    ExceedsTarget = 9,
    NothingToClaim = 10,
    AlreadyClaimed = 11,
    InvalidParameters = 12,
    // 13 is left unused: callers already read #13 from the USDC token contract
    // as "no trustline", and campaign calls surface both.
    /// Less than the campaign's minimum has been raised.
    BelowMinimum = 14,
    /// Nothing new to draw, and funding is still open.
    NothingToDisburse = 15,
}

#[contracttype]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CampaignStatus {
    /// Accepting contributions; funds are earning in the vault. Once the
    /// minimum is met the farmer may already have drawn part of the advance.
    Funding,
    /// Target reached, farmer has not drawn all of it yet.
    Funded,
    /// Funding closed and everything raised paid out; waiting on the harvest.
    Disbursed,
    /// Farmer repaid. Investors claim principal + return + yield.
    Repaid,
    /// Goal missed. Investors claim principal + yield.
    Refunding,
}

#[contracttype]
#[derive(Clone)]
pub struct Campaign {
    pub id: u32,
    pub farmer: Address,
    pub crop: String,
    pub region: String,
    pub season: u32,
    /// The only capacity fact on chain. The real figure stayed on the device.
    pub threshold_kg: u64,
    /// Anonymous per-farmer-per-season handle. Not linkable to an identity.
    pub nullifier: BytesN<32>,
    pub target: i128,
    pub raised: i128,
    /// Vault shares this campaign currently holds.
    pub shares: i128,
    pub deadline: u64,
    /// What the farmer promises back, in basis points over principal.
    pub return_bps: u32,
    /// Share of the target, in basis points, that must be raised before the
    /// farmer can draw. 10_000 means all or nothing.
    pub min_bps: u32,
    /// Principal paid out to the farmer so far.
    pub disbursed: i128,
    pub status: CampaignStatus,
    /// Final, fixed amount investors divide once the campaign is terminal.
    pub investor_pool: i128,
}

#[contracttype]
enum DataKey {
    Admin,
    Verifier,
    Vault,
    Token,
    NextId,
    Campaign(u32),
    /// (campaign, investor) -> contributed amount.
    Investment(u32, Address),
    Claimed(u32, Address),
    /// Spent capacity attestations: nullifier -> campaign id.
    Nullifier(BytesN<32>),
    /// Anonymous reputation: nullifier -> completed repayments.
    Reputation(BytesN<32>),
}

#[contract]
pub struct HarvestCampaign;

#[contractimpl]
impl HarvestCampaign {
    pub fn initialize(
        env: Env,
        admin: Address,
        verifier: Address,
        vault: Address,
        token: Address,
    ) -> Result<(), CampaignError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(CampaignError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        env.storage().instance().set(&DataKey::Vault, &vault);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::NextId, &1u32);
        Ok(())
    }

    /// Open a campaign against a zero-knowledge capacity proof.
    ///
    /// The verifier call is the gate: it reverts unless the proof pairs, the
    /// issuer is accredited, and the proof is bound to `farmer`. Only then is
    /// the nullifier spent, which is what stops one attestation being recycled
    /// into several simultaneous campaigns.
    #[allow(clippy::too_many_arguments)]
    pub fn create_campaign(
        env: Env,
        farmer: Address,
        claim: CapacityClaim,
        proof: Proof,
        crop: String,
        region: String,
        target: i128,
        deadline: u64,
        return_bps: u32,
        min_bps: u32,
    ) -> Result<u32, CampaignError> {
        farmer.require_auth();

        if target <= 0 || return_bps > 10_000 || min_bps == 0 || min_bps > 10_000 {
            return Err(CampaignError::InvalidParameters);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(CampaignError::DeadlinePassed);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Nullifier(claim.nullifier.clone()))
        {
            return Err(CampaignError::NullifierAlreadyUsed);
        }

        // Reverts the whole transaction if the proof does not hold.
        Self::verifier(&env).verify_capacity(&farmer, &claim, &proof);

        let id: u32 = env.storage().instance().get(&DataKey::NextId).unwrap_or(1);
        let campaign = Campaign {
            id,
            farmer: farmer.clone(),
            crop,
            region,
            season: claim.season,
            threshold_kg: claim.threshold_kg,
            nullifier: claim.nullifier.clone(),
            target,
            raised: 0,
            shares: 0,
            deadline,
            return_bps,
            min_bps,
            disbursed: 0,
            status: CampaignStatus::Funding,
            investor_pool: 0,
        };

        env.storage().persistent().set(&DataKey::Campaign(id), &campaign);
        env.storage()
            .persistent()
            .set(&DataKey::Nullifier(claim.nullifier.clone()), &id);
        env.storage().instance().set(&DataKey::NextId, &(id + 1));

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("created")),
            (id, farmer, claim.threshold_kg, target),
        );
        Ok(id)
    }

    /// Contribute to a campaign. The funds go straight into the vault.
    pub fn fund(
        env: Env,
        investor: Address,
        id: u32,
        amount: i128,
    ) -> Result<i128, CampaignError> {
        investor.require_auth();
        if amount <= 0 {
            return Err(CampaignError::InvalidAmount);
        }

        let mut campaign = Self::load(&env, id)?;
        if campaign.status != CampaignStatus::Funding {
            return Err(CampaignError::WrongStatus);
        }
        if env.ledger().timestamp() > campaign.deadline {
            return Err(CampaignError::DeadlinePassed);
        }
        if campaign.raised + amount > campaign.target {
            return Err(CampaignError::ExceedsTarget);
        }

        let this = env.current_contract_address();
        Self::token(&env).transfer(&investor, &this, &amount);

        let shares = Self::vault_deposit(&env, amount);

        campaign.raised += amount;
        campaign.shares += shares;
        if campaign.raised == campaign.target {
            campaign.status = CampaignStatus::Funded;
        }

        let prior: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Investment(id, investor.clone()))
            .unwrap_or(0);
        env.storage().persistent().set(
            &DataKey::Investment(id, investor.clone()),
            &(prior + amount),
        );
        env.storage().persistent().set(&DataKey::Campaign(id), &campaign);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("funded")),
            (id, investor, amount, shares),
        );
        Ok(shares)
    }

    /// Close a campaign that missed its minimum once the deadline has passed.
    ///
    /// Unwinds the vault position in full, so the pool investors divide is
    /// principal plus everything the vault earned while they waited. The
    /// attestation's nullifier is released: the farmer was never financed on
    /// it, so they may open a smaller campaign for the same season.
    pub fn close_unfunded(env: Env, id: u32) -> Result<i128, CampaignError> {
        let mut campaign = Self::load(&env, id)?;
        if campaign.status != CampaignStatus::Funding {
            return Err(CampaignError::WrongStatus);
        }
        if env.ledger().timestamp() <= campaign.deadline {
            return Err(CampaignError::DeadlineNotReached);
        }
        // Past the minimum the farmer is entitled to the money; the campaign
        // settles through `disburse` and `repay` instead.
        if campaign.raised >= Self::minimum(&campaign) {
            return Err(CampaignError::WrongStatus);
        }

        let recovered = Self::vault_withdraw(&env, campaign.shares);
        campaign.shares = 0;
        campaign.investor_pool = recovered;
        campaign.status = CampaignStatus::Refunding;
        env.storage().persistent().set(&DataKey::Campaign(id), &campaign);
        env.storage()
            .persistent()
            .remove(&DataKey::Nullifier(campaign.nullifier.clone()));

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("unfunded")),
            (id, campaign.raised, recovered),
        );
        Ok(recovered)
    }

    /// Farmer draws everything raised and not yet drawn.
    ///
    /// Allowed once the minimum is met, and again whenever more has come in,
    /// so a farmer who reached half the target is not left waiting for the
    /// rest. The farmer receives principal only; the vault yield earned while
    /// it waited stays behind and is added to the investors' pool. That is the
    /// concrete answer to "what did DeFindex actually buy us" -- the investors'
    /// downside for committing early is covered by the yield, not by the farmer.
    ///
    /// Once funding has closed (target reached or deadline passed) the call
    /// also moves the campaign to `Disbursed`, which opens repayment -- even
    /// when there was nothing new to pay out.
    pub fn disburse(env: Env, id: u32) -> Result<i128, CampaignError> {
        let mut campaign = Self::load(&env, id)?;
        if campaign.status != CampaignStatus::Funding && campaign.status != CampaignStatus::Funded {
            return Err(CampaignError::WrongStatus);
        }
        campaign.farmer.require_auth();
        if campaign.raised < Self::minimum(&campaign) {
            return Err(CampaignError::BelowMinimum);
        }

        let closed = campaign.raised == campaign.target || env.ledger().timestamp() > campaign.deadline;
        let advance = campaign.raised - campaign.disbursed;
        if advance == 0 && !closed {
            return Err(CampaignError::NothingToDisburse);
        }

        // Everything in the vault belongs to this undrawn principal plus the
        // yield it earned; take it all out and keep the yield for investors.
        let recovered = Self::vault_withdraw(&env, campaign.shares);
        let yield_earned = (recovered - advance).max(0);
        // A vault can round a withdrawal down by a stroop; never promise the
        // farmer more than actually came back.
        let paid = advance.min(recovered);

        campaign.shares = 0;
        campaign.disbursed += advance;
        campaign.investor_pool += yield_earned;
        if closed {
            campaign.status = CampaignStatus::Disbursed;
        }
        env.storage().persistent().set(&DataKey::Campaign(id), &campaign);

        if paid > 0 {
            Self::token(&env).transfer(&env.current_contract_address(), &campaign.farmer, &paid);
        }

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("disburse")),
            (id, campaign.farmer.clone(), paid, yield_earned),
        );
        Ok(paid)
    }

    /// Exactly what the farmer owes: the principal actually drawn plus the
    /// agreed return on it.
    pub fn amount_due(env: Env, id: u32) -> Result<i128, CampaignError> {
        let c = Self::load(&env, id)?;
        Ok(Self::due(&c))
    }

    /// Farmer repays after the harvest. Bumps the anonymous reputation tier.
    pub fn repay(env: Env, id: u32) -> Result<u32, CampaignError> {
        let mut campaign = Self::load(&env, id)?;
        if campaign.status != CampaignStatus::Disbursed {
            return Err(CampaignError::WrongStatus);
        }
        campaign.farmer.require_auth();

        let due = Self::due(&campaign);
        Self::token(&env).transfer(
            &campaign.farmer,
            &env.current_contract_address(),
            &due,
        );

        campaign.investor_pool += due;
        campaign.status = CampaignStatus::Repaid;
        env.storage().persistent().set(&DataKey::Campaign(id), &campaign);

        // Reputation accrues to the nullifier, not the address. A farmer builds
        // a cheaper cost of capital over seasons without ever being identified,
        // and can prove the tier later with the same nullifier.
        let tier: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::Reputation(campaign.nullifier.clone()))
            .unwrap_or(0);
        let tier = tier + 1;
        env.storage()
            .persistent()
            .set(&DataKey::Reputation(campaign.nullifier.clone()), &tier);

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("repaid")),
            (id, due, tier),
        );
        Ok(tier)
    }

    /// Investor takes their pro-rata share of a settled campaign.
    pub fn claim(env: Env, investor: Address, id: u32) -> Result<i128, CampaignError> {
        investor.require_auth();
        let campaign = Self::load(&env, id)?;
        if campaign.status != CampaignStatus::Repaid && campaign.status != CampaignStatus::Refunding
        {
            return Err(CampaignError::WrongStatus);
        }
        if env
            .storage()
            .persistent()
            .has(&DataKey::Claimed(id, investor.clone()))
        {
            return Err(CampaignError::AlreadyClaimed);
        }

        let contributed: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Investment(id, investor.clone()))
            .unwrap_or(0);
        if contributed == 0 {
            return Err(CampaignError::NothingToClaim);
        }

        // On a repaid campaign the principal was already handed to the farmer,
        // so the pool holds return + yield and the investor's principal came
        // back through the repayment. On a refund the pool is the principal
        // plus yield. Either way it divides by contribution.
        let payout = (contributed * campaign.investor_pool) / campaign.raised;
        env.storage()
            .persistent()
            .set(&DataKey::Claimed(id, investor.clone()), &true);

        if payout > 0 {
            Self::token(&env).transfer(&env.current_contract_address(), &investor, &payout);
        }

        env.events().publish(
            (symbol_short!("campaign"), symbol_short!("claimed")),
            (id, investor, payout),
        );
        Ok(payout)
    }

    // -- views --------------------------------------------------------------

    pub fn get_campaign(env: Env, id: u32) -> Result<Campaign, CampaignError> {
        Self::load(&env, id)
    }

    pub fn campaign_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::NextId).unwrap_or(1) - 1
    }

    pub fn investment_of(env: Env, id: u32, investor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Investment(id, investor))
            .unwrap_or(0)
    }

    pub fn has_claimed(env: Env, id: u32, investor: Address) -> bool {
        env.storage().persistent().has(&DataKey::Claimed(id, investor))
    }

    /// Completed repayments behind an anonymous nullifier.
    pub fn reputation_of(env: Env, nullifier: BytesN<32>) -> u32 {
        env.storage()
            .persistent()
            .get(&DataKey::Reputation(nullifier))
            .unwrap_or(0)
    }

    /// Indicative pricing from anonymous history: every completed season takes
    /// 200bps off, floored at 900. The identity behind the tier is never known.
    pub fn quoted_rate_bps(env: Env, nullifier: BytesN<32>) -> u32 {
        let tier = Self::reputation_of(env, nullifier);
        let base: u32 = 1_500;
        base.saturating_sub(tier.saturating_mul(200)).max(900)
    }

    pub fn config(env: Env) -> (Address, Address, Address) {
        (
            env.storage().instance().get(&DataKey::Verifier).unwrap(),
            env.storage().instance().get(&DataKey::Vault).unwrap(),
            env.storage().instance().get(&DataKey::Token).unwrap(),
        )
    }

    // -- internals ----------------------------------------------------------

    /// The smallest amount raised at which the farmer may draw (rounded up).
    fn minimum(c: &Campaign) -> i128 {
        (c.target * c.min_bps as i128 + 9_999) / 10_000
    }

    fn due(c: &Campaign) -> i128 {
        c.disbursed + (c.disbursed * c.return_bps as i128) / 10_000
    }

    fn load(env: &Env, id: u32) -> Result<Campaign, CampaignError> {
        env.storage()
            .persistent()
            .get(&DataKey::Campaign(id))
            .ok_or(CampaignError::NotFound)
    }

    fn token(env: &Env) -> token::Client<'_> {
        token::Client::new(env, &env.storage().instance().get(&DataKey::Token).unwrap())
    }

    fn vault(env: &Env) -> DefindexVaultClient<'_> {
        DefindexVaultClient::new(env, &env.storage().instance().get(&DataKey::Vault).unwrap())
    }

    fn verifier(env: &Env) -> VerifierClient<'_> {
        VerifierClient::new(env, &env.storage().instance().get(&DataKey::Verifier).unwrap())
    }

    /// Deposit into the vault on this contract's own behalf.
    ///
    /// The vault pulls the tokens, so the `transfer` happens two invocations
    /// deep. Soroban only auto-authorizes a contract's *direct* sub-calls, so
    /// the nested transfer has to be pre-authorized explicitly -- without this
    /// the deposit fails with an authorization error rather than anything that
    /// points at the cause.
    fn vault_deposit(env: &Env, amount: i128) -> i128 {
        let this = env.current_contract_address();
        let token_addr: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let vault_addr: Address = env.storage().instance().get(&DataKey::Vault).unwrap();

        let transfer_args: Vec<Val> = vec![
            env,
            this.clone().into_val(env),
            vault_addr.into_val(env),
            amount.into_val(env),
        ];

        env.authorize_as_current_contract(vec![
            env,
            InvokerContractAuthEntry::Contract(SubContractInvocation {
                context: ContractContext {
                    contract: token_addr,
                    fn_name: Symbol::new(env, "transfer"),
                    args: transfer_args,
                },
                sub_invocations: vec![env],
            }),
        ]);

        let (_, shares, _) = Self::vault(env).deposit(
            &vec![env, amount],
            &vec![env, amount],
            &this,
            &true,
        );
        shares
    }

    /// Burn `shares` and return the underlying recovered.
    fn vault_withdraw(env: &Env, shares: i128) -> i128 {
        if shares <= 0 {
            return 0;
        }
        let this = env.current_contract_address();
        let amounts = Self::vault(env).withdraw(&shares, &vec![env, 0i128], &this);
        amounts.get(0).unwrap_or(0)
    }
}

// The contract is no_std; its tests are not, so they can read fixture files
// and use serde.
#[cfg(test)]
extern crate std;
#[cfg(test)]
mod test;
