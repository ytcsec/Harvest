//! Turns snarkjs' decimal JSON into the byte encoding Soroban's BN254 host
//! functions expect.
//!
//! arkworks parses the decimal strings; the byte layout is then written by hand
//! as plain big-endian, because Soroban's host rejects arkworks' own
//! little-endian-with-flags serialization. See `fq_be` for the details.

#![allow(dead_code)]

use std::{fs, path::PathBuf, str::FromStr};

use ark_bn254::Fq;
use ark_ff::{BigInteger, PrimeField};
use harvest_verifier::{CapacityClaim, Proof, VerificationKey};
use serde::Deserialize;
use soroban_sdk::{
    crypto::bn254::{
        Bn254G1Affine, Bn254G2Affine, BN254_G1_SERIALIZED_SIZE, BN254_G2_SERIALIZED_SIZE,
    },
    Bytes, BytesN, Env, String as SorobanString, Vec,
};

#[derive(Deserialize)]
pub struct VerificationKeyJson {
    pub vk_alpha_1: [String; 3],
    pub vk_beta_2: [[String; 2]; 3],
    pub vk_gamma_2: [[String; 2]; 3],
    pub vk_delta_2: [[String; 2]; 3],
    #[serde(rename = "IC")]
    pub ic: std::vec::Vec<[String; 3]>,
}

#[derive(Deserialize)]
pub struct ProofJson {
    pub pi_a: [String; 3],
    pub pi_b: [[String; 2]; 3],
    pub pi_c: [String; 3],
}

#[derive(Deserialize)]
pub struct ClaimJson {
    pub issuer_ax: String,
    pub issuer_ay: String,
    pub threshold_kg: u64,
    pub season: u32,
    pub nullifier: String,
    pub address_binding: String,
}

#[derive(Deserialize)]
pub struct FixtureJson {
    #[serde(rename = "farmerAddress")]
    pub farmer_address: String,
    pub claim: ClaimJson,
    pub proof: ProofJson,
    #[serde(rename = "publicSignals")]
    pub public_signals: std::vec::Vec<String>,
}

fn data_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("data")
}

fn read(name: &str) -> String {
    let path = data_dir().join(name);
    fs::read_to_string(&path).unwrap_or_else(|e| {
        panic!(
            "missing fixture {}: {e}\nRun `node export-fixtures.mjs` in circuits/ first.",
            path.display()
        )
    })
}

pub fn load_fixture(name: &str) -> FixtureJson {
    serde_json::from_str(&read(name)).expect("fixture is not valid JSON")
}

pub fn load_vk(env: &Env) -> VerificationKey {
    let j: VerificationKeyJson =
        serde_json::from_str(&read("verification_key.json")).expect("bad verification key");

    let mut ic = Vec::new(env);
    for p in &j.ic {
        ic.push_back(g1(env, &p[0], &p[1]));
    }

    VerificationKey {
        alpha: g1(env, &j.vk_alpha_1[0], &j.vk_alpha_1[1]),
        beta: g2(env, &j.vk_beta_2[0][0], &j.vk_beta_2[0][1], &j.vk_beta_2[1][0], &j.vk_beta_2[1][1]),
        gamma: g2(env, &j.vk_gamma_2[0][0], &j.vk_gamma_2[0][1], &j.vk_gamma_2[1][0], &j.vk_gamma_2[1][1]),
        delta: g2(env, &j.vk_delta_2[0][0], &j.vk_delta_2[0][1], &j.vk_delta_2[1][0], &j.vk_delta_2[1][1]),
        ic,
    }
}

pub fn proof_of(env: &Env, p: &ProofJson) -> Proof {
    Proof {
        a: g1(env, &p.pi_a[0], &p.pi_a[1]),
        b: g2(env, &p.pi_b[0][0], &p.pi_b[0][1], &p.pi_b[1][0], &p.pi_b[1][1]),
        c: g1(env, &p.pi_c[0], &p.pi_c[1]),
    }
}

