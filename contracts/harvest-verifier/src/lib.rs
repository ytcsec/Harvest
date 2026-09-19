#![no_std]
//! # Harvest Capacity Verifier
//!
//! Verifies, on chain, a Groth16 proof that a farmer holds a cooperative-signed
//! attestation whose expected harvest is at least `threshold_kg` -- without the
//! chain ever learning the real figure.
//!
//! The pairing check runs against Soroban's native BN254 host functions
//! (`env.crypto().bn254()`), so this is real verification, not an attestation
//! that some off-chain service said the proof was fine.
//!
//! ## What this contract enforces beyond the pairing
//!
//! A valid pairing on its own is not enough to make a capacity claim
//! trustworthy. Three extra checks turn it into one:
//!
//! 1. **Issuer allow-list.** The proof commits to the issuer's Baby Jubjub
//!    public key as a public signal. Without pinning that key to an accredited
//!    cooperative, a farmer could mint their own attestation and prove against
//!    it perfectly.
//! 2. **Canonical signal order.** Callers hand over a typed `CapacityClaim`,
//!    not a loose vector, so they cannot permute the public inputs into a
//!    different statement than the circuit was compiled for.
//! 3. **Caller binding.** The proof commits to sha256 of the caller's strkey.
//!    Without it, anyone watching the network could lift a valid proof and
//!    replay it from their own account.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr, Bn254G1Affine, Bn254G2Affine},
    panic_with_error, vec, Address, Bytes, BytesN, Env, U256, Vec,
};

/// Number of public signals the circuit exposes:
/// `[issuerAx, issuerAy, threshold, season, nullifier, addressBinding]`.
pub const PUBLIC_SIGNAL_COUNT: u32 = 6;

/// Length of a Stellar strkey. Both `G...` account ids and `C...` contract ids
/// encode to exactly this many characters.
const STRKEY_LEN: usize = 56;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAuthorized = 3,
    /// `ic` must hold exactly one point per public signal, plus one.
    MalformedVerificationKey = 4,
    /// The attesting key is not on the accredited-issuer allow-list.
    IssuerNotAccredited = 5,
    /// The proof was generated for a different account than the one calling.
    AddressBindingMismatch = 6,
    /// The pairing check failed: the statement is not true, or the proof is junk.
    InvalidProof = 7,
    /// Address did not strkey to the expected 56 characters.
    UnsupportedAddressFormat = 8,
}

/// Groth16 verification key, in the shape snarkjs exports it.
#[contracttype]
#[derive(Clone)]
pub struct VerificationKey {
    pub alpha: Bn254G1Affine,
    pub beta: Bn254G2Affine,
    pub gamma: Bn254G2Affine,
    pub delta: Bn254G2Affine,
    /// `ic[0]` is the constant term; `ic[i+1]` pairs with public signal `i`.
    pub ic: Vec<Bn254G1Affine>,
}

#[contracttype]
#[derive(Clone)]
pub struct Proof {
    pub a: Bn254G1Affine,
    pub b: Bn254G2Affine,
    pub c: Bn254G1Affine,
}

/// The statement being proven, as a typed struct rather than a raw signal
/// vector, so the ordering is fixed by this contract and not by the caller.
///
/// Field elements arrive as 32-byte big-endian values; `threshold_kg` and
/// `season` are plain integers because they are small and human-meaningful.
#[contracttype]
#[derive(Clone)]
pub struct CapacityClaim {
    /// Accredited issuer's Baby Jubjub public key, x coordinate.
    pub issuer_ax: BytesN<32>,
    /// Accredited issuer's Baby Jubjub public key, y coordinate.
    pub issuer_ay: BytesN<32>,
    /// The only capacity fact revealed to the market, in kilograms.
    pub threshold_kg: u64,
    /// Season the attestation belongs to; stops cross-season replay.
    pub season: u32,
    /// Poseidon(farmerSecret, season). Stable per farmer per season, and
    /// reveals nothing about who the farmer is.
    pub nullifier: BytesN<32>,
    /// sha256(caller strkey), high byte zeroed so it fits BN254's field.
    /// See `address_binding()` for the exact definition.
    pub address_binding: BytesN<32>,
}

