"use client";

import React, { useState, useMemo, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { ExternalLink, Search, SlidersHorizontal } from "lucide-react";
import { CampaignMagazine } from "@/components/campaign/CampaignCard";
import { cropName, regionName } from "@/lib/crop-names";
import { CampaignSkeletons, CampaignsError, NoCampaigns } from "@/components/campaign/CampaignStates";
import { useCampaigns, useVaultStats } from "@/lib/chain/hooks";
import { deployments, explorerContract } from "@/lib/chain/deployments";
import { useLocale } from "@/i18n/LocaleProvider";

/** Live figures from the DeFindex vault that holds every campaign's escrow. */
function VaultStrip() {
  const stats = useVaultStats();
  const { t, money } = useLocale();
  const items = [
    [t("explore.vaultManaged"), stats ? money(stats.managedUsdc) : "—"],
    [t("explore.vaultInvested"), stats ? money(stats.investedUsdc) : "—"],
    [t("explore.vaultShare"), stats ? `${stats.pricePerShare.toFixed(4)} USDC` : "—"],
  ];
  return (
    <div data-testid="vault-strip" data-loaded={stats ? "true" : "false"} className="mt-6 flex flex-wrap items-center gap-2 text-xs">
      {items.map(([label, value]) => (
        <div key={label} className="bg-white/80 border border-stone-200 rounded-full px-3.5 py-1.5">
          <span className="text-stone-500">{label}: </span>
          <span className="font-semibold text-stone-900">{value}</span>
        </div>
      ))}
      <a
        href={explorerContract(deployments.vault)}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-amber-700 font-semibold hover:text-amber-800 px-2"
      >
        <span>{t("explore.vaultLink")}</span>
        <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

function ExploreContent() {
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get("q") || "";
  const initialCategory = searchParams.get("category") || "all";

  const { campaigns, loading, error, refresh } = useCampaigns();
  const { t, locale } = useLocale();
  const [search, setSearch] = useState(initialQuery);
  const [selectedProduct, setSelectedProduct] = useState(initialCategory);
  const [sortOption, setSortOption] = useState<"trending" | "ending" | "newest" | "target">("trending");
  // Active by default; repaid and refunded campaigns stay reachable as track record.
  const [statusView, setStatusView] = useState<"active" | "done">("active");
  const activeCount = campaigns.filter((c) => c.isOpen).length;
  const doneCount = campaigns.length - activeCount;

  const products = ["all", ...Array.from(new Set(campaigns.map((c) => c.product)))];

  const filteredCampaigns = useMemo(() => {
    let result = campaigns.filter((c) => (statusView === "active" ? c.isOpen : !c.isOpen));

    // Search filter
    if (search.trim()) {
      const q = search.toLocaleLowerCase("tr");
      result = result.filter((c) =>
        [c.title, c.region, c.crop, c.product, c.productEn, c.farmer, cropName(c.crop, "tr"), cropName(c.crop, "en"), regionName(c.region, "tr"), regionName(c.region, "en")].some((field) =>
          field.toLocaleLowerCase("tr").includes(q),
        ),
      );
    }

    // Product category filter
    if (selectedProduct !== "all") {
      result = result.filter(
        (c) => c.product.toLocaleLowerCase("tr") === selectedProduct.toLocaleLowerCase("tr"),
      );
    }

    // Sorting. The list arrives newest first.
    if (sortOption === "trending") {
      result.sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || b.raised - a.raised);
    } else if (sortOption === "ending") {
      result.sort((a, b) => Number(b.isOpen) - Number(a.isOpen) || a.deadline - b.deadline);
    } else if (sortOption === "newest") {
      result.sort((a, b) => b.id - a.id);
    } else if (sortOption === "target") {
      result.sort((a, b) => b.target - a.target);
    }

    return result;
  }, [campaigns, search, selectedProduct, sortOption, statusView]);

  return (
    <div className="min-h-screen">
      {/* Header Banner */}
      <section className="border-b border-harvest-border pt-16 pb-12 md:pt-24">
        <div className="max-w-7xl mx-auto px-5 md:px-8">
          <div className="max-w-3xl mb-10">
            <div className="eyebrow mb-3">{t("home.campaigns.eyebrow")}</div>
            <h1 className="font-display text-5xl md:text-7xl leading-none font-normal text-harvest-earth mb-5">
              {statusView === "active" ? t("explore.titleActive") : t("explore.titleDone")}
            </h1>
            <p className="text-stone-600 text-base md:text-lg">
              {t("explore.subtitle")}
            </p>
          </div>

          {/* Search bar inside header */}
          <div className="relative max-w-xl">
            <Search className="w-5 h-5 text-stone-400 absolute left-4 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("explore.search")}
              className="w-full h-12 pl-12 pr-4 rounded-full bg-harvest-paper border border-harvest-border focus:border-harvest-gold focus:outline-none text-sm text-harvest-earth placeholder:text-harvest-muted"
            />
          </div>

          <VaultStrip />
        </div>
      </section>

      {/* Filter Bar & Grid */}
      <section className="max-w-7xl mx-auto px-5 md:px-8 py-10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 pb-6 border-b border-stone-200">
          {/* Active / completed */}
          <div className="flex gap-1 p-1 rounded-full border border-harvest-border bg-harvest-paper w-fit">
            {(
              [
                ["active", t("explore.tabActive", { n: activeCount })],
                ["done", t("explore.tabDone", { n: doneCount })],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusView(id)}
                className={`px-4 py-1.5 rounded-full text-xs font-semibold transition-colors ${
                  statusView === id ? "bg-harvest-earth text-harvest-cream" : "text-stone-500 hover:text-stone-900"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Category Pills */}
          <div className="flex flex-wrap gap-2">
            {products.map((p) => {
              const isActive = selectedProduct.toLocaleLowerCase("tr") === p.toLocaleLowerCase("tr");
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setSelectedProduct(p)}
                  className={`h-9 px-4 rounded-full border text-xs font-medium transition-colors ${
                    isActive
                      ? "bg-harvest-earth border-harvest-earth text-harvest-cream"
                      : "bg-harvest-paper/60 border-harvest-border text-harvest-earth hover:border-harvest-gold"
                  }`}
                >
                  {p === "all" ? t("explore.all") : locale === "en" ? (campaigns.find((c) => c.product === p)?.productEn ?? p) : p}
                </button>
              );
            })}
          </div>

          {/* Sorting Buttons */}
          <div className="flex items-center gap-2 text-xs">
            <SlidersHorizontal className="w-4 h-4 text-stone-400 mr-1 shrink-0" />
            <span className="text-stone-500 font-medium hidden sm:inline">{t("explore.sortLabel")}</span>
            {(
              [
                { id: "trending", label: t("explore.sortTrending") },
                { id: "ending", label: t("explore.sortEnding") },
                { id: "newest", label: t("explore.sortNewest") },
                { id: "target", label: t("explore.sortTarget") },
              ] as const
            ).map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setSortOption(s.id)}
                className={`px-3 py-1.5 rounded-xl font-medium transition-colors ${
                  sortOption === s.id
                    ? "bg-stone-900 text-white"
                    : "text-stone-600 hover:bg-stone-200/60"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* Campaign Cards */}
        {loading ? (
          <CampaignSkeletons count={6} />
        ) : error ? (
          <CampaignsError message={error} onRetry={refresh} />
        ) : campaigns.length === 0 ? (
          <NoCampaigns />
        ) : filteredCampaigns.length > 0 ? (
          <CampaignMagazine campaigns={filteredCampaigns} />
        ) : (
          <div className="text-center py-20 rounded-3xl border border-harvest-border bg-harvest-paper p-8">
            <p className="text-stone-500 text-base mb-4">
              {t("explore.noMatch")}
            </p>
            <button
              onClick={() => {
                setSearch("");
                setSelectedProduct("all");
                setSortOption("trending");
              }}
              className="px-5 py-2.5 bg-amber-600 text-white rounded-full text-sm font-semibold hover:bg-amber-700 transition-colors"
            >
              {t("explore.clearFilters")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

export default function ExplorePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-harvest-cream py-20 text-center text-stone-500">…</div>}>
      <ExploreContent />
    </Suspense>
  );
}
