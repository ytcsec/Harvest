/**
 * The whole campaign lifecycle against the live testnet contracts, with the
 * escrow in the real DeFindex vault.
 *
 *   node scripts/lifecycle-on-testnet.mjs
 *
 * Two fresh accounts, both funded in lira through the TR anchor:
 *
 *   farmer    cooperative attestation -> Groth16 proof -> create_campaign
 *   investor  fund -> (vault deposit happens inside the campaign contract)
 *   farmer    disburse  (campaign withdraws from DeFindex, pays the advance)
 *   farmer    repay     (principal + agreed return)
 *   investor  claim     (pro-rata share of the investor pool)
 *
 * Every step is a real testnet transaction. The script checks the money at
 * each stage, so a rounding loss in the vault would fail it loudly.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as snarkjs from "snarkjs";
import { Asset, BASE_FEE, Horizon, Keypair, Networks, Operation, TransactionBuilder } from "@stellar/stellar-sdk";

import { AnchorClient } from "../packages/sdk/src/anchor.mjs";
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
  fromStroops,
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

const TARGET = 2; // USDC
const RETURN_PERCENT = 10;

const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const soroban = new SorobanClient();

const step = (n, m) => console.log(`\n[${n}] ${m}`);
const tx = (label, res) => console.log(`    ${label}: ${res.explorer}`);
function check(cond, msg) {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`    ok  ${msg}`);
}

async function usdcOf(address) {
  const acct = await horizon.loadAccount(address);
  const line = acct.balances.find((b) => b.asset_code === USDC.code && b.asset_issuer === USDC.issuer);
  return line ? Number(line.balance) : 0;
}

/** Fresh account, USDC trustline, and USDC bought with lira at the anchor. */
async function newFundedAccount(label, lira) {
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

  const anchor = new AnchorClient();
  await anchor.authenticate(kp.publicKey(), (xdr, pp) => {
    const c = TransactionBuilder.fromXDR(xdr, pp);
    c.sign(kp);
    return c.toXDR();
  });
  const dep = await anchor.startDeposit({ account: kp.publicKey(), amount: lira });
  await anchor.simulateBankTransfer(dep.id, lira);
  const settled = await anchor.waitForCompletion(dep.id);
  console.log(`    ${label} ${kp.publicKey()}  ${lira} TRY -> ${settled.amount_out} USDC`);
  return kp;
}

const read = (method, args = []) =>
  soroban.read({ contractId: d.campaign, method, args, source: d.deployer });
const call = (kp, method, args) =>
  soroban.invoke({ contractId: d.campaign, method, args, source: kp.publicKey(), sign: keypairSigner(kp.secret()) });

console.log(`campaign ${d.campaign}`);
console.log(`vault    ${d.vault}  (DeFindex)`);

// ---------------------------------------------------------------------------
step(1, "two accounts, funded in lira through the anchor");
const farmer = await newFundedAccount("farmer  ", 60);
const investor = await newFundedAccount("investor", 200);

// ---------------------------------------------------------------------------
step(2, "cooperative attestation and a Groth16 proof bound to the farmer");
const issuerKey = Buffer.from(
  JSON.parse(readFileSync(join(ROOT, ".harvest", "issuer-key.json"), "utf8")).secret,
  "hex",
);
if (!existsSync(ZKEY)) throw new Error("no proving key -- run npm run circuit:build");
const issuerPub = await issuerPublicKey(issuerKey);
const SEASON = 2026n;
const farmerSecret = randomFarmerSecret();
const parcelId = parcelIdOf("Giresun/Bulancak ada 214 parsel 7");
const cropCode = cropCodeOf("findik");
const signature = await signAttestation(issuerKey, {
  yieldKg: 48_500n, parcelId, cropCode, seasonId: SEASON, farmerSecret,
});
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  await buildCircuitInput({
    issuerPub, threshold: 40_000n, seasonId: SEASON, farmerSecret, yieldKg: 48_500n,
    parcelId, cropCode, signature, binding: addressBinding(farmer.publicKey()),
  }),
  WASM,
  ZKEY,
);
const claim = encodeClaim(publicSignals);
console.log(`    proof over >= 40 t, nullifier 0x${claim.nullifier.slice(0, 12)}...`);

// ---------------------------------------------------------------------------
step(3, "create_campaign");
const deadline = BigInt(Math.floor(Date.now() / 1000) + 3 * 86_400);
const created = await call(farmer, "create_campaign", [
  addressToScVal(farmer.publicKey()),
  claimToScVal(claim),
  proofToScVal(encodeProof(proof)),
  str("Giresun Tombul Fındık"),
  str("Giresun / Bulancak"),
  i128(toStroops(TARGET)),
  u64(deadline),
  u32(RETURN_PERCENT * 100),
]);
const id = Number(created.value);
tx(`campaign #${id}`, created);

// ---------------------------------------------------------------------------
step(4, `investor funds the full ${TARGET} USDC`);
const investorBefore = await usdcOf(investor.publicKey());
tx("fund", await call(investor, "fund", [addressToScVal(investor.publicKey()), u32(id), i128(toStroops(TARGET))]));
let c = await read("get_campaign", [u32(id)]);
check(Array.isArray(c.status) ? c.status[0] === "Funded" : c.status === "Funded", "campaign is Funded");
check(fromStroops(c.raised) === TARGET, `raised = ${TARGET} USDC`);
check(fromStroops(c.shares) === TARGET, `DeFindex shares = ${fromStroops(c.shares)} (1:1 with USDC, no rounding loss)`);

// ---------------------------------------------------------------------------
step(5, "farmer draws the advance (campaign withdraws from DeFindex)");
const farmerBefore = await usdcOf(farmer.publicKey());
tx("disburse", await call(farmer, "disburse", [u32(id)]));
const farmerAfter = await usdcOf(farmer.publicKey());
check(Math.abs(farmerAfter - farmerBefore - TARGET) < 1e-7, `farmer received ${(farmerAfter - farmerBefore).toFixed(7)} USDC`);

// ---------------------------------------------------------------------------
step(6, "farmer repays principal + return");
const due = fromStroops(await read("amount_due", [u32(id)]));
tx("repay", await call(farmer, "repay", [u32(id)]));
check(Math.abs(due - TARGET * (1 + RETURN_PERCENT / 100)) < 1e-7, `amount due was ${due} USDC`);

// ---------------------------------------------------------------------------
step(7, "investor claims");
tx("claim", await call(investor, "claim", [addressToScVal(investor.publicKey()), u32(id)]));
const investorAfter = await usdcOf(investor.publicKey());
const net = investorAfter - investorBefore;
check(
  Math.abs(net - TARGET * (RETURN_PERCENT / 100)) < 1e-6,
  `investor net ${net.toFixed(7)} USDC (the ${RETURN_PERCENT}% return; testnet vault earns no yield)`,
);

console.log(`
lifecycle complete on the DeFindex vault
  campaign  https://stellar.expert/explorer/testnet/contract/${d.campaign}
  vault     https://stellar.expert/explorer/testnet/contract/${d.vault}
`);

// snarkjs keeps its curve worker threads alive; without this the process
// finishes its work and then never exits.
await globalThis.curve_bn128?.terminate();
