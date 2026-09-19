"use client";

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

import { tr, type Dict } from "@/i18n/tr";
import { en } from "@/i18n/en";
import { setRuntimeLocale } from "@/i18n/runtime";

export type Locale = "tr" | "en";
/**
 * Display currency. Everything on chain is USDC; USD is shown 1:1 and lira
 * through the TR anchor's live USDC/TRY mid rate.
 */
export type Currency = "USDC" | "USD" | "TRY";

const DICTS: Record<Locale, Dict> = { tr, en };
const LOCALE_KEY = "harvest.locale";
const CURRENCY_KEY = "harvest.currency";
/** Public, CORS-open, no login: the anchor's own health report carries its rate. */
const RATE_URL = "https://tr-mock-anchor.fly.dev/health";

type Vars = Record<string, string | number>;

interface LocaleContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  currency: Currency;
  setCurrency: (c: Currency) => void;
  /** Lira per USDC from the anchor, or null until it has answered. */
  tryPerUsdc: number | null;
  /** Translate a dotted key; `{name}` placeholders are filled from `vars`. */
  t: (key: string, vars?: Vars) => string;
  /** A translated list (arrays in the dictionary). */
  tList: (key: string) => string[];
  number: (n: number, digits?: number) => string;
  /** A USDC amount in the chosen display currency. */
  money: (usdc: number, digits?: number) => string;
  /** A lira amount in the chosen display currency. */
  moneyFromTry: (lira: number) => string;
  date: (unixSeconds: number) => string;
  /** "%15" in Turkish, "15%" in English. */
  percent: (n: number) => string;
}

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used inside <LocaleProvider>");
  return ctx;
}

function lookup(dict: Dict, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (node && typeof node === "object") return (node as Record<string, unknown>)[part];
    return undefined;
  }, dict);
}

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* private mode: the choice lasts for this visit */
  }
};

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [currency, setCurrencyState] = useState<Currency>("USDC");
  const [tryPerUsdc, setTryPerUsdc] = useState<number | null>(null);

  // English by default; a stored choice overrides it.
  //
  // The browser's own language used to decide, which read well until you were
  // demonstrating the English copy on a Turkish laptop and it kept switching
  // back. The toggle in the header is the way in, and it persists.
  useEffect(() => {
    const stored = read(LOCALE_KEY);
    const initial: Locale = stored === "tr" || stored === "en" ? stored : "en";
    setLocaleState(initial);
    const storedCurrency = read(CURRENCY_KEY);
    if (storedCurrency === "USDC" || storedCurrency === "USD" || storedCurrency === "TRY") {
      setCurrencyState(storedCurrency);
    }
  }, []);

  useEffect(() => {
    setRuntimeLocale(locale);
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    fetch(RATE_URL)
      .then((r) => r.json())
      .then((h) => {
        const rate = Number(h?.rates?.mid_rate);
        if (!cancelled && rate > 0) setTryPerUsdc(rate);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    write(LOCALE_KEY, l);
  }, []);

  const setCurrency = useCallback((c: Currency) => {
    setCurrencyState(c);
    write(CURRENCY_KEY, c);
  }, []);

  const value = useMemo<LocaleContextValue>(() => {
    const intl = locale === "tr" ? "tr-TR" : "en-US";
    const number = (n: number, digits = 2) =>
      new Intl.NumberFormat(intl, { maximumFractionDigits: digits }).format(n);

    const t = (key: string, vars?: Vars) => {
      const hit = lookup(DICTS[locale], key) ?? lookup(tr, key);
      let text = typeof hit === "string" ? hit : key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) text = text.split(`{${k}}`).join(String(v));
      }
      return text;
    };

    const tList = (key: string) => {
      const hit = lookup(DICTS[locale], key) ?? lookup(tr, key);
      return Array.isArray(hit) ? (hit as string[]) : [];
    };

    const money = (usdc: number, digits = 2) => {
      if (currency === "USD") return `$${number(usdc, digits)}`;
      if (currency === "TRY" && tryPerUsdc) return `₺${number(usdc * tryPerUsdc, 0)}`;
      return `${number(usdc, digits)} USDC`;
    };

    const moneyFromTry = (lira: number) => {
      if (currency === "TRY" || !tryPerUsdc) return `₺${number(lira, 0)}`;
      const usdc = lira / tryPerUsdc;
      return currency === "USD" ? `$${number(usdc, 0)}` : `${number(usdc, 0)} USDC`;
    };

    const date = (unixSeconds: number) =>
      new Date(unixSeconds * 1000).toLocaleDateString(intl, { day: "numeric", month: "long", year: "numeric" });

    const percent = (n: number) => (locale === "tr" ? `%${number(n, 2)}` : `${number(n, 2)}%`);
    return { locale, setLocale, currency, setCurrency, tryPerUsdc, t, tList, number, money, moneyFromTry, date, percent };
  }, [locale, currency, tryPerUsdc, setLocale, setCurrency]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
