"use client";

import React from "react";
import Link from "next/link";
import { SealLogo } from "@/components/ui/SealLogo";
import { deployments, explorerContract } from "@/lib/chain/deployments";
import { useLocale } from "@/i18n/LocaleProvider";

export function Footer() {
  const { t } = useLocale();
  const linkClass = "text-harvest-text hover:text-harvest-earth transition-colors";
  return (
    <footer className="bg-[#EFEADB] border-t border-harvest-border text-harvest-text">
      <div className="max-w-7xl mx-auto px-5 md:px-8 py-14">
        <div className="grid grid-cols-2 md:grid-cols-[1.4fr_1fr_1fr] gap-8">
          <div className="col-span-2 md:col-span-1">
            <div className="flex items-center gap-3 mb-4">
              <SealLogo className="w-10 h-10" />
              <span className="font-bold text-lg tracking-tight text-harvest-earth">HARVEST</span>
            </div>
            <p className="text-sm text-harvest-text max-w-md leading-6">{t("footer.tagline")}</p>
          </div>

          <div className="text-sm">
            <div className="font-semibold text-harvest-earth mb-3">{t("footer.platform")}</div>
            <ul className="space-y-2">
              <li>
                <Link href="/explore" className={linkClass}>
                  {t("nav.campaigns")}
                </Link>
              </li>
              <li>
                <Link href="/#how" className={linkClass}>
                  {t("nav.how")}
                </Link>
              </li>
              <li>
                <Link href="/#zk" className={linkClass}>
                  {t("nav.zk")}
                </Link>
              </li>
              <li>
                <Link href="/#stellar" className={linkClass}>
                  {t("nav.stellar")}
                </Link>
              </li>
              <li>
                <Link href="/#faq" className={linkClass}>
                  {t("footer.faq")}
                </Link>
              </li>
            </ul>
          </div>

          <div className="text-sm">
            <div className="font-semibold text-harvest-earth mb-3">{t("footer.onchain")}</div>
            <ul className="space-y-2">
              {[
                [t("footer.campaignContract"), explorerContract(deployments.campaign)],
                [t("footer.vault"), explorerContract(deployments.vault)],
                [t("footer.anchor"), deployments.anchor],
              ].map(([label, href]) => (
                <li key={label}>
                  <a href={href} target="_blank" rel="noreferrer" className={linkClass}>
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>

        <div className="border-t border-harvest-border mt-12 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-harvest-muted">
          <div>{t("footer.copyright")}</div>
          <div>{t("footer.rights")}</div>
        </div>
      </div>
    </footer>
  );
}
