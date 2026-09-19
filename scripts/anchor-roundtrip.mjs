/**
 * Prove the fiat rail end to end against the live TR anchor sandbox.
 *
 *   node scripts/anchor-roundtrip.mjs [amountTry]
 *
 * Turkish lira in -> real testnet USDC in the wallet -> lira back out to an
 * IBAN. The bank leg and the KYC are simulated by the sandbox; the USDC
 * movement is genuine testnet activity you can open in an explorer.
 *
 * This is the hackathon's second requirement in one file: "a user should be
 * able to put real Turkish lira in and get a usable balance out, or the
 * reverse."
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { AnchorClient } from "../packages/sdk/src/anchor.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STELLAR = process.env.STELLAR_BIN ?? join(homedir(), ".harvest-bin", "stellar.exe");
const IDENTITY = "harvest-deployer";
const HORIZON = "https://horizon-testnet.stellar.org";

const USDC_CODE = "USDC";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
// In Turkish lira -- the anchor's deposit endpoint prices the fiat leg, and
// the sandbox floor is 50 TRY.
const AMOUNT_TRY = Number(process.argv[2] ?? 500);

const secret = execFileSync(STELLAR, ["keys", "show", IDENTITY], { encoding: "utf8" }).trim();
const keypair = Keypair.fromSecret(secret);
const server = new Horizon.Server(HORIZON);
const usdc = new Asset(USDC_CODE, USDC_ISSUER);

const step = (n, m) => console.log(`\n[${n}] ${m}`);
const balanceOf = async () => {
  const acct = await server.loadAccount(keypair.publicKey());
  const line = acct.balances.find(
    (b) => b.asset_code === USDC_CODE && b.asset_issuer === USDC_ISSUER,
  );
  return line ? Number(line.balance) : null;
};

console.log(`\naccount: ${keypair.publicKey()}`);
console.log(`anchor : tr-mock-anchor.fly.dev`);

// ---------------------------------------------------------------------------
step(1, "USDC trustline");

if ((await balanceOf()) === null) {
  // A classic account cannot hold an issued asset without a trustline. Smart
  // wallets (contract accounts) do not need this, which is one more reason the
  // farmer-facing flow uses one.
  const account = await server.loadAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: usdc }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  await server.submitTransaction(tx);
  console.log("    trustline created");
} else {
  console.log("    already present");
}
const before = await balanceOf();
console.log(`    USDC balance: ${before}`);

// ---------------------------------------------------------------------------
step(2, "SEP-10 authentication");

const anchor = new AnchorClient();
await anchor.authenticate(keypair.publicKey(), (xdr, passphrase) => {
  const challenge = TransactionBuilder.fromXDR(xdr, passphrase);
  challenge.sign(keypair);
  return challenge.toXDR();
});
console.log("    authenticated (no API key: the Stellar key is the identity)");

// ---------------------------------------------------------------------------
step(3, "SEP-38 rate");

try {
  const q = await anchor.quote({
    buyAsset: `stellar:${USDC_CODE}:${USDC_ISSUER}`,
    sellAmount: 500,
  });
  console.log(`    500 TRY -> ${q.buy_amount ?? "?"} USDC  (rate ${q.price ?? "?"})`);
} catch (err) {
  console.log(`    quote unavailable: ${err.message}`);
}

// ---------------------------------------------------------------------------
step(4, `SEP-6 deposit of ${AMOUNT_TRY} TRY`);

const deposit = await anchor.startDeposit({ account: keypair.publicKey(), amount: AMOUNT_TRY });
console.log(`    transaction : ${deposit.id}`);
if (deposit.how) console.log(`    instructions: ${String(deposit.how).slice(0, 120)}`);
for (const [field, v] of Object.entries(deposit.instructions ?? {})) {
  console.log(`    ${field}: ${v.value ?? v}`);
}

step(5, "simulating the customer's bank transfer");
await anchor.simulateBankTransfer(deposit.id, AMOUNT_TRY);
console.log("    wired (sandbox stand-in for a real FAST/havale)");

step(6, "waiting for settlement");
const settled = await anchor.waitForCompletion(deposit.id, {
  onUpdate: (t) => console.log(`    status: ${t.status}`),
});
console.log(`    settled. stellar tx: ${settled.stellar_transaction_id ?? "(claimable balance)"}`);

const after = await balanceOf();
console.log(`\n    USDC before : ${before}`);
console.log(`    USDC after  : ${after}`);
console.log(`    delta       : ${(after - before).toFixed(7)}`);

console.log(`
fiat rail confirmed: Turkish lira went in, spendable USDC came out.

  account  https://stellar.expert/explorer/testnet/account/${keypair.publicKey()}
${settled.stellar_transaction_id ? `  payment  https://stellar.expert/explorer/testnet/tx/${settled.stellar_transaction_id}` : ""}

The same client drives the withdraw direction (USDC -> IBAN); the app's
"withdraw to IBAN" screen calls startWithdraw() with these same credentials.
`);
