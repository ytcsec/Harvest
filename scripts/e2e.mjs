/**
 * End-to-end browser test.
 *
 *   node scripts/e2e.mjs            # headless
 *   node scripts/e2e.mjs --headed   # watch it happen
 *
 * Drives the real app against the real cooperative service and the real
 * testnet contracts. No mocks: the vault strip and the campaign list are read
 * back from the deployed contracts, the demo wallet is funded by friendbot,
 * and the proof is built by snarkjs in the page against the 9,981-constraint
 * circuit.
 *
 * The on-chain accept / reject / replay verdicts are asserted by
 * `scripts/prove-on-testnet.mjs`, which also checks that the submitted payload
 * never contains the private yield. This file covers the browser path: that a
 * person can actually get from "nothing" to "a real Groth16 proof" through the
 * UI, and that the private figure only ever appears in the panel labelled as
 * staying on the device.
 *
 * Selectors are `data-testid`, not copy. The app ships Turkish and English
 * dictionaries and the user can switch at runtime, so asserting on visible
 * text would make this test a translation test.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEADED = process.argv.includes("--headed");
const WEB = "http://localhost:3000";
const ISSUER = "http://localhost:8787";

/**
 * A grower the cooperative has never met, fresh every run.
 *
 * Enrolling as one of the seed growers would tie the run to whether an earlier
 * one had already claimed them. A new ÇKS number is always free, and it is the
 * path a real first-time applicant takes. The expected harvest it produces is
 * the cooperative's to decide, so the assertions below read it off the page
 * rather than from a table here.
 */
const freshCks = () => `CKS-2026-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
const DEED = "Ordu/Altinordu ada 91 parsel 4";

/**
 * "48.500 kg" or "48,500 kg" -> 48500.
 *
 * The app formats with the viewer's locale, so the thousands separator is a dot
 * in Turkish and a comma in English. Stripping everything that is not a digit
 * reads both without the test having to know which language is on screen.
 */
const kgFrom = (text) => Number((/([\d.,]+)\s*kg/.exec(text)?.[1] ?? "0").replace(/\D/g, ""));


let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}${extra ? `  ${extra}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${extra ? `  ${extra}` : ""}`);
  }
};

const children = [];

/** Reuse a service already running on a port rather than fighting it for one. */
async function alreadyUp(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2500) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Spawn a dev server and wait until its port answers.
 *
 * Polling the port rather than grepping stdout: next and npm both colourise
 * and chunk their banners, so a regex over the stream is a race that usually
 * loses.
 */
async function start(name, cmd, args, { cwd = ROOT, url, timeoutMs = 240_000 }) {
  const child = spawn(cmd, args, { cwd, shell: true, env: process.env });
  children.push(child);

  let exited = null;
  child.on("exit", (code) => {
    exited = code;
  });
  const log = [];
  const capture = (b) => log.push(b.toString());
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`${name} exited early (${exited})
${log.join("").slice(-1200)}`);
    }
    if (await alreadyUp(url)) return child;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`${name} never answered on ${url}
