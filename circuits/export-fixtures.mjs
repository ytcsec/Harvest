/**
 * Emit deterministic proof fixtures for the Soroban contract tests.
 *
 * The Rust side has no circom toolchain, so the honest way to test the on-chain
 * verifier is to feed it real artefacts produced here and assert the pairing
 * check agrees. Everything is derived from fixed seeds so the fixtures are
 * reproducible and reviewable in git.
 *
 * Writes into contracts/harvest-verifier/tests/data/:
 *   verification_key.json   the circuit's VK, straight from snarkjs
 *   valid.json              a real proof + the claim it proves
 *   invalid.json            the same claim with a proof from a *different*
 *                           statement, so the verifier must reject it
 */

import * as snarkjs from "snarkjs";
import { StrKey } from "@stellar/stellar-sdk";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  addressBinding,
  buildCircuitInput,
  computeNullifier,
  cropCodeOf,
  issuerPublicKey,
  parcelIdOf,
  signAttestation,
} from "@harvest/sdk/attestation";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "build");
const OUT = join(HERE, "..", "contracts", "harvest-verifier", "tests", "data");
const WASM = join(BUILD, "harvest_capacity_js", "harvest_capacity.wasm");
const ZKEY = join(BUILD, "harvest_capacity_final.zkey");

mkdirSync(OUT, { recursive: true });

/** 32-byte big-endian hex, the shape `BytesN<32>` wants. */
const toBytes32Hex = (v) => BigInt(v).toString(16).padStart(64, "0");

// Deterministic actors -------------------------------------------------------
const issuerKey = Buffer.alloc(32, 0x11);           // "Giresun coop" signing key
const issuerPub = await issuerPublicKey(issuerKey);
const rogueKey = Buffer.alloc(32, 0x22);            // an unaccredited signer
const rogueIssuerPub = await issuerPublicKey(rogueKey);
const farmerSecret = 0x1234567890abcdefn;

// A contract address, not a classic G account.
//
// Farmers onboard through a passkey smart wallet, and Stellar smart wallets
// *are* contracts -- so the address a proof is bound to is a C-strkey in the
// real flow. It also sidesteps the trustline a classic account would need
// before it could hold USDC, which is a deployment concern rather than
// something these fixtures should be asserting about.
const farmerAddress = StrKey.encodeContract(Buffer.alloc(32, 0x33));

const SEASON = 2026n;
const REAL_YIELD = 48_500n;
const THRESHOLD = 40_000n;
const parcelId = parcelIdOf("Giresun/Bulancak ada 214 parsel 7");
const cropCode = cropCodeOf("findik");
const binding = addressBinding(farmerAddress);

async function prove(overrides = {}) {
  const opts = {
    issuerPub,
    threshold: THRESHOLD,
    seasonId: SEASON,
    farmerSecret,
    yieldKg: REAL_YIELD,
    parcelId,
    cropCode,
    binding,
    ...overrides,
  };
  const signature =
    overrides.signature ??
    (await signAttestation(overrides.signingKey ?? issuerKey, {
      yieldKg: opts.yieldKg,
      parcelId: opts.parcelId,
      cropCode: opts.cropCode,
      seasonId: opts.seasonId,
      farmerSecret: opts.farmerSecret,
    }));
  const input = await buildCircuitInput({ ...opts, signature });
  return snarkjs.groth16.fullProve(input, WASM, ZKEY);
}

/** Shape the contract's `CapacityClaim` expects. */
async function claimOf(pub, threshold, season, secret, bind) {
  return {
    issuer_ax: toBytes32Hex(pub.Ax),
    issuer_ay: toBytes32Hex(pub.Ay),
    threshold_kg: Number(threshold),
    season: Number(season),
    nullifier: toBytes32Hex(await computeNullifier(secret, season)),
    address_binding: toBytes32Hex(bind),
  };
}

console.log("generating fixtures ...");

// --- the honest proof ------------------------------------------------------
const good = await prove();
const claim = await claimOf(issuerPub, THRESHOLD, SEASON, farmerSecret, binding);

writeFileSync(
  join(OUT, "valid.json"),
  JSON.stringify(
    {
      note: "Real Groth16 proof: farmer holds a coop-signed attestation for 48500kg and proves >= 40000kg.",
      farmerAddress,
      issuerLabel: "Giresun Findik Tarim Satis Kooperatifi",
      claim,
      proof: good.proof,
      publicSignals: good.publicSignals,
      // Recorded only so a reader can see what the proof is hiding. It is not
      // part of the proof and never reaches the chain.
      secretsForDocumentationOnly: {
        realYieldKg: REAL_YIELD.toString(),
        parcelId: parcelId.toString(),
      },
    },
    null,
    2,
  ),
);

// --- a proof of a different statement, replayed against this claim ---------
// Same farmer and season, but the proof was generated for a 45000kg threshold.
// Submitting it alongside a 40000kg claim must fail the pairing check.
const mismatched = await prove({ threshold: 45_000n });
writeFileSync(
  join(OUT, "invalid.json"),
  JSON.stringify(
    {
      note: "Proof generated for threshold=45000 but submitted against a claim of 40000. Pairing must fail.",
      farmerAddress,
      claim,
      proof: mismatched.proof,
      publicSignals: mismatched.publicSignals,
    },
    null,
    2,
  ),
);

// --- an unaccredited issuer -----------------------------------------------
// Cryptographically flawless, but signed by a key the contract never accredited.
const rogueBinding = binding;
const rogue = await prove({ issuerPub: rogueIssuerPub, signingKey: rogueKey });
writeFileSync(
  join(OUT, "rogue-issuer.json"),
  JSON.stringify(
    {
      note: "A perfectly valid proof under a self-generated issuer key. The pairing passes; the allow-list must still reject it.",
      farmerAddress,
      claim: await claimOf(rogueIssuerPub, THRESHOLD, SEASON, farmerSecret, rogueBinding),
      proof: rogue.proof,
      publicSignals: rogue.publicSignals,
    },
    null,
    2,
  ),
);

copyFileSync(join(BUILD, "verification_key.json"), join(OUT, "verification_key.json"));

console.log(`  farmer address : ${farmerAddress}`);
console.log(`  binding        : 0x${toBytes32Hex(binding)}`);
console.log(`  accredited Ax  : 0x${toBytes32Hex(issuerPub.Ax)}`);
console.log(`  wrote valid.json, invalid.json, rogue-issuer.json, verification_key.json`);
console.log(`  -> ${OUT}`);
