"use client";

import React from "react";
import { useLocale } from "@/i18n/LocaleProvider";
import { useContent } from "@/i18n/content";
import type { Testimonial } from "@/lib/mock-data";

function Card({ item }: { item: Testimonial }) {
  return (
    <figure className="mr-6 w-[320px] sm:w-[400px] shrink-0 bg-white rounded-2xl p-6 border border-stone-100 flex flex-col justify-between shadow-sm">
      <blockquote className="text-stone-700 leading-relaxed mb-6 italic">“{item.text}”</blockquote>
      <figcaption className="flex items-center gap-3 pt-4 border-t border-stone-100">
        <div className="w-11 h-11 rounded-full bg-gradient-to-br from-amber-500 to-emerald-500 text-white font-bold flex items-center justify-center shrink-0">
          {item.initials}
        </div>
        <div>
          <div className="font-bold text-stone-900 text-sm">{item.name}</div>
          <div className="text-xs text-stone-500">{item.role}</div>
        </div>
      </figcaption>
    </figure>
  );
}

/**
 * Testimonials as a strip that drifts to the right and stops while the
 * pointer (or keyboard focus) is on it. The list is rendered twice so the
 * loop has no seam; the copy is hidden from screen readers.
 */
export function Testimonials() {
  const { t } = useLocale();
  const { testimonials } = useContent();
  return (
    <section className="py-20">
      <div className="max-w-7xl mx-auto px-5 md:px-8">
        <div className="max-w-2xl mb-10">
          <div className="text-sm font-semibold text-amber-700 mb-2">{t("testimonials.kicker")}</div>
          <h2 className="font-display text-3xl md:text-4xl font-normal text-stone-900 tracking-tight">
            {t("testimonials.title")}
          </h2>
        </div>
      </div>

      <div className="marquee relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
        <div className="marquee-track flex w-max items-stretch py-2">
          {testimonials.map((item) => (
            <Card key={item.name} item={item} />
          ))}
          <div className="flex items-stretch" aria-hidden="true">
            {testimonials.map((item) => (
              <Card key={`${item.name}-copy`} item={item} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
