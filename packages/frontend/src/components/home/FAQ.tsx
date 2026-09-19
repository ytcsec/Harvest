"use client";

import React, { useState } from "react";
import { ChevronDown } from "lucide-react";
import { useLocale } from "@/i18n/LocaleProvider";
import { useContent } from "@/i18n/content";
import { cn } from "@/lib/utils";

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { t } = useLocale();
  const { faqs } = useContent();

  const toggle = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section id="faq" className="max-w-4xl mx-auto px-4 md:px-6 py-16">
      <div className="text-center mb-10">
        <div className="text-sm font-semibold text-amber-700 mb-2">
          {t("faq.kicker")}
        </div>
        <h2 className="font-display text-3xl md:text-4xl font-normal text-stone-900 tracking-tight">
          {t("faq.title")}
        </h2>
      </div>

      <div className="space-y-3">
        {faqs.map((faq, index) => {
          const isOpen = openIndex === index;
          return (
            <div
              key={index}
              className="bg-white border border-stone-100 rounded-2xl overflow-hidden shadow-sm transition-colors"
            >
              <button
                type="button"
                onClick={() => toggle(index)}
                className="w-full text-left px-6 py-5 flex items-center justify-between gap-4 font-semibold text-stone-900 focus:outline-none"
              >
                <span className="text-base md:text-lg">{faq.q}</span>
                <ChevronDown
                  className={cn(
                    "w-5 h-5 text-stone-400 shrink-0 transition-transform duration-200",
                    isOpen && "rotate-180 text-amber-600"
                  )}
                />
              </button>

              {isOpen && (
                <div className="px-6 pb-5 pt-1 text-stone-600 text-sm md:text-base leading-relaxed border-t border-stone-50">
                  {faq.a}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
