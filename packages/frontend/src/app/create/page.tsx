"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Building2,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import { useWallet } from "@/components/wallet/WalletProvider";
import {
  checkProofOnChain,
  createCampaign,
  fetchMyMembership,
  reputationOf,
  requestAttestation,
} from "@/lib/chain/harvest";
import { commitmentForIssuer, proveCapacity } from "@/lib/chain/prover";
import { useLocale } from "@/i18n/LocaleProvider";
import { useCampaignText } from "@/i18n/campaign";
import { ProofChallenge } from "@/components/campaign/ProofChallenge";

/**
 * The farmer flow, behind the original four-step wizard design:
 *
 *   1  the cooperative service signs an EdDSA attestation over
 *      Poseidon(farmerSecret); it never sees the secret itself.
 *   2  snarkjs builds a real Groth16 proof in this tab, and the verifier
 *      contract checks it in simulation before anything is spent.
 *   3  `create_campaign`, which the contract refuses unless the proof passes
 *      the BN254 pairing check on chain.
 *
 * The private figure is read from the signed attestation rather than typed: a
 * farmer who could type any number would be attesting to nothing.
 */

interface Member {
  membershipId: string;
  farmer: string;
  crop: string;
  cropLabel: { tr: string; en: string };
  region: { tr: string; en: string };
  season: number;
  expectedYieldKg: number;
}

interface Attested {
  issuer: { ax: string; ay: string };
  attestation: { expectedYieldKg: string; parcelId: string; cropCode: string; season: string };
  signature: { sigR8x: string; sigR8y: string; sigS: string };
  display: { parcel: string; cropLabel: { tr: string; en: string }; region: { tr: string; en: string } };
}

interface ProofResult {
  claim: { nullifier: string; threshold_kg: number; season: number };
  proof: { a: string; b: string; c: string };
  provingMs: number;
}



const inputClass =
  "w-full h-11 px-4 rounded-xl border border-stone-200 focus:border-amber-500 focus:outline-none text-sm text-stone-900";
const labelClass = "text-sm font-semibold text-stone-700 block mb-1.5";

