/**
 * Move the campaign escrow onto a real DeFindex vault.
 *
 *   node scripts/deploy-defindex.mjs
 *
 * Until now the campaign contract escrowed into `mock-defindex-vault`, our
 * twin of DeFindex's VaultTrait. This script replaces it with a genuine
 * DeFindex vault, created through DeFindex's own testnet factory:
 *
 *   1  the deployer gets a USDC trustline and a little USDC from the TR anchor
 *   2  the factory creates a DeFindex vault holding the anchor's USDC
 *   3  the deployer seeds it with 1 USDC (see below)
 *   4  a fresh campaign contract is deployed and wired to the existing
 *      verifier, the new vault and USDC
 *   5  deployments.json is updated; the old addresses move under `legacy`
 *
 * Why a new vault rather than DeFindex's own testnet USDC vault: that one
 * holds Blend's testnet USDC (CAQCFVLO...), not the Circle testnet USDC the
 * anchor settles (GBBD47IF... / CBIELTK6...). Two different tokens -- lira
 * from the anchor could never reach it. On testnet, Blend's pools only list
 * Blend's own USDC, so this vault has no yield strategy attached and its
 * funds sit idle. On mainnet the same vault takes a Blend USDC strategy.
 *
 * Why the seed deposit: a DeFindex vault locks MINIMUM_LIQUIDITY shares on
 * its first deposit. If a campaign made that first deposit it would recover
 * slightly less than it put in, and `disburse` -- which pays the farmer the
 * full amount raised -- would fail. Seeding first keeps shares 1:1 with USDC.
 *
 * Idempotent: every step checks deployments.json first.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
const DEPLOYMENTS = join(ROOT, "deployments.json");
const CAMPAIGN_WASM = join(ROOT, "contracts", "target", "wasm32v1-none", "release", "harvest_campaign.wasm");

const STELLAR =
  process.env.STELLAR_BIN ??
  [join(homedir(), ".harvest-bin", "stellar.exe"), "C:\\Program Files (x86)\\Stellar CLI\\stellar.exe"].find(
    existsSync,
  ) ??
  "stellar";
const IDENTITY = process.env.HARVEST_IDENTITY ?? "deployer";
const NETWORK = "testnet";

/** DeFindex's testnet factory, from paltalabs/defindex public/testnet.contracts.json. */
const DEFINDEX_FACTORY = "CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32";
const SEED_USDC = 1;
const STROOPS = 10_000_000;

const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");

const out = JSON.parse(readFileSync(DEPLOYMENTS, "utf8"));
const save = () => writeFileSync(DEPLOYMENTS, JSON.stringify(out, null, 2) + "\n");

const step = (n, m) => console.log(`\n[${n}] ${m}`);

function stellar(args) {
  try {
    return execFileSync(STELLAR, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`stellar ${args.slice(0, 3).join(" ")} failed:\n${detail || err.message}`);
  }
}

const invoke = (id, fn, args = [], { send = true } = {}) =>
  stellar([
    "contract", "invoke",
    "--id", id,
    "--source-account", IDENTITY,
    "--network", NETWORK,
    ...(send ? [] : ["--send=no"]),
    "--", fn, ...args,
  ]).split("\n").pop().replace(/^"|"$/g, "");

// ---------------------------------------------------------------------------
step(1, "deployer account");

const admin = stellar(["keys", "address", IDENTITY]);
const keypair = Keypair.fromSecret(stellar(["keys", "show", IDENTITY]));
console.log(`    ${admin}`);

const usdcBalance = async () => {
  const acct = await horizon.loadAccount(admin);
  const line = acct.balances.find((b) => b.asset_code === USDC.code && b.asset_issuer === USDC.issuer);
  return line ? Number(line.balance) : null;
};

