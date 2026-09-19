/**
 * Deploy a new campaign contract next to the existing verifier and DeFindex
 * vault.
 *
 *   npm run contracts:build && node scripts/deploy-campaign.mjs
 *
 * Used when the campaign contract's interface changes -- here, for the
 * minimum funding threshold (`min_bps`): the farmer can draw once that share
 * of the target is raised and keep drawing as more arrives. The verifier, the
 * DeFindex vault and USDC stay as they are; the previous campaign contract
 * moves under `legacy` in deployments.json, and its campaigns stay readable
 * there on chain.
 *
 * Campaigns do not move with it: open them again with
 * `scripts/open-demo-campaigns.mjs` and `scripts/open-global-campaigns.mjs`.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS = join(ROOT, "deployments.json");
const CAMPAIGN_WASM = join(ROOT, "contracts", "target", "wasm32v1-none", "release", "harvest_campaign.wasm");
const NOTE = process.argv[2] ?? "all-or-nothing campaign contract; superseded by the minimum-threshold version";

const STELLAR =
  process.env.STELLAR_BIN ??
  [join(homedir(), ".harvest-bin", "stellar.exe"), "C:\\Program Files (x86)\\Stellar CLI\\stellar.exe"].find(
    existsSync,
  ) ??
  "stellar";
const IDENTITY = process.env.HARVEST_IDENTITY ?? "deployer";
const NETWORK = "testnet";

function stellar(args) {
  try {
    return execFileSync(STELLAR, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`stellar ${args.slice(0, 3).join(" ")} failed:\n${detail || err.message}`);
  }
}

if (!existsSync(CAMPAIGN_WASM)) throw new Error(`missing ${CAMPAIGN_WASM} -- run npm run contracts:build`);

const out = JSON.parse(readFileSync(DEPLOYMENTS, "utf8"));
const admin = stellar(["keys", "address", IDENTITY]);
const vault = out.defindex?.vault ?? out.vault;

console.log(`admin     ${admin}`);
console.log(`verifier  ${out.verifier} (unchanged)`);
console.log(`vault     ${vault} (unchanged, DeFindex)`);
console.log(`previous  ${out.campaign}`);

const campaign = stellar([
  "contract", "deploy",
  "--wasm", CAMPAIGN_WASM,
  "--source-account", IDENTITY,
  "--network", NETWORK,
]).split("\n").pop().trim();
console.log(`deployed  ${campaign}`);

stellar([
  "contract", "invoke",
  "--id", campaign,
  "--source-account", IDENTITY,
  "--network", NETWORK,
  "--", "initialize",
  "--admin", admin,
  "--verifier", out.verifier,
  "--vault", vault,
  "--token", out.usdc,
]);
console.log("initialized: existing verifier + DeFindex vault + USDC");

out.legacy ??= [];
out.legacy.push({ campaign: out.campaign, vault: out.campaignVault ?? vault, note: NOTE });
out.campaign = campaign;
out.campaignVault = vault;
out.campaignAdmin = admin;
out.explorer = `https://stellar.expert/explorer/testnet/contract/${campaign}`;
writeFileSync(DEPLOYMENTS, JSON.stringify(out, null, 2) + "\n");

console.log(`\ndeployments.json updated\n  campaign  ${out.explorer}`);
