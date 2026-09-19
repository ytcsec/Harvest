"use client";

import React, { useState } from "react";
import { Keypair } from "@stellar/stellar-sdk";
import { AlertTriangle, CheckCircle2, Loader2, ShieldAlert, XCircle } from "lucide-react";

import { checkProofOnChain } from "@/lib/chain/harvest";
import { useLocale } from "@/i18n/LocaleProvider";
import { useCampaignText } from "@/i18n/campaign";

type Verdict = "idle" | "running" | "rejected" | "accepted" | "error";

interface Props {
  address: string;
  claim: { threshold_kg: number } & Record<string, unknown>;
  proof: unknown;
}

/**
 * Ask the live verifier about two lies told with a perfectly valid proof:
 * a threshold higher than the one proven, and the same proof sent from an
 * account it was not made for. Both are simulations -- nothing is submitted --
 * and a "rejected" here is the contract's verdict, not the UI's.
 *
 * Showing that the chain refuses what is false is what makes the accepted
 * proof mean something.
 */
export function ProofChallenge({ address, claim, proof }: Props) {
  const { t } = useLocale();
  const { tons } = useCampaignText();
  const [inflated, setInflated] = useState<Verdict>("idle");
  const [replayed, setReplayed] = useState<Verdict>("idle");
  const inflatedKg = claim.threshold_kg * 2;

  const ask = async (set: (v: Verdict) => void, args: Parameters<typeof checkProofOnChain>[0]) => {
    set("running");
    try {
      set((await checkProofOnChain(args)) ? "accepted" : "rejected");
    } catch (err) {
      // A contract trap is a refusal too; a network failure is not a verdict.
      set((err as Error)?.name === "ContractCallError" ? "rejected" : "error");
    }
  };

  const rows = [
    {
      label: t("challenge.inflate", { value: tons(inflatedKg) }),
      verdict: inflated,
      run: () => ask(setInflated, { address, claim: { ...claim, threshold_kg: inflatedKg }, proof }),
      rejectedText: t("challenge.rejectedInflate"),
    },
    {
      label: t("challenge.replay"),
      verdict: replayed,
      run: () => ask(setReplayed, { address: Keypair.random().publicKey(), claim, proof }),
      rejectedText: t("challenge.rejectedReplay"),
    },
  ];

  return (
    <div className="border border-stone-200 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
        <ShieldAlert className="w-4 h-4 text-amber-700" />
        <span>{t("challenge.title")}</span>
      </div>
      <p className="text-xs text-stone-500">
        {t("challenge.note")}
      </p>
      {rows.map((row, i) => (
        <div key={i} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <span className="text-xs text-stone-700">{row.label}</span>
          {row.verdict === "idle" ? (
            <button
              type="button"
              onClick={row.run}
              className="shrink-0 h-8 px-4 rounded-full border border-stone-300 text-xs font-semibold text-stone-800 hover:bg-stone-50"
            >
              {t("challenge.try")}
            </button>
          ) : row.verdict === "running" ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-stone-500">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> {t("challenge.asking")}
            </span>
          ) : row.verdict === "rejected" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-700">
              <XCircle className="w-4 h-4" /> {row.rejectedText}
            </span>
          ) : row.verdict === "accepted" ? (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
              <CheckCircle2 className="w-4 h-4" /> {t("challenge.accepted")}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="w-4 h-4" /> {t("challenge.network")}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
