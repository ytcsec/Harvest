"use client";

import { useLocale } from "@/i18n/LocaleProvider";
import type { CampaignView } from "@/lib/campaigns";
import { cropName, regionName } from "@/lib/crop-names";

/** Campaign wording in the current language: title, product, status, tonnes, dates. */
export function useCampaignText() {
  const { t, locale, number, date } = useLocale();
  const tons = (kg: number) => t("common.tons", { n: number(kg / 1000, 1) });
  return {
    title: (c: CampaignView) => t("card.title", { crop: cropName(c.crop, locale), season: c.season }),
    crop: (c: CampaignView) => cropName(c.crop, locale),
    region: (c: CampaignView) => regionName(c.region, locale),
    product: (c: CampaignView) => (locale === "en" ? c.productEn : c.product),
    status: (c: CampaignView) => t(`status.${c.status}`),
    tons,
    threshold: (c: CampaignView) => t("common.atLeast", { value: tons(c.thresholdKg) }),
    deadline: (c: CampaignView) => date(c.deadline),
    daysLeft: (c: CampaignView) => t("common.daysLeft", { n: c.daysLeft }),
    season: (c: CampaignView) => t("common.season", { year: c.season }),
  };
}
