"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ExternalLink,
  FileText,
  Loader2,
  Lock,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";

import { useWallet } from "@/components/wallet/WalletProvider";
import {
  DOC,
  applyForMembership,
  checkEnrolmentOnChain,
  docsInMask,
  fetchRequirements,
  landStaysPrivate,
  maskIsSufficient,
  prefetchEnrolmentArtifacts,
  proveEnrolment,
  registerOnChain,
  isIdentityEnrolled,
  registrationOf,
} from "@/lib/chain/enrolment";
import { fetchMyMembership } from "@/lib/chain/harvest";
import { commitmentForIssuer, resetFarmerSecret } from "@/lib/chain/prover";
import { deployments, explorerContract } from "@/lib/chain/deployments";
import { useLocale } from "@/i18n/LocaleProvider";

/**
 * Membership enrolment, behind the same four-step wizard the campaign flow uses.
 *
 *   1  who is applying: name and national id. Nothing else, because nothing
 *      else is theirs to give yet -- an applicant has no membership number, and
 *      asking for one would mean asking them to already be a member.
 *   2  their documents. The ÇKS number is the key the cooperative looks up: it
 *      is the state's farmer registry, it exists independently of any
 *      cooperative, and the membership number comes back as the *result*. On a
 *      match the cooperative signs a credential over Poseidon(farmerSecret).
 *   3  snarkjs turns that credential into a Groth16 proof in this tab, and the
 *      enrolment verifier checks it in simulation before anything is spent.
 *   4  `register`, which spends the enrolment nullifier so the credential
 *      cannot be used twice.
 *
 * The land area is read from the cooperative's record rather than typed, for
 * the same reason the harvest figure is: an applicant who could type any number
 * would be proving nothing.
 */

interface Requirement {
  bit: number;
  key: string;
  label: { tr: string; en: string };
  required: boolean;
  computed?: boolean;
  placeholder?: string;
  help: { tr: string; en: string };
}

interface Check {
  bit: number;
  key: string;
  label: { tr: string; en: string };
  required: boolean;
  passed: boolean;
}

interface Approved {
  issuer: { ax: string; ay: string };
  review: { checks: Check[]; attrMask: number; docMask: number; sufficient: boolean };
  credential: {
    applicantRef: string;
    parcelId: string;
    landDecares: string;
    attrMask: string;
    season: string;
  };
  signature: { sigR8x: string; sigR8y: string; sigS: string };
  membership: {
    membershipId: string;
    cropLabel: { tr: string; en: string };
    region: { tr: string; en: string };
    season: number;
  };
  display: { farmer: string; parcel: string; membershipId: string };
}

interface EnrolProof {
  claim: { nullifier: string; threshold_kg: number; season: number };
  proof: { a: string; b: string; c: string };
  publicSignals: string[];
  provingMs: number;
  docMask: number;
}

const inputClass =
  "w-full h-11 px-4 rounded-xl border border-stone-200 focus:border-amber-500 focus:outline-none text-sm text-stone-900";
const labelClass = "text-sm font-semibold text-stone-700 block mb-1.5";


