#![no_std]
//! # Local stand-in for a DeFindex vault
//!
//! Implements the slice of `paltalabs/defindex`'s `VaultTrait` that Harvest
//! calls, with identical signatures:
//!
//! ```ignore
//! fn deposit(e, amounts_desired: Vec<i128>, amounts_min: Vec<i128>, from: Address, invest: bool)
//!     -> (Vec<i128>, i128, Option<Vec<i128>>)
//! fn withdraw(e, df_amount: i128, min_amounts_out: Vec<i128>, from: Address) -> Vec<i128>
//! ```
//!
//! ## Why this exists
//!
//! Harvest talks to a vault through `DefindexVaultClient`, which is just an
//! address. Pointing that address at a real DeFindex testnet vault and pointing
//! it here are the same code path -- `scripts/deploy.mjs` decides which, based
//! on whether a live vault is reachable and denominated in the same USDC the
//! anchor issues.
//!
//! Keeping a local twin buys three things:
//!
//! 1. Contract tests that do not depend on testnet liveness.
//! 2. A demo that still works if the venue wifi dies.
//! 3. `accrue_yield`, so a 45-day funding window's interest can be shown in a
//!    four-minute pitch. Real vaults cannot be fast-forwarded.
//!
//! It is emphatically **not** a yield strategy. It holds the deposited token
//! and tracks proportional shares; `accrue_yield` simply mints more underlying
//! to itself, which is what a profitable strategy would look like from the
//! outside.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, vec, Address, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VaultError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    InsufficientShares = 4,
    SlippageExceeded = 5,
    WrongAmountsLength = 6,
}

#[contracttype]
enum DataKey {
    Token,
    Manager,
    TotalShares,
    Shares(Address),
    /// Underlying units credited by `accrue_yield`, on top of deposits.
    AccruedYield,
}

#[contract]
pub struct MockDefindexVault;

#[contractimpl]
impl MockDefindexVault {
    pub fn initialize(env: Env, token: Address, manager: Address) -> Result<(), VaultError> {
        if env.storage().instance().has(&DataKey::Token) {
            return Err(VaultError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Manager, &manager);
        env.storage().instance().set(&DataKey::TotalShares, &0i128);
        env.storage().instance().set(&DataKey::AccruedYield, &0i128);
        Ok(())
    }

    /// Mirrors `VaultTrait::deposit`.
    ///
    /// Returns `(amounts_actually_taken, shares_minted, per_strategy_report)`.
    /// The third slot is where a real vault reports how the deposit was split
    /// across strategies; Harvest decodes it as an opaque `Val` and ignores it,
    /// which is what keeps this twin and the real vault interchangeable.
    pub fn deposit(
        env: Env,
        amounts_desired: Vec<i128>,
        amounts_min: Vec<i128>,
        from: Address,
        _invest: bool,
    ) -> Result<(Vec<i128>, i128, Option<Vec<i128>>), VaultError> {
        from.require_auth();
        if amounts_desired.len() != 1 || amounts_min.len() != 1 {
            return Err(VaultError::WrongAmountsLength);
        }
        let amount = amounts_desired.get(0).unwrap();
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        if amount < amounts_min.get(0).unwrap() {
            return Err(VaultError::SlippageExceeded);
        }

        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0);
        let managed = Self::total_managed(&env);

        // First deposit sets the 1:1 baseline; later ones are priced against
        // whatever the vault is currently worth, so depositors who arrive after
        // yield has accrued do not dilute the ones already in.
        let shares = if total_shares == 0 || managed == 0 {
            amount
        } else {
            amount.checked_mul(total_shares).unwrap() / managed
        };

        Self::token(&env).transfer(&from, &env.current_contract_address(), &amount);

        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares + shares));
        let held: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Shares(from.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::Shares(from.clone()), &(held + shares));

        Ok((
            vec![&env, amount],
            shares,
            Some(vec![&env, amount]),
        ))
    }

    /// Mirrors `VaultTrait::withdraw`. Burns shares, returns underlying.
    pub fn withdraw(
        env: Env,
        df_amount: i128,
        min_amounts_out: Vec<i128>,
        from: Address,
    ) -> Result<Vec<i128>, VaultError> {
        from.require_auth();
        if df_amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        let held: i128 = env
            .storage()
            .persistent()
            .get(&DataKey::Shares(from.clone()))
            .unwrap_or(0);
        if held < df_amount {
            return Err(VaultError::InsufficientShares);
        }

        let total_shares: i128 = env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0);
        let managed = Self::total_managed(&env);
        let amount = df_amount.checked_mul(managed).unwrap() / total_shares;

        if let Some(min) = min_amounts_out.get(0) {
            if amount < min {
                return Err(VaultError::SlippageExceeded);
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::Shares(from.clone()), &(held - df_amount));
        env.storage()
            .instance()
            .set(&DataKey::TotalShares, &(total_shares - df_amount));

        Self::token(&env).transfer(&env.current_contract_address(), &from, &amount);
        Ok(vec![&env, amount])
    }

    /// Shares held by an address, matching the vault's token-interface balance.
    pub fn balance(env: Env, id: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Shares(id))
            .unwrap_or(0)
    }

    pub fn total_shares(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::TotalShares).unwrap_or(0)
    }

    /// Underlying currently under management. Mirrors the shape of
    /// `fetch_total_managed_funds` for a single-asset vault.
    pub fn fetch_total_managed_funds(env: Env) -> Vec<i128> {
        vec![&env, Self::total_managed(&env)]
    }

    /// Underlying per 1e7 shares, i.e. the share price at 7 decimals.
    /// Starts at 1e7 and climbs as yield accrues.
    pub fn price_per_share(env: Env) -> i128 {
        let total = Self::total_shares(env.clone());
        if total == 0 {
            return 10_000_000;
        }
        Self::total_managed(&env).checked_mul(10_000_000).unwrap() / total
    }

    /// Demo lever: credit `amount` of underlying to the vault as if a strategy
    /// had earned it. Manager-only, and the tokens must really be minted to the
    /// vault -- the share price is derived from the actual balance, so this
    /// cannot fake yield that is not there.
    pub fn accrue_yield(env: Env, amount: i128) -> Result<i128, VaultError> {
        let manager: Address = env
            .storage()
            .instance()
            .get(&DataKey::Manager)
            .ok_or(VaultError::NotInitialized)?;
        manager.require_auth();
        if amount <= 0 {
            return Err(VaultError::InvalidAmount);
        }
        let prior: i128 = env.storage().instance().get(&DataKey::AccruedYield).unwrap_or(0);
        env.storage()
            .instance()
            .set(&DataKey::AccruedYield, &(prior + amount));
        Ok(Self::price_per_share(env))
    }

    pub fn accrued_yield(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::AccruedYield).unwrap_or(0)
    }

    fn total_managed(env: &Env) -> i128 {
        Self::token(env).balance(&env.current_contract_address())
    }

    fn token(env: &Env) -> token::Client<'_> {
        let addr: Address = env
            .storage()
            .instance()
            .get(&DataKey::Token)
            .expect("vault not initialized");
        token::Client::new(env, &addr)
    }
}
