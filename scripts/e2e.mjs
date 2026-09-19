/**
 * End-to-end browser test.
 *
 *   node scripts/e2e.mjs            # headless
 *   node scripts/e2e.mjs --headed   # watch it happen
 *
 * Drives the real app against the real cooperative service and the real
 * testnet contracts. No mocks: the marketplace and the vault banner are read
 * back from the deployed contracts, the wallet is funded by friendbot, and the
 * proof is built by snarkjs in the page against the 9,981-constraint circuit.
 *
 * The on-chain accept / reject / replay verdicts are asserted by
 * `scripts/prove-on-testnet.mjs`, which also checks that the submitted payload
 * never contains the private yield. This file covers the browser path: that a
 * person can actually get from "nothing" to "a real Groth16 proof" through the
 * UI, and that the private figure only ever appears in the panel labelled as
 * staying on the device.
 */

import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const HEADED = process.argv.includes("--headed");
const WEB = "http://localhost:5173";

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
 * Polling the port rather than grepping stdout: vite colourises and chunks its
 * banner, so a regex over the stream is a race that usually loses.
 */
async function start(name, cmd, args, { cwd = ROOT, url, timeoutMs = 120_000 }) {
  const child = spawn(cmd, args, { cwd, shell: true, env: process.env });
  children.push(child);

  let exited = null;
  child.on("exit", (code) => { exited = code; });
  const log = [];
  const capture = (b) => log.push(b.toString());
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited !== null) {
      throw new Error(`${name} exited early (${exited})
${log.join("").slice(-800)}`);
    }
    if (await alreadyUp(url)) return child;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error(`${name} never answered on ${url}
${log.join("").slice(-800)}`);
}

const cleanup = () => children.forEach((c) => { try { c.kill(); } catch {} });
process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(1); });

console.log("\nHarvest end-to-end\n");

if (await alreadyUp("http://localhost:8787/issuer")) {
  console.log("  cooperative service already running, reusing it");
} else {
  console.log("  starting the cooperative service ...");
  await start("issuer", "node", ["packages/issuer/server.mjs"], {
    url: "http://localhost:8787/issuer",
  });
}

if (await alreadyUp(WEB)) {
  console.log("  web app already running, reusing it");
} else {
  console.log("  starting the web app ...");
  // cwd matters: vite resolves index.html relative to its root, and the repo
  // root has none.
  await start("vite", "npx", ["vite", "--port", "5173", "--strictPort"], {
    cwd: join(ROOT, "packages", "web"),
    url: WEB,
  });
}

const browser = await chromium.launch({ headless: !HEADED });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

try {
  await page.goto(WEB, { waitUntil: "networkidle" });

  // -- shell ---------------------------------------------------------------
  ok("app loads", (await page.locator("header span:has-text('HARVEST')").first().isVisible()));
  ok(
    "investor portal is the landing view",
    (await page.locator("h1:has-text('Doğrulanmış Tarım Hasatlarına')").isVisible()),
  );

  // -- live chain reads, before any wallet exists --------------------------
  console.log("\n  reading the vault and the campaign list from chain ...");
  await page.waitForFunction(
    () => !document.body.innerText.includes("Kasadaki Toplam Değer\n—"),
    null,
    { timeout: 60_000 },
  ).catch(() => {});
  const vaultBlock = await page.locator("div:has-text('Kasadaki Toplam Değer')").last().innerText();
  ok("vault banner shows live figures", /USDC/.test(vaultBlock), vaultBlock.replace(/\s+/g, " ").trim().slice(0, 60));

  const opportunities = await page.locator("text=/Toplam .* hasat fırsatı/").innerText();
  ok("campaign list read from the contract", /Toplam\s+\d+\s+hasat/.test(opportunities), opportunities.trim());

  // -- wallet --------------------------------------------------------------
  console.log("\n  creating a funded wallet (friendbot + USDC trustline) ...");
  await page.click("header button:has-text('Cüzdan Oluştur')");
  await page.click("div[class*='fixed'] button:has-text('Cüzdan Oluştur')");
  await page.waitForSelector("text=Cüzdan Bağlandı", { timeout: 120_000 });
  const addr = await page.locator("p.font-mono").first().innerText();
  ok("wallet created and funded", /^G[A-Z0-9]{55}$/.test(addr.trim()), `${addr.trim().slice(0, 8)}…`);
  await page.click("div[class*='fixed'] button[class*='hover:bg-emerald-950']");

  // -- farmer flow ---------------------------------------------------------
  await page.click("button:has-text('Çiftçi & ZK Başvuru')");
  ok("farmer flow opens", await page.locator("h2:has-text('Hasat Öncesi ZK Avans Başvurusu')").isVisible());

  console.log("\n  requesting the cooperative attestation ...");
  await page.click("button:has-text('Resmi İmzalı Sertifikayı Al')");
  await page.waitForSelector("text=GİZLİ TUTULAN VERİLER", { timeout: 60_000 });

  // Target the list row itself: :has-text() matches every ancestor too, so
  // .last() lands on the innermost node, which is rarely the one with the value.
  const secretRow = await page.locator("li:has-text('Gerçek Rekolte')").innerText();
  ok("cooperative signs the real yield", secretRow.includes("48.500"), secretRow.trim());

  const thresholdInput = page.locator("input[type='number']").first();
  const threshold = Number(await thresholdInput.inputValue());
  ok("threshold defaults below the real yield", threshold > 0 && threshold * 1000 < 48_500, `${threshold} ton`);

  // The declaration sentence itself, not the panel: :has-text() also matches
  // the panel's heading row, which carries the label but none of the numbers.
  const declaration = await page.locator("text=/Bu üreticinin hasat tahmini en az/").innerText();
  ok("only the threshold is declared on chain", declaration.includes(`${threshold} Ton`), declaration.trim());
  ok("the real figure is absent from the declaration", !declaration.includes("48.500"));

  // -- proving -------------------------------------------------------------
  console.log("\n  generating the Groth16 proof in the browser ...");
  await page.click("button:has-text('Tarayıcıda ZK Proof Üret')");
  await page.waitForSelector("text=ZK Proof Hazır", { timeout: 240_000 });

  const proofBadge = await page.locator(".badge-zk").first().innerText();
  ok("proof generated in the page", /Groth16/.test(proofBadge), proofBadge.replace(/\s+/g, " ").trim());
  ok("proving time reported", /\d+\s*ms/.test(proofBadge), (proofBadge.match(/\d+\s*ms/) ?? [""])[0]);

  ok(
    "campaign step never shows the private yield",
    !(await page.locator("main").innerText()).includes("48.500"),
  );

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(ROOT, "docs", "screenshot-proof.png"), fullPage: true });
} finally {
  const fatal = consoleErrors.filter(
    (e) => !/favicon|externalized for browser compatibility|Download the React DevTools/i.test(e),
  );
  ok("no uncaught errors in the page", fatal.length === 0, fatal.slice(0, 2).join(" | "));

  await browser.close();
  cleanup();
}

console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
