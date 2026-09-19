/**
 * Everything the UI needs from the outside world: the cooperative, the
 * contracts and the anchor.
 *
 * Ported from packages/web/src/lib/harvest.js, plus the rest of the campaign
 * lifecycle (disburse, repay, claim, close_unfunded) that the campaign detail
 * page drives.
 *
 * Reads are simulations, so they only need *an* existing account to run as.
 * They use the deployer, which lets the marketplace be browsed before anyone
 * has a wallet.
 */

import "./polyfills";
import { tl } from "../../i18n/runtime";
import {
  SorobanClient,
  addressToScVal,
  bytesN,
  claimToScVal,
  fromStroops,
  i128,
  proofToScVal,
  str,
  toStroops,
  u32,
  u64,
} from "@harvest/sdk/soroban";
import { AnchorClient } from "@harvest/sdk/anchor";

import { ISSUER_URL, deployments } from "./deployments";
import { payUsdcWithMemo } from "./wallet";

const soroban = new SorobanClient();
export const anchor = new AnchorClient();

const READ_SOURCE = deployments.deployer;

const read = (contractId, method, args = []) =>
  soroban.read({ contractId, method, args, source: READ_SOURCE });

// ------------------------------------------------------------- cooperative --

async function issuerJson(path, init) {
  let res;
  try {
    res = await fetch(`${ISSUER_URL}${path}`, init);
  } catch {
    throw new Error(
      tl(
        `Kooperatif servisine ulaşılamadı (${ISSUER_URL}). Depo kökünde "npm run issuer" çalışıyor mu?`,
        `Could not reach the cooperative service (${ISSUER_URL}). Is "npm run issuer" running at the repo root?`,
      ),
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? tl(`kooperatif servisi ${res.status} döndü`, `cooperative service returned ${res.status}`));
  return body;
}

export const fetchIssuer = () => issuerJson("/issuer");
export const fetchMembers = () => issuerJson("/members");

export const requestAttestation = (membershipId, farmerCommitment) =>
  issuerJson("/attest", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ membershipId, farmerCommitment }),
  });

// ---------------------------------------------------------------- verifier --

/**
 * Ask the chain whether a proof holds, without spending a transaction.
 * Runs the real pairing check inside simulation, so a `false` here is the
 * contract's verdict and not the UI's opinion.
 *
 * @param {{ address: string, claim: object, proof: unknown }} args
 * @returns {Promise<boolean>}
 */
export async function checkProofOnChain({ address, claim, proof }) {
  return read(deployments.verifier, "check_capacity", [
    addressToScVal(address),
    claimToScVal(claim),
    proofToScVal(proof),
  ]);
}

// ---------------------------------------------------------------- campaigns --

export async function createCampaign({
  address,
  sign,
  invoke,
  claim,
  proof,
  crop,
  region,
  targetUsdc,
  days,
  returnPercent,
  minPercent = 50,
}) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + days * 86_400);
  // The proof has already passed `checkProofOnChain`, so an error code here is
  // the campaign contract's rather than the verifier's.
  return invokeCampaign({
    address,
    sign,
    invoke,
    method: "create_campaign",
    args: [
      addressToScVal(address),
      claimToScVal(claim),
      proofToScVal(proof),
      str(crop),
      str(region),
      i128(toStroops(targetUsdc)),
      u64(deadline),
      u32(Math.round(returnPercent * 100)),
      u32(Math.round(minPercent * 100)),
    ],
  });
}

export async function campaignCount() {
  return Number((await read(deployments.campaign, "campaign_count")) ?? 0);
}

const STATUS = ["Funding", "Funded", "Disbursed", "Repaid", "Refunding"];

/** `scValToNative` gives enum variants back as `["Funding"]`-ish shapes. */
const readStatus = (raw) => {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0];
  return STATUS[Number(raw) ?? 0] ?? "Funding";
};

const toHex = (bytes) => (bytes ? Buffer.from(bytes).toString("hex") : "");

/** @returns {Promise<import("../campaigns").ChainCampaign | null>} */
export async function getCampaign(id) {
  const c = await read(deployments.campaign, "get_campaign", [u32(id)]);
  if (!c) return null;
  return {
    id: Number(c.id),
    farmer: c.farmer,
    crop: c.crop,
    region: c.region,
    season: Number(c.season),
    thresholdKg: Number(c.threshold_kg),
    nullifier: toHex(c.nullifier),
    target: fromStroops(c.target),
    raised: fromStroops(c.raised),
    shares: fromStroops(c.shares),
    deadline: Number(c.deadline),
    returnPercent: Number(c.return_bps) / 100,
    minPercent: Number(c.min_bps ?? 10_000) / 100,
    disbursed: fromStroops(c.disbursed ?? 0),
    status: readStatus(c.status),
    investorPool: fromStroops(c.investor_pool),
  };
}

