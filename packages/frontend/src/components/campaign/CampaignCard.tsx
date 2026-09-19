"use client";

import React from "react";
import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import type { CampaignView } from "@/lib/campaigns";
import { useLocale } from "@/i18n/LocaleProvider";
import { useCampaignText } from "@/i18n/campaign";

interface CampaignCardProps {
  campaign: CampaignView;
  /** "feature": the large card of a magazine block, with a short description. */
  variant?: "feature" | "compact";
}

/** A campaign card in the HARVEST.V2 editorial style. */
export function CampaignCard({ campaign, variant = "compact" }: CampaignCardProps) {
  const { t, money, percent } = useLocale();
  const ct = useCampaignText();
  const title = ct.title(campaign);
  const feature = variant === "feature";

  return (
    <Link href={`/kampanya/${campaign.id}`} className="group flex h-full flex-col">
      <div
        className={`relative overflow-hidden rounded-2xl bg-harvest-earth ${
          feature ? "aspect-[4/3] md:aspect-auto md:flex-1 md:min-h-[26rem]" : "aspect-[16/10]"
        }`}
      >
        <img
          src={campaign.cover}
          alt={title}
          loading="lazy"
          className="absolute inset-0 h-full w-full object-cover transition duration-700 group-hover:scale-[1.04]"
        />
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-harvest-paper/92 px-3 py-1.5 text-xs font-semibold text-harvest-earth backdrop-blur-sm">
          <Check className="h-3.5 w-3.5 text-harvest-success" />
          {t("home.campaigns.verified")}
        </span>
        <span className="absolute bottom-4 left-4 text-xs font-semibold text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)]">
          {ct.region(campaign)}
        </span>
      </div>

      <div className="pt-4">
        <div className="mb-2 flex items-center justify-between gap-3 text-xs text-harvest-muted">
          <span>{ct.season(campaign)}</span>
          <span className="inline-flex items-center gap-1 font-medium text-harvest-text">
            <span aria-hidden>{campaign.productIcon}</span>
            {ct.product(campaign)}
          </span>
        </div>
        <h3
          className={`font-display font-normal leading-tight text-harvest-earth group-hover:text-harvest-field transition-colors ${
            feature ? "text-3xl md:text-4xl" : "text-2xl"
          }`}
        >
          {title}
        </h3>
        {feature && (
          <p className="mt-3 max-w-xl text-sm leading-6 text-harvest-text">
            {t("card.zkThreshold")} {ct.threshold(campaign)} · {t("card.return")} {percent(campaign.returnPercent)}
          </p>
        )}

        <div className="mt-4 h-[3px] overflow-hidden rounded-full bg-harvest-border">
          <div className="h-full rounded-full bg-harvest-field transition-all duration-500" style={{ width: `${campaign.percent}%` }} />
        </div>
        <div className="mt-3 flex items-center justify-between gap-3 text-sm">
          <span className="text-harvest-muted">
            <b className="font-semibold text-harvest-earth">{money(campaign.raised)}</b>{" "}
            {t("home.campaigns.of", { goal: money(campaign.target) })}
          </span>
          <span className="text-xs text-harvest-muted">
            {campaign.isOpen ? ct.daysLeft(campaign) : ct.status(campaign)}
          </span>
        </div>
        <div className="mt-4 flex items-center justify-between border-t border-harvest-border pt-3 text-sm font-medium text-harvest-earth">
          <span>{t("home.campaigns.discover")}</span>
          <ArrowUpRight className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
        </div>
      </div>
    </Link>
  );
}

/**
 * Campaigns in magazine blocks of three: one large card beside two stacked
 * ones, alternating sides so a long list still has rhythm.
 */
export function CampaignMagazine({ campaigns }: { campaigns: CampaignView[] }) {
  const blocks: CampaignView[][] = [];
  for (let i = 0; i < campaigns.length; i += 3) blocks.push(campaigns.slice(i, i + 3));

  return (
    <div data-testid="campaign-list" data-count={campaigns.length} className="space-y-14">
      {blocks.map((block, b) => {
        const [lead, ...rest] = block;
        const flip = b % 2 === 1;
        return (
          <div
            key={lead.id}
            className={`grid gap-8 ${rest.length ? (flip ? "md:grid-cols-[1fr_1.45fr]" : "md:grid-cols-[1.45fr_1fr]") : ""}`}
          >
            <div className={flip ? "md:order-2" : ""}>
              <CampaignCard campaign={lead} variant="feature" />
            </div>
            {rest.length > 0 && (
              <div className={`grid gap-8 ${flip ? "md:order-1" : ""}`}>
                {rest.map((c) => (
                  <CampaignCard key={c.id} campaign={c} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
