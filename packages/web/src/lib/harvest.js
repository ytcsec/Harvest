/**
 * Everything the UI needs from the outside world: the cooperative, the
 * contracts and the anchor.
 *
 * Contract ids are injected at build time from `deployments.json` (see
 * vite.config.js) so the app cannot drift from what is actually deployed.
 */

import {
  SorobanClient,
  addressToScVal,
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

export const deployments = __DEPLOYMENTS__;
export const ISSUER_URL = import.meta.env.VITE_ISSUER_URL ?? "http://localhost:8787";

const soroban = new SorobanClient();
export const anchor = new AnchorClient();

export const explorerContract = (id) =>
  `https://stellar.expert/explorer/testnet/contract/${id}`;

// ------------------------------------------------------------- cooperative --

export async function fetchIssuer() {
  const res = await fetch(`${ISSUER_URL}/issuer`);
  if (!res.ok) throw new Error(`cooperative service unreachable (${res.status})`);
  return res.json();
}

export async function fetchMembers() {
  const res = await fetch(`${ISSUER_URL}/members`);
  if (!res.ok) throw new Error(`cooperative service unreachable (${res.status})`);
  return res.json();
}

export async function requestAttestation(membershipId, farmerCommitment) {
  const res = await fetch(`${ISSUER_URL}/attest`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ membershipId, farmerCommitment }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error ?? `attestation refused (${res.status})`);
  return body;
}

// ---------------------------------------------------------------- verifier --

/**
 * Ask the chain whether a proof holds, without spending a transaction.
 * Runs the real pairing check inside simulation, so a `false` here is the
 * contract's verdict and not the UI's opinion.
 */
export async function checkProofOnChain({ address, claim, proof, source }) {
  return soroban.read({
    contractId: deployments.verifier,
    method: "check_capacity",
    args: [addressToScVal(address), claimToScVal(claim), proofToScVal(proof)],
    source,
  });
}

// ---------------------------------------------------------------- campaigns --

export async function createCampaign({
  address,
  sign,
  claim,
  proof,
  crop,
  region,
  targetUsdc,
  days,
  returnPercent,
}) {
  const deadline = BigInt(Math.floor(Date.now() / 1000) + days * 86_400);
  return soroban.invoke({
    contractId: deployments.campaign,
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
    ],
    source: address,
    sign,
  });
}

export async function campaignCount(source) {
  const n = await soroban.read({
    contractId: deployments.campaign,
    method: "campaign_count",
    args: [],
    source,
  });
  return Number(n ?? 0);
}

const STATUS = ["Funding", "Funded", "Disbursed", "Repaid", "Refunding"];

/** `scValToNative` gives enum variants back as `["Funding", void 0]`-ish shapes. */
const readStatus = (raw) => {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw[0];
  return STATUS[Number(raw) ?? 0] ?? "Funding";
};

export async function getCampaign(id, source) {
  const c = await soroban.read({
    contractId: deployments.campaign,
    method: "get_campaign",
    args: [u32(id)],
    source,
  });
  if (!c) return null;
  return {
    id: Number(c.id),
    farmer: c.farmer,
    crop: c.crop,
    region: c.region,
    season: Number(c.season),
    thresholdKg: Number(c.threshold_kg),
    target: fromStroops(c.target),
    raised: fromStroops(c.raised),
    shares: fromStroops(c.shares),
    deadline: Number(c.deadline),
    returnPercent: Number(c.return_bps) / 100,
    status: readStatus(c.status),
    investorPool: fromStroops(c.investor_pool),
  };
}

export async function listCampaigns(source) {
  const count = await campaignCount(source);
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  // Simulations are independent; serialising them would make a ten-campaign
  // list take ten round trips.
  const all = await Promise.all(ids.map((id) => getCampaign(id, source).catch(() => null)));
  return all.filter(Boolean).reverse();
}

export async function fundCampaign({ address, sign, id, amountUsdc }) {
  return soroban.invoke({
    contractId: deployments.campaign,
    method: "fund",
    args: [addressToScVal(address), u32(id), i128(toStroops(amountUsdc))],
    source: address,
    sign,
  });
}

export async function disburse({ address, sign, id }) {
  return soroban.invoke({
    contractId: deployments.campaign,
    method: "disburse",
    args: [u32(id)],
    source: address,
    sign,
  });
}

// ------------------------------------------------------------------ anchor --

export async function anchorDeposit({ address, challengeSigner, amountTry, onStatus }) {
  if (!anchor.authenticated) {
    onStatus?.("authenticating");
    await anchor.authenticate(address, challengeSigner);
  }

  onStatus?.("requesting");
  const deposit = await anchor.startDeposit({ account: address, amount: amountTry });

  onStatus?.("wiring");
  await anchor.simulateBankTransfer(deposit.id, amountTry);

  onStatus?.("settling");
  const settled = await anchor.waitForCompletion(deposit.id, {
    onUpdate: (tx) => onStatus?.(tx.status),
  });

  return { deposit, settled };
}

export async function anchorQuote(amountTry) {
  return anchor.quote({
    buyAsset: "stellar:USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
    sellAmount: amountTry,
  });
}

export async function anchorWithdraw({ address, challengeSigner, amountUsdc }) {
  if (!anchor.authenticated) {
    await anchor.authenticate(address, challengeSigner);
  }
  return anchor.startWithdraw({ amount: amountUsdc });
}
