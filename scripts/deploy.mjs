/**
 * Deploy Harvest to Stellar testnet.
 *
 * Idempotent: re-running reuses the identity, the funded account and any
 * already-deployed contract ids recorded in `deployments.json`, so it is safe
 * to run repeatedly while iterating.
 *
 *   node scripts/deploy.mjs              # deploy / top up
 *   node scripts/deploy.mjs --fresh      # ignore existing ids and redeploy
 *
 * Everything goes through the `stellar` CLI with `execFileSync` and an argv
 * array -- never a shell string -- because the verification key is passed as
 * JSON and Windows quoting would mangle it.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import {
  encodeVerificationKey,
  checkEncodingAgainstFixture,
  fieldToHex,
} from "../packages/sdk/src/encoding.mjs";
import { issuerPublicKey } from "../packages/sdk/src/attestation.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = join(ROOT, ".harvest");
const DEPLOYMENTS = join(ROOT, "deployments.json");
const WASM_DIR = join(ROOT, "contracts", "target", "wasm32v1-none", "release");
const STELLAR = process.env.STELLAR_BIN ?? join(homedir(), ".harvest-bin", "stellar.exe");

const NETWORK = "testnet";
const IDENTITY = "harvest-deployer";
const FRESH = process.argv.includes("--fresh");

/**
 * Circle's testnet USDC. This is the asset the TR anchor
 * (tr-mock-anchor.fly.dev) actually settles in, so it has to be the asset the
 * campaign contract and the vault are denominated in -- otherwise the fiat rail
 * and the escrow are two unrelated systems wearing the same label.
 */
const USDC_ASSET = "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

// ---------------------------------------------------------------------------

const log = (msg) => console.log(msg);
const step = (n, msg) => console.log(`\n[${n}] ${msg}`);

function stellar(args, { quiet = false } = {}) {
  if (!quiet) log(`    $ stellar ${args.join(" ").slice(0, 140)}`);
  try {
    return execFileSync(STELLAR, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`stellar ${args[0]} ${args[1] ?? ""} failed:\n${detail || err.message}`);
  }
}

function loadDeployments() {
  if (FRESH || !existsSync(DEPLOYMENTS)) return {};
  try {
    return JSON.parse(readFileSync(DEPLOYMENTS, "utf8"));
  } catch {
    return {};
  }
}

function save(deployments) {
  writeFileSync(DEPLOYMENTS, JSON.stringify(deployments, null, 2) + "\n");
}

const out = loadDeployments();
mkdirSync(STATE_DIR, { recursive: true });

// ---------------------------------------------------------------------------
step(1, "identity");

const identities = stellar(["keys", "ls"], { quiet: true });
if (!identities.split(/\s+/).includes(IDENTITY)) {
  log(`    creating and funding '${IDENTITY}'`);
  stellar(["keys", "generate", IDENTITY, "--network", NETWORK, "--fund", "--overwrite"]);
} else {
  log(`    reusing '${IDENTITY}'`);
}
const deployer = stellar(["keys", "address", IDENTITY], { quiet: true });
log(`    deployer: ${deployer}`);
// Friendbot is idempotent enough to call again; a funded account just stays funded.
try {
  stellar(["keys", "fund", IDENTITY, "--network", NETWORK], { quiet: true });
} catch {
  /* already funded */
}

// ---------------------------------------------------------------------------
step(2, "cooperative signing key");

// The accredited issuer. In production this lives in the cooperative's HSM;
// here it is generated once and cached so re-deploys keep the same identity.
const issuerKeyPath = join(STATE_DIR, "issuer-key.json");
let issuerSecretHex;
if (existsSync(issuerKeyPath) && !FRESH) {
  issuerSecretHex = JSON.parse(readFileSync(issuerKeyPath, "utf8")).secret;
  log("    reusing cached issuer key");
} else {
  issuerSecretHex = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32)),
  ).toString("hex");
  writeFileSync(issuerKeyPath, JSON.stringify({ secret: issuerSecretHex }, null, 2));
  log(`    generated a new issuer key -> ${issuerKeyPath}`);
}
const issuerPub = await issuerPublicKey(Buffer.from(issuerSecretHex, "hex"));
const issuerAx = fieldToHex(issuerPub.Ax);
const issuerAy = fieldToHex(issuerPub.Ay);
log(`    issuer Ax: 0x${issuerAx.slice(0, 16)}...`);

