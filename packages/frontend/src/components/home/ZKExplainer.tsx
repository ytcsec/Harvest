"use client";

import React from "react";
import { ShieldCheck, CheckCircle2 } from "lucide-react";
import { useLocale } from "@/i18n/LocaleProvider";

export function ZKExplainer() {
  const { t, tList } = useLocale();
  const points = tList("zk.points");

  return (
    <section id="zk" className="max-w-7xl mx-auto px-4 md:px-6 py-20">
      <div className="bg-gradient-to-br from-stone-900 via-stone-900 to-stone-800 text-white rounded-3xl p-8 md:p-14 relative overflow-hidden shadow-2xl">
        {/* Subtle decorative glow */}
        <div className="absolute -right-20 -top-20 w-80 h-80 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -left-20 -bottom-20 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative grid md:grid-cols-2 gap-10 items-center">
          {/* Left Column */}
          <div>
            <div className="inline-flex items-center gap-2 bg-white/10 border border-white/20 text-amber-300 text-xs font-semibold px-3 py-1.5 rounded-full mb-5">
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>{t("zk.badge")}</span>
            </div>

            <h2 className="font-display text-3xl md:text-4xl font-normal leading-tight mb-4 text-white">
              {t("zk.title1")}
              <br />
              {t("zk.title2")}
            </h2>

            <p className="text-stone-300 leading-relaxed mb-6">
              {t("zk.bodyA")}
              <b className="text-white">{t("zk.bodyBold")}</b>
              {t("zk.bodyC")}
            </p>

            <div className="space-y-3">
              {points.map((point, index) => (
                <div key={index} className="flex items-start gap-3">
                  <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <span className="text-stone-200 text-sm">{point}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column (Circuit Code) */}
          <div className="bg-white/5 border border-white/10 rounded-2xl p-6 backdrop-blur">
            <div className="text-xs text-stone-400 mb-2 font-mono">
              {t("zk.codeTitle")}
            </div>
            <pre className="text-sm text-emerald-300 font-mono leading-relaxed whitespace-pre-wrap">
{`private:  yield_tons
public:   threshold = 850, farmer_id
assert:   yield_tons > threshold
emit:     proof ✅

${t("zk.codeFooter")}`}
            </pre>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="text-xs bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                Groth16
              </span>
              <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded-full">
                Stellar Soroban
              </span>
              <span className="text-xs bg-stone-500/20 text-stone-300 border border-stone-500/30 px-2.5 py-1 rounded-full">
                {t("zk.anchorTag")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