pub fn claim_of(env: &Env, c: &ClaimJson) -> CapacityClaim {
    CapacityClaim {
        issuer_ax: hex32(env, &c.issuer_ax),
        issuer_ay: hex32(env, &c.issuer_ay),
        threshold_kg: c.threshold_kg,
        season: c.season,
        nullifier: hex32(env, &c.nullifier),
        address_binding: hex32(env, &c.address_binding),
    }
}

pub fn sorobanize(env: &Env, s: &str) -> SorobanString {
    SorobanString::from_str(env, s)
}

pub fn hex32(env: &Env, hex: &str) -> BytesN<32> {
    let hex = hex.trim_start_matches("0x");
    assert_eq!(hex.len(), 64, "expected 32 bytes of hex, got {}", hex.len());
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).expect("bad hex");
    }
    BytesN::from_array(env, &out)
}

/// Decimal field element -> 32 big-endian bytes, as `BytesN<32>`.
pub fn fr_bytes(env: &Env, decimal: &str) -> BytesN<32> {
    let big = <ark_bn254::Fr as PrimeField>::BigInt::from_str(decimal).expect("bad field element");
    let mut le = big.to_bytes_le();
    le.resize(32, 0);
    le.reverse();
    let mut out = [0u8; 32];
    out.copy_from_slice(&le);
    BytesN::from_array(env, &out)
}

/// One base-field coordinate as 32 big-endian bytes.
///
/// Deliberately *not* `ark_serialize::serialize_uncompressed`: arkworks writes
/// field elements little-endian and stores point flags in the top bits of the
/// final byte. Soroban's host wants plain big-endian with both flag bits clear,
/// and rejects anything else with
/// `bn254 G1 deserialize: the two flag bits must be unset`.
fn fq_be(label: &str, decimal: &str) -> [u8; 32] {
    let value = Fq::from_str(decimal).unwrap_or_else(|_| panic!("bad {label}: {decimal}"));
    let be = value.into_bigint().to_bytes_be();
    assert!(be.len() <= 32, "{label} does not fit in 32 bytes");
    let mut out = [0u8; 32];
    out[32 - be.len()..].copy_from_slice(&be);
    out
}

/// G1 = x || y, each 32 bytes big-endian.
fn g1(env: &Env, x: &str, y: &str) -> Bn254G1Affine {
    let mut buf = [0u8; BN254_G1_SERIALIZED_SIZE];
    buf[0..32].copy_from_slice(&fq_be("G1 x", x));
    buf[32..64].copy_from_slice(&fq_be("G1 y", y));
    Bn254G1Affine::from_array(env, &buf)
}

/// G2 = x.c1 || x.c0 || y.c1 || y.c0, each 32 bytes big-endian.
///
/// snarkjs emits `pi_b[0] = [x.c0, x.c1]` (real part first). Soroban's host
/// wants the *imaginary* part first -- the same convention as Ethereum's
/// pairing precompile -- so the halves are swapped here. Feeding it in snarkjs
/// order deserializes past the flag check and then fails with
/// `bn254 G2: point not on curve`, which is the tell for this exact mistake.
fn g2(env: &Env, x0: &str, x1: &str, y0: &str, y1: &str) -> Bn254G2Affine {
    let mut buf = [0u8; BN254_G2_SERIALIZED_SIZE];
    buf[0..32].copy_from_slice(&fq_be("G2 x.c1", x1));
    buf[32..64].copy_from_slice(&fq_be("G2 x.c0", x0));
    buf[64..96].copy_from_slice(&fq_be("G2 y.c1", y1));
    buf[96..128].copy_from_slice(&fq_be("G2 y.c0", y0));
    Bn254G2Affine::from_array(env, &buf)
}

pub fn bytes_of(env: &Env, raw: &[u8]) -> Bytes {
    Bytes::from_slice(env, raw)
}
