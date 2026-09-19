"use client";

import * as trContent from "@/lib/mock-data";
import * as enContent from "@/lib/mock-data.en";
import { useLocale } from "@/i18n/LocaleProvider";

/** The showcase content (steps, FAQ, cooperatives, stories, testimonials) in the current language. */
export function useContent() {
  const { locale } = useLocale();
  return locale === "en" ? enContent : trContent;
}
