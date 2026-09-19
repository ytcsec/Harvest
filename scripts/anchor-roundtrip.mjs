/**
 * Prove the fiat rail end to end against the live TR anchor sandbox.
 *
 *   node scripts/anchor-roundtrip.mjs [amountTry]
 *
 * Turkish lira in -> real testnet USDC in the wallet -> lira back out to an
 * IBAN (SEP-12 payout details, SEP-6 withdraw, a USDC payment carrying the
 * anchor's memo). The bank leg and the KYC are simulated by the sandbox; the
 * USDC movement is genuine testnet activity you can open in an explorer.
 *
 * Uses the deployer identity from the Stellar CLI when it is installed, and a
 * fresh friendbot-funded account otherwise, so it runs on any machine.
 *
 * This is the hackathon's second requirement in one file: "a user should be
 * able to put real Turkish lira in and get a usable balance out, or the
 * reverse."
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

import { AnchorClient } from "../packages/sdk/src/anchor.mjs";

const STELLAR = process.env.STELLAR_BIN ?? join(homedir(), ".harvest-bin", "stellar.exe");
const IDENTITY = "harvest-deployer";
const HORIZON = "https://horizon-testnet.stellar.org";

const USDC_CODE = "USDC";
const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
// In Turkish lira -- the anchor's deposit endpoint prices the fiat leg, and
// the sandbox floor is 50 TRY.
const AMOUNT_TRY = Number(process.argv[2] ?? 500);
// The payout IBAN for the withdrawal leg. It must pass the ISO 13616 mod-97
// checksum; the anchor rejects one that does not.
const PAYOUT_IBAN = process.env.PAYOUT_IBAN ?? "TR330006100519786457841326";
const WITHDRAW_USDC = 5;

let keypair;
if (existsSync(STELLAR)) {
  const secret = execFileSync(STELLAR, ["keys", "show", IDENTITY], { encoding: "utf8" }).trim();
  keypair = Keypair.fromSecret(secret);
} else {
  keypair = Keypair.random();
  const res = await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);
  if (!res.ok) throw new Error(`friendbot refused the account: ${res.status}`);
  console.log("(no Stellar CLI found; using a fresh friendbot-funded account)");
}

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
  // wallets (contract accounts) do not need this.
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

// ---------------------------------------------------------------------------
step(7, "SEP-12: payout IBAN");

// SEP-6 /withdraw has no bank field for `bank_account`; the payout IBAN goes
// to the anchor as customer data, the endpoint a real anchor uses for KYC.
await anchor.putCustomer({ bank_account_number: PAYOUT_IBAN });
console.log(`    IBAN ${PAYOUT_IBAN} registered`);

// ---------------------------------------------------------------------------
step(8, `SEP-6 withdraw of ${WITHDRAW_USDC} USDC`);

const withdrawal = await anchor.startWithdraw({ amount: WITHDRAW_USDC });
console.log(`    send to ${withdrawal.account_id} with memo (${withdrawal.memo_type}) ${withdrawal.memo}`);

// The anchor attributes the incoming payment to this withdrawal by the memo.
const payer = await server.loadAccount(keypair.publicKey());
const payment = new TransactionBuilder(payer, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(
    Operation.payment({ destination: withdrawal.account_id, asset: usdc, amount: String(WITHDRAW_USDC) }),
  )
  .addMemo(Memo.id(String(withdrawal.memo)))
  .setTimeout(60)
  .build();
payment.sign(keypair);
const paid = await server.submitTransaction(payment);
console.log(`    USDC sent: ${paid.hash}`);

step(9, "waiting for the lira payout");
const payout = await anchor.waitForCompletion(withdrawal.id, {
  onUpdate: (t) => console.log(`    status: ${t.status}`),
});
console.log(
  `    ${payout.amount_in} USDC -> ${payout.amount_out} TRY to ${payout.to} (${payout.external_transaction_id})`,
);

console.log(`
fiat rail confirmed both ways: Turkish lira went in and spendable USDC came
out; USDC went back and lira was paid to an IBAN (simulated FAST).

  account  https://stellar.expert/explorer/testnet/account/${keypair.publicKey()}
${settled.stellar_transaction_id ? `  deposit  https://stellar.expert/explorer/testnet/tx/${settled.stellar_transaction_id}\n` : ""}  withdraw https://stellar.expert/explorer/testnet/tx/${paid.hash}
`);
