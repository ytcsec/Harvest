"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, CheckCircle2, ExternalLink, Loader2, ShieldCheck, User, XCircle } from "lucide-react";

import { useWallet } from "@/components/wallet/WalletProvider";
import { useCampaign } from "@/lib/chain/hooks";
import {
  amountDue,
  claim,
  closeUnfunded,
  disburse,
  fundCampaign,
  hasClaimed,
  investmentOf,
  repay,
} from "@/lib/chain/harvest";
import { deployments, explorerAccount } from "@/lib/chain/deployments";
import { type CampaignView } from "@/lib/campaigns";
import { useLocale } from "@/i18n/LocaleProvider";
import { useCampaignText } from "@/i18n/campaign";

type Tab = "zk" | "anchor" | "terms";

interface Position {
  invested: number;
  claimed: boolean;
  /** Only read for the farmer of a disbursed campaign. */
  due: number | null;
}

interface TxResult {
  hash: string;
  explorer: string;
}

type Action = (args: { address: string; sign: unknown; invoke: unknown; id: number }) => Promise<TxResult>;

function Summary({ campaign }: { campaign: CampaignView }) {
  const { t, money } = useLocale();
  const ct = useCampaignText();
  return (
    <p className="text-harvest-text leading-8 text-lg">
      {t("detail.summary", {
        region: ct.region(campaign),
        season: campaign.season,
        crop: ct.crop(campaign),
        target: money(campaign.target),
        threshold: ct.threshold(campaign),
        deadline: ct.deadline(campaign),
        rate: campaign.returnPercent,
      })}
    </p>
  );
}

