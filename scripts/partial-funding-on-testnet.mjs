/**
 * The minimum-threshold path on the live campaign contract.
 *
 *   node scripts/open-demo-campaigns.mjs rehearsal   # a 2 USDC campaign, 50% minimum
 *   node scripts/partial-funding-on-testnet.mjs
 *
 * Takes the newest rehearsal campaign from .harvest/demo-farmers.json and walks
 * it through: half the target funded -> the farmer draws while funding stays
 * open -> the rest arrives -> the farmer draws it too -> repay -> claim.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import {
  SorobanClient,
  addressToScVal,
  fromStroops,
  i128,
  keypairSigner,
  toStroops,
  u32,
} from "../packages/sdk/src/soroban.mjs";
import { AnchorClient } from "../packages/sdk/src/anchor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const d = JSON.parse(readFileSync(join(ROOT, "deployments.json"), "utf8"));
const farmers = JSON.parse(readFileSync(join(ROOT, ".harvest", "demo-farmers.json"), "utf8"));
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

const soroban = new SorobanClient();
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const read = (method, args = []) => soroban.read({ contractId: d.campaign, method, args, source: d.deployer });
const call = (kp, method, args) =>
  soroban.invoke({ contractId: d.campaign, method, args, source: kp.publicKey(), sign: keypairSigner(kp.secret()) });
const status = (c) => (Array.isArray(c.status) ? c.status[0] : c.status);
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`    ok  ${msg}`);
};

const entry = [...farmers].reverse().find((f) => f.contract === d.campaign && f.campaignId && f.farmerSecretKey);
const farmer = Keypair.fromSecret(entry.farmerSecretKey);
const id = entry.campaignId;
let c = await read("get_campaign", [u32(id)]);
const target = fromStroops(c.target);
const half = target / 2;
console.log(`campaign #${id} · target ${target} USDC · minimum ${Number(c.min_bps) / 100}%`);

async function withUsdc(lira) {
  const kp = Keypair.random();
  await fetch(`https://friendbot.stellar.org?addr=${kp.publicKey()}`);
  const acct = await horizon.loadAccount(kp.publicKey());
  const t = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  t.sign(kp);
  await horizon.submitTransaction(t);
  const anchor = new AnchorClient();
  await anchor.authenticate(kp.publicKey(), (xdr, pp) => {
    const x = TransactionBuilder.fromXDR(xdr, pp);
    x.sign(kp);
    return x.toXDR();
  });
  const dep = await anchor.startDeposit({ account: kp.publicKey(), amount: lira });
  await anchor.simulateBankTransfer(dep.id, lira);
  await anchor.waitForCompletion(dep.id);
  return kp;
}

console.log("\n[1] an investor (lira through the anchor) and the farmer's return money");
const investor = await withUsdc(100);
const topUp = await withUsdc(60);
// The farmer needs a USDC trustline to receive the advance.
const fAcct = await horizon.loadAccount(farmer.publicKey());
if (!fAcct.balances.some((b) => b.asset_code === "USDC" && b.asset_issuer === USDC.issuer)) {
  const t = new TransactionBuilder(fAcct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  t.sign(farmer);
  await horizon.submitTransaction(t);
}
const pay = new TransactionBuilder(await horizon.loadAccount(topUp.publicKey()), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.payment({ destination: farmer.publicKey(), asset: USDC, amount: "1" }))
  .setTimeout(60)
  .build();
pay.sign(topUp);
await horizon.submitTransaction(pay);

console.log(`\n[2] half the target (${half} USDC) is funded`);
console.log(`    fund: ${(await call(investor, "fund", [addressToScVal(investor.publicKey()), u32(id), i128(toStroops(half))])).explorer}`);

console.log("\n[3] the farmer draws while funding stays open");
console.log(`    disburse: ${(await call(farmer, "disburse", [u32(id)])).explorer}`);
c = await read("get_campaign", [u32(id)]);
check(status(c) === "Funding", "campaign still accepts contributions");
check(fromStroops(c.disbursed) === half, `drawn so far = ${half} USDC`);

console.log(`\n[4] the rest arrives and the farmer draws it too`);
console.log(`    fund: ${(await call(investor, "fund", [addressToScVal(investor.publicKey()), u32(id), i128(toStroops(target - half))])).explorer}`);
console.log(`    disburse: ${(await call(farmer, "disburse", [u32(id)])).explorer}`);
c = await read("get_campaign", [u32(id)]);
check(status(c) === "Disbursed", "funding closed, repayment open");
check(fromStroops(c.disbursed) === target, `drawn in total = ${target} USDC`);

console.log("\n[5] repay what was drawn, plus the return; the investor claims");
const due = fromStroops(await read("amount_due", [u32(id)]));
console.log(`    repay ${due} USDC: ${(await call(farmer, "repay", [u32(id)])).explorer}`);
console.log(`    claim: ${(await call(investor, "claim", [addressToScVal(investor.publicKey()), u32(id)])).explorer}`);
c = await read("get_campaign", [u32(id)]);
check(status(c) === "Repaid", "campaign repaid");
console.log("\npartial funding path verified on testnet");
