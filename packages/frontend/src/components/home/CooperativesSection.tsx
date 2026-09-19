"use client";

import React from "react";
import { Building2 } from "lucide-react";
import { useLocale } from "@/i18n/LocaleProvider";
import { useContent } from "@/i18n/content";

export function CooperativesSection() {
  const { t, moneyFromTry } = useLocale();
  const { cooperatives } = useContent();

  return (
    <section className="max-w-7xl mx-auto px-4 md:px-6 py-12">
      <div className="max-w-2xl mb-10">
        <div className="text-sm font-semibold text-amber-700 mb-2">
          {t("coops.kicker")}
        </div>
        <h2 className="font-display text-3xl md:text-4xl font-normal text-stone-900 tracking-tight">
          {t("coops.title")}
        </h2>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-4">
        {cooperatives.map((coop) => (
          <div
            key={coop.id}
            className="bg-white rounded-2xl p-5 border border-stone-100 hover:border-amber-300 hover:shadow-md transition-all"
          >
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-100 to-emerald-100 flex items-center justify-center mb-4">
              <Building2 className="w-6 h-6 text-amber-700" />
            </div>
            <h3 className="font-bold text-stone-900 leading-snug mb-1">
              {coop.name}
            </h3>
            <div className="text-xs text-stone-500 mb-3">
              {coop.location} · {t("coops.members", { n: coop.members })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-stone-100">
              <div>
                <div className="font-bold text-stone-900 whitespace-nowrap">
                  {moneyFromTry(coop.totalRaised)}
                </div>
                <div className="text-xs text-stone-500">{t("coops.totalRaised")}</div>
              </div>
              <div className="text-xs bg-amber-50 text-amber-700 font-semibold px-2 py-1 rounded-full whitespace-nowrap">
                {t("coops.campaigns", { n: coop.campaigns })}
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
