#![no_std]
//! # Harvest Registry
//!
//! Membership enrolment: the gate in front of campaign creation.
//!
//! ## What this closes
//!
//! The cooperative's attestation service signs a harvest attestation for
//! whoever presents a membership number. On its own that makes "an accredited
//! cooperative vouched for this farmer" mean no more than "this person knew a
//! member id" -- two different browsers can both claim the same member's
//! harvest, because the capacity nullifier is keyed to a secret each browser
//! generates for itself.
//!
//! Enrolment fixes the anchor. A farmer submits their documents to the
//! cooperative once. The cooperative checks them and signs a membership
//! credential over `Poseidon(farmerSecret)` -- a commitment, never the secret.
//! The farmer then proves, in zero knowledge, that such a credential exists,
//! and this contract records the enrolment nullifier. A second enrolment for
//! the same secret is refused, and the chain never learns whose it is.
//!
//! ## What reaches the chain
//!
//! Only the document mask: which checks passed. The identity document, the
//! parcel and the land area stay inside the proof. Bit 3 of the mask is not the
//! cooperative's opinion at all -- `harvest_enrolment.circom` computes it from
//! the land figure the cooperative signed, so "this holding clears the
//! eligibility floor" is a statement the chain verifies rather than accepts.
//!
//! ## Why there is no second verifier contract
//!
//! [`HarvestVerifier`] is deployed twice: once holding the capacity circuit's
//! verification key, once holding the enrolment circuit's. Both circuits expose
//! six public signals in the same order, so one contract serves both. The
//! verification key is the boundary: a capacity proof presented to the
//! enrolment verifier fails the pairing check, and the other way round.

use soroban_sdk::{
    contract, contractclient, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine},
    symbol_short, Address, BytesN, Env,
};

// ---------------------------------------------------------------------------
// External interfaces
// ---------------------------------------------------------------------------

/// Mirrors `harvest_verifier`'s public types.
///
/// Re-declared rather than imported for the same reason `harvest_campaign` does
/// it: depending on the verifier crate would compile its `#[contractimpl]`
/// entry points into this wasm too.
///
/// Soroban encodes a `#[contracttype]` struct as a map keyed by field *name*,
/// so the names here are part of the wire format and cannot be renamed to suit
/// this contract. `threshold_kg` is the one public scalar a Harvest circuit
/// reveals: a harvest threshold in kilograms for `harvest_capacity`, and the
/// document mask for `harvest_enrolment`. Read it through [`doc_mask`].
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

/// The document mask carried by an enrolment claim. See [`CapacityClaim`].
fn doc_mask(claim: &CapacityClaim) -> u64 {
    claim.threshold_kg
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
pub enum RegistryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    /// This farmer secret has already enrolled for this season.
    AlreadyRegistered = 3,
    /// The proof is valid, but the cooperative's checks do not cover what the
    /// registry insists on.
    InsufficientDocuments = 4,
    NotFound = 5,
}

/// What the chain keeps about an enrolment.
///
/// Note what is *not* here: no name, no identity document, no parcel, no land
/// area. The nullifier is the only handle, and it is unlinkable to the person
/// without their secret.
#[contracttype]
#[derive(Clone)]
pub struct Registration {
    /// Poseidon(farmerSecret, season, ENROLMENT_TAG).
    pub nullifier: BytesN<32>,
    /// The account that submitted the enrolment and will open campaigns.
    pub farmer: Address,
    /// Which checks the proof published. See `packages/sdk/src/enrolment.mjs`.
    pub doc_mask: u64,
    pub season: u32,
    pub registered_at: u64,
}

#[contracttype]
enum DataKey {
    Admin,
    Verifier,
    /// The mask an enrolment has to clear to be accepted.
    RequiredMask,
    Count,
    /// Enrolment nullifier -> registration.
    Enrolment(BytesN<32>),
    /// Farmer address -> their enrolment nullifier, so the app can ask
    /// "is this account enrolled?" without holding the secret.
    ByAddress(Address),
}

#[contract]
pub struct HarvestRegistry;

