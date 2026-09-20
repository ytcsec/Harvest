"use client";

import React from "react";
import { ShieldCheck, Scale } from "lucide-react";
import { useLocale } from "@/i18n/LocaleProvider";

/**
 * The two objections a jury raises first: how the yield claim is proven, and
 * why a farmer cannot simply over-ask. Sits right under "How it works" and
 * mirrors its editorial styling.
 */
export function JuryQuestions() {
  const { t } = useLocale();

  const cards = [
    {
      icon: ShieldCheck,
      title: t("home.jury.q1Title"),
      body: t("home.jury.q1Body"),
      tag: t("home.jury.q1Tag"),
    },
    {
      icon: Scale,
      title: t("home.jury.q2Title"),
      body: t("home.jury.q2Body"),
      tag: t("home.jury.q2Tag"),
    },
  ];

  return (
    <section id="jury" className="max-w-7xl mx-auto px-5 md:px-8 py-20 md:py-28 scroll-mt-20">
      <div className="grid md:grid-cols-[1fr_auto] gap-6 md:items-end mb-14">
        <div>
          <div className="eyebrow mb-3">{t("home.jury.eyebrow")}</div>
          <h2 className="font-display font-normal text-4xl md:text-6xl leading-none text-harvest-earth">
            {t("home.jury.title")}
          </h2>
        </div>
        <p className="max-w-xs text-sm leading-6 text-harvest-text">{t("home.jury.body")}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        {cards.map((card, i) => {
          const Icon = card.icon;
          return (
            <article
              key={card.title}
              className="flex flex-col rounded-2xl border border-harvest-border bg-harvest-paper p-7 md:p-8"
            >
              <div className="flex items-center gap-4">
                <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-harvest-cream text-harvest-field">
                  <Icon className="h-5 w-5" strokeWidth={1.7} />
                </span>
                <span className="text-xs text-harvest-muted">{String(i + 1).padStart(2, "0")}</span>
              </div>
              <h3 className="mt-6 text-xl md:text-2xl font-display font-normal leading-snug text-harvest-earth">
                {card.title}
              </h3>
              <p className="mt-4 text-sm leading-7 text-harvest-text flex-1">{card.body}</p>
              <span className="mt-6 border-t border-harvest-border pt-3 text-xs font-medium text-harvest-earth">
                {card.tag}
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}