/**
 * Newest first.
 * @returns {Promise<import("../campaigns").ChainCampaign[]>}
 */
export async function listCampaigns() {
  const count = await campaignCount();
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  // Simulations are independent; serialising them would make a ten-campaign
  // list take ten round trips.
  const all = await Promise.all(ids.map((id) => getCampaign(id).catch(() => null)));
  return /** @type {import("../campaigns").ChainCampaign[]} */ (all.filter(Boolean)).reverse();
}

export async function investmentOf(id, investor) {
  return fromStroops(
    (await read(deployments.campaign, "investment_of", [u32(id), addressToScVal(investor)])) ?? 0,
  );
}

export async function hasClaimed(id, investor) {
  return Boolean(
    await read(deployments.campaign, "has_claimed", [u32(id), addressToScVal(investor)]),
  );
}

/** Principal plus the agreed return: what `repay` will pull from the farmer. */
export async function amountDue(id) {
  return fromStroops((await read(deployments.campaign, "amount_due", [u32(id)])) ?? 0);
}

/**
 * `ContractCallError` explains codes with the verifier's table, whose numbers
 * overlap the campaign contract's. Campaign calls get their own wording.
 */
const CAMPAIGN_ERRORS = {
  3: ["kampanya bulunamadı", "campaign not found"],
  4: [
    "bu kooperatif kaydıyla bu sezon için zaten bir kampanya açılmış",
    "a campaign is already open for this cooperative record and season",
  ],
  5: ["geçersiz tutar", "invalid amount"],
  6: ["kampanya bu işlem için uygun durumda değil", "the campaign is not in a state that allows this"],
  7: ["fonlama süresi henüz dolmadı", "the funding window has not closed yet"],
  8: ["fonlama süresi doldu", "the funding window has closed"],
  9: ["bu tutar kampanyayı hedefinin üstüne çıkarır", "this amount would push the campaign past its target"],
  10: ["talep edilecek bir pay yok", "there is nothing to claim"],
  11: ["pay zaten talep edilmiş", "the share has already been claimed"],
  12: ["geçersiz kampanya parametreleri", "invalid campaign parameters"],
  14: ["toplanan tutar henüz asgari eşiğe ulaşmadı", "less than the campaign's minimum has been raised"],
  15: ["çekilecek yeni katkı yok", "there is nothing new to draw yet"],
};

/**
 * The USDC token contract's own errors surface through campaign calls too,
 * and their numbers overlap the campaign contract's: token #10 is "balance
 * too low", campaign #10 is "nothing to claim". Which one it is depends on
 * the call -- only `fund` and `repay` move the caller's USDC.
 */
const TOKEN_ERRORS = {
  10: [
    "USDC bakiyeniz bu işlem için yetersiz. Cüzdan penceresinden TL yükleyebilirsiniz.",
    "Your USDC balance is too low for this. You can top up from the wallet window.",
  ],
  13: [
    "Hesapta USDC hattı (trustline) yok. Cüzdan penceresinden \"Hesabı Hazırla\"yı kullanın.",
    "The account has no USDC trustline. Use \"Prepare account\" in the wallet window.",
  ],
};
const PAYS_FROM_CALLER = new Set(["fund", "repay"]);

async function explainCampaignErrors(method, call) {
  try {
    return await call();
  } catch (err) {
    const code = err?.code;
    const pair =
      (code === 10 && PAYS_FROM_CALLER.has(method) ? TOKEN_ERRORS[10] : null) ??
      (code === 13 ? TOKEN_ERRORS[13] : null) ??
      CAMPAIGN_ERRORS[code];
    if (pair) throw new Error(tl(...pair), { cause: err });
    throw err;
  }
}

/**
 * `invoke` is set for passkey wallets: a contract account cannot be a
 * transaction source, so the wallet signs the auth entry and a relayer submits.
 */
const invokeCampaign = ({ address, sign, invoke, method, args }) =>
  explainCampaignErrors(method, () =>
    invoke
      ? invoke({ contractId: deployments.campaign, method, args })
      : soroban.invoke({ contractId: deployments.campaign, method, args, source: address, sign }),
  );

