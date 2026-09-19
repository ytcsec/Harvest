/**
 * Compile the circuit and run the Groth16 setup.
 *
 * Trusted setup note: we use the Hermez "powers of tau" ceremony output rather
 * than generating our own phase-1, because a self-generated phase-1 is only as
 * trustworthy as the machine that made it. Phase 2 (circuit-specific) is
 * contributed locally here; for anything beyond testnet that contribution
 * would need to be a real multi-party ceremony, and the README says so.
 */

import { execFileSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "build");
const CACHE = join(HERE, ".ptau");

/**
 * Which circuit to build:
 *
 *   node build.mjs                    # harvest_capacity
 *   node build.mjs harvest_enrolment  # the membership-document circuit
 *
 * The capacity circuit keeps the unsuffixed output names it has always had --
 * `deploy.mjs`, `sync-zk.mjs` and the app all read `build/verification_key.json`
 * -- so adding a second circuit does not move anything out from under them.
 */
const DEFAULT_CIRCUIT = "harvest_capacity";
const CIRCUIT = process.argv[2] ?? DEFAULT_CIRCUIT;
const suffix = CIRCUIT === DEFAULT_CIRCUIT ? "" : `${CIRCUIT}_`;
const VK_OUT = `build/${suffix}verification_key.json`;
const PROVENANCE_OUT = `${suffix}setup-provenance.json`;

const CIRCOM =
  process.env.CIRCOM_PATH ?? join(homedir(), ".harvest-bin", "circom.exe");

/**
 * npm hoists workspace dependencies to the repo root when nothing conflicts, so
 * snarkjs may sit in either `circuits/node_modules` or `../node_modules`, and
 * which one depends on the rest of the tree at install time. Resolving instead
 * of hardcoding keeps `npm run circuit:build` working after a fresh install.
 */
const require = createRequire(import.meta.url);
const SNARKJS = (() => {
  for (const base of [HERE, resolve(HERE, "..")]) {
    const candidate = join(base, "node_modules", "snarkjs", "build", "cli.cjs");
    if (existsSync(candidate)) return candidate;
  }
  return join(dirname(require.resolve("snarkjs")), "cli.cjs");
})();

/** circomlib resolves the same way; give circom both roots to search. */
const INCLUDE_PATHS = [join(HERE, "node_modules"), resolve(HERE, "..", "node_modules")].filter(
  existsSync,
);

function sh(cmd, args, opts = {}) {
  console.log(`  $ ${cmd === process.execPath ? "node" : cmd} ${args.join(" ")}`);
  return execFileSync(cmd, args, { stdio: "inherit", cwd: HERE, ...opts });
}
const snarkjs = (...args) => sh(process.execPath, [SNARKJS, ...args]);

/** Hermez ceremony files are indexed by log2 of the constraint capacity. */
function ptauPowerFor(constraints) {
  let p = 8;
  while (1 << p < constraints + 1024) p++;
  return Math.max(p, 12);
}

/**
 * Prefer the Hermez ceremony output. As of 2026-09 every published mirror
 * returns 403 (iden3/snarkjs#636), so we fall back to generating phase 1
 * locally. That fallback is dev-grade -- a single-contributor ceremony is only
 * as sound as this machine -- and `setupProvenance` records which path was
 * taken so the README cannot overclaim.
 */
const PTAU_MIRRORS = (name) => [
  `https://storage.googleapis.com/zkevm/ptau/${name}`,
  `https://hermez.s3-eu-west-1.amazonaws.com/${name}`,
  `https://pse-trusted-setup-ppot.s3.eu-central-1.amazonaws.com/hermez/${name}`,
];

export let setupProvenance = "unknown";

