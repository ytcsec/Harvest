"use client";

import Link from "next/link";
import { ArrowDown, ArrowUpRight, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocale } from "@/i18n/LocaleProvider";

/**
 * The HARVEST.V2 opening: a wheat field drawn on a canvas that, as the page
 * scrolls, is harvested into a seal and then a verified proof. Ported from
 * the design's own React version; the copy comes from the dictionaries.
 */

type Stalk = {
  x: number;
  z: number;
  lean: number;
  h: number;
  hue: number;
};

function makeStalks() {
  let seed = 49;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  return Array.from({ length: 460 }, () => ({
    x: rnd(),
    z: rnd(),
    lean: rnd() - 0.5,
    h: rnd(),
    hue: rnd(),
  })).sort((a, b) => a.z - b.z);
}

const stalks = makeStalks();

export function HeroJourney() {
  const { t, tList } = useLocale();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sectionRef = useRef<HTMLElement | null>(null);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    const section = sectionRef.current;
    if (!canvas || !section) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let activeProgress = 0;
    let pending = false;

    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    const smooth = (start: number, end: number, value: number) => {
      const t = clamp((value - start) / (end - start));
      return t * t * (3 - 2 * t);
    };

    const wheat = (x: number, y: number, stalkHeight: number, bend: number, color: string, alpha: number, scale = 1) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.quadraticCurveTo(bend * 0.3, -stalkHeight * 0.5, bend, -stalkHeight);
      ctx.stroke();
      ctx.translate(bend, -stalkHeight);
      ctx.rotate((bend / stalkHeight) * 0.65);
      for (let row = 0; row < 7; row += 1) {
        for (const side of [-1, 1]) {
          const yy = row * 5;
          ctx.save();
          ctx.translate(side * 2, yy);
          ctx.rotate(side * 0.63);
          ctx.beginPath();
          ctx.ellipse(side * 2, -3, 2.5, 6.2, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.moveTo(side * 2, -8);
          ctx.lineTo(side * 3, -23 + yy * 0.15);
          ctx.lineWidth = 0.5;
          ctx.stroke();
          ctx.restore();
        }
      }
      ctx.restore();
    };

    const draw = () => {
      pending = false;
      const p = reduced.matches ? 0.74 : activeProgress;
      ctx.clearRect(0, 0, width, height);
      const bg = ctx.createLinearGradient(0, 0, width, height);
      bg.addColorStop(0, "#263120");
      bg.addColorStop(0.62, "#303922");
      bg.addColorStop(1, "#778054");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, width, height);

      const fieldFade = 1 - smooth(0.32, 0.64, p);
      if (fieldFade > 0) {
        ctx.save();
        ctx.globalAlpha = fieldFade;
        const light = ctx.createRadialGradient(width * 0.86, height * 0.42, 0, width * 0.75, height * 0.6, width * 0.54);
        light.addColorStop(0, "#c9bb7048");
        light.addColorStop(1, "#7d864000");
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, width, height);
        stalks.forEach((stalk) => {
          const z = stalk.z;
          const x = stalk.x * width * 1.25 - width * 0.12;
          const y = height * 0.66 + z * height * 0.44 + smooth(0.26, 0.5, p) * height * 0.55;
          const scale = 0.22 + z * 1.1;
          const stalkHeight = (120 + stalk.h * 105) * (1 + smooth(0.02, 0.22, p) * 0.25);
          const bend = stalk.lean * 40 + Math.sin(stalk.x * 10 + p * 11 + z * 3) * 14 + p * 20;
          const color = `hsl(${48 + stalk.hue * 10 - smooth(0, 0.25, p) * 9}, ${30 + z * 16}%, ${26 + z * 30 + stalk.hue * 10 + smooth(0, 0.25, p) * 8}%)`;
          wheat(x, y, stalkHeight, bend, color, 0.24 + z * 0.72, scale);
        });
        const shade = ctx.createLinearGradient(0, 0, width, 0);
        shade.addColorStop(0, "#15201460");
        shade.addColorStop(0.58, "#15201412");
        shade.addColorStop(1, "#15201400");
        ctx.fillStyle = shade;
        ctx.fillRect(0, 0, width, height);
        ctx.restore();
      }

      const proof = smooth(0.28, 0.64, p);
      if (proof > 0) {
        ctx.fillStyle = `rgba(19, 29, 20, ${proof})`;
        ctx.fillRect(0, 0, width, height);
        const cx = width < 760 ? width * 0.5 : width * 0.74;
        const cy = height * (width < 760 ? 0.56 : 0.43);
        const radius = Math.min(width * 0.19, 156);
        ctx.save();
        ctx.globalAlpha = proof;
        for (let i = 0; i < 90; i += 1) {
          const a = i * 2.399963;
          const t = i / 90;
          const r = (radius * 1.2 + Math.sqrt(t) * radius * 1.65) * (1 - smooth(0.5, 0.88, p) * 0.4);
          const x = cx + Math.cos(a + p * 2) * r;
          const y = cy + Math.sin(a + p * 2) * r * 0.85;
          ctx.fillStyle = "#b9b485";
          ctx.globalAlpha = proof * (0.08 + (i % 4) * 0.025);
          ctx.fillRect(x, y, 12 + (i % 5) * 4, 3);
          ctx.fillRect(x + 4, y + 7, 17, 3);
        }
        ctx.globalAlpha = proof;
        for (let i = 0; i < 3; i += 1) {
          ctx.strokeStyle = i === 0 ? "#dfc27999" : "#dfc27944";
          ctx.lineWidth = i === 0 ? 1.5 : 0.7;
          ctx.beginPath();
          ctx.arc(cx, cy, radius + i * 9, 0, Math.PI * 2);
          ctx.stroke();
        }
        for (let k = 0; k < 12; k += 1) {
          const a = (k * Math.PI) / 6;
          const rr = radius + 27;
          ctx.strokeStyle = "#d9c17a55";
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
          ctx.lineTo(cx + Math.cos(a) * (rr + 18), cy + Math.sin(a) * (rr + 18));
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx + Math.cos(a) * (rr + 18), cy + Math.sin(a) * (rr + 18), 2.2, 0, Math.PI * 2);
          ctx.fillStyle = k / 12 < smooth(0.6, 0.95, p) ? "#ddbd72" : "#46513a";
          ctx.fill();
        }
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate((1 - proof) * 2);
        wheat(0, 47, 72, 0, "#dfc279", 1, 1.25);
        ctx.restore();
        ctx.restore();
      }
    };

    const schedule = () => {
      if (!pending) {
        pending = true;
        requestAnimationFrame(draw);
      }
    };

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      update();
    };

    const update = () => {
      const rect = section.getBoundingClientRect();
      activeProgress = clamp(-rect.top / Math.max(1, rect.height - window.innerHeight));
      setProgress(activeProgress);
      if (rect.bottom >= 0 && rect.top <= window.innerHeight) schedule();
    };

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", resize);
    reduced.addEventListener("change", resize);
    resize();

    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", resize);
      reduced.removeEventListener("change", resize);
    };
  }, []);

  const heroOpacity = 1 - Math.min(1, Math.max(0, (progress - 0.1) / 0.26));
  const proofOpacity = Math.min(1, Math.max(0, (progress - 0.34) / 0.22));
  const resultOpacity = Math.min(1, Math.max(0, (progress - 0.7) / 0.18));
  const footerOpacity = 1 - Math.min(1, Math.max(0, (progress - 0.05) / 0.11));
  const stages = tList("home.journey.stages");
  const stage = progress < 0.32 ? stages[0] : progress < 0.72 ? stages[1] : stages[2];
  const title = tList("home.journey.title");
  const proofTitle = tList("home.journey.proofTitle");

  return (
    <section
      ref={sectionRef}
      className="relative h-[310svh] bg-harvest-earth text-harvest-cream"
      aria-label={t("home.journey.aria")}
    >
      <div className="sticky top-16 h-[calc(100svh-4rem)] overflow-hidden">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" aria-hidden="true" />
        <div className="absolute inset-0 bg-gradient-to-r from-harvest-earth/55 via-harvest-earth/18 to-transparent" />

        <div
          className="max-w-7xl mx-auto px-5 md:px-8 relative flex h-full items-center"
          style={{ opacity: heroOpacity, transform: `translateY(${-progress * 120}px)`, visibility: heroOpacity === 0 ? "hidden" : "visible" }}
        >
          <div className="max-w-3xl pb-10">
            <p className="mb-6 inline-flex items-center gap-2 text-sm font-medium text-harvest-cream/90">
              <span className="text-harvest-wheat">✳</span>
              {t("home.journey.eyebrow")}
            </p>
            <h1 className="font-display font-normal text-[3rem] leading-[0.92] text-harvest-cream sm:text-[4.2rem] md:text-[5.2rem] lg:text-[6rem]">
              {title.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </h1>
            <div className="mt-8 flex flex-col gap-5 md:flex-row md:items-end">
              <p className="max-w-md text-base leading-7 text-harvest-cream/80">{t("home.journey.body")}</p>
              <Link href="#campaigns" className="harvest-button-cream shrink-0 self-start md:self-auto">
                <span>{t("home.journey.cta")}</span>
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        </div>

        <div
          className="pointer-events-none absolute right-[8%] top-[42%] hidden items-start gap-3 text-sm font-semibold leading-5 text-harvest-cream/85 md:flex"
          style={{ opacity: heroOpacity }}
        >
          <span className="text-2xl leading-none text-harvest-wheat">+</span>
          <span className="max-w-[10rem]">{t("home.journey.caption")}</span>
        </div>

        <div
          id="proof"
          className="max-w-7xl mx-auto px-5 md:px-8 pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2"
          style={{ opacity: proofOpacity }}
        >
          <div className="max-w-xl">
            <p className="mb-4 text-sm font-semibold text-harvest-wheat">{t("home.journey.proofEyebrow")}</p>
            <h2 className="font-display font-normal text-5xl leading-none text-white md:text-7xl">
              {proofTitle.map((line, i) => (
                <span key={i} className="block">
                  {line}
                </span>
              ))}
            </h2>
            <p className="mt-5 text-lg leading-8 text-harvest-cream/76">{t("home.journey.proofBody")}</p>
            <div
              className="mt-8 inline-flex items-start gap-3 rounded-[1.1rem] border border-harvest-wheat/30 bg-harvest-earth/72 p-4 text-sm shadow-harvest backdrop-blur"
              style={{ opacity: resultOpacity }}
            >
              <ShieldCheck className="mt-0.5 h-5 w-5 text-harvest-wheat" />
              <div>
                <p className="text-[11px] uppercase tracking-wide text-harvest-wheat/80">{t("home.journey.resultEyebrow")}</p>
                <p className="font-semibold text-white">{t("home.journey.resultTitle")}</p>
                <p className="text-harvest-cream/62">{t("home.journey.resultNote")}</p>
              </div>
            </div>
          </div>
        </div>

        <div
          className="max-w-7xl mx-auto px-5 md:px-8 absolute bottom-6 left-0 right-0 hidden sm:flex items-center justify-between gap-4 text-xs font-medium text-harvest-cream/75"
          style={{ opacity: footerOpacity }}
        >
          <span>{t("home.journey.tagline")}</span>
          <Link href="#campaigns" className="inline-flex items-center gap-2">
            {t("home.journey.scroll")} <ArrowDown className="h-3.5 w-3.5" />
          </Link>
          <span>{t("home.journey.network")}</span>
        </div>

        <div
          className="max-w-7xl mx-auto px-5 md:px-8 absolute bottom-6 left-0 right-0 flex items-center justify-between gap-4 text-xs font-medium text-harvest-cream/72"
          style={{ opacity: 1 - footerOpacity }}
        >
          <span className="whitespace-nowrap">{stage}</span>
          <div className="h-px flex-1 overflow-hidden bg-harvest-cream/18">
            <div className="h-full bg-harvest-wheat" style={{ width: `${progress * 100}%` }} />
          </div>
          <span className="whitespace-nowrap">{stages[2]}</span>
        </div>
      </div>
    </section>
  );
}