if ((await usdcBalance()) === null) {
  const acct = await horizon.loadAccount(admin);
  const tx = new TransactionBuilder(acct, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(Operation.changeTrust({ asset: USDC }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  await horizon.submitTransaction(tx);
  console.log("    USDC trustline opened");
}

if ((await usdcBalance()) < SEED_USDC + 0.5) {
  // The seed comes through the same lira rail the users use.
  const anchor = new AnchorClient();
  await anchor.authenticate(admin, (xdr, passphrase) => {
    const challenge = TransactionBuilder.fromXDR(xdr, passphrase);
    challenge.sign(keypair);
    return challenge.toXDR();
  });
  const deposit = await anchor.startDeposit({ account: admin, amount: 200 });
  await anchor.simulateBankTransfer(deposit.id, 200);
  const settled = await anchor.waitForCompletion(deposit.id);
  console.log(`    200 TRY -> ${settled.amount_out} USDC via the TR anchor`);
}
console.log(`    USDC balance: ${await usdcBalance()}`);

// ---------------------------------------------------------------------------
step(2, "DeFindex vault (through DeFindex's factory)");

out.defindex ??= {};
if (!out.defindex.vault) {
  const role = admin;
  out.defindex.vault = invoke(DEFINDEX_FACTORY, "create_defindex_vault", [
    // 0 emergency manager, 1 fee receiver, 2 manager, 3 rebalance manager
    "--roles", JSON.stringify({ 0: role, 1: role, 2: role, 3: role }),
    "--vault_fee", "0",
    "--assets", JSON.stringify([{ address: out.usdc, strategies: [] }]),
    // Only used for swaps between a vault's assets; a single-asset vault
    // never swaps. DeFindex requires an address here all the same.
    "--soroswap_router", DEFINDEX_FACTORY,
    "--name_symbol", JSON.stringify({ name: "Harvest USDC Escrow", symbol: "HVUSDC" }),
    "--upgradable", "false",
  ]);
  out.defindex.factory = DEFINDEX_FACTORY;
  save();
  console.log(`    created ${out.defindex.vault}`);
} else {
  console.log(`    already created: ${out.defindex.vault}`);
}

// ---------------------------------------------------------------------------
step(3, `seed deposit of ${SEED_USDC} USDC`);

const supply = BigInt(invoke(out.defindex.vault, "total_supply", [], { send: false }) || "0");
if (supply === 0n) {
  const amount = String(SEED_USDC * STROOPS);
  invoke(out.defindex.vault, "deposit", [
    "--amounts_desired", JSON.stringify([amount]),
    "--amounts_min", JSON.stringify([amount]),
    "--from", admin,
    "--invest", "false",
  ]);
  console.log("    seeded; the vault's locked minimum liquidity is paid by the deployer, not a campaign");
} else {
  console.log(`    already seeded (total supply ${supply})`);
}

// ---------------------------------------------------------------------------
step(4, "campaign contract on the DeFindex vault");

if (out.campaignVault !== out.defindex.vault) {
  if (!existsSync(CAMPAIGN_WASM)) throw new Error(`missing ${CAMPAIGN_WASM} -- run npm run contracts:build`);

  out.legacy ??= [];
  out.legacy.push({
    campaign: out.campaign,
    vault: out.vault,
    note: "campaign contract escrowing into mock-defindex-vault; superseded by the DeFindex vault",
  });

  const campaign = stellar([
    "contract", "deploy",
    "--wasm", CAMPAIGN_WASM,
    "--source-account", IDENTITY,
    "--network", NETWORK,
  ]).split("\n").pop().trim();
  console.log(`    deployed ${campaign}`);

  invoke(campaign, "initialize", [
    "--admin", admin,
    "--verifier", out.verifier,
    "--vault", out.defindex.vault,
    "--token", out.usdc,
  ]);
  console.log("    initialized: existing verifier + DeFindex vault + USDC");

  out.campaign = campaign;
  out.vault = out.defindex.vault;
  out.campaignVault = out.defindex.vault;
  out.campaignAdmin = admin;
  out.explorer = `https://stellar.expert/explorer/testnet/contract/${campaign}`;
  save();
} else {
  console.log(`    already wired: ${out.campaign}`);
}

console.log(`
done
  DeFindex vault  https://stellar.expert/explorer/testnet/contract/${out.defindex.vault}
  campaign        https://stellar.expert/explorer/testnet/contract/${out.campaign}
`);
