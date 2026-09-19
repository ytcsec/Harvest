/**
 * Campaigns outside Türkiye, so the marketplace shows the model is not tied
 * to one country: three open for funding, three taken all the way through
 * the lifecycle (funded -> advance drawn -> repaid -> claimed).
 *
 *   node scripts/open-global-campaigns.mjs
 *
 * Everything is the real path on testnet: cooperative-signed records, a
 * Groth16 proof per farmer, `create_campaign` gated by the verifier, and USDC
 * that entered through the TR anchor. Crop and region names go on chain in
 * English; the web app translates them (packages/frontend/src/lib/crop-names.ts).
 *
 * Every record is signed with the one cooperative key the verifier has
 * accredited. The verifier takes any number of issuers (`accredit_issuer`),
 * so in production each country's cooperative signs with its own key.
 *
 * Farmer and investor keys go to `.harvest/demo-farmers.json` (gitignored).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

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
import { AnchorClient } from "../packages/sdk/src/anchor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const d = JSON.parse(readFileSync(join(ROOT, "deployments.json"), "utf8"));
const WASM = join(ROOT, "circuits", "build", "harvest_capacity_js", "harvest_capacity.wasm");
const ZKEY = join(ROOT, "circuits", "build", "harvest_capacity_final.zkey");
const OUT = join(ROOT, ".harvest", "demo-farmers.json");
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

const CAMPAIGNS = [
  // Open for funding, with a first backer already in.
  { crop: "Cauca Specialty Coffee", region: "Cauca, Colombia", cropKey: "kahve", parcel: "Cauca/Popayan finca 17",
    yieldKg: 18_400n, thresholdKg: 15_000n, targetUsdc: 70, returnPercent: 14, days: 40, seedUsdc: 6 },
  { crop: "Lao Cai Terrace Rice", region: "Lao Cai, Vietnam", cropKey: "pirinc", parcel: "Lao Cai/Sa Pa plot 42",
    yieldKg: 64_000n, thresholdKg: 52_000n, targetUsdc: 90, returnPercent: 12, days: 35, seedUsdc: 4 },
  { crop: "Kericho Highland Tea", region: "Kericho, Kenya", cropKey: "cay", parcel: "Kericho/Kapsoit estate 9",
    yieldKg: 27_500n, thresholdKg: 22_000n, targetUsdc: 55, returnPercent: 15, days: 28, seedUsdc: 3 },
  // Completed seasons: funded, advance drawn, repaid with the return, claimed.
  { crop: "Vidarbha Organic Cotton", region: "Maharashtra, India", cropKey: "pamuk", parcel: "Vidarbha/Wardha survey 118",
    yieldKg: 38_000n, thresholdKg: 30_000n, targetUsdc: 6, returnPercent: 13, days: 20, complete: true },
  { crop: "Kostanay Hard Wheat", region: "Kostanay, Kazakhstan", cropKey: "bugday", parcel: "Kostanay/Zhitikara field 6",
    yieldKg: 210_000n, thresholdKg: 180_000n, targetUsdc: 8, returnPercent: 11, days: 20, complete: true },
  { crop: "Maule Valley Cherries", region: "Maule, Chile", cropKey: "kiraz", parcel: "Maule/Curico parcela 23",
    yieldKg: 14_200n, thresholdKg: 11_000n, targetUsdc: 5, returnPercent: 15, days: 20, complete: true },
];

const SEASON = 2026n;
const soroban = new SorobanClient();
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

const call = (kp, method, args) =>
  soroban.invoke({ contractId: d.campaign, method, args, source: kp.publicKey(), sign: keypairSigner(kp.secret()) });

/** Fresh account with a USDC trustline; with `lira`, USDC bought at the TR anchor. */
async function newAccount(lira = 0) {
  const kp = Keypair.random();
  const fb = await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  if (!fb.ok) throw new Error(`friendbot: ${fb.status}`);
  const acct = await horizon.loadAccount(kp.publicKey());
  const t = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  t.sign(kp);
  await horizon.submitTransaction(t);
  if (lira > 0) {
    const anchor = new AnchorClient();
    await anchor.authenticate(kp.publicKey(), (xdr, pp) => {
      const c = TransactionBuilder.fromXDR(xdr, pp);
      c.sign(kp);
      return c.toXDR();
    });
    const dep = await anchor.startDeposit({ account: kp.publicKey(), amount: lira });
    await anchor.simulateBankTransfer(dep.id, lira);
    const settled = await anchor.waitForCompletion(dep.id);
    console.log(`    ${lira} TRY -> ${settled.amount_out} USDC through the anchor`);
  }
  return kp;
}

