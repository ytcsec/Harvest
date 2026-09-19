"use client";

import React, { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Menu, X } from "lucide-react";
import { SealLogo } from "@/components/ui/SealLogo";
import { useWallet } from "@/components/wallet/WalletProvider";
import { useLocale, type Currency, type Locale } from "@/i18n/LocaleProvider";
import { shortAddress } from "@/lib/campaigns";

/** Language and display-currency pickers. */
function PreferencePicker() {
  const { locale, setLocale, currency, setCurrency, t } = useLocale();
  return (
    <div className="flex items-center gap-1.5 shrink-0">
      <div className="flex rounded-full border border-harvest-border bg-harvest-paper p-0.5" role="group" aria-label={t("settings.language")}>
        {(["tr", "en"] as Locale[]).map((l) => (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={locale === l}
            className={`h-8 px-2.5 rounded-full text-xs font-semibold uppercase transition-colors ${
              locale === l ? "bg-harvest-earth text-harvest-cream" : "text-harvest-muted hover:text-harvest-earth"
            }`}
          >
            {l}
          </button>
        ))}
      </div>
      <select
        value={currency}
        onChange={(e) => setCurrency(e.target.value as Currency)}
        aria-label={t("settings.currency")}
        title={t("settings.currencyHint")}
        className="h-9 rounded-full border border-harvest-border bg-harvest-paper px-2.5 text-xs font-semibold text-harvest-earth focus:outline-none focus:ring-2 focus:ring-harvest-wheat"
      >
        <option value="USDC">USDC</option>
        <option value="USD">USD $</option>
        <option value="TRY">TL ₺</option>
      </select>
    </div>
  );
}

/** "Sign in" until a wallet exists; then the address and balance. */
function WalletButton({ fullWidth = false, onOpen }: { fullWidth?: boolean; onOpen?: () => void }) {
  const { wallet, ready, balances, onTestnet, openWallet } = useWallet();
  const { t, money } = useLocale();
  const open = () => {
    onOpen?.();
    openWallet();
  };

  if (!ready) {
    return <div className={`h-10 rounded-full bg-harvest-border/60 ${fullWidth ? "w-full" : "w-24"}`} aria-hidden />;
  }

  if (!wallet) {
    return (
      <button
        type="button"
        data-testid="wallet-button"
        onClick={open}
        className={`h-10 px-4 rounded-full border border-harvest-border bg-harvest-paper text-sm font-semibold text-harvest-earth hover:border-harvest-gold transition-colors ${fullWidth ? "w-full" : ""}`}
      >
        {t("nav.login")}
      </button>
    );
  }

  // Wheat until the account can actually transact: right network, funded,
  // USDC trustline open.
  const attention =
    onTestnet === false || (balances.known && (!balances.exists || balances.usdc === null));
  const amount = balances.usdc === null ? "—" : money(balances.usdc);

  return (
    <button
      type="button"
      data-testid="wallet-button"
      data-wallet-address={wallet.address}
      onClick={open}
      aria-label={
        t("nav.walletLabel", { address: shortAddress(wallet.address), amount }) +
        (attention ? t("nav.setupNeeded") : "")
      }
      className={`h-10 px-3 rounded-full border border-harvest-border bg-harvest-paper hover:border-harvest-gold inline-flex items-center gap-2 text-sm transition-colors ${fullWidth ? "w-full justify-center" : ""}`}
    >
      <span
        className={`w-2 h-2 rounded-full ${attention ? "bg-harvest-gold" : "bg-harvest-success"}`}
        aria-hidden
      />
      <span className="font-mono text-xs text-harvest-text">{shortAddress(wallet.address)}</span>
      <span className="font-semibold text-harvest-earth">{amount}</span>
    </button>
  );
}

export function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const { t } = useLocale();

  const links = [
    { href: "/explore", label: t("nav.campaigns") },
    { href: "/kayit", label: t("enrol.navLink") },
    { href: "/#how", label: t("nav.how") },
    { href: "/#zk", label: t("nav.zk") },
    { href: "/#stellar", label: t("nav.stellar") },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-harvest-border bg-harvest-paper/85 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center gap-4 lg:gap-6">
        <Link href="/" className="flex items-center gap-2.5 shrink-0" aria-label="HARVEST">
          <SealLogo className="w-9 h-9" />
          <span className="font-bold text-lg tracking-tight text-harvest-earth">HARVEST</span>
        </Link>

        <nav className="hidden xl:flex items-center gap-6 text-sm font-medium text-harvest-text mx-auto">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="hover:text-harvest-earth transition-colors whitespace-nowrap">
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2 shrink-0 ml-auto xl:ml-0">
          <PreferencePicker />
          <WalletButton />
          <Link href="/create" className="harvest-button-dark h-10 px-5 whitespace-nowrap">
            <span>{t("nav.start")}</span>
            <ArrowUpRight className="w-4 h-4" />
          </Link>
        </div>

        <button
          className="xl:hidden ml-auto md:ml-0 p-2 rounded-full border border-harvest-border bg-harvest-paper text-harvest-earth"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={t("nav.menu")}
          aria-expanded={isOpen}
        >
          {isOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {isOpen && (
        <div className="xl:hidden border-t border-harvest-border bg-harvest-paper px-4 md:px-8 py-4 space-y-3">
          <nav className="flex flex-col space-y-1 text-harvest-earth font-medium">
            {links.map((l) => (
              <Link key={l.href} href={l.href} onClick={() => setIsOpen(false)} className="py-2">
                {l.label}
              </Link>
            ))}
          </nav>
          <div className="md:hidden">
            <PreferencePicker />
          </div>
          <div className="pt-2 flex flex-col gap-2 md:hidden">
            <WalletButton fullWidth onOpen={() => setIsOpen(false)} />
            <Link href="/create" onClick={() => setIsOpen(false)} className="harvest-button-dark w-full">
              <span>{t("nav.start")}</span>
              <ArrowUpRight className="w-4 h-4" />
            </Link>
          </div>
        </div>
      )}
    </header>
  );
}