export default function CampaignDetailPage() {
  const params = useParams();
  const id = Number(params?.id);

  const { campaign, loading, error, refresh } = useCampaign(id);
  const { wallet, balances, openWallet, openAnchor, notify, refreshBalances } = useWallet();
  const { t, tList, money, percent } = useLocale();
  const ct = useCampaignText();

  const [activeTab, setActiveTab] = useState<Tab>("zk");
  const [position, setPosition] = useState<Position | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastTx, setLastTx] = useState<{ label: string; explorer: string } | null>(null);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [pledgeAmount, setPledgeAmount] = useState("10");

  const isFarmer = Boolean(wallet && campaign && wallet.address === campaign.farmer);

  const loadPosition = useCallback(async () => {
    if (!wallet || !campaign) {
      setPosition(null);
      return;
    }
    try {
      const [invested, claimed, due] = await Promise.all([
        investmentOf(campaign.id, wallet.address),
        hasClaimed(campaign.id, wallet.address),
        isFarmer && campaign.status === "Disbursed" ? amountDue(campaign.id) : Promise.resolve(null),
      ]);
      setPosition({ invested, claimed, due });
    } catch {
      setPosition(null);
    }
  }, [wallet, campaign, isFarmer]);

  useEffect(() => {
    loadPosition();
  }, [loadPosition]);

  const run = async (label: string, action: Action, success: string) => {
    if (!wallet || !campaign) return;
    setBusy(label);
    try {
      const res = await action({ address: wallet.address, sign: wallet.sign, invoke: wallet.invoke, id: campaign.id });
      setLastTx({ label, explorer: res.explorer });
      notify(success);
      await Promise.all([refresh(), refreshBalances()]);
    } catch (err) {
      notify(t("detail.toasts.failed", { label, error: err instanceof Error ? err.message : String(err) }), "error");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-harvest-cream py-24 flex items-center justify-center gap-3 text-stone-500">
        <Loader2 className="w-5 h-5 animate-spin" />
        <span>{t("detail.loading")}</span>
      </div>
    );
  }

  if (error || !campaign) {
    return (
      <div className="min-h-screen bg-harvest-cream py-24">
        <div className="max-w-lg mx-auto px-4 text-center">
          <h1 className="font-display text-2xl font-normal text-stone-900 mb-2">
            {error ? t("detail.readError") : t("detail.notFound")}
          </h1>
          <p className="text-sm text-stone-600 mb-6 break-words">
            {error ?? t("detail.notFoundBody", { id: String(params?.id) })}
          </p>
          <Link
            href="/explore"
            className="inline-flex items-center gap-2 h-11 px-6 bg-amber-600 hover:bg-amber-700 text-white rounded-full text-sm font-semibold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>{t("detail.allCampaigns")}</span>
          </Link>
        </div>
      </div>
    );
  }

  const title = ct.title(campaign);
  const statusText = ct.status(campaign);
  const remaining = Math.max(0, campaign.target - campaign.raised);
  const amount = Number(pledgeAmount) || 0;
  const insufficient = balances.usdc === null || balances.usdc < amount;
  const deadlinePassed = campaign.status === "Funding" && !campaign.isOpen;
  const canClaim =
    (campaign.status === "Repaid" || campaign.status === "Refunding") &&
    (position?.invested ?? 0) > 0 &&
    !position?.claimed;
  const A = {
    fund: t("detail.actions.fund"),
    close: t("detail.actions.close"),
    disburse: t("detail.actions.disburse"),
    repay: t("detail.actions.repay"),
    claim: t("detail.actions.claim"),
  };

  const handleSupport = async (e: React.FormEvent) => {
    e.preventDefault();
    await run(
      A.fund,
      (args) => fundCampaign({ ...args, amountUsdc: amount }),
      t("detail.toasts.funded", { amount: money(amount) }),
    );
    setIsModalOpen(false);
  };

  const primaryButton =
    "w-full h-12 bg-amber-600 hover:bg-amber-700 text-white rounded-full font-bold text-base shadow-md hover:shadow-lg transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2";
  const note = "text-sm text-stone-600 bg-stone-50 border border-stone-100 rounded-2xl p-4";

  // A fresh testnet account has no XLM or no USDC trustline yet. Every action
  // here moves USDC to or from the account, so it has to be set up first --
  // otherwise the token contract refuses with a bare "Error(Contract, #13)".
  const needsSetup = Boolean(wallet && balances.known && (!balances.exists || balances.usdc === null));

  const renderAction = () => {
    if (needsSetup) {
      return (
        <div className="space-y-3">
          <p className={note}>{t("detail.setupNote")}</p>
          <button type="button" onClick={openWallet} className={primaryButton}>
            {t("detail.setupButton")}
          </button>
        </div>
      );
    }
    if (campaign.isOpen) {
      return (
        <button type="button" onClick={() => (wallet ? setIsModalOpen(true) : openWallet())} className={primaryButton}>
          {t("detail.support")}
        </button>
      );
    }
    if (!wallet) {
      return (
        <button type="button" onClick={openWallet} className={primaryButton}>
          {t("detail.loginToAct")}
        </button>
      );
    }
    if (deadlinePassed) {
      return (
        <div className="space-y-3">
          <p className={note}>{t("detail.deadlineNote")}</p>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() => run(A.close, closeUnfunded, t("detail.toasts.closed"))}
            className={primaryButton}
          >
            {busy === A.close && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>{t("detail.closeButton")}</span>
          </button>
        </div>
      );
    }
    if (campaign.status === "Funded") {
      return isFarmer ? (
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => run(A.disburse, disburse, t("detail.toasts.disbursed", { amount: money(campaign.raised) }))}
          className={primaryButton}
        >
          {busy === A.disburse && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{t("detail.disburseButton", { amount: money(campaign.raised) })}</span>
        </button>
      ) : (
        <p className={note}>{t("detail.fundedNote")}</p>
      );
    }
    if (campaign.status === "Disbursed") {
      if (!isFarmer) return <p className={note}>{t("detail.disbursedNote")}</p>;
      const due = position?.due ?? null;
      const short = due !== null && (balances.usdc ?? 0) < due;
      return (
        <div className="space-y-3">
          {short && (
            <div className="text-xs text-rose-800 bg-rose-50 border border-rose-100 rounded-xl p-3 flex items-center justify-between gap-3">
              <span>{t("detail.repayShort", { due: money(due ?? 0), balance: money(balances.usdc ?? 0) })}</span>
              <button
                type="button"
                onClick={() => openAnchor("deposit")}
                className="shrink-0 px-3 py-1.5 rounded-full bg-amber-600 text-white font-semibold"
              >
                {t("detail.topUp")}
              </button>
            </div>
          )}
          <button
            type="button"
            disabled={Boolean(busy) || due === null || short}
            onClick={() => run(A.repay, repay, t("detail.toasts.repaid"))}
            className={primaryButton}
          >
            {busy === A.repay && <Loader2 className="w-4 h-4 animate-spin" />}
            <span>
              {t("detail.repayButton")} {due !== null ? `(${money(due)})` : ""}
            </span>
          </button>
          <button
            type="button"
            onClick={() => openAnchor("withdraw")}
            className="w-full h-11 border border-stone-200 text-stone-800 hover:bg-stone-50 rounded-full text-sm font-semibold"
          >
            {t("detail.withdrawIban")}
          </button>
        </div>
      );
    }
    if (canClaim) {
      return (
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => run(A.claim, claim, t("detail.toasts.claimed"))}
          className={primaryButton}
        >
          {busy === A.claim && <Loader2 className="w-4 h-4 animate-spin" />}
          <span>{t("detail.claimButton")}</span>
        </button>
      );
    }
    return (
      <p className={note}>
        {position?.claimed
          ? t("detail.claimedNote")
          : campaign.status === "Repaid"
            ? t("detail.repaidNote")
            : t("detail.refundingNote")}
      </p>
    );
  };

  const tabButton = (tab: Tab, label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(tab)}
      role="tab"
      aria-selected={activeTab === tab}
      className={`-mb-px pb-3 text-sm font-medium border-b-2 transition-colors ${
        activeTab === tab ? "border-harvest-earth text-harvest-earth" : "border-transparent text-harvest-muted hover:text-harvest-earth"
      }`}
    >
      {label}
    </button>
  );

  const verified = tList("detail.verified").map((line) =>
    line.split("{threshold}").join(ct.threshold(campaign)).split("{season}").join(String(campaign.season)),
  );

  return (
    <div className="min-h-screen pb-24 lg:pb-0">
      <div className="max-w-7xl mx-auto px-5 md:px-8 pt-10 md:pt-14 pb-20">
        <Link
          href="/explore"
          className="inline-flex items-center gap-2 text-sm text-harvest-text hover:text-harvest-earth mb-10 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>{t("detail.back")}</span>
        </Link>

        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-10 lg:gap-14 items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 eyebrow mb-4">
              <span>{ct.region(campaign)}</span>
              <span className="text-harvest-muted">/</span>
              <span>
                {campaign.productIcon} {ct.product(campaign)}
              </span>
              <span className="text-harvest-muted">/</span>
              <span>{ct.season(campaign)}</span>
              <span className="ml-2 px-2.5 py-0.5 rounded-full border border-harvest-border bg-harvest-paper text-xs text-harvest-earth">
                #{campaign.id} · {statusText}
              </span>
            </div>
            <h1 className="font-display font-normal text-4xl md:text-6xl leading-[1.02] text-harvest-earth mb-5">{title}</h1>
            <div className="flex flex-wrap items-center gap-2 text-harvest-text">
              <User className="w-4 h-4 text-harvest-muted" />
              <span>{t("common.anonymousProducer")}</span>
              <a
                href={explorerAccount(campaign.farmer)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-harvest-field hover:text-harvest-earth inline-flex items-center gap-1"
              >
                {campaign.farmerShort}
                <ExternalLink className="w-3 h-3" />
              </a>
              {isFarmer && (
                <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold">
                  {t("common.yourCampaign")}
                </span>
              )}
            </div>

            <div className="relative mt-8 aspect-[16/10] w-full rounded-2xl overflow-hidden bg-harvest-earth">
              <img src={campaign.cover} alt={title} className="absolute inset-0 w-full h-full object-cover" />
              <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-harvest-paper/92 px-3 py-1.5 text-xs font-semibold text-harvest-earth">
                <CheckCircle2 className="h-3.5 w-3.5 text-harvest-success" />
                {t("home.campaigns.verified")}
              </span>
            </div>

            <div className="mt-8 max-w-2xl">
              <Summary campaign={campaign} />
            </div>

            <div className="mt-12">
              <div className="flex flex-wrap gap-6 border-b border-harvest-border mb-8" role="tablist">
                {tabButton("zk", t("detail.tabZk"))}
                {tabButton("anchor", t("detail.tabAnchor"))}
                {tabButton("terms", t("detail.tabTerms"))}
              </div>
              {activeTab === "zk" && (
                <div className="space-y-6">
                  <div>
                    <h3 className="font-bold text-stone-900 text-base mb-2">{t("detail.zkQuestion")}</h3>
                    <p className="text-sm text-stone-600 leading-relaxed">{t("detail.zkBody")}</p>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-4">
                    <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4">
                      <div className="text-xs font-bold text-emerald-900 mb-3">{t("detail.verifiedTitle")}</div>
                      <ul className="space-y-2.5 text-xs text-emerald-900">
                        {verified.map((line) => (
                          <li key={line} className="flex items-start gap-2">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div className="bg-rose-50/60 border border-rose-100 rounded-2xl p-4">
                      <div className="text-xs font-bold text-rose-900 mb-3">{t("detail.hiddenTitle")}</div>
                      <ul className="space-y-2.5 text-xs text-rose-900">
                        {tList("detail.hidden").map((line) => (
                          <li key={line} className="flex items-start gap-2">
                            <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>

                  <div className="bg-stone-900 rounded-2xl p-4 font-mono text-xs text-emerald-300 overflow-x-auto">
                    <div className="text-stone-500 mb-1">{"// harvest_capacity.circom · Groth16 / BN254"}</div>
                    <pre className="whitespace-pre-wrap">
{`private:  yield_kg, parcel_id, farmer_secret, coop_signature
public:   threshold_kg = ${campaign.thresholdKg}, season = ${campaign.season}
          nullifier = 0x${campaign.nullifier.slice(0, 16)}…
assert:   coop EdDSA signature over the record ✓
assert:   yield_kg >= threshold_kg ✓`}
                    </pre>
                  </div>
                </div>
              )}

              {activeTab === "anchor" && (
                <div className="space-y-4 text-sm text-stone-700 leading-relaxed">
                  <h3 className="font-bold text-stone-900 text-base">{t("detail.anchorTitle")}</h3>
                  <p>{t("detail.anchorBody")}</p>
                  <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200">
                    <div className="font-semibold text-stone-900 mb-1">
                      {t("detail.anchorChannel", { domain: deployments.anchor?.replace("https://", "") ?? "" })}
                    </div>
                    <div className="text-xs text-stone-500">{t("detail.anchorSandbox")}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAnchor("deposit")}
                    className="h-10 px-5 rounded-full bg-stone-900 hover:bg-stone-800 text-white text-sm font-semibold"
                  >
                    {t("detail.topUp")}
                  </button>
                </div>
              )}

              {activeTab === "terms" && (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  {[
                    [t("detail.termReturn"), percent(campaign.returnPercent), "text-amber-700"],
                    [t("detail.termDeadline"), ct.deadline(campaign), "text-stone-900"],
                    [t("detail.termStatus"), statusText, "text-emerald-700"],
                    [t("detail.termShares"), campaign.shares.toFixed(4), "text-stone-900"],
                  ].map(([label, value, color]) => (
                    <div key={label} className="bg-stone-50 p-4 rounded-2xl border border-stone-100">
                      <div className="text-xs text-stone-500 mb-1">{label}</div>
                      <div className={`text-lg md:text-xl font-bold ${color}`}>{value}</div>
                    </div>
                  ))}
                  {campaign.investorPool > 0 && (
                    <div className="col-span-2 bg-stone-50 p-4 rounded-2xl border border-stone-100">
                      <div className="text-xs text-stone-500 mb-1">{t("detail.investorPool")}</div>
                      <div className="text-lg font-bold text-stone-900">{money(campaign.investorPool, 4)}</div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <aside id="fund-panel" className="lg:sticky lg:top-24 rounded-2xl bg-[#E8E8DA] p-6 md:p-8 scroll-mt-24">
            <div className="text-sm text-harvest-text mb-4">{t("detail.panelEyebrow")}</div>
            <div className="font-display text-5xl text-harvest-earth leading-none">{money(campaign.raised)}</div>
            <div className="mt-2 text-xs text-harvest-muted">{t("detail.target", { amount: money(campaign.target) })}</div>

            <div className="mt-6 h-[3px] w-full overflow-hidden rounded-full bg-harvest-cream">
              <div className="h-full rounded-full bg-harvest-field transition-all duration-500" style={{ width: `${campaign.percent}%` }} />
            </div>

            <dl className="mt-6 text-sm">
              {[
                [t("detail.rowProgress"), `${campaign.percent}%`],
                [t("detail.rowTime"), campaign.isOpen ? ct.daysLeft(campaign) : statusText],
                [t("detail.harvestReturn"), percent(campaign.returnPercent)],
                [t("detail.zkThreshold"), ct.threshold(campaign)],
                ...(wallet ? [[t("detail.yourContribution"), money(position?.invested ?? 0)]] : []),
                [t("detail.rowPrivate"), t("detail.rowPrivateValue")],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between gap-4 border-t border-harvest-cream py-3">
                  <dt className="text-harvest-text">{label}</dt>
                  <dd className="font-semibold text-harvest-earth text-right">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-6">{renderAction()}</div>

            {lastTx && (
              <a
                href={lastTx.explorer}
                target="_blank"
                rel="noreferrer"
                className="mt-4 flex items-center justify-center gap-1 text-xs font-semibold text-harvest-field hover:text-harvest-earth"
              >
                <span>{t("detail.lastTx", { label: lastTx.label })}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            )}

            <div className="mt-5 flex items-start gap-2 text-xs text-harvest-muted">
              <ShieldCheck className="w-4 h-4 text-harvest-success shrink-0" />
              <span>{t("detail.onchainNote")}</span>
            </div>
          </aside>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-harvest-border bg-harvest-paper/95 backdrop-blur px-5 py-3 flex items-center justify-between gap-4 lg:hidden">
        <span className="text-sm text-harvest-muted">
          <b className="text-harvest-earth">{money(campaign.raised)}</b>
          <br />
          {t("detail.target", { amount: money(campaign.target) })}
        </span>
        <a href="#fund-panel" className="harvest-button-dark h-11 px-5">
          {t("detail.mobileCta")}
        </a>
      </div>

      {isModalOpen && wallet && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={busy ? undefined : () => setIsModalOpen(false)}
        >
          <div
            className="bg-white rounded-3xl max-w-md w-full p-6 md:p-8 relative shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            <form onSubmit={handleSupport} className="space-y-5">
              <h3 className="text-xl font-bold text-stone-900">{t("detail.modal.title")}</h3>
              <p className="text-sm text-stone-600">{t("detail.modal.body")}</p>

              <div>
                <label htmlFor="pledge" className="text-xs font-semibold text-stone-700 block mb-1.5">
                  {t("detail.modal.amount")}
                </label>
                <input
                  id="pledge"
                  type="number"
                  value={pledgeAmount}
                  onChange={(e) => setPledgeAmount(e.target.value)}
                  min={0.0000001}
                  max={remaining}
                  step="any"
                  className="w-full h-12 px-4 rounded-xl border border-stone-200 focus:border-amber-500 focus:outline-none font-bold text-stone-900 text-lg"
                  required
                />
                <div className="flex justify-between text-xs text-stone-500 mt-1">
                  <span>
                    {t("detail.modal.balance", { amount: balances.usdc === null ? "—" : money(balances.usdc, 4) })}
                  </span>
                  <span>{t("detail.modal.remaining", { amount: money(remaining) })}</span>
                </div>
              </div>

              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100 text-xs text-stone-600 space-y-1.5">
                <div className="flex justify-between">
                  <span>{t("detail.modal.expectedReturn")}</span>
                  <span className="font-bold text-amber-700">{percent(campaign.returnPercent)}</span>
                </div>
                <div className="flex justify-between gap-3">
                  <span>{t("detail.modal.expectedBack")}</span>
                  <span className="font-semibold text-stone-800 text-right">
                    {t("detail.modal.expectedBackValue", {
                      amount: money(amount * (1 + campaign.returnPercent / 100), 4),
                    })}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{t("detail.modal.deadline")}</span>
                  <span className="font-semibold text-stone-800">{ct.deadline(campaign)}</span>
                </div>
              </div>

              {insufficient && (
                <div className="text-xs text-amber-900 bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-center justify-between gap-3">
                  <span>{t("detail.modal.insufficient")}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsModalOpen(false);
                      openAnchor("deposit");
                    }}
                    className="shrink-0 px-3 py-1.5 rounded-full bg-amber-600 text-white font-semibold"
                  >
                    {t("detail.topUp")}
                  </button>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={Boolean(busy)}
                  className="flex-1 h-11 border border-stone-200 rounded-full font-semibold text-sm text-stone-700 hover:bg-stone-50"
                >
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={Boolean(busy) || insufficient || amount <= 0 || amount > remaining}
                  className="flex-1 h-11 bg-amber-600 hover:bg-amber-700 text-white rounded-full font-semibold text-sm transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  {busy === A.fund && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{busy === A.fund ? t("detail.modal.submitting") : t("detail.modal.submit")}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
