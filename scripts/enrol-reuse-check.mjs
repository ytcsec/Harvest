/**
 * The identity behind an enrolment is the browser's secret, not its wallet.
 *
 *   node scripts/enrol-reuse-check.mjs
 *
 * A farmer who enrols and then creates a second demo wallet gets a new address
 * while the secret in localStorage stays put -- and the registry keys its
 * nullifier on the secret. Checking "is this address enrolled?" reports free,
 * and the farmer only finds out when `register` reverts with AlreadyRegistered,
 * after a 9 MB download and a proof they cannot use.
 *
 * This walks that exact path and asserts the app now says so up front.
 */

import { chromium } from "playwright";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILE = join(ROOT, ".harvest", "reuse-check-profile");
const WEB = process.env.WEB_URL ?? "http://localhost:3000";

let pass = 0;
let fail = 0;
const ok = (n, c, x = "") => {
  c ? (pass++, console.log(`  PASS  ${n}${x ? `  ${x}` : ""}`)) : (fail++, console.log(`  FAIL  ${n}${x ? `  ${x}` : ""}`));
};

/**
 * A grower the cooperative has never met, fresh every run.
 *
 * Enrolling as one of the seed growers would make the run depend on whether a
 * previous one had already claimed them. A new ÇKS number is always free, and
 * it exercises the path a real first-time applicant takes.
 */
const freshCks = () => `CKS-2026-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
const DEED = "Ordu/Altinordu ada 91 parsel 4";

console.log("\nEnrolment identity reuse\n");

rmSync(PROFILE, { recursive: true, force: true });
const ctx = await chromium.launchPersistentContext(PROFILE, {
  headless: !process.argv.includes("--headed"),
  viewport: { width: 1400, height: 1100 },
});
const p = ctx.pages()[0] ?? (await ctx.newPage());
p.setDefaultTimeout(180_000);
const id = (s) => p.locator(`[data-testid="${s}"]`);

const newDemoWallet = async () => {
  await id("wallet-button").first().click();
  await id("wallet-modal").waitFor();
  await id("wallet-create-demo").click();
  await id("wallet-address").waitFor({ timeout: 180_000 });
  const addr = (await id("wallet-address").innerText()).trim();
  await id("wallet-close").click();
  await id("wallet-modal").waitFor({ state: "hidden" });
  return addr;
};

try {
  // --- a complete enrolment -------------------------------------------------
  await p.goto(`${WEB}/kayit`, { waitUntil: "domcontentloaded" });
  await id("enrol-fullname").waitFor();
  const first = await newDemoWallet();
  ok("first demo wallet created", /^G[A-Z2-7]{55}$/.test(first), `${first.slice(0, 8)}…`);

  await id("enrol-fullname").fill("Reuse Check");
  await id("enrol-nationalid").fill("11122233344");
  await id("enrol-to-documents").click();
  await id("doc-cks").waitFor();

  const cks = freshCks();
  await id("doc-cks").fill(cks);
  await id("doc-deed").fill(DEED);
  await id("doc-tarsim").fill("TRS-2026-40188");
  await id("enrol-submit").click();
  await id("enrol-review").waitFor({ timeout: 120_000 });

  await id("enrol-prove").click();
  await id("enrol-proof-ok").waitFor({ timeout: 300000 });
  await id("enrol-register").click();
  await id("enrol-done").waitFor({ timeout: 300000 });
  ok("the enrolment is recorded on chain", true, cks);

  // --- a second wallet, same browser, same secret ---------------------------
  // Drop the wallet keys and nothing else. `harvest.farmerSecret.v1` stays,
  // which is exactly what happens when someone makes a new demo wallet: a new
  // address over an identity the registry has already seen.
  await p.evaluate(() => {
    localStorage.removeItem("harvest.wallet.v1");
    localStorage.removeItem("harvest.wallet.kind");
  });
  ok(
    "the farmer identity survives a new wallet",
    await p.evaluate(() => Boolean(localStorage.getItem("harvest.farmerSecret.v1"))),
  );

  await p.goto(`${WEB}/kayit`, { waitUntil: "domcontentloaded" });
  await id("enrol-fullname").waitFor();
  const second = await newDemoWallet();
  ok("a second demo wallet has a different address", second !== first, `${second.slice(0, 8)}…`);

  // --- the app must refuse before the transaction, not after ---------------
  await id("already-enrolled").waitFor({ timeout: 120_000 });
  const msg = (await id("already-enrolled").innerText()).replace(/\s+/g, " ").trim();
  ok("the app says the identity is already enrolled", msg.length > 0, msg.slice(0, 70));
  ok(
    "and does not offer the enrolment form",
    (await id("enrol-submit").count()) === 0,
    "no way to reach a transaction that would revert",
  );
} catch (e) {
  fail++;
  console.log("  ERROR ", String(e).split("\n")[0].slice(0, 200));
} finally {
  await ctx.close();
  rmSync(PROFILE, { recursive: true, force: true });
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
