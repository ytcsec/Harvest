/**
 * End-to-end browser test.
 *
 *   node scripts/e2e.mjs            # headless
 *   node scripts/e2e.mjs --headed   # watch it happen
 *
 * Drives the real app against the real cooperative service and the real
 * testnet contracts. No mocks: the wallet is funded by friendbot, the proof is
 * built by snarkjs in the page, and the verdicts come back from the deployed
 * verifier.
 *
 * The check that matters most is the last one. It asserts the browser refuses
 * to leak the private yield into the payload -- the claim the whole product
 * rests on, verified in the place a user would actually be harmed.
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
const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });

const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

try {
  await page.goto(WEB, { waitUntil: "networkidle" });
  ok("app loads", await page.locator(".brand h1").isVisible());

  // -- language -----------------------------------------------------------
  ok("defaults to Turkish", (await page.locator(".tabs button").first().textContent()) === "Çiftçi");
  await page.click('.langs button:has-text("EN")');
  ok("switches to English", (await page.locator(".tabs button").first().textContent()) === "Farmer");
  await page.click('.langs button:has-text("TR")');

  // -- wallet -------------------------------------------------------------
  console.log("\n  creating a funded wallet (friendbot + USDC trustline) ...");
  await page.click('button.btn:has-text("Cüzdan oluştur")');
  await page.waitForSelector(".chip.mono", { timeout: 90_000 });
  const walletChip = await page.locator(".chip.mono").textContent();
  ok("wallet created and funded", /USDC/.test(walletChip), walletChip.trim());

  // -- attestation --------------------------------------------------------
  console.log("\n  requesting the cooperative attestation ...");
  await page.click('button.btn:has-text("Belgeyi al")');
  await page.waitForSelector(".pane.private .big", { timeout: 30_000 });
  const attested = await page.locator(".pane.private .big").first().textContent();
  ok("cooperative signs the yield", attested.includes("48,5"), attested.trim());

  // -- threshold ----------------------------------------------------------
  const panes = page.locator(".pane");
  await page.waitForSelector(".pane.public .big", { timeout: 10_000 });
  const disclosed = await page.locator(".pane.public .big").textContent();
  const kept = await page.locator(".pane.private .big").nth(1).textContent();
  ok("threshold defaults below the real yield", disclosed.includes("38,8") || disclosed.includes("38"), disclosed.trim());
  ok("headroom stays private", kept.trim().length > 0, kept.trim());

  // -- proving ------------------------------------------------------------
  console.log("\n  generating the Groth16 proof in the browser ...");
  await page.click('button.btn:has-text("Kanıt üret")');
  await page.waitForSelector(".badge:has-text('Kanıt hazır')", { timeout: 180_000 });
  const timing = await page.locator(".chip:has-text('Üretim süresi')").textContent();
  ok("proof generated in the page", true, timing.trim());

  // -- the privacy claim, checked where it matters -------------------------
  await page.click("summary:has-text('Gönderilecek veriyi incele')");
  const payload = await page.locator("pre.payload").first().textContent();
  ok("payload excludes the real yield (48500)", !payload.includes("48500"));
  ok("payload carries only the threshold", payload.includes('"threshold_kg"'));

  // -- on-chain verification ----------------------------------------------
  console.log("\n  asking the deployed contract ...");
  await page.click('.tabs button:has-text("Kanıt")');
  await page.click('button:has-text("Geçerli kanıtı doğrula")');
  await page.waitForSelector(".verdict", { timeout: 90_000 });
  const first = await page.locator(".verdict").first().getAttribute("class");
  ok("live contract accepts the honest proof", first.includes("ok"));

  await page.click('button:has-text("Eşiği 90 tona şişir")');
  await page.waitForFunction(() => document.querySelectorAll(".verdict").length >= 2, null, {
    timeout: 90_000,
  });
  const second = await page.locator(".verdict").nth(1).getAttribute("class");
  ok("live contract rejects the inflated claim", second.includes("no"));

  await page.click('button:has-text("Başka bir hesaptan")');
  await page.waitForFunction(() => document.querySelectorAll(".verdict").length >= 3, null, {
    timeout: 90_000,
  });
  const third = await page.locator(".verdict").nth(2).getAttribute("class");
  ok("live contract rejects the replay", third.includes("no"));

  // -- investor view loads -------------------------------------------------
  await page.click('.tabs button:has-text("Yatırımcı")');
  ok("investor view renders", await page.locator("h2").first().isVisible());

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