#[contractimpl]
impl HarvestRegistry {
    /// Wire the registry to the enrolment verifier and fix the required mask.
    ///
    /// `required_mask` is stored rather than hardcoded so the cooperative can
    /// be told, at deploy time, which checks are mandatory -- TARSİM insurance
    /// is not available for every crop, so demanding it in code would lock out
    /// growers the scheme is meant to serve.
    pub fn initialize(
        env: Env,
        admin: Address,
        verifier: Address,
        required_mask: u64,
    ) -> Result<(), RegistryError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(RegistryError::AlreadyInitialized);
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        env.storage()
            .instance()
            .set(&DataKey::RequiredMask, &required_mask);
        env.storage().instance().set(&DataKey::Count, &0u32);
        Ok(())
    }

    /// Enrol, against a zero-knowledge proof that an accredited cooperative
    /// checked this farmer's documents.
    ///
    /// The verifier call is the gate: it reverts unless the proof pairs, the
    /// issuer is on the accredited list, and the proof is bound to `farmer`.
    /// Only then is the nullifier spent, which is what stops one credential
    /// enrolling twice.
    pub fn register(
        env: Env,
        farmer: Address,
        claim: CapacityClaim,
        proof: Proof,
    ) -> Result<u32, RegistryError> {
        farmer.require_auth();

        let required: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RequiredMask)
            .ok_or(RegistryError::NotInitialized)?;

        let mask = doc_mask(&claim);
        if mask & required != required {
            return Err(RegistryError::InsufficientDocuments);
        }

        if env
            .storage()
            .persistent()
            .has(&DataKey::Enrolment(claim.nullifier.clone()))
        {
            return Err(RegistryError::AlreadyRegistered);
        }

        // Reverts the whole transaction if the proof does not hold.
        Self::verifier(&env).verify_capacity(&farmer, &claim, &proof);

        let registration = Registration {
            nullifier: claim.nullifier.clone(),
            farmer: farmer.clone(),
            doc_mask: mask,
            season: claim.season,
            registered_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Enrolment(claim.nullifier.clone()), &registration);
        env.storage()
            .persistent()
            .set(&DataKey::ByAddress(farmer.clone()), &claim.nullifier);

        let count: u32 = env.storage().instance().get(&DataKey::Count).unwrap_or(0) + 1;
        env.storage().instance().set(&DataKey::Count, &count);

        env.events().publish(
            (symbol_short!("member"), symbol_short!("enrolled")),
            (farmer, mask, claim.season),
        );
        Ok(count)
    }

    /// Has this enrolment nullifier been spent?
    pub fn is_registered(env: Env, nullifier: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .has(&DataKey::Enrolment(nullifier))
    }

    /// The enrolment behind a nullifier.
    pub fn registration_of(
        env: Env,
        nullifier: BytesN<32>,
    ) -> Result<Registration, RegistryError> {
        env.storage()
            .persistent()
            .get(&DataKey::Enrolment(nullifier))
            .ok_or(RegistryError::NotFound)
    }

    /// The enrolment an account submitted, if any. What the app calls to decide
    /// whether to show "enrolled" or send the farmer to the application form.
    pub fn registration_of_address(
        env: Env,
        farmer: Address,
    ) -> Result<Registration, RegistryError> {
        let nullifier: BytesN<32> = env
            .storage()
            .persistent()
            .get(&DataKey::ByAddress(farmer))
            .ok_or(RegistryError::NotFound)?;
        Self::registration_of(env, nullifier)
    }

    /// Is this account enrolled? The cheap check the UI polls.
    pub fn is_address_registered(env: Env, farmer: Address) -> bool {
        env.storage().persistent().has(&DataKey::ByAddress(farmer))
    }

    pub fn registered_count(env: Env) -> u32 {
        env.storage().instance().get(&DataKey::Count).unwrap_or(0)
    }

    /// `(admin, verifier, required_mask)`.
    pub fn config(env: Env) -> Result<(Address, Address, u64), RegistryError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(RegistryError::NotInitialized)?;
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(RegistryError::NotInitialized)?;
        let required: u64 = env
            .storage()
            .instance()
            .get(&DataKey::RequiredMask)
            .ok_or(RegistryError::NotInitialized)?;
        Ok((admin, verifier, required))
    }

    // -----------------------------------------------------------------------

    fn verifier(env: &Env) -> VerifierClient<'_> {
        let id: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .expect("registry not initialized");
        VerifierClient::new(env, &id)
    }
}

// The contract is no_std; its tests are not, so they can read fixture files
// and use serde.
#[cfg(test)]
extern crate std;
#[cfg(test)]
mod test;
