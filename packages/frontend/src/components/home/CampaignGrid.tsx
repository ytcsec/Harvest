"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { CampaignMagazine } from "@/components/campaign/CampaignCard";
import { CampaignSkeletons, CampaignsError, NoCampaigns } from "@/components/campaign/CampaignStates";
import { useCampaigns } from "@/lib/chain/hooks";
import { useLocale } from "@/i18n/LocaleProvider";

/** Live campaigns from the contract, in the HARVEST.V2 magazine layout. */
export function CampaignGrid() {
  const { campaigns, loading, error, refresh } = useCampaigns();
  const { t, locale } = useLocale();
  const [filter, setFilter] = useState("all");

  // Only campaigns that can still be funded belong on the home page.
  const open = useMemo(() => campaigns.filter((c) => c.isOpen), [campaigns]);
  const products = useMemo(() => {
    const seen = new Map<string, string>();
    for (const c of open) seen.set(c.product, locale === "en" ? c.productEn : c.product);
    return Array.from(seen.entries());
  }, [open, locale]);
  const shown = (filter === "all" ? open : open.filter((c) => c.product === filter)).slice(0, 3);

  const chip = (active: boolean) =>
    `h-10 px-4 rounded-full border text-sm font-medium transition-colors ${
      active
        ? "bg-harvest-earth border-harvest-earth text-harvest-cream"
        : "border-harvest-border bg-harvest-paper/60 text-harvest-earth hover:border-harvest-gold"
    }`;

  return (
    <section id="campaigns" className="max-w-7xl mx-auto px-5 md:px-8 py-20 md:py-28 scroll-mt-20">
      <div className="grid md:grid-cols-[1fr_auto] gap-6 md:items-end mb-10">
        <div>
          <div className="eyebrow mb-3">{t("home.campaigns.eyebrow")}</div>
          <h2 className="font-display font-normal text-4xl md:text-6xl leading-none text-harvest-earth">
            {t("home.campaigns.title")}
          </h2>
        </div>
        <p className="max-w-xs text-sm leading-6 text-harvest-text">{t("home.campaigns.body")}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-harvest-border pb-6 mb-10" role="group">
        <button type="button" className={chip(filter === "all")} onClick={() => setFilter("all")}>
          {t("home.campaigns.all")} <span className="ml-1 opacity-70">{open.length}</span>
        </button>
        {products.map(([key, label]) => (
          <button key={key} type="button" className={chip(filter === key)} onClick={() => setFilter(key)}>
            {label}
          </button>
        ))}
        <span className="ml-auto text-xs text-harvest-muted">{t("home.campaigns.note")}</span>
      </div>

      {loading ? (
        <CampaignSkeletons />
      ) : error ? (
        <CampaignsError message={error} onRetry={refresh} />
      ) : shown.length === 0 ? (
        <NoCampaigns />
      ) : (
        <CampaignMagazine campaigns={shown} />
      )}

      <div className="mt-12 flex justify-center">
        <Link href="/explore" className="harvest-button-light">
          <span>{t("home.campaigns.viewAll")}</span>
          <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
