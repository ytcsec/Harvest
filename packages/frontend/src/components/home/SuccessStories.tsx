"use client";

import React from "react";
import { CheckCircle } from "lucide-react";
import { useLocale } from "@/i18n/LocaleProvider";
import { useContent } from "@/i18n/content";

export function SuccessStories() {
  const { t, moneyFromTry } = useLocale();
  const { successStories } = useContent();

  return (
    <section className="max-w-7xl mx-auto px-4 md:px-6 py-20">
      <div className="max-w-2xl mb-10">
        <div className="text-sm font-semibold text-amber-700 mb-2">
          {t("stories.kicker")}
        </div>
        <h2 className="font-display text-3xl md:text-4xl font-normal text-stone-900 tracking-tight">
          {t("stories.title")}
        </h2>
      </div>

      <div className="grid md:grid-cols-3 gap-6">
        {successStories.map((story) => (
          <div
            key={story.id}
            className="bg-white rounded-2xl overflow-hidden border border-stone-100 hover:shadow-lg transition-all"
          >
            <div className="aspect-[16/10] overflow-hidden">
              <img
                src={story.cover}
                alt={story.title}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            </div>
            <div className="p-5">
              <div className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-xs font-semibold px-2 py-0.5 rounded-full mb-2">
                <CheckCircle className="w-3 h-3" />
                <span>{t("stories.done")}</span>
              </div>
              <h3 className="font-bold text-stone-900 mb-1">
                {story.title}
              </h3>
              <div className="text-xs text-stone-500 mb-3">
                {story.farmer} · {story.location}
              </div>
              <div className="flex items-baseline justify-between pt-3 border-t border-stone-100">
                <div>
                  <div className="font-black text-stone-900">
                    {moneyFromTry(story.repaid ?? story.raised ?? 0)}
                  </div>
                  <div className="text-xs text-stone-500">{t("stories.repaid")}</div>
                </div>
                <div className="text-xs text-stone-600 font-medium">
                  {story.season ?? t("stories.investors", { n: story.backers ?? 0 })}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