export const fundCampaign = ({ address, sign, invoke, id, amountUsdc }) =>
  invokeCampaign({
    address,
    sign,
    invoke,
    method: "fund",
    args: [addressToScVal(address), u32(id), i128(toStroops(amountUsdc))],
  });

/** Farmer draws a fully funded advance. */
export const disburse = ({ address, sign, invoke, id }) =>
  invokeCampaign({ address, sign, invoke, method: "disburse", args: [u32(id)] });

/** Farmer repays principal + return after the harvest. */
export const repay = ({ address, sign, invoke, id }) =>
  invokeCampaign({ address, sign, invoke, method: "repay", args: [u32(id)] });

/** Investor takes their pro-rata share of a settled campaign. */
export const claim = ({ address, sign, invoke, id }) =>
  invokeCampaign({ address, sign, invoke, method: "claim", args: [addressToScVal(address), u32(id)] });

/** Anyone may close a campaign that missed its target after the deadline. */
export const closeUnfunded = ({ address, sign, invoke, id }) =>
  invokeCampaign({ address, sign, invoke, method: "close_unfunded", args: [u32(id)] });

// ------------------------------------------------------------------ anchor --

/**
 * One SEP-10 session per wallet, shared by quote, deposit and withdraw.
 *
 * Every SEP-38 call needs the JWT -- including the indicative price -- so the
 * modal authenticates as soon as it opens. Keyed by address because the
 * client is a module singleton and a forgotten wallet's token must not be
 * reused for the next one.
 */
let anchorSession = null;

export function ensureAnchorAuth(address, challengeSigner) {
  if (anchorSession?.address !== address) {
    anchor.jwt = null;
    const promise = anchor.authenticate(address, challengeSigner).catch((err) => {
      anchorSession = null;
      throw err;
    });
    anchorSession = { address, promise };
  }
  return anchorSession.promise;
}

export async function anchorDeposit({ address, challengeSigner, amountTry, onStatus, onInstructions }) {
  onStatus?.("authenticating");
  await ensureAnchorAuth(address, challengeSigner);

  onStatus?.("requesting");
  const deposit = await anchor.startDeposit({ account: address, amount: amountTry });
  if (deposit.instructions) onInstructions?.(deposit.instructions);

  onStatus?.("wiring");
  await anchor.simulateBankTransfer(deposit.id, amountTry);

  onStatus?.("settling");
  const settled = await anchor.waitForCompletion(deposit.id, {
    onUpdate: (tx) => onStatus?.(tx.status),
  });

  return { deposit, settled };
}

const USDC_SEP38 = "stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

/** SEP-38 price for a deposit: how much USDC `amountTry` lira buys. */
export async function anchorQuote({ address, challengeSigner, amountTry }) {
  await ensureAnchorAuth(address, challengeSigner);
  return anchor.quote({ buyAsset: USDC_SEP38, sellAmount: amountTry });
}

/** SEP-38 price for a withdrawal: how much lira `amountUsdc` pays out. */
export async function anchorWithdrawQuote({ address, challengeSigner, amountUsdc }) {
  await ensureAnchorAuth(address, challengeSigner);
  return anchor.quote({ sellAsset: USDC_SEP38, buyAsset: "iso4217:TRY", sellAmount: amountUsdc });
}

export const normalizeIban = (iban) => String(iban).replace(/\s+/g, "").toUpperCase();

/**
 * A Turkish IBAN: "TR", two check digits, 22 more digits (26 characters), and
 * a valid ISO 13616 mod-97 checksum. The anchor rejects a bad checksum, so it
 * is checked here before anything is sent -- in particular before the USDC.
 */
const mod97 = (digits) => {
  let remainder = 0;
  for (const d of digits) remainder = (remainder * 10 + Number(d)) % 97;
  return remainder;
};
const lettersToDigits = (s) => s.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));

export function isTurkishIban(iban) {
  const value = normalizeIban(iban);
  if (!/^TR\d{24}$/.test(value)) return false;
  return mod97(lettersToDigits(value.slice(4) + value.slice(0, 4))) === 1;
}

/**
 * A random but well-formed Turkish IBAN for demos: TR, check digits, the
 * bank's 5-digit code, a reserve 0, and 16 random account digits. The check
 * digits are computed, so the anchor accepts it; it belongs to nobody.
 *
 * @param {string} bankCode five digits, e.g. "00010" for Ziraat
 */
