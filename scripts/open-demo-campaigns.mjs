/**
 * Open a few campaigns on the live campaign contract so the marketplace has
 * something to fund during a demo.
 *
 *   node scripts/open-demo-campaigns.mjs
 *
 * Each campaign goes through the real path: a fresh farmer account, a
 * cooperative-signed record for one of the cooperative service's members, a
 * Groth16 proof bound to that farmer, and `create_campaign`, which the
 * contract only accepts once the verifier's pairing check passes.
 *
 * The farmer keys are written to `.harvest/demo-farmers.json` (gitignored),
 * so someone can import one into a wallet and play the farmer in the demo --
 * draw the advance, repay. They are throwaway testnet accounts.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import { Keypair } from "@stellar/stellar-sdk";

import {
  addressBinding,
  buildCircuitInput,
  cropCodeOf,
  issuerPublicKey,
  parcelIdOf,
  randomFarmerSecret,
  signAttestation,
} from "../packages/sdk/src/attestation.mjs";
import { encodeClaim, encodeProof } from "../packages/sdk/src/encoding.mjs";
import {
  SorobanClient,
  addressToScVal,
  claimToScVal,
  i128,
  keypairSigner,
  proofToScVal,
  str,
  toStroops,
  u32,
  u64,
} from "../packages/sdk/src/soroban.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const d = JSON.parse(readFileSync(join(ROOT, "deployments.json"), "utf8"));
const WASM = join(ROOT, "circuits", "build", "harvest_capacity_js", "harvest_capacity.wasm");
const ZKEY = join(ROOT, "circuits", "build", "harvest_capacity_final.zkey");
const OUT = join(ROOT, ".harvest", "demo-farmers.json");

// Mirrors the member records in packages/issuer/server.mjs.
const DEMO = [
  {
    crop: "Giresun Tombul Fındık",
    region: "Giresun / Bulancak",
    cropKey: "findik",
    parcel: "Giresun/Bulancak ada 214 parsel 7",
    yieldKg: 48_500n,
    thresholdKg: 38_000n,
    targetUsdc: 50,
    returnPercent: 15,
    days: 30,
  },
  {
    crop: "Erken Hasat Sızma Zeytinyağı",
    region: "Balıkesir / Edremit",
    cropKey: "zeytinyagi",
    parcel: "Balikesir/Edremit ada 88 parsel 12",
    yieldKg: 62_000n,
    thresholdKg: 49_000n,
    targetUsdc: 80,
    returnPercent: 12,
    days: 21,
  },
  {
    crop: "Ege Uzun Lifli Pamuk",
    region: "Aydın / Söke",
    cropKey: "pamuk",
    parcel: "Aydin/Soke ada 51 parsel 3",
    yieldKg: 91_500n,
    thresholdKg: 73_000n,
    targetUsdc: 120,
    returnPercent: 14,
    days: 45,
  },
  {
    key: "patates",
    farmerName: "Kemal Güler",
    crop: "Tokat Patatesi",
    region: "Tokat / Merkez",
    cropKey: "patates",
    parcel: "Tokat/Merkez ada 132 parsel 5",
    yieldKg: 120_000n,
    thresholdKg: 95_000n,
    targetUsdc: 60,
    returnPercent: 13,
    days: 30,
  },
  {
    // A tiny campaign for rehearsing the farmer buttons in the UI, so the
    // demo campaigns stay open.
    key: "rehearsal",
    crop: "Giresun Tombul Fındık",
    region: "Giresun / Bulancak",
    cropKey: "findik",
    parcel: "Giresun/Bulancak ada 214 parsel 7",
    yieldKg: 48_500n,
    thresholdKg: 38_000n,
    targetUsdc: 2,
    returnPercent: 10,
    days: 7,
  },
];

// `node scripts/open-demo-campaigns.mjs patates` opens only the entries whose
// key is given; with no arguments the first three (the original demo set).
const wanted = process.argv.slice(2);
const selected = wanted.length
  ? DEMO.filter((c) => wanted.includes(c.key))
  : DEMO.filter((c) => !c.key);
if (!selected.length) throw new Error(`no demo campaign matches ${wanted.join(", ")}`);

const SEASON = 2026n;
const soroban = new SorobanClient();

if (!existsSync(ZKEY)) throw new Error("no proving key -- run npm run circuit:build");
const issuerKey = Buffer.from(
  JSON.parse(readFileSync(join(ROOT, ".harvest", "issuer-key.json"), "utf8")).secret,
  "hex",
);
const issuerPub = await issuerPublicKey(issuerKey);

console.log(`campaign contract ${d.campaign}\n`);

const opened = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];

for (const c of selected) {
  const farmer = Keypair.random();
  const fb = await fetch(`https://friendbot.stellar.org?addr=${farmer.publicKey()}`);
  if (!fb.ok) throw new Error(`friendbot: ${fb.status}`);

  const farmerSecret = randomFarmerSecret();
  const parcelId = parcelIdOf(c.parcel);
  const cropCode = cropCodeOf(c.cropKey);
  const signature = await signAttestation(issuerKey, {
    yieldKg: c.yieldKg, parcelId, cropCode, seasonId: SEASON, farmerSecret,
  });

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    await buildCircuitInput({
      issuerPub, threshold: c.thresholdKg, seasonId: SEASON, farmerSecret, yieldKg: c.yieldKg,
      parcelId, cropCode, signature, binding: addressBinding(farmer.publicKey()),
    }),
    WASM,
    ZKEY,
  );
  const claim = encodeClaim(publicSignals);
  if (JSON.stringify({ claim, proof: encodeProof(proof) }).includes(c.yieldKg.toString())) {
    throw new Error("the real yield leaked into the on-chain payload");
  }

  const deadline = BigInt(Math.floor(Date.now() / 1000) + c.days * 86_400);
  const res = await soroban.invoke({
    contractId: d.campaign,
    method: "create_campaign",
    args: [
      addressToScVal(farmer.publicKey()),
      claimToScVal(claim),
      proofToScVal(encodeProof(proof)),
      str(c.crop),
      str(c.region),
      i128(toStroops(c.targetUsdc)),
      u64(deadline),
      u32(c.returnPercent * 100),
      // The grower can start drawing once half the target is raised.
      u32(5_000),
    ],
    source: farmer.publicKey(),
    sign: keypairSigner(farmer.secret()),
  });

  const id = Number(res.value);
  console.log(`#${id}  ${c.crop} · ${c.region}${c.farmerName ? ` · çiftçi: ${c.farmerName}` : ""}`);
  console.log(`     >= ${Number(c.thresholdKg) / 1000} t (real ${Number(c.yieldKg) / 1000} t stays private)`);
  console.log(`     target ${c.targetUsdc} USDC · return ${c.returnPercent}% · ${c.days} days`);
  console.log(`     ${res.explorer}\n`);

  opened.push({
    campaignId: id,
    ...(c.farmerName ? { farmerName: c.farmerName } : {}),
    crop: c.crop,
    region: c.region,
    farmerAddress: farmer.publicKey(),
    // Throwaway testnet key, so a teammate can import it and play the farmer.
    farmerSecretKey: farmer.secret(),
    contract: d.campaign,
    createdAt: new Date().toISOString(),
  });
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(opened, null, 2) + "\n");
console.log(`farmer keys saved to ${OUT} (gitignored)`);

// snarkjs keeps its curve worker threads alive; without this Node never exits.
await globalThis.curve_bn128?.terminate();