async function ensurePtau(power) {
  mkdirSync(CACHE, { recursive: true });
  const name = `powersOfTau28_hez_final_${power}.ptau`;
  const dest = join(CACHE, name);

  if (existsSync(dest) && statSync(dest).size > 1024) {
    console.log(`  ptau cached: ${name}`);
    setupProvenance = "hermez-ceremony (cached)";
    return dest;
  }

  for (const url of PTAU_MIRRORS(name)) {
    try {
      console.log(`  trying ${new URL(url).host} ...`);
      const res = await fetch(url);
      if (!res.ok) {
        console.log(`    ${res.status} ${res.statusText}`);
        continue;
      }
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      console.log(`  saved ${(statSync(dest).size / 1e6).toFixed(1)} MB from Hermez ceremony`);
      setupProvenance = "hermez-ceremony";
      return dest;
    } catch (err) {
      console.log(`    unreachable: ${err.message}`);
    }
  }

  console.log(`
  !! Every Hermez mirror refused the download (see iden3/snarkjs#636).
  !! Falling back to a locally generated phase-1 ceremony.
  !! This is fine for testnet; it is NOT a production-grade trusted setup.
`);
  const local = join(CACHE, `pot${power}_local_final.ptau`);
  if (existsSync(local) && statSync(local).size > 1024) {
    console.log(`  local ptau cached: ${local}`);
    setupProvenance = "local-dev-ceremony (cached)";
    return local;
  }
  const entropy = process.env.PHASE1_ENTROPY ?? "harvest-phase1-istanbul-2026";
  snarkjs("powersoftau", "new", "bn128", String(power), join(CACHE, "p1_0000.ptau"), "-v");
  // snarkjs' CLI parser only accepts the `--flag=value` form for these.
  snarkjs(
    "powersoftau", "contribute",
    join(CACHE, "p1_0000.ptau"), join(CACHE, "p1_0001.ptau"),
    "--name=harvest-local-phase1", `-e=${entropy}`,
  );
  snarkjs("powersoftau", "prepare", "phase2", join(CACHE, "p1_0001.ptau"), local, "-v");
  setupProvenance = "local-dev-ceremony";
  return local;
}

console.log("\n[1/5] compiling circuit");
mkdirSync(BUILD, { recursive: true });
sh(CIRCOM, [
  `${CIRCUIT}.circom`,
  "--r1cs",
  "--wasm",
  "--sym",
  "-o",
  "build",
  ...INCLUDE_PATHS.flatMap((p) => ["-l", p]),
]);

console.log("\n[2/5] inspecting constraint system");
const info = execFileSync(process.execPath, [SNARKJS, "r1cs", "info", `build/${CIRCUIT}.r1cs`], {
  cwd: HERE,
  encoding: "utf8",
});
console.log(info.trim());
const constraints = Number(/# of Constraints:\s*(\d+)/i.exec(info)?.[1] ?? 0);
if (!constraints) throw new Error("could not read constraint count from r1cs info");
const power = ptauPowerFor(constraints);
console.log(`  -> ${constraints} constraints, using 2^${power} ptau`);

console.log("\n[3/5] fetching powers of tau");
const ptau = await ensurePtau(power);

console.log("\n[4/5] groth16 setup + phase-2 contribution");
snarkjs("groth16", "setup", `build/${CIRCUIT}.r1cs`, ptau, `build/${CIRCUIT}_0000.zkey`);
snarkjs(
  "zkey",
  "contribute",
  `build/${CIRCUIT}_0000.zkey`,
  `build/${CIRCUIT}_final.zkey`,
  "--name=harvest-protocol-phase2",
  `-e=${process.env.PHASE2_ENTROPY ?? "harvest-pro-hackathon-2026-istanbul"}`,
);

console.log("\n[5/5] exporting verification key");
snarkjs("zkey", "export", "verificationkey", `build/${CIRCUIT}_final.zkey`, VK_OUT);

const vk = JSON.parse(readFileSync(join(HERE, VK_OUT), "utf8"));
writeFileSync(
  join(BUILD, PROVENANCE_OUT),
  JSON.stringify(
    { phase1: setupProvenance, phase2: "single local contribution", constraints, ptauPower: power },
    null,
    2,
  ),
);
console.log(`\ndone.`);
console.log(`  phase-1 setup    : ${setupProvenance}`);
console.log(`  curve            : ${vk.curve}`);
console.log(`  protocol         : ${vk.protocol}`);
console.log(`  public signals   : ${vk.nPublic}`);
console.log(`  proving key      : build/${CIRCUIT}_final.zkey`);
console.log(`  witness wasm     : build/${CIRCUIT}_js/${CIRCUIT}.wasm`);
console.log(`  verification key : ${VK_OUT}`);
if (vk.nPublic !== 6) {
  throw new Error(`expected 6 public signals, got ${vk.nPublic} -- contract IC size would mismatch`);
}
