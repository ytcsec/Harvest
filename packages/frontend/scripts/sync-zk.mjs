/**
 * Copies the proving artefacts from the circuit build into public/zk, so the
 * app always proves against the same zkey the verifier contract was set up
 * with. They are ~8 MB and gitignored; `npm run circuit:build` produces them.
 */

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const build = join(here, "..", "..", "..", "circuits", "build");
const out = join(here, "..", "public", "zk");

const files = [
  [join(build, "harvest_capacity_js", "harvest_capacity.wasm"), "harvest_capacity.wasm"],
  [join(build, "harvest_capacity_final.zkey"), "harvest_capacity_final.zkey"],
  [join(build, "verification_key.json"), "verification_key.json"],
];

mkdirSync(out, { recursive: true });

let missing = 0;
for (const [src, name] of files) {
  const dest = join(out, name);
  if (!existsSync(src)) {
    if (!existsSync(dest)) missing++;
    console.warn(`[sync-zk] ${src} not found${existsSync(dest) ? ", keeping the existing copy" : ""}`);
    continue;
  }
  if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs) {
    copyFileSync(src, dest);
    console.log(`[sync-zk] ${name} updated`);
  }
}

if (missing) {
  console.error("[sync-zk] proving artefacts are missing. Run `npm run circuit:build` at the repo root.");
  process.exit(1);
}