export default function CreateCampaignPage() {
  const { wallet, ready, openWallet, notify } = useWallet();
  const { t, tList, locale, number, percent } = useLocale();
  const { tons } = useCampaignText();
  const STEPS = tList("create.steps");
  const kg = (n: number) => `${number(n, 0)} kg`;

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** The cooperative turned us away for want of an enrolment, not a fault. */
  const [notEnrolled, setNotEnrolled] = useState(false);
  /** The membership this browser enrolled for, if any. */
  const [myMembership, setMyMembership] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [membershipId, setMembershipId] = useState("");
  const [attested, setAttested] = useState<Attested | null>(null);
  const [zk, setZk] = useState<ProofResult | null>(null);
  const [reputation, setReputation] = useState<{ tier: number; ratePercent: number } | null>(null);
  const [created, setCreated] = useState<{ id: number; explorer: string } | null>(null);

  const [form, setForm] = useState({
    thresholdTons: "38",
    targetUsdc: "120",
    returnPercent: "15",
    days: "30",
    minPercent: "50",
    crop: "",
    region: "",
  });

  // This browser's own membership, and nothing else.
  //
  // There used to be a list here. The endpoint behind it published every
  // grower's expected yield without any authentication -- the figure the whole
  // proof system exists to keep from the market. A farmer only ever needs their
  // own record, so that is all that is fetched, and the cooperative only hands
  // it over to the commitment that enrolled for it.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mine: Member & { membershipId: string | null } = await fetchMyMembership(
          await commitmentForIssuer(),
        );
        if (cancelled) return;
        setMyMembership(mine.membershipId ?? null);
        setMembershipId(mine.membershipId ?? "");
        setMembers(mine.membershipId ? [mine as Member] : []);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const member = members.find((m) => m.membershipId === membershipId);
  const yieldKg = attested ? Number(attested.attestation.expectedYieldKg) : (member?.expectedYieldKg ?? 0);
  const thresholdKg = Math.round(Number(form.thresholdTons) * 1000);

  const fail = (err: unknown) => {
    setNotEnrolled((err as { code?: string })?.code === "NOT_ENROLLED");
    setError(err instanceof Error ? err.message : String(err));
  };

  // 1. Get the cooperative-signed attestation.
  //
  // The cooperative refuses unless this browser's commitment is the one that
  // enrolled for the membership, so a 403 here means "go and register", not
  // "something broke". Say that rather than surfacing the raw error.
  const handleAttest = async () => {
    setBusy(true);
    setError(null);
    try {
      const commitment = await commitmentForIssuer();
      const result: Attested = await requestAttestation(membershipId, commitment);
      const real = Number(result.attestation.expectedYieldKg);
      setAttested(result);
      setZk(null);
      setForm((f) => ({
        ...f,
        thresholdTons: String(Math.floor((real * 0.8) / 1000)),
        crop: result.display.cropLabel[locale],
        region: result.display.region[locale],
      }));
      setStep(2);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // 2. Prove locally, then let the verifier contract judge it in simulation.
  const handleProve = async () => {
    if (!wallet || !attested) return;
    setBusy(true);
    setError(null);
    setStage("witness");
    try {
      const result: ProofResult = await proveCapacity({
        issuer: attested.issuer,
        attestation: attested.attestation,
        signature: attested.signature,
        thresholdKg,
        address: wallet.address,
        onStage: setStage,
      });

      setStage("onchain");
      const accepted = await checkProofOnChain({
        address: wallet.address,
        claim: result.claim,
        proof: result.proof,
      });
      if (!accepted) throw new Error(t("create.verifierRejected"));

      setZk(result);
      reputationOf(result.claim.nullifier)
        .then((rep: { tier: number; ratePercent: number }) => {
          setReputation(rep);
          setForm((f) => ({ ...f, returnPercent: String(rep.ratePercent) }));
        })
        .catch(() => setReputation(null));
      notify(t("create.proofOkToast", { ms: result.provingMs }));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  // 3. Open the campaign on chain.
  const handlePublish = async () => {
    if (!wallet || !zk) return;
    setBusy(true);
    setError(null);
    try {
      const res = await createCampaign({
        address: wallet.address,
        sign: wallet.sign,
        invoke: wallet.invoke,
        claim: zk.claim,
        proof: zk.proof,
        crop: form.crop.trim(),
        region: form.region.trim(),
        targetUsdc: Number(form.targetUsdc),
        days: Number(form.days),
        returnPercent: Number(form.returnPercent),
        minPercent: Number(form.minPercent),
      });
      setCreated({ id: Number(res.value), explorer: res.explorer });
      setStep(4);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setStep(1);
    setAttested(null);
    setZk(null);
    setReputation(null);
    setCreated(null);
    setError(null);
  };

  return (
    <div className="min-h-screen bg-harvest-cream py-12 md:py-16">
      <div className="max-w-3xl mx-auto px-4 md:px-6">
        {/* Header */}
        <div className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-normal text-stone-900 mb-2">{t("create.title")}</h1>
          <p className="text-stone-600 text-sm md:text-base">
            {t("create.subtitle")}
          </p>
        </div>

        {/* Stepper indicator */}
        <ol className="flex items-center gap-2 mb-8" aria-label={t("create.stepsAria")}>
          {STEPS.map((title, i) => {
            const s = i + 1;
            return (
              <React.Fragment key={s}>
                <li className="flex items-center gap-2" aria-current={step === s ? "step" : undefined}>
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm transition-colors ${
                      step >= s ? "bg-amber-600 text-white" : "bg-stone-200 text-stone-500"
                    }`}
                  >
                    {step > s ? <CheckCircle2 className="w-5 h-5" /> : s}
                  </div>
                  <span
                    className={`hidden md:inline text-xs font-semibold ${
                      step === s ? "text-stone-900" : "text-stone-500"
                    }`}
                  >
                    {title}
                  </span>
                </li>
                {s < STEPS.length && (
                  <div
                    className={`flex-1 h-1 rounded transition-colors ${step > s ? "bg-amber-600" : "bg-stone-200"}`}
                  />
                )}
              </React.Fragment>
            );
          })}
        </ol>

        <div className="bg-white rounded-3xl border border-stone-100 p-6 md:p-10 shadow-sm">
          {error && !notEnrolled && (
            <div className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-100 text-rose-900 text-sm flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">{error}</span>
            </div>
          )}

          {notEnrolled && (
            <div
              data-testid="needs-enrolment"
              className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-100 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <span className="min-w-0">{t("enrol.notEnrolledHint")}</span>
              <Link
                href="/kayit"
                className="shrink-0 h-10 px-5 inline-flex items-center rounded-full bg-amber-600 hover:bg-amber-700 text-white font-semibold"
              >
                {t("enrol.goEnrol")}
              </Link>
            </div>
          )}

          {ready && !wallet && step < 4 && (
            <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-100 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span>{t("create.needWallet")}</span>
              <button
                type="button"
                onClick={openWallet}
                className="shrink-0 h-10 px-5 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-semibold"
              >
                {t("create.connect")}
              </button>
            </div>
          )}

          {/* STEP 1 — cooperative attestation */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <Building2 className="w-6 h-6 text-amber-700" />
                <div>
                  <h2 className="font-display font-normal text-xl text-stone-900">{t("create.s1Title")}</h2>
                  <p className="text-sm text-stone-600">
                    {t("create.s1Body")}
                  </p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="member" className={labelClass}>
                    {t("create.member")}
                  </label>
                  <select
                    id="member"
                    value={membershipId}
                    onChange={(e) => setMembershipId(e.target.value)}
                    className={`${inputClass} bg-white`}
                    disabled={members.length === 0}
                  >
                    {/* Once this browser has enrolled, the other memberships
                        are not choices -- the cooperative would refuse them. */}
                    {members
                      .filter((m) => !myMembership || m.membershipId === myMembership)
                      .map((m) => (
                        <option key={m.membershipId} value={m.membershipId}>
                          {m.farmer} — {m.membershipId}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>{t("create.product")}</label>
                  <input value={member?.cropLabel[locale] ?? ""} readOnly className={`${inputClass} bg-stone-50`} />
                </div>
                <div>
                  <label className={labelClass}>{t("create.region")}</label>
                  <input value={member?.region[locale] ?? ""} readOnly className={`${inputClass} bg-stone-50`} />
                </div>
                <div>
                  <label className={labelClass}>{t("create.season")}</label>
                  <input value={member?.season ?? ""} readOnly className={`${inputClass} bg-stone-50`} />
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 space-y-2">
                <div className="flex items-center gap-2 text-amber-900 text-sm font-bold">
                  <Lock className="w-4 h-4" />
                  <span>{t("create.secretTitle")}</span>
                </div>
                <div data-testid="secret-yield" className="text-2xl font-black text-amber-900 font-mono">
                  {kg(yieldKg)}
                </div>
                <p className="text-xs text-amber-800">
                  {t("create.secretBody")}
                </p>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="button"
                  data-testid="attest"
                  onClick={handleAttest}
                  disabled={busy || !membershipId || !wallet}
                  className="h-11 px-8 bg-amber-600 hover:bg-amber-700 text-white rounded-full font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  <span>{busy ? t("create.attesting") : t("create.attest")}</span>
                  {!busy && <ArrowRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 — ZK proof */}
          {step === 2 && attested && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display font-normal text-xl text-stone-900 mb-1">{t("create.s2Title")}</h2>
                <p className="text-sm text-stone-600">
                  {t("create.s2Body")}
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div data-testid="stays-panel" className="bg-rose-50/60 border border-rose-100 rounded-2xl p-4 text-xs text-rose-900 space-y-1.5">
                  <div className="font-bold mb-2">{t("create.stays")}</div>
                  <div>{t("create.realYield")} <strong>{kg(yieldKg)}</strong></div>
                  <div>{t("create.parcel")} <strong>{attested.display.parcel}</strong></div>
                  <div>{t("create.membershipSecret")}</div>
                </div>
                <div className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4 text-xs text-emerald-900 space-y-2">
                  <div className="font-bold">{t("create.statementTitle")}</div>
                  <div data-testid="statement">{t("create.statement", { n: form.thresholdTons || 0 })}</div>
                  <div>
                    <label htmlFor="threshold" className="block font-semibold mb-1">
                      {t("create.threshold")}
                    </label>
                    <input
                      id="threshold"
                      type="number"
                      min={1}
                      max={Math.floor(yieldKg / 1000)}
                      value={form.thresholdTons}
                      onChange={(e) => {
                        setForm({ ...form, thresholdTons: e.target.value });
                        setZk(null);
                      }}
                      className="w-full h-10 px-3 rounded-xl border border-emerald-200 bg-white font-mono font-bold text-sm text-stone-900 focus:outline-none focus:border-emerald-500"
                    />
                    <p className="text-[11px] text-emerald-800 mt-1">
                      {t("create.hiddenShare", { value: tons(Math.max(0, yieldKg - thresholdKg)) })}
                    </p>
                  </div>
                </div>
              </div>

              {!zk && !busy && (
                <button
                  type="button"
                  data-testid="prove"
                  onClick={handleProve}
                  disabled={!wallet || thresholdKg <= 0 || thresholdKg > yieldKg}
                  className="w-full h-12 bg-stone-900 hover:bg-stone-800 text-white rounded-full font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{t("create.prove")}</span>
                </button>
              )}

              {busy && (
                <div className="flex items-center gap-3 justify-center bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-700" />
                  <span className="text-sm text-amber-900 font-medium">
                    {t(`create.stages.${stage ?? "working"}`)}…
                  </span>
                </div>
              )}

              {zk && (
                <div data-testid="proof-ok" className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-semibold text-emerald-900 text-sm">
                      {t("create.proofOk")}
                    </div>
                    <div data-testid="proof-detail" className="text-xs text-emerald-800 font-mono mt-1 break-all">
                      Groth16 · {zk.provingMs} ms · ≥ {tons(zk.claim.threshold_kg)} · nullifier 0x
                      {zk.claim.nullifier.slice(0, 12)}…
                    </div>
                    {reputation && (
                      <div className="text-xs text-emerald-800 mt-1">
                        {t("create.tier", { tier: reputation.tier, rate: reputation.ratePercent })}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {zk && wallet && <ProofChallenge address={wallet.address} claim={zk.claim} proof={zk.proof} />}

              <div className="flex justify-between pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={restart}
                  disabled={busy}
                  className="h-11 px-6 border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-full text-sm font-semibold"
                >
                  {t("common.back")}
                </button>
                <button
                  type="button"
                  data-testid="to-terms"
                  onClick={() => setStep(3)}
                  disabled={!zk || busy}
                  className="h-11 px-8 bg-amber-600 hover:bg-amber-700 text-white rounded-full text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t("common.next")}
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — campaign terms */}
          {step === 3 && zk && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display font-normal text-xl text-stone-900 mb-1">{t("create.s3Title")}</h2>
                <p className="text-sm text-stone-600">
                  {t("create.s3Body")}
                </p>
              </div>

              <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center gap-2 text-xs text-emerald-900">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                <span>
                  {t("create.proofReady", { threshold: `≥ ${tons(zk.claim.threshold_kg)}`, season: zk.claim.season })}
                </span>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="target" className={labelClass}>
                    {t("create.target")}
                  </label>
                  <input
                    id="target"
                    type="number"
                    min={1}
                    value={form.targetUsdc}
                    onChange={(e) => setForm({ ...form, targetUsdc: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="rate" className={labelClass}>
                    {t("create.rate")}
                  </label>
                  <input
                    id="rate"
                    type="number"
                    step="0.5"
                    min={0}
                    value={form.returnPercent}
                    onChange={(e) => setForm({ ...form, returnPercent: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="days" className={labelClass}>
                    {t("create.days")}
                  </label>
                  <input
                    id="days"
                    type="number"
                    min={1}
                    value={form.days}
                    onChange={(e) => setForm({ ...form, days: e.target.value })}
                    className={inputClass}
                  />
                </div>
                <div>
                  <label htmlFor="min" className={labelClass}>
                    {t("create.min")}
                  </label>
                  <select
                    id="min"
                    value={form.minPercent}
                    onChange={(e) => setForm({ ...form, minPercent: e.target.value })}
                    className={inputClass}
                  >
                    {["50", "60", "75", "100"].map((p) => (
                      <option key={p} value={p}>
                        {p === "100" ? t("create.minAll") : percent(Number(p))}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-stone-500 mt-1">{t("create.minHint")}</p>
                </div>
                <div>
                  <label htmlFor="region" className={labelClass}>
                    {t("create.region")}
                  </label>
                  <input
                    id="region"
                    value={form.region}
                    onChange={(e) => setForm({ ...form, region: e.target.value })}
                    className={inputClass}
                  />
                </div>
              </div>
              <div>
                <label htmlFor="crop" className={labelClass}>
                  {t("create.product")}
                </label>
                <input
                  id="crop"
                  value={form.crop}
                  onChange={(e) => setForm({ ...form, crop: e.target.value })}
                  className={inputClass}
                />
              </div>

              <div className="flex justify-between pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setStep(2)}
                  disabled={busy}
                  className="h-11 px-6 border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-full text-sm font-semibold"
                >
                  {t("common.back")}
                </button>
                <button
                  type="button"
                  onClick={handlePublish}
                  disabled={
                    busy ||
                    !(Number(form.targetUsdc) > 0) ||
                    !(Number(form.days) > 0) ||
                    !form.crop.trim() ||
                    !form.region.trim()
                  }
                  className="h-11 px-8 bg-amber-600 hover:bg-amber-700 text-white rounded-full text-sm font-semibold transition-colors disabled:opacity-40 inline-flex items-center gap-2"
                >
                  {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{busy ? t("create.publishing") : t("create.publish")}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 — live */}
          {step === 4 && created && (
            <div className="text-center py-6">
              <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                <CheckCircle2 className="w-9 h-9 text-emerald-600" />
              </div>
              <h2 className="font-display font-normal text-2xl text-stone-900 mb-2">{t("create.liveTitle")}</h2>
              <p className="text-stone-600 text-sm max-w-md mx-auto mb-2 leading-relaxed">
                {t("create.liveBody", { id: created.id })}
              </p>
              <a
                href={created.explorer}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-amber-700 hover:text-amber-800 mb-6"
              >
                <span>{t("common.viewTx")}</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  href={`/kampanya/${created.id}`}
                  className="inline-flex items-center justify-center gap-2 h-11 px-8 bg-amber-600 hover:bg-amber-700 text-white rounded-full text-sm font-semibold transition-colors"
                >
                  <span>{t("create.viewCampaign")}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <button
                  type="button"
                  onClick={restart}
                  className="h-11 px-6 border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-full text-sm font-semibold"
                >
                  {t("create.newCampaign")}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
