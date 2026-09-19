"use client";

import React, { useEffect, useState } from "react";
import { Coins, ExternalLink, Fingerprint, Landmark, ShieldCheck, Vault, Workflow } from "lucide-react";

import { useLocale } from "@/i18n/LocaleProvider";
import { tr } from "@/i18n/tr";
import { en } from "@/i18n/en";
import { deployments, explorerContract, explorerTx } from "@/lib/chain/deployments";
import { campaignCount, vaultStats } from "@/lib/chain/harvest";
import { shortAddress } from "@/lib/campaigns";

/** The smart-account kit's WebAuthn verifier on testnet (lib/chain/passkey.js). */
const WEBAUTHN_VERIFIER = "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F";

/** One card per Stellar component, in the dictionary's order. */
const CARDS: { icon: React.ElementType; link: { href: string; label: string } | null }[] = [
  { icon: ShieldCheck, link: null },
  { icon: Workflow, link: { href: explorerContract(deployments.campaign), label: deployments.campaign } },
  { icon: Vault, link: { href: explorerContract(deployments.vault), label: deployments.vault } },
  { icon: Coins, link: { href: explorerContract(deployments.usdc), label: deployments.usdc } },
  { icon: Landmark, link: { href: `${deployments.anchor}/.well-known/stellar.toml`, label: "" } },
  { icon: Fingerprint, link: { href: explorerContract(WEBAUTHN_VERIFIER), label: WEBAUTHN_VERIFIER } },
];

/** Transactions from scripts/passkey-e2e.mjs, for a judge who wants to click through. */
const SAMPLE_TXS = [
  "a5c033d1fca1fb1ef3b75e9fa5ab2693204afe6f1a68e2d5704ea78cdccf2fed",
  "bc67187702b850bc60d2b5ae5f9c9bfedbc67ff9de63692ad56c0d8e00a3cb18",
];

export function StellarOnChain() {
  const { t, tList, locale, money, number } = useLocale();
  const items = (locale === "en" ? en : tr).stellar.items;
  const samples = tList("stellar.samples");
  const [live, setLive] = useState<{ campaigns: number; vault: number } | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([campaignCount(), vaultStats()])
      .then(([campaigns, vault]) => {
        if (!cancelled) setLive({ campaigns, vault: vault.managedUsdc });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const stats = [
    { label: t("stellar.liveCampaigns"), value: live ? number(live.campaigns, 0) : "…" },
    { label: t("stellar.liveVault"), value: live ? money(live.vault) : "…" },
    { label: t("stellar.liveNetwork"), value: t("stellar.network") },
  ];

  return (
    <section id="stellar" className="max-w-7xl mx-auto px-4 md:px-6 py-16 scroll-mt-20">
      <div className="max-w-3xl mb-8">
        <div className="text-sm font-semibold text-amber-700 mb-2">{t("stellar.kicker")}</div>
        <h2 className="font-display text-3xl md:text-4xl font-normal text-stone-900 tracking-tight mb-3">{t("stellar.title")}</h2>
        <p className="text-stone-600 leading-relaxed">{t("stellar.subtitle")}</p>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-8 max-w-2xl">
        {stats.map((s) => (
          <div key={s.label} className="bg-white rounded-2xl border border-stone-200 px-4 py-3">
            <div className="text-[11px] text-stone-500">{s.label}</div>
            <div className="text-base md:text-lg font-bold text-stone-900 truncate">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((item, i) => {
          const card = CARDS[i];
          const Icon = card?.icon ?? ShieldCheck;
          return (
            <div key={item.title} className="bg-white rounded-2xl p-6 border border-stone-200 flex flex-col">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5" />
                </div>
                <h3 className="font-bold text-stone-900">{item.title}</h3>
              </div>
              <p className="text-sm text-stone-600 leading-relaxed mb-4 flex-1">{item.body}</p>
              <div className="text-[11px] font-mono text-emerald-800 bg-emerald-50 border border-emerald-100 rounded-lg px-2.5 py-1.5 mb-3">
                {item.tech}
              </div>
              {card?.link && (
                <a
                  href={card.link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 hover:text-amber-800"
                >
                  <span className="font-mono">
                    {card.link.label ? shortAddress(card.link.label) : t("stellar.openAnchor")}
                  </span>
                  {card.link.label && <span className="text-stone-400">· {t("stellar.open")}</span>}
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-6 bg-stone-50 border border-stone-200 rounded-2xl p-5">
        <div className="text-sm font-semibold text-stone-900 mb-2">{t("stellar.samplesTitle")}</div>
        <ul className="space-y-1.5">
          {SAMPLE_TXS.map((hash, i) => (
            <li key={hash}>
              <a
                href={explorerTx(hash)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex flex-wrap items-center gap-1.5 text-xs text-stone-700 hover:text-amber-800"
              >
                <span>{samples[i]}</span>
                <span className="font-mono text-stone-400">{hash.slice(0, 10)}…</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