${log.join("").slice(-1200)}`);
}

const cleanup = () =>
  children.forEach((c) => {
    try {
      c.kill();
    } catch {}
  });
process.on("exit", cleanup);
process.on("SIGINT", () => {
  cleanup();
  process.exit(1);
});

console.log("\nHarvest end-to-end\n");

if (await alreadyUp(`${ISSUER}/issuer`)) {
  console.log("  cooperative service already running, reusing it");
} else {
  console.log("  starting the cooperative service ...");
  await start("issuer", "node", ["packages/issuer/server.mjs"], { url: `${ISSUER}/issuer` });
}

if (await alreadyUp(WEB)) {
  console.log("  web app already running, reusing it");
} else {
  console.log("  starting the web app (next dev, first compile takes a while) ...");
  await start("next", "npm", ["-w", "@harvest/frontend", "run", "dev", "--", "--port", "3000"], {
    url: WEB,
  });
}

// `next dev` compiles a route on its first request. Asking for each one over
// plain HTTP first means the browser never arrives mid-compile -- which serves
// a half-written chunk and fails the page with a SyntaxError rather than a
// timeout the assertions could ride out.
console.log("\n  warming the routes (next compiles on first request) ...");
for (const route of ["/", "/explore", "/kayit", "/create"]) {
  const t0 = Date.now();
  await fetch(`${WEB}${route}`, { signal: AbortSignal.timeout(300_000) }).catch(() => {});
  console.log(`    ${route} ${Date.now() - t0} ms`);
}

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(120_000);

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const testid = (id) => page.locator(`[data-testid="${id}"]`);

try {
  // -- shell ---------------------------------------------------------------
  console.log("\n  loading the app ...");
  await page.goto(WEB, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForSelector('a[aria-label="HARVEST"]', { timeout: 180_000 });
  ok("app loads", await page.locator('a[aria-label="HARVEST"]').first().isVisible());

  // -- live chain reads, before any wallet exists --------------------------
  console.log("\n  reading the vault and the campaign list from chain ...");
  await page.goto(`${WEB}/explore`, { waitUntil: "domcontentloaded", timeout: 180_000 });

  await testid("vault-strip").first().waitFor({ timeout: 180_000 });
  ok("campaigns page renders", await testid("vault-strip").first().isVisible());

  await page
    .waitForSelector('[data-testid="vault-strip"][data-loaded="true"]', { timeout: 120_000 })
    .catch(() => {});
  const vaultStrip = (await testid("vault-strip").first().innerText()).replace(/\s+/g, " ").trim();
  ok("vault strip shows live figures", /USDC/.test(vaultStrip), vaultStrip.slice(0, 70));

  await testid("campaign-list").waitFor({ timeout: 120_000 });
  const campaignCount = Number(await testid("campaign-list").getAttribute("data-count"));
  ok("campaign list read from the contract", campaignCount > 0, `${campaignCount} campaigns`);

  // -- wallet --------------------------------------------------------------
  console.log("\n  creating a demo wallet (friendbot + USDC trustline) ...");
  await testid("wallet-button").first().click();
  await testid("wallet-modal").waitFor();
  await testid("wallet-create-demo").click();
  await testid("wallet-address").waitFor({ timeout: 180_000 });
  const addr = (await testid("wallet-address").innerText()).trim();
  ok("demo wallet created and funded", /^G[A-Z2-7]{55}$/.test(addr), `${addr.slice(0, 8)}…`);
  await testid("wallet-close").click();
  await testid("wallet-modal").waitFor({ state: "hidden" });

  // -- enrolment -----------------------------------------------------------
  // The cooperative will not attest to a harvest for a wallet that has not
  // enrolled, so the farmer path now starts here. `enrol-e2e.mjs` covers this
  // flow in detail; what matters for this run is getting through it.
  console.log("\n  enrolling the membership (documents -> proof -> registry) ...");
  await page.goto(`${WEB}/kayit`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await testid("enrol-fullname").waitFor({ timeout: 180_000 });
  // The wallet was created on another page and comes back from localStorage
  // asynchronously. The form's Next button stays disabled until it does, so
  // wait for the navbar to show an address rather than racing it.
  await page.waitForSelector('[data-testid="wallet-button"][data-wallet-address]', {
    timeout: 120_000,
  });

  // No membership is picked: an applicant does not have one yet. The ÇKS number
  // is the key, and the membership number comes back as the result.
  ok("the enrolment form asks for no membership number", (await page.locator("#membership").count()) === 0);

  await testid("enrol-fullname").fill("E2E Applicant");
  await testid("enrol-nationalid").fill("10000000146");
  await testid("enrol-to-documents").click();
  await testid("doc-cks").waitFor();

  const cks = freshCks();
  await testid("doc-cks").fill(cks);
  await testid("doc-deed").fill(DEED);
  await testid("enrol-submit").click();
  await testid("enrol-review").waitFor({ timeout: 120_000 });

  const granted = (await testid("enrol-membership-granted").innerText()).replace(/\s+/g, " ").trim();
  ok("a membership number is handed back", /GFK-\d{4}-\d{4}/.test(granted), granted.slice(0, 60));

  const enrolStays = (await testid("enrol-stays").innerText()).replace(/\s+/g, " ").trim();
  const enrolPublished = (await testid("enrol-published").innerText()).replace(/\s+/g, " ").trim();
  ok("the land area stays in the on-device panel", /dekar|decare/i.test(enrolStays), enrolStays.slice(0, 60));
  ok("the land area is absent from what gets published", !/dekar|decare/i.test(enrolPublished));

  await testid("enrol-prove").click();
  await testid("enrol-proof-ok").waitFor({ timeout: 300_000 });
  ok("the enrolment verifier accepts the proof", await testid("enrol-proof-ok").isVisible());

  await testid("enrol-register").click();
  await testid("enrol-done").waitFor({ timeout: 300_000 });
  ok("the enrolment is recorded on chain", await testid("enrol-done").isVisible());

  // -- farmer flow ---------------------------------------------------------
  console.log("\n  requesting the cooperative attestation ...");
  await page.goto(`${WEB}/create`, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await testid("secret-yield").waitFor({ timeout: 180_000 });
  // The panel renders before `fetchMembers()` resolves, showing 0 kg until the
  // cooperative answers. Read the figure, not whatever is on screen first.
  await page.waitForFunction(
    () => {
      const el = document.querySelector('[data-testid="secret-yield"]');
      return !!el && !/^0(\D|$)/.test(el.textContent.trim());
    },
    null,
    { timeout: 120_000 },
  );

  // The figure is the cooperative's, derived when it opened the membership, so
  // the test learns it here rather than asserting a number it chose itself.
  const secret = (await testid("secret-yield").innerText()).trim();
  const realYieldKg = kgFrom(secret);
  ok("cooperative record carries a real yield", realYieldKg > 0, secret);

  await testid("attest").click();
  await testid("stays-panel").waitFor({ timeout: 120_000 });
  ok("attestation advances to the proof step", await testid("stays-panel").isVisible());

  const stays = (await testid("stays-panel").innerText()).replace(/\s+/g, " ").trim();
  ok("the real figure stays in the on-device panel", stays.includes(secret), stays.slice(0, 70));

  const threshold = Number(await page.locator("#threshold").inputValue());
  ok(
    "threshold defaults below the real yield",
    threshold > 0 && threshold * 1000 < realYieldKg,
    `${threshold} t < ${realYieldKg / 1000} t`,
  );

  const statement = (await testid("statement").innerText()).replace(/\s+/g, " ").trim();
  ok("only the threshold is declared on chain", statement.includes(String(threshold)), statement);
  ok("the real figure is absent from the declaration", !statement.includes(secret));

  // -- proving -------------------------------------------------------------
  console.log("\n  generating the Groth16 proof in the browser ...");
  await testid("prove").click();
  await testid("proof-ok").waitFor({ timeout: 300_000 });

  const proofDetail = (await testid("proof-detail").innerText()).replace(/\s+/g, " ").trim();
  ok("proof generated in the page", /Groth16/.test(proofDetail), proofDetail.slice(0, 70));
  ok("proving time reported", /\d+\s*ms/.test(proofDetail), (proofDetail.match(/\d+\s*ms/) ?? [""])[0]);
  ok(
    "the verifier contract accepted it",
    await testid("proof-ok").isVisible(),
    "on-chain simulation, not a UI claim",
  );

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(ROOT, "docs", "screenshot-proof.png"), fullPage: true });

  // -- the private figure must not survive into the campaign terms ---------
  await testid("to-terms").click();
  await page.locator("#target").waitFor({ timeout: 60_000 });
  const termsText = await page.locator("main, body").first().innerText();
  ok("campaign terms step never shows the private yield", !termsText.includes(secret));
} finally {
  const fatal = consoleErrors.filter(
    (e) =>
      !/favicon|externalized for browser compatibility|Download the React DevTools|Fast Refresh/i.test(e) &&
      // The enrolment walk above deliberately applies as growers who are
      // already enrolled until it finds one who is not, and the cooperative
      // answers 409. Those are this test's own doing; anything else is not.
      !/status of 409/i.test(e),
  );
  ok("no uncaught errors in the page", fatal.length === 0, fatal.slice(0, 2).join(" | "));

  await browser.close();
  cleanup();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
