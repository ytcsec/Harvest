/**
 * Deploy the membership-enrolment half of the protocol.
 *
 *   node scripts/deploy-enrolment.mjs
 *
 * Two contracts go up:
 *
 *   1  a second instance of `harvest_verifier`, holding the *enrolment*
 *      circuit's verification key. Both circuits publish six public signals in
 *      the same order, so the same wasm serves both -- and the key is what
 *      keeps a capacity proof from passing as an enrolment, which
 *      `harvest-registry`'s tests assert directly.
 *   2  `harvest_registry`, which verifies enrolment proofs and spends the
 *      enrolment nullifier so one credential cannot enrol twice.
 *
 * The cooperative is accredited on the new verifier with the same signing key
 * it already uses, so a farmer deals with one cooperative, not two.
 *
 * Idempotent: every step checks deployments.json first.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

import { encodeVerificationKey } from "../packages/sdk/src/encoding.mjs";
import { REQUIRED_MASK, docsInMask, DOC_LABELS } from "../packages/sdk/src/enrolment.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOYMENTS = join(ROOT, "deployments.json");
const WASM_DIR = join(ROOT, "contracts", "target", "wasm32v1-none", "release");
const STELLAR = process.env.STELLAR_BIN ?? join(homedir(), ".harvest-bin", "stellar.exe");

const NETWORK = "testnet";
const IDENTITY = "harvest-deployer";

const log = (m) => console.log(m);
const step = (n, m) => console.log(`\n[${n}] ${m}`);

function stellar(args, { quiet = false } = {}) {
  if (!quiet) log(`    $ stellar ${args.join(" ").slice(0, 130)}`);
  try {
    return execFileSync(STELLAR, args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (err) {
    const detail = [err.stdout, err.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`stellar ${args[0]} ${args[1] ?? ""} failed:\n${detail || err.message}`);
  }
}

const out = JSON.parse(readFileSync(DEPLOYMENTS, "utf8"));
const save = () => writeFileSync(DEPLOYMENTS, JSON.stringify(out, null, 2) + "\n");

if (!out.deployer) throw new Error("deployments.json has no deployer. Run: npm run deploy");
if (!out.issuer?.ax) throw new Error("deployments.json has no issuer key. Run: npm run deploy");

console.log("\nHarvest enrolment deployment\n");

// ---------------------------------------------------------------------------
step(1, "enrolment verification key");

const vkPath = join(ROOT, "circuits", "build", "harvest_enrolment_verification_key.json");
if (!existsSync(vkPath)) {
  throw new Error(
    `no enrolment verification key at ${vkPath}\nRun: npm -w @harvest/circuits run build:enrolment`,
  );
}
const vk = encodeVerificationKey(JSON.parse(readFileSync(vkPath, "utf8")));
log(`    ${vk.ic.length} IC points, ${vk.ic.length - 1} public signals`);

// ---------------------------------------------------------------------------
step(2, "contracts");

function deploy(key, wasmName) {
  if (out[key]) {
    log(`    ${key}: reusing ${out[key]}`);
    return out[key];
  }
  const wasm = join(WASM_DIR, wasmName);
  if (!existsSync(wasm)) throw new Error(`missing ${wasm}\nRun: npm run contracts:build`);
  const id = stellar(["contract", "deploy", "--wasm", wasm, "--network", NETWORK, "--source-account", IDENTITY]);
  out[key] = id.split(/\s+/).pop();
  save();
  log(`    ${key}: ${out[key]}`);
  return out[key];
}

const enrolmentVerifierId = deploy("enrolmentVerifier", "harvest_verifier.wasm");
const registryId = deploy("registry", "harvest_registry.wasm");

const invoke = (id, fn, args) =>
  stellar(["contract", "invoke", "--id", id, "--network", NETWORK, "--source-account", IDENTITY, "--", fn, ...args]);

// ---------------------------------------------------------------------------
step(3, "initialize");

out.init ??= {};
function initialized(flag, fn) {
  if (out.init[flag]) {
    log(`    ${flag}: already done`);
    return;
  }
  fn();
  out.init[flag] = true;
  save();
}

initialized("enrolmentVerifier", () => {
  invoke(enrolmentVerifierId, "initialize", ["--admin", out.deployer, "--vk", JSON.stringify(vk)]);
  log("    enrolment verifier initialized with the enrolment circuit's key");
});

initialized("enrolmentIssuer", () => {
  invoke(enrolmentVerifierId, "accredit_issuer", [
    "--ax", out.issuer.ax,
    "--ay", out.issuer.ay,
    "--label", out.issuer.label,
  ]);
  log("    the same cooperative accredited on the enrolment verifier");
});

initialized("registry", () => {
  invoke(registryId, "initialize", [
    "--admin", out.deployer,
    "--verifier", enrolmentVerifierId,
    "--required_mask", String(REQUIRED_MASK),
  ]);
  log(`    registry wired to the enrolment verifier, required mask ${REQUIRED_MASK}`);
});

// ---------------------------------------------------------------------------
out.enrolment = {
  verifier: enrolmentVerifierId,
  registry: registryId,
  requiredMask: REQUIRED_MASK,
};
save();

const required = docsInMask(REQUIRED_MASK)
  .map((bit) => DOC_LABELS[bit].en)
  .join(", ");

console.log(`
deployed to ${NETWORK}

  enrolment verifier  ${enrolmentVerifierId}
  registry            ${registryId}
  required documents  ${required}

  explorer  https://stellar.expert/explorer/testnet/contract/${registryId}

Written to deployments.json.
`);
