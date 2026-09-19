import { chromium } from "playwright";

const WEB = "http://localhost:3000";
let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log(`  PASS  ${n}${x ? "  " + x : ""}`)) : (fail++, console.log(`  FAIL  ${n}${x ? "  " + x : ""}`)); };

const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1400, height: 1100 } });
p.setDefaultTimeout(180000);
const errs = [];
p.on("console", m => m.type() === "error" && errs.push(m.text()));
p.on("pageerror", e => errs.push("PAGEERROR: " + String(e)));
const id = (s) => p.locator(`[data-testid="${s}"]`);

/**
 * A grower the cooperative has never met, fresh every run.
 *
 * Enrolling as one of the seed growers would make the run depend on whether a
 * previous one had already claimed them. A new ÇKS number is always free, and
 * it exercises the path a real first-time applicant takes.
 */
const freshCks = () => `CKS-2026-${String(Math.floor(Math.random() * 1e6)).padStart(6, "0")}`;
const DEED = "Ordu/Altinordu ada 91 parsel 4";


try {
  await p.goto(`${WEB}/kayit`, { waitUntil: "domcontentloaded" });
  await id("enrol-fullname").waitFor();
  ok("enrolment page loads", true);

  console.log("\n  creating a demo wallet ...");
  await id("wallet-button").first().click();
  await id("wallet-modal").waitFor();
  await id("wallet-create-demo").click();
  await id("wallet-address").waitFor({ timeout: 180000 });
  const addr = (await id("wallet-address").innerText()).trim();
  ok("demo wallet created", /^G[A-Z2-7]{55}$/.test(addr), addr.slice(0, 8) + "…");
  await id("wallet-close").click();
  await id("wallet-modal").waitFor({ state: "hidden" });

  // step 1 -- nothing but who you are. There is deliberately no membership to
  // pick: an applicant has no membership number until enrolment gives them one.
  ok("the form asks for no membership number", (await p.locator("#membership").count()) === 0);
  await id("enrol-fullname").fill("Yeni Uye");
  await id("enrol-nationalid").fill("99988877766");
  await id("enrol-to-documents").click();

  // step 2 -- a malformed ÇKS number first. This is a registry number, so the
  // shape is checked before anything is looked up.
  await id("doc-cks").waitFor();
  await id("doc-cks").fill("not-a-cks-number");
  await id("doc-deed").fill(DEED);
  await id("enrol-submit").click();
  await id("enrol-error").waitFor({ timeout: 60000 });
  ok("a malformed ÇKS number is refused", (await id("enrol-error").innerText()).length > 0,
     (await id("enrol-error").innerText()).slice(0, 60));

  // Now a well-formed one the cooperative has never seen: it opens a membership
  // rather than turning the grower away.
  const cks = freshCks();
  await id("doc-cks").fill(cks);
  await id("doc-tarsim").fill("TRS-2026-40188");
  await id("enrol-crop").selectOption("findik");
  await id("enrol-submit").click();
  await id("enrol-error").waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
  await id("enrol-review").waitFor({ timeout: 120000 });
  ok("the application is approved", true, cks);

  const granted = (await id("enrol-membership-granted").innerText()).replace(/\s+/g, " ");
  ok("a membership number is handed back", /GFK-\d{4}-\d{4}/.test(granted), granted.slice(0, 70));

  const stays = (await id("enrol-stays").innerText()).replace(/\s+/g, " ");
  ok("the land area is shown as staying on the device", /dekar|decare/i.test(stays), stays.slice(0, 80));
  const published = (await id("enrol-published").innerText()).replace(/\s+/g, " ");
  ok("the published mask is shown", /docMask = 15/.test(published), published.slice(0, 70));
  ok("the land area is not in the published panel", !/dekar|decare/i.test(published));

  console.log("\n  generating the enrolment proof ...");
  await id("enrol-prove").click();
  await id("enrol-proof-ok").waitFor({ timeout: 300000 });
  const detail = (await id("enrol-proof-detail").innerText()).replace(/\s+/g, " ");
  ok("proof generated and the verifier accepted it", /Groth16/.test(detail), detail.slice(0, 70));

  console.log("\n  registering on chain ...");
  await id("enrol-register").click();
  await id("enrol-done").waitFor({ timeout: 300000 });
  ok("the enrolment is recorded on chain", true, (await id("enrol-done").innerText()).split("\n")[1]?.slice(0, 60));

  await p.screenshot({ path: "docs/screenshot-enrolment.png", fullPage: true });
} catch (e) {
  fail++; console.log("  ERROR ", String(e).split("\n")[0].slice(0, 200));
} finally {
  const fatal = errs.filter(e => !/favicon|externalized for browser|React DevTools|Fast Refresh|Failed to load resource/i.test(e));
  ok("no uncaught errors in the page", fatal.length === 0, fatal.slice(0, 2).join(" | ").slice(0, 160));
  await b.close();
}
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
