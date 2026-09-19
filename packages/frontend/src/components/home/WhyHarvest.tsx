"use client";

import React from "react";
import { ShieldCheck, EyeOff, Coins, Zap } from "lucide-react";
import { useLocale } from "@/i18n/LocaleProvider";
import { tr } from "@/i18n/tr";
import { en } from "@/i18n/en";

const ICONS = [ShieldCheck, EyeOff, Coins, Zap];

export function WhyHarvest() {
  const { t, locale } = useLocale();
  const features = (locale === "en" ? en : tr).why.items.map((item, i) => ({
    ...item,
    icon: ICONS[i] ?? ShieldCheck,
  }));

  return (
    <section className="max-w-7xl mx-auto px-4 md:px-6 py-12">
      <div className="max-w-2xl mb-10">
        <div className="text-sm font-semibold text-amber-700 mb-2">
          {t("why.kicker")}
        </div>
        <h2 className="font-display text-3xl md:text-4xl font-normal text-stone-900 tracking-tight">
          {t("why.title")}
        </h2>
      </div>

      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-6">
        {features.map((feature, index) => {
          const Icon = feature.icon;
          return (
            <div
              key={index}
              className="bg-white rounded-2xl p-6 border border-stone-100 hover:shadow-md transition-shadow"
            >
              <div className="w-12 h-12 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center mb-4">
                <Icon className="w-6 h-6" />
              </div>
              <h3 className="font-bold text-stone-900 text-lg mb-2">
                {feature.title}
              </h3>
              <p className="text-stone-600 text-sm leading-relaxed">
                {feature.description}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