#[contracttype]
enum DataKey {
    Admin,
    Vk,
    /// (Ax, Ay) of an accredited issuer -> a human-readable label.
    Issuer(BytesN<64>),
}

#[contract]
pub struct HarvestVerifier;

#[contractimpl]
impl HarvestVerifier {
    /// Store the admin and the circuit's verification key.
    ///
    /// The key is set once at deploy time from `circuits/build/verification_key.json`.
    /// Rotating it would silently change which circuit the chain trusts, so it is
    /// deliberately not updatable.
    pub fn initialize(env: Env, admin: Address, vk: VerificationKey) -> Result<(), VerifierError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(VerifierError::AlreadyInitialized);
        }
        if vk.ic.len() != PUBLIC_SIGNAL_COUNT + 1 {
            return Err(VerifierError::MalformedVerificationKey);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Vk, &vk);
        Ok(())
    }

    /// Add a cooperative / TARSIM signing key to the accredited-issuer list.
    ///
    /// In production this is a governance action; for the hackathon the admin
    /// registers the demo cooperative's key at deploy time.
    pub fn accredit_issuer(
        env: Env,
        ax: BytesN<32>,
        ay: BytesN<32>,
        label: soroban_sdk::String,
    ) -> Result<(), VerifierError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VerifierError::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Issuer(issuer_key(&env, &ax, &ay)), &label);
        Ok(())
    }

    pub fn revoke_issuer(env: Env, ax: BytesN<32>, ay: BytesN<32>) -> Result<(), VerifierError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(VerifierError::NotInitialized)?;
        admin.require_auth();
        env.storage()
            .persistent()
            .remove(&DataKey::Issuer(issuer_key(&env, &ax, &ay)));
        Ok(())
    }

    pub fn is_accredited(env: Env, ax: BytesN<32>, ay: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Issuer(issuer_key(&env, &ax, &ay)))
    }

    /// Recompute the address binding the circuit must have committed to.
    ///
    /// Defined as `sha256(strkey ASCII)` with the leading byte cleared, i.e.
    /// the top 248 bits of the digest read as a big-endian integer. Clearing
    /// that byte guarantees the value reduces into BN254's ~254-bit scalar
    /// field with no modular ambiguity -- if we hashed to a full 256 bits, two
    /// distinct digests could collapse onto the same field element and the
    /// binding would stop being injective.
    ///
    /// Hashing the strkey (`"GA..."` / `"CB..."`) rather than the XDR encoding
    /// is deliberate: a browser can reproduce it with one line of WebCrypto,
    /// with no XDR library and no question about whether the payload is an
    /// `ScVal` or a bare `ScAddress`.
    ///
    /// Exposed publicly so clients derive this instead of guessing it.
    pub fn address_binding(env: Env, who: Address) -> BytesN<32> {
        let strkey = who.to_string();
        let len = strkey.len() as usize;
        // Both ed25519 account ids (G...) and contract ids (C...) strkey to 56
        // characters. The guard keeps a future address format from silently
        // producing a truncated, collidable binding.
        let mut buf = [0u8; STRKEY_LEN];
        if len != STRKEY_LEN {
            panic_with_error!(&env, VerifierError::UnsupportedAddressFormat);
        }
        strkey.copy_into_slice(&mut buf);

        let digest = env
            .crypto()
            .sha256(&Bytes::from_slice(&env, &buf))
            .to_bytes()
            .to_array();

        let mut out = [0u8; 32];
        out[1..32].copy_from_slice(&digest[0..31]);
        BytesN::from_array(&env, &out)
    }

    /// The load-bearing call.
    ///
    /// Returns `Ok(())` only when the pairing check passes *and* the issuer is
    /// accredited *and* the proof is bound to `caller`. Anything else is an
    /// error, never a silent `false`, so a caller cannot forget to check.
    pub fn verify_capacity(
        env: Env,
        caller: Address,
        claim: CapacityClaim,
        proof: Proof,
    ) -> Result<(), VerifierError> {
        let vk: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::Vk)
            .ok_or(VerifierError::NotInitialized)?;

        if !Self::is_accredited(env.clone(), claim.issuer_ax.clone(), claim.issuer_ay.clone()) {
            return Err(VerifierError::IssuerNotAccredited);
        }

        if Self::address_binding(env.clone(), caller) != claim.address_binding {
            return Err(VerifierError::AddressBindingMismatch);
        }

        let signals = public_signals(&env, &claim);
        if signals.len() + 1 != vk.ic.len() {
            return Err(VerifierError::MalformedVerificationKey);
        }

        if verify_groth16(&env, &vk, &proof, &signals) {
            Ok(())
        } else {
            Err(VerifierError::InvalidProof)
        }
    }

    /// Same check, but reports the outcome instead of trapping.
    ///
    /// The app asks this in simulation before it spends a transaction, so a
    /// proof that would be refused costs nothing. `prove-on-testnet.mjs` uses it
    /// the other way round, to show the chain turning down claims that do not
    /// hold.
    pub fn check_capacity(env: Env, caller: Address, claim: CapacityClaim, proof: Proof) -> bool {
        Self::verify_capacity(env, caller, claim, proof).is_ok()
    }
}

