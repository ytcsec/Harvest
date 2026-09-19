"use client";

import React from "react";
import Link from "next/link";
import { AlertTriangle, Sprout } from "lucide-react";
import { useLocale } from "@/i18n/LocaleProvider";

/** Placeholder cards while the contract is being read. */
export function CampaignSkeletons({ count = 3 }: { count?: number }) {
  const { t } = useLocale();
  return (
    <div className="grid md:grid-cols-[1.45fr_1fr] gap-8" aria-busy="true" aria-label={t("states.loadingAria")}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`animate-pulse ${i === 0 ? "md:row-span-2" : ""}`}>
          <div className={`rounded-2xl bg-stone-100 ${i === 0 ? "aspect-[4/3] md:aspect-auto md:h-[26rem]" : "aspect-[16/10]"}`} />
          <div className="pt-4 space-y-3">
            <div className="h-3 w-1/3 bg-stone-100 rounded" />
            <div className="h-4 w-3/4 bg-stone-100 rounded" />
            <div className="h-2 w-full bg-stone-100 rounded-full" />
            <div className="h-3 w-1/2 bg-stone-100 rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CampaignsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLocale();
  return (
    <div className="text-center py-16 bg-white rounded-3xl border border-rose-100 p-8">
      <AlertTriangle className="w-8 h-8 text-rose-500 mx-auto mb-3" />
      <p className="text-stone-800 font-semibold mb-1">{t("states.errorTitle")}</p>
      <p className="text-xs text-stone-500 mb-5 break-words max-w-lg mx-auto">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="px-5 py-2.5 bg-stone-900 text-white rounded-full text-sm font-semibold hover:bg-stone-800 transition-colors"
      >
        {t("common.retry")}
      </button>
    </div>
  );
}

export function NoCampaigns() {
  const { t } = useLocale();
  return (
    <div className="text-center py-16 bg-white rounded-3xl border border-stone-200 p-8">
      <Sprout className="w-8 h-8 text-emerald-600 mx-auto mb-3" />
      <p className="text-stone-800 font-semibold mb-1">{t("states.emptyTitle")}</p>
      <p className="text-sm text-stone-500 mb-5">{t("states.emptySub")}</p>
      <Link
        href="/create"
        className="inline-flex px-5 py-2.5 bg-amber-600 text-white rounded-full text-sm font-semibold hover:bg-amber-700 transition-colors"
      >
        {t("nav.start")}
      </Link>
    </div>
  );
}
