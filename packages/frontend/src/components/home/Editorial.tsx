"use client";

/**
 * The HARVEST.V2 editorial sections of the home page: the introduction with
 * the showcase figures, the founding quote, the four steps with the honesty
 * note, and the closing call to action.
 */

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Diamond, RotateCcw, TrendingUp, Zap } from "lucide-react";
import { useLocale } from "@/i18n/LocaleProvider";
import { useContent } from "@/i18n/content";
import { tr } from "@/i18n/tr";
import { en } from "@/i18n/en";

const lines = (items: string[]) =>
  items.map((line, i) => (
    <span key={i} className="block">
      {line}
    </span>
  ));

/**
 * A figure that counts up from zero, easing out, the first time it scrolls
 * into view. With reduced motion it shows the final value straight away.
 */
function CountUp({ to, format, duration = 1800 }: { to: number; format: (n: number) => string; duration?: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setValue(to);
      return undefined;
    }
    let frame = 0;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const t = Math.min(1, (now - start) / duration);
          const eased = 1 - Math.pow(1 - t, 3);
          setValue(to * eased);
          if (t < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [to, duration]);

  return <span ref={ref}>{format(value)}</span>;
}

export function HomeIntro() {
  const { t, tList, number, moneyFromTry, percent } = useLocale();
  const { platformStats } = useContent();
  const stats: [number, (n: number) => string, string][] = [
    [platformStats.totalRaised, (n) => `${moneyFromTry(Math.round(n))}+`, t("home.intro.statRaised")],
    [platformStats.activeFarmers, (n) => `${number(Math.round(n), 0)}+`, t("home.intro.statFarmers")],
    [platformStats.activeCampaigns, (n) => `${Math.round(n)}+`, t("home.intro.statCampaigns")],
    [platformStats.successRate, (n) => percent(Math.round(n)), t("home.intro.statRepaid")],
  ];

  return (
    <section id="trust" className="max-w-7xl mx-auto px-5 md:px-8 pt-24 md:pt-32 pb-16">
      <div className="grid md:grid-cols-[1fr_2fr] gap-8 md:gap-12">
        <div className="eyebrow pt-3">{t("home.intro.eyebrow")}</div>
        <div>
          <h2 className="font-display font-normal text-4xl md:text-6xl leading-[1.02] text-harvest-earth">
            {lines(tList("home.intro.title"))}
          </h2>
          <p className="mt-8 max-w-xl text-base leading-7 text-harvest-text">{t("home.intro.body")}</p>
        </div>
      </div>

      <div className="mt-16 grid grid-cols-2 md:grid-cols-[1fr_1fr_1fr_1fr_1.2fr] gap-8 border-t border-harvest-border pt-10">
        {stats.map(([to, format, label]) => (
          <div key={label}>
            <div className="font-display text-3xl lg:text-4xl text-harvest-earth whitespace-nowrap tabular-nums">
              <CountUp to={to} format={format} />
            </div>
            <div className="mt-2 text-xs text-harvest-muted">{label}</div>
          </div>
        ))}
        <p className="col-span-2 md:col-span-1 text-sm font-medium text-harvest-earth">
          {t("home.intro.note")}
          <span className="mt-1 block text-xs font-normal text-harvest-muted">{t("home.intro.noteSub")}</span>
        </p>
      </div>
    </section>
  );
}

export function FoundingQuote() {
  const { t, tList } = useLocale();
  return (
    <section className="bg-[#E8E8DA] py-20 md:py-28">
      <div className="max-w-5xl mx-auto px-5 text-center">
        <div className="eyebrow mb-8">{t("home.quote.eyebrow")}</div>
        <blockquote className="font-display text-4xl md:text-6xl leading-[1.08] text-harvest-earth">
          “{tList("home.quote.text").join(" ")}”
        </blockquote>
        <div className="mt-8 inline-flex items-center gap-4 text-sm text-harvest-text">
          {t("home.quote.signature")}
          <svg viewBox="0 0 60 30" className="h-6 w-12" aria-hidden>
            <path d="M0 25Q15 0 30 15T60 5" fill="none" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
      </div>
    </section>
  );
}

const STEP_ICONS = [Zap, Diamond, TrendingUp, RotateCcw];

export function FourSteps() {
  const { t, locale } = useLocale();
  const items = (locale === "en" ? en : tr).home.steps.items;

  return (
    <section id="how" className="max-w-7xl mx-auto px-5 md:px-8 py-20 md:py-28 scroll-mt-20">
      <div className="grid md:grid-cols-[1fr_auto] gap-6 md:items-end mb-14">
        <div>
          <div className="eyebrow mb-3">{t("home.steps.eyebrow")}</div>
          <h2 className="font-display font-normal text-4xl md:text-6xl leading-none text-harvest-earth">
            {t("home.steps.title")}
          </h2>
        </div>
        <p className="max-w-xs text-sm leading-6 text-harvest-text">{t("home.steps.body")}</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
        {items.map((step, i) => {
          const Icon = STEP_ICONS[i] ?? Zap;
          return (
            <article key={step.title} className="border-t border-harvest-border pt-5 flex flex-col">
              <span className="text-xs text-harvest-muted">{String(i + 1).padStart(2, "0")}</span>
              <Icon className="mt-8 mb-6 h-7 w-7 text-harvest-field" strokeWidth={1.6} />
              <h3 className="text-lg font-semibold text-harvest-earth mb-3">{step.title}</h3>
              <p className="text-sm leading-6 text-harvest-text flex-1">{step.body}</p>
              <span className="mt-6 border-t border-harvest-border pt-3 text-xs text-harvest-earth">{step.tag}</span>
            </article>
          );
        })}
      </div>

      <div className="mt-14 grid md:grid-cols-[1fr_2fr_auto] gap-6 items-start border-t border-harvest-border pt-8">
        <div className="text-sm font-semibold text-harvest-earth">{t("home.honesty.title")}</div>
        <p className="text-sm leading-6 text-harvest-muted max-w-2xl">{t("home.honesty.body")}</p>
        <Link href="/#zk" className="inline-flex items-center gap-1 text-sm font-medium text-harvest-earth underline underline-offset-4 decoration-harvest-gold">
          {t("home.honesty.button")}
          <ArrowUpRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </section>
  );
}

export function Ending() {
  const { t, tList } = useLocale();
  return (
    <section className="bg-harvest-earth text-harvest-cream py-24 md:py-32 text-center">
      <div className="max-w-5xl mx-auto px-5">
        <div className="text-5xl text-harvest-wheat mb-6" aria-hidden>
          ✳
        </div>
        <div className="text-sm text-harvest-cream/80 mb-6">{t("home.ending.eyebrow")}</div>
        <h2 className="font-display font-normal text-6xl md:text-8xl leading-[0.92] text-harvest-cream">
          {lines(tList("home.ending.title"))}
        </h2>
        <div className="mt-12 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/explore" className="harvest-button-cream">
            <span>{t("home.ending.back")}</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <Link href="/create" className="harvest-button border border-harvest-cream/40 text-harvest-cream hover:border-harvest-wheat">
            <span>{t("home.ending.start")}</span>
            <ArrowUpRight className="h-4 w-4" />
          </Link>
        </div>
        <p className="mt-10 text-sm text-harvest-cream/60">{t("home.ending.note")}</p>
      </div>
    </section>
  );
}