/// Canonical public-signal ordering. Must match the circuit's
/// `component main {public [...]}` declaration exactly, or every proof fails.
fn public_signals(env: &Env, claim: &CapacityClaim) -> Vec<Bn254Fr> {
    vec![
        env,
        fr_from_bytes(env, &claim.issuer_ax),
        fr_from_bytes(env, &claim.issuer_ay),
        fr_from_u128(env, claim.threshold_kg as u128),
        fr_from_u128(env, claim.season as u128),
        fr_from_bytes(env, &claim.nullifier),
        fr_from_bytes(env, &claim.address_binding),
    ]
}

fn fr_from_bytes(env: &Env, value: &BytesN<32>) -> Bn254Fr {
    Bn254Fr::from_u256(U256::from_be_bytes(
        env,
        &Bytes::from_array(env, &value.to_array()),
    ))
}

fn fr_from_u128(env: &Env, value: u128) -> Bn254Fr {
    Bn254Fr::from_u256(U256::from_u128(env, value))
}

/// Two 32-byte coordinates concatenated, used as the issuer's storage key.
fn issuer_key(env: &Env, ax: &BytesN<32>, ay: &BytesN<32>) -> BytesN<64> {
    let mut buf = [0u8; 64];
    buf[0..32].copy_from_slice(&ax.to_array());
    buf[32..64].copy_from_slice(&ay.to_array());
    BytesN::from_array(env, &buf)
}

/// Textbook Groth16:
///
/// ```text
/// e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
/// where vk_x = ic[0] + sum_i (signal_i * ic[i+1])
/// ```
fn verify_groth16(env: &Env, vk: &VerificationKey, proof: &Proof, signals: &Vec<Bn254Fr>) -> bool {
    let bn = env.crypto().bn254();

    let mut vk_x = vk.ic.get(0).unwrap();
    for (signal, point) in signals.iter().zip(vk.ic.iter().skip(1)) {
        vk_x = bn.g1_add(&vk_x, &bn.g1_mul(&point, &signal));
    }

    let lhs = vec![env, -proof.a.clone(), vk.alpha.clone(), vk_x, proof.c.clone()];
    let rhs = vec![
        env,
        proof.b.clone(),
        vk.beta.clone(),
        vk.gamma.clone(),
        vk.delta.clone(),
    ];

    bn.pairing_check(lhs, rhs)
}

#[cfg(test)]
mod test;