export default function EnrolPage() {
  const { wallet, ready, openWallet, notify } = useWallet();
  const { t, tList, locale, number } = useLocale();

  const [step, setStep] = useState(1);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [minDecares, setMinDecares] = useState("10");
  /** The season the cooperative is enrolling for; needed to work out the nullifier. */
  const [season, setSeason] = useState<number | null>(null);
  const [crops, setCrops] = useState<{ key: string; label: { tr: string; en: string } }[]>([]);
  const [crop, setCrop] = useState("");
  const [applicant, setApplicant] = useState({ fullName: "", nationalId: "" });
  const [documents, setDocuments] = useState<Record<string, string>>({});
  const [approved, setApproved] = useState<Approved | null>(null);
  const [zk, setZk] = useState<EnrolProof | null>(null);
  const [registered, setRegistered] = useState<{ id: number; explorer?: string } | null>(null);
  const [existing, setExisting] = useState<{ docMask: number; season: number } | null>(null);
  /** Registered on chain, unknown to the cooperative. A demo-reset artefact. */
  const [orphaned, setOrphaned] = useState(false);

  const STEPS = tList("enrol.steps");

  useEffect(() => {
    fetchRequirements()
      .then((r: { checks: Requirement[]; minDecares: string; season: number; crops: { key: string; label: { tr: string; en: string } }[] }) => {
        setRequirements(r.checks);
        setMinDecares(r.minDecares);
        setSeason(r.season);
        setCrops(r.crops ?? []);
        setCrop(r.crops?.[0]?.key ?? "");
      })
      .catch(() => {});
  }, []);

  // Already enrolled? Say so rather than walking someone through a form that
  // ends in AlreadyRegistered.
  //
  // Both sides are checked, because they can disagree. The chain cannot forget
  // a spent nullifier, so clearing the cooperative's records -- which is how the
  // demo is reset -- leaves a browser registered on chain and unknown to the
  // cooperative. That state is a dead end in both directions, so it gets its own
  // message and its own way out.
  useEffect(() => {
    if (!wallet || !season) {
      setExisting(null);
      setOrphaned(false);
      return;
    }
    let cancelled = false;
    (async () => {
      // The nullifier follows the secret in localStorage, not the wallet, so it
      // is what the registry will actually refuse. Asking by address instead
      // reports "free" for a fresh demo wallet in a browser that has already
      // enrolled, and the farmer only finds out when `register` reverts.
      const [spent, atCoop, byAddress] = await Promise.all([
        isIdentityEnrolled(season),
        commitmentForIssuer()
          .then(fetchMyMembership)
          .catch(() => ({ membershipId: null })),
        registrationOf(wallet.address),
      ]);
      if (cancelled) return;
      setExisting(
        spent ? { docMask: byAddress?.docMask ?? atCoop.docMask ?? 0, season: Number(season) } : null,
      );
      setOrphaned(spent && !atCoop.membershipId);
    })();
    return () => {
      cancelled = true;
    };
  }, [wallet, season]);

  // 9 MB of artefacts. Start them as soon as someone is on the form.
  useEffect(() => {
    if (wallet) prefetchEnrolmentArtifacts();
  }, [wallet]);

  const fail = (err: unknown) => setError(err instanceof Error ? err.message : String(err));

  const labelOf = (l: { tr: string; en: string }) => (locale === "en" ? l.en : l.tr);

  // 1. Send the documents to the cooperative.
  const handleApply = async () => {
    setBusy(true);
    setError(null);
    try {
      const result: Approved = await applyForMembership({ applicant, documents, crop });
      setApproved(result);
      setZk(null);
      setStep(3);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  // 2. Prove it, and ask the chain before spending anything.
  const handleProve = async () => {
    if (!approved || !wallet) return;
    setBusy(true);
    setError(null);
    try {
      const result = await proveEnrolment({
        issuer: approved.issuer,
        credential: approved.credential,
        signature: approved.signature,
        address: wallet.address,
        onStage: setStage,
      });
      setStage("onchain");
      const accepted = await checkEnrolmentOnChain({
        address: wallet.address,
        claim: result.claim,
        proof: result.proof,
      });
      if (!accepted) throw new Error(t("enrol.verifierRejected"));
      setZk(result);
      notify(t("enrol.proofOk"));
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  // 3. Spend the nullifier.
  const handleRegister = async () => {
    if (!zk || !wallet) return;
    setBusy(true);
    setError(null);
    try {
      // `invoke` hands back `{ value, explorer, hash }`; the contract's return
      // value is the running count of enrolments, which is this one's number.
      const res = await registerOnChain({
        address: wallet.address,
        sign: wallet.sign,
        invoke: wallet.invoke,
        claim: zk.claim,
        proof: zk.proof,
      });
      setRegistered({ id: Number(res.value), explorer: res.explorer });
      setStep(4);
    } catch (err) {
      fail(err);
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setStep(1);
    setApproved(null);
    setZk(null);
    setError(null);
  };

  const maskText = (mask: number) =>
    docsInMask(mask)
      .map((bit) => labelOf(DOC_LABEL_FALLBACK[bit] ?? { tr: String(bit), en: String(bit) }))
      .join(" · ");

  return (
    <div className="min-h-screen bg-harvest-cream py-12 md:py-16">
      <div className="max-w-3xl mx-auto px-4 md:px-6">
        <div className="mb-8">
          <h1 className="font-display text-3xl md:text-4xl font-normal text-stone-900 mb-2">{t("enrol.title")}</h1>
          <p className="text-stone-600 text-sm md:text-base">{t("enrol.subtitle")}</p>
        </div>

        <ol className="flex items-center gap-2 mb-8" aria-label={t("enrol.stepsAria")}>
          {STEPS.map((title: string, i: number) => {
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
                    className={`hidden md:inline text-xs font-semibold ${step === s ? "text-stone-900" : "text-stone-500"}`}
                  >
                    {title}
                  </span>
                </li>
                {s < STEPS.length && (
                  <div className={`flex-1 h-1 rounded transition-colors ${step > s ? "bg-amber-600" : "bg-stone-200"}`} />
                )}
              </React.Fragment>
            );
          })}
        </ol>

        <div className="bg-white rounded-3xl border border-stone-100 p-6 md:p-10 shadow-sm">
          {error && (
            <div
              data-testid="enrol-error"
              className="mb-6 p-4 rounded-2xl bg-rose-50 border border-rose-100 text-rose-900 text-sm flex items-start gap-3"
            >
              <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0 mt-0.5" />
              <span className="break-words min-w-0">{error}</span>
            </div>
          )}

          {ready && !wallet && step < 4 && (
            <div className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-100 text-sm text-amber-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <span>{t("enrol.needWallet")}</span>
              <button
                type="button"
                onClick={openWallet}
                className="shrink-0 h-10 px-5 rounded-full bg-amber-600 hover:bg-amber-700 text-white font-semibold"
              >
                {t("enrol.connect")}
              </button>
            </div>
          )}

          {orphaned && step < 4 && (
            <div
              data-testid="enrol-orphaned"
              className="mb-6 p-4 rounded-2xl bg-amber-50 border border-amber-100 text-sm text-amber-900 flex items-start gap-3"
            >
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-semibold">{t("enrol.orphanTitle")}</div>
                <div className="text-xs mt-0.5">{t("enrol.orphanBody")}</div>
                <button
                  type="button"
                  data-testid="enrol-reset-identity"
                  onClick={() => {
                    resetFarmerSecret();
                    setOrphaned(false);
                    setExisting(null);
                    restart();
                  }}
                  className="mt-2.5 h-9 px-4 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold"
                >
                  {t("enrol.orphanReset")}
                </button>
              </div>
            </div>
          )}

          {existing && !orphaned && step < 4 && (
            <div
              data-testid="already-enrolled"
              className="mb-6 p-4 rounded-2xl bg-emerald-50 border border-emerald-100 text-sm text-emerald-900 flex items-start gap-3"
            >
              <BadgeCheck className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <div className="font-semibold">{t("enrol.alreadyTitle")}</div>
                <div className="text-xs mt-0.5">
                  {t("enrol.alreadyBody", { season: existing.season, mask: maskText(existing.docMask) })}
                </div>
                <Link href="/create" className="inline-flex items-center gap-1 text-xs font-semibold mt-2 hover:underline">
                  <span>{t("enrol.goCreate")}</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}

          {/* STEP 1 -- who is applying */}
          {step === 1 && !existing && (
            <div className="space-y-5">
              <div className="flex items-center gap-3 mb-2">
                <FileText className="w-6 h-6 text-amber-700" />
                <div>
                  <h2 className="font-display font-normal text-xl text-stone-900">{t("enrol.s1Title")}</h2>
                  <p className="text-sm text-stone-600">{t("enrol.s1Body")}</p>
                </div>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="fullName" className={labelClass}>
                    {t("enrol.fullName")}
                  </label>
                  <input
                    id="fullName"
                    data-testid="enrol-fullname"
                    value={applicant.fullName}
                    onChange={(e) => setApplicant({ ...applicant, fullName: e.target.value })}
                    className={inputClass}
                    placeholder="Ad Soyad"
                  />
                </div>
                <div>
                  <label htmlFor="nationalId" className={labelClass}>
                    {t("enrol.nationalId")}
                  </label>
                  <input
                    id="nationalId"
                    data-testid="enrol-nationalid"
                    value={applicant.nationalId}
                    onChange={(e) => setApplicant({ ...applicant, nationalId: e.target.value })}
                    className={inputClass}
                    placeholder="10000000146"
                  />
                </div>
              </div>

              <div className="p-4 rounded-2xl bg-stone-50 border border-stone-200 flex items-start gap-2.5 text-xs text-stone-600">
                <Lock className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                <span>{t("enrol.identityNote")}</span>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="button"
                  data-testid="enrol-to-documents"
                  onClick={() => setStep(2)}
                  disabled={!wallet || !applicant.fullName.trim() || !applicant.nationalId.trim()}
                  className="h-11 px-8 bg-amber-600 hover:bg-amber-700 text-white rounded-full font-semibold text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  <span>{t("common.next")}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          {/* STEP 2 -- the documents */}
          {step === 2 && !existing && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display font-normal text-xl text-stone-900 mb-1">{t("enrol.s2Title")}</h2>
                <p className="text-sm text-stone-600">{t("enrol.s2Body")}</p>
              </div>

              <div className="space-y-4">
                {requirements
                  .filter((r) => !r.computed)
                  .map((r) => (
                    <div key={r.key}>
                      <label htmlFor={`doc-${r.key}`} className={labelClass}>
                        {labelOf(r.label)}{" "}
                        {!r.required && <span className="font-normal text-stone-400">({t("enrol.optional")})</span>}
                      </label>
                      <input
                        id={`doc-${r.key}`}
                        data-testid={`doc-${r.key}`}
                        value={documents[r.key] ?? ""}
                        onChange={(e) => setDocuments({ ...documents, [r.key]: e.target.value })}
                        className={`${inputClass} font-mono`}
                        placeholder={r.placeholder}
                      />
                      <p className="text-[11px] text-stone-500 mt-1">{labelOf(r.help)}</p>
                    </div>
                  ))}

                <div>
                  <label htmlFor="crop" className={labelClass}>
                    {t("enrol.crop")}
                  </label>
                  <select
                    id="crop"
                    data-testid="enrol-crop"
                    value={crop}
                    onChange={(e) => setCrop(e.target.value)}
                    className={`${inputClass} bg-white`}
                  >
                    {crops.map((c) => (
                      <option key={c.key} value={c.key}>
                        {labelOf(c.label)}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-stone-500 mt-1">{t("enrol.cropHelp")}</p>
                </div>

                {requirements
                  .filter((r) => r.computed)
                  .map((r) => (
                    <div
                      key={r.key}
                      className="p-4 rounded-2xl bg-emerald-50/60 border border-emerald-100 text-xs text-emerald-900 flex items-start gap-2.5"
                    >
                      <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" />
                      <div>
                        <div className="font-bold">
                          {labelOf(r.label)}{" "}
                          <span className="font-normal text-emerald-700">({t("enrol.computed")})</span>
                        </div>
                        <div className="mt-0.5">{labelOf(r.help)}</div>
                      </div>
                    </div>
                  ))}
              </div>

              <div className="flex justify-between pt-4 border-t border-stone-100">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  disabled={busy}
                  className="h-11 px-6 border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-full text-sm font-semibold"
                >
                  {t("common.back")}
                </button>
                <button
                  type="button"
                  data-testid="enrol-submit"
                  onClick={handleApply}
                  disabled={busy || !wallet}
                  className="h-11 px-8 bg-amber-600 hover:bg-amber-700 text-white rounded-full text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2"
                >
                  {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                  <span>{busy ? t("enrol.submitting") : t("enrol.submit")}</span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 -- the proof */}
          {step === 3 && approved && !existing && (
            <div className="space-y-5">
              <div>
                <h2 className="font-display font-normal text-xl text-stone-900 mb-1">{t("enrol.s3Title")}</h2>
                <p className="text-sm text-stone-600">{t("enrol.s3Body")}</p>
              </div>

              <div
                data-testid="enrol-membership-granted"
                className="rounded-2xl bg-amber-50 border border-amber-100 p-4 flex items-start gap-3"
              >
                <BadgeCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                <div className="min-w-0 text-sm">
                  <div className="font-semibold text-amber-900">{t("enrol.granted")}</div>
                  <div className="text-xs text-amber-800 mt-0.5">
                    <span className="font-mono font-bold">{approved.membership.membershipId}</span>
                    {" · "}
                    {labelOf(approved.membership.cropLabel)} · {labelOf(approved.membership.region)}
                  </div>
                </div>
              </div>

              <div data-testid="enrol-review" className="rounded-2xl border border-stone-200 overflow-hidden">
                <div className="px-4 py-2.5 bg-stone-50 text-xs font-bold text-stone-700 border-b border-stone-200">
                  {t("enrol.reviewTitle")}
                </div>
                <ul className="divide-y divide-stone-100">
                  {approved.review.checks.map((c) => (
                    <li key={c.key} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                      <span className="text-stone-700">
                        {labelOf(c.label)}{" "}
                        {!c.required && <span className="text-stone-400">({t("enrol.optional")})</span>}
                      </span>
                      {c.passed ? (
                        <span className="inline-flex items-center gap-1.5 text-emerald-700 font-semibold text-xs">
                          <CheckCircle2 className="w-4 h-4" />
                          {t("enrol.passed")}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 text-stone-400 font-semibold text-xs">
                          <XCircle className="w-4 h-4" />
                          {c.required ? t("enrol.failed") : t("enrol.notProvided")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div
                  data-testid="enrol-stays"
                  className="bg-rose-50/60 border border-rose-100 rounded-2xl p-4 text-xs text-rose-900 space-y-1.5"
                >
                  <div className="font-bold mb-2">{t("enrol.staysTitle")}</div>
                  <div>{t("enrol.staysIdentity")}</div>
                  <div>
                    {t("enrol.staysParcel")} <strong>{approved.display.parcel}</strong>
                  </div>
                  <div>
                    {t("enrol.staysLand")}{" "}
                    <strong>{t("enrol.decares", { n: number(Number(approved.credential.landDecares), 0) })}</strong>
                  </div>
                  <div className="text-[11px]">{t("enrol.staysLandNote", { min: minDecares })}</div>
                </div>
                <div
                  data-testid="enrol-published"
                  className="bg-emerald-50/60 border border-emerald-100 rounded-2xl p-4 text-xs text-emerald-900 space-y-2"
                >
                  <div className="font-bold">{t("enrol.publishedTitle")}</div>
                  <div>
                    {t("enrol.maskLabel")}: <strong>{maskText(approved.review.docMask)}</strong>
                  </div>
                  <div className="font-mono text-[11px]">docMask = {approved.review.docMask}</div>
                </div>
              </div>

              {!zk && !busy && (
                <button
                  type="button"
                  data-testid="enrol-prove"
                  onClick={handleProve}
                  disabled={!wallet || !approved.review.sufficient}
                  className="w-full h-12 bg-stone-900 hover:bg-stone-800 text-white rounded-full font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-40"
                >
                  <Sparkles className="w-4 h-4" />
                  <span>{t("enrol.prove")}</span>
                </button>
              )}

              {busy && (
                <div className="flex items-center gap-3 justify-center bg-amber-50 border border-amber-100 rounded-xl p-4">
                  <Loader2 className="w-5 h-5 animate-spin text-amber-700" />
                  <span className="text-sm text-amber-900 font-medium">
                    {t(`enrol.stages.${stage ?? "working"}`)}…
                  </span>
                </div>
              )}

              {zk && (
                <div
                  data-testid="enrol-proof-ok"
                  className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex items-start gap-3"
                >
                  <CheckCircle2 className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="font-semibold text-emerald-900 text-sm">{t("enrol.proofOk")}</div>
                    <div
                      data-testid="enrol-proof-detail"
                      className="text-xs text-emerald-800 font-mono mt-1 break-all"
                    >
                      {t("enrol.proofMeta", { ms: zk.provingMs, mask: zk.docMask })} · nullifier 0x
                      {zk.claim.nullifier.slice(0, 12)}…
                    </div>
                    {!landStaysPrivate(zk.publicSignals, approved.credential.landDecares) && (
                      <div className="text-xs text-rose-700 mt-1">land area leaked into a public signal</div>
                    )}
                  </div>
                </div>
              )}

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
                  data-testid="enrol-register"
                  onClick={handleRegister}
                  disabled={!zk || busy}
                  className="h-11 px-8 bg-amber-600 hover:bg-amber-700 text-white rounded-full text-sm font-semibold transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {busy ? t("enrol.registering") : t("enrol.register")}
                </button>
              </div>
            </div>
          )}

          {/* STEP 4 -- done */}
          {step === 4 && registered && (
            <div data-testid="enrol-done" className="text-center py-6">
              <BadgeCheck className="mx-auto h-14 w-14 text-emerald-600" />
              <h2 className="font-display font-normal text-2xl text-stone-900 mt-5 mb-2">{t("enrol.doneTitle")}</h2>
              <p className="mx-auto max-w-md text-sm leading-6 text-stone-600">
                {t("enrol.doneBody", { id: registered.id })}
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/create"
                  className="h-11 px-8 inline-flex items-center gap-2 bg-amber-600 hover:bg-amber-700 text-white rounded-full text-sm font-semibold"
                >
                  <span>{t("enrol.goCreate")}</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
                {(registered.explorer || deployments.registry) && (
                  <a
                    href={registered.explorer ?? explorerContract(deployments.registry)}
                    target="_blank"
                    rel="noreferrer"
                    className="h-11 px-6 inline-flex items-center gap-1.5 border border-stone-200 text-stone-700 hover:bg-stone-50 rounded-full text-sm font-semibold"
                  >
                    <span>{t("enrol.viewRegistry")}</span>
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Labels for the mask bits, so a mask can be rendered without another round
 * trip to the cooperative. Mirrors `DOC_LABELS` in the SDK.
 */
const DOC_LABEL_FALLBACK: Record<number, { tr: string; en: string }> = {
  [DOC.CKS]: { tr: "ÇKS kaydı", en: "ÇKS registration" },
  [DOC.DEED]: { tr: "Tapu / kira", en: "Deed or lease" },
  [DOC.TARSIM]: { tr: "TARSİM", en: "TARSİM" },
  [DOC.LAND]: { tr: "Arazi eşiği", en: "Land threshold" },
};