// ---------------------------------------------------------------------------
step(3, "verification key");

const vkPath = join(ROOT, "circuits", "build", "verification_key.json");
if (!existsSync(vkPath)) {
  throw new Error(`no verification key at ${vkPath}\nRun: npm run circuit:build`);
}
const vk = encodeVerificationKey(JSON.parse(readFileSync(vkPath, "utf8")));
log(`    ${vk.ic.length} IC points, ${vk.ic.length - 1} public signals`);

// Catch encoder drift here, not as an unexplained InvalidProof from a live
// contract an hour into the demo.
const fixturePath = join(ROOT, "contracts", "harvest-verifier", "tests", "data", "valid.json");
if (existsSync(fixturePath)) {
  checkEncodingAgainstFixture(JSON.parse(readFileSync(fixturePath, "utf8")));
  log("    encoding matches the Rust-verified fixture");
}

// ---------------------------------------------------------------------------
step(4, "USDC token contract");

if (!out.usdc) {
  const id = stellar(["contract", "id", "asset", "--asset", USDC_ASSET, "--network", NETWORK]);
  // The SAC may not be instantiated on testnet yet; deploying is a no-op if it is.
  try {
    stellar(["contract", "asset", "deploy", "--asset", USDC_ASSET, "--network", NETWORK, "--source-account", IDENTITY], { quiet: true });
    log("    deployed the USDC Stellar Asset Contract");
  } catch {
    log("    USDC SAC already live");
  }
  out.usdc = id;
  save(out);
}
log(`    USDC: ${out.usdc}`);

// ---------------------------------------------------------------------------
step(5, "contracts");

function deploy(name, wasmName) {
  if (out[name]) {
    log(`    ${name}: reusing ${out[name]}`);
    return out[name];
  }
  const wasm = join(WASM_DIR, wasmName);
  if (!existsSync(wasm)) throw new Error(`missing ${wasm}\nRun: npm run contracts:build`);
  const id = stellar(["contract", "deploy", "--wasm", wasm, "--network", NETWORK, "--source-account", IDENTITY]);
  out[name] = id.split(/\s+/).pop();
  save(out);
  log(`    ${name}: ${out[name]}`);
  return out[name];
}

const verifierId = deploy("verifier", "harvest_verifier.wasm");
const vaultId = deploy("vault", "mock_defindex_vault.wasm");
const campaignId = deploy("campaign", "harvest_campaign.wasm");

const invoke = (id, fn, args) =>
  stellar(["contract", "invoke", "--id", id, "--network", NETWORK, "--source-account", IDENTITY, "--", fn, ...args]);

// ---------------------------------------------------------------------------
step(6, "initialize");

function initialized(flag, fn) {
  if (out.init?.[flag]) {
    log(`    ${flag}: already done`);
    return;
  }
  fn();
  out.init = { ...(out.init ?? {}), [flag]: true };
  save(out);
}

initialized("verifier", () => {
  invoke(verifierId, "initialize", ["--admin", deployer, "--vk", JSON.stringify(vk)]);
  log("    verifier initialized with the circuit's verification key");
});

initialized("issuer", () => {
  invoke(verifierId, "accredit_issuer", [
    "--ax", issuerAx,
    "--ay", issuerAy,
    "--label", "Giresun Findik Tarim Satis Kooperatifi",
  ]);
  log("    cooperative accredited");
});

initialized("vault", () => {
  invoke(vaultId, "initialize", ["--token", out.usdc, "--manager", deployer]);
  log("    vault initialized");
});

initialized("campaign", () => {
  invoke(campaignId, "initialize", [
    "--admin", deployer,
    "--verifier", verifierId,
    "--vault", vaultId,
    "--token", out.usdc,
  ]);
  log("    campaign contract wired to verifier + vault + USDC");
});

// ---------------------------------------------------------------------------
out.network = NETWORK;
out.deployer = deployer;
out.issuer = { ax: issuerAx, ay: issuerAy, label: "Giresun Findik Tarim Satis Kooperatifi" };
out.anchor = "https://tr-mock-anchor.fly.dev";
out.explorer = `https://stellar.expert/explorer/testnet/contract/${campaignId}`;
save(out);

console.log(`
deployed to ${NETWORK}

  verifier  ${verifierId}
  campaign  ${campaignId}
  vault     ${vaultId}
  USDC      ${out.usdc}

  explorer  ${out.explorer}

Written to deployments.json.
`);