if (!existsSync(ZKEY)) throw new Error("no proving key -- run npm run circuit:build");
const issuerKey = Buffer.from(JSON.parse(readFileSync(join(ROOT, ".harvest", "issuer-key.json"), "utf8")).secret, "hex");
const issuerPub = await issuerPublicKey(issuerKey);

const needed = CAMPAIGNS.reduce((sum, c) => sum + (c.complete ? c.targetUsdc : c.seedUsdc ?? 0), 0);
console.log(`campaign contract ${d.campaign}\n\n[investor] backs every campaign, ${needed} USDC in total`);
// ~49 TRY per USDC on the sandbox; a margin for the rate moving.
const investor = await newAccount(Math.ceil(needed * 55));

const opened = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : [];
opened.push({ role: "global-investor", address: investor.publicKey(), secretKey: investor.secret(), createdAt: new Date().toISOString() });

for (const c of CAMPAIGNS) {
  console.log(`\n${c.crop} · ${c.region}`);
  // A completed campaign's farmer must also pay the return, so it gets lira too.
  const farmer = await newAccount(c.complete ? 100 : 0);

  const farmerSecret = randomFarmerSecret();
  const parcelId = parcelIdOf(c.parcel);
  const cropCode = cropCodeOf(c.cropKey);
  const signature = await signAttestation(issuerKey, { yieldKg: c.yieldKg, parcelId, cropCode, seasonId: SEASON, farmerSecret });
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
  const created = await call(farmer, "create_campaign", [
    addressToScVal(farmer.publicKey()),
    claimToScVal(claim),
    proofToScVal(encodeProof(proof)),
    str(c.crop),
    str(c.region),
    i128(toStroops(c.targetUsdc)),
    u64(deadline),
    u32(c.returnPercent * 100),
  ]);
  const id = Number(created.value);
  console.log(`    #${id} created: ${created.explorer}`);

  const amount = c.complete ? c.targetUsdc : c.seedUsdc;
  if (amount) {
    const funded = await call(investor, "fund", [addressToScVal(investor.publicKey()), u32(id), i128(toStroops(amount))]);
    console.log(`    funded ${amount} USDC: ${funded.explorer}`);
  }
  if (c.complete) {
    console.log(`    disburse: ${(await call(farmer, "disburse", [u32(id)])).explorer}`);
    console.log(`    repay:    ${(await call(farmer, "repay", [u32(id)])).explorer}`);
    console.log(`    claim:    ${(await call(investor, "claim", [addressToScVal(investor.publicKey()), u32(id)])).explorer}`);
  }

  opened.push({
    campaignId: id,
    crop: c.crop,
    region: c.region,
    status: c.complete ? "Repaid" : "Funding",
    farmerAddress: farmer.publicKey(),
    farmerSecretKey: farmer.secret(),
    contract: d.campaign,
    createdAt: new Date().toISOString(),
  });
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(opened, null, 2) + "\n");
}

console.log(`\nkeys saved to ${OUT} (gitignored)`);
// snarkjs keeps its curve worker threads alive; without this Node never exits.
await globalThis.curve_bn128?.terminate();