export function randomTurkishIban(bankCode) {
  let account = "";
  for (let i = 0; i < 16; i++) account += Math.floor(Math.random() * 10);
  const bban = `${bankCode}0${account}`;
  const check = String(98 - mod97(lettersToDigits(`${bban}TR00`))).padStart(2, "0");
  return `TR${check}${bban}`;
}

/** "TR330006..." -> "TR33 0006 ..." */
export const formatIban = (iban) => normalizeIban(iban).replace(/(.{4})/g, "$1 ").trim();

/**
 * The off-ramp, end to end: USDC out of the wallet, lira into an IBAN.
 *
 *   1  SEP-12: hand the anchor the payout IBAN. SEP-6 `/withdraw` has no bank
 *      field for `bank_account`, so without this step the sandbox pays out to
 *      an IBAN of its own and the one the user typed goes nowhere.
 *   2  SEP-6 `/withdraw`: the anchor answers with its treasury address and a
 *      memo that identifies this withdrawal.
 *   3  The wallet sends the USDC to that address with that memo -- a real
 *      testnet payment the user approves in their wallet.
 *   4  Poll SEP-6 `/transaction` until the anchor has matched the payment and
 *      paid the lira (simulated FAST in the sandbox).
 *
 * @param {object} args
 * @param {{address: string, sign: Function, signChallenge: Function}} args.wallet
 * @param {number} args.amountUsdc
 * @param {string} args.iban
 * @param {string} [args.bankName]
 * @param {(status: string) => void} [args.onStatus]
 * @param {(payment: {hash: string}) => void} [args.onPayment]
 */
export async function anchorWithdraw({ wallet, amountUsdc, iban, bankName, onStatus, onPayment }) {
  onStatus?.("authenticating");
  await ensureAnchorAuth(wallet.address, wallet.signChallenge);

  onStatus?.("kyc");
  await anchor.putCustomer({
    bank_account_number: normalizeIban(iban),
    ...(bankName ? { bank_name: bankName } : {}),
  });

  onStatus?.("requesting");
  const withdrawal = await anchor.startWithdraw({ amount: amountUsdc });
  if (!withdrawal.account_id || !withdrawal.memo) {
    throw new Error(tl("anchor çekim için bir hesap ve memo vermedi", "the anchor did not return an account and memo for the withdrawal"));
  }

  onStatus?.("paying");
  const hash = await payUsdcWithMemo(wallet, {
    destination: withdrawal.account_id,
    amount: amountUsdc,
    memo: withdrawal.memo,
    memoType: withdrawal.memo_type,
  });
  onPayment?.({ hash });

  onStatus?.("settling");
  const settled = await anchor.waitForCompletion(withdrawal.id, {
    onUpdate: (tx) => onStatus?.(tx.status),
  });

  return { withdrawal, paymentHash: hash, settled };
}

// ------------------------------------------------------------------- vault --

/**
 * Live figures from the DeFindex vault that holds every campaign's escrow.
 * Deliberately not an invented TVL or APY: what the vault reports is shown.
 *
 * `fetch_total_managed_funds` returns one entry per asset (USDC only here)
 * with what sits idle in the vault and what is deployed into strategies. On
 * testnet no strategy is attached -- Blend's testnet pools only list Blend's
 * own USDC -- so everything is idle and a share stays worth exactly 1 USDC.
 */
export async function vaultStats() {
  const [managed, supply, perShare] = await Promise.all([
    read(deployments.vault, "fetch_total_managed_funds"),
    read(deployments.vault, "total_supply"),
    // Underlying for one whole share (1e7 units); 1.0 means no yield yet.
    read(deployments.vault, "get_asset_amounts_per_shares", [i128(10_000_000n)]).catch(() => null),
  ]);

  const usdc = Array.isArray(managed) ? managed[0] : null;
  return {
    managedUsdc: fromStroops(usdc?.total_amount ?? 0),
    idleUsdc: fromStroops(usdc?.idle_amount ?? 0),
    investedUsdc: fromStroops(usdc?.invested_amount ?? 0),
    totalShares: fromStroops(supply ?? 0),
    pricePerShare: perShare?.[0] !== undefined ? fromStroops(perShare[0]) : 1,
  };
}

/** The anonymous repayment tier behind a nullifier, and what it prices at. */
export async function reputationOf(nullifierHex) {
  const [tier, rateBps] = await Promise.all([
    read(deployments.campaign, "reputation_of", [bytesN(nullifierHex)]),
    read(deployments.campaign, "quoted_rate_bps", [bytesN(nullifierHex)]),
  ]);
  return { tier: Number(tier ?? 0), ratePercent: Number(rateBps ?? 0) / 100 };
}
