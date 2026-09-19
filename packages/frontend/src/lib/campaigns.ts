import { campaigns as sampleCampaigns, successStories } from "@/lib/mock-data";

export type CampaignStatus = "Funding" | "Funded" | "Disbursed" | "Repaid" | "Refunding";

/** A campaign exactly as `lib/chain/harvest.js#getCampaign` reads it. */
export interface ChainCampaign {
  id: number;
  farmer: string;
  crop: string;
  region: string;
  season: number;
  thresholdKg: number;
  nullifier: string;
  target: number;
  raised: number;
  shares: number;
  deadline: number;
  returnPercent: number;
  /** Share of the target, in percent, after which the grower can draw. */
  minPercent: number;
  /** Principal the grower has drawn so far. */
  disbursed: number;
  status: CampaignStatus;
  investorPool: number;
}

/**
 * What the cards and the detail page render.
 *
 * The contract stores a crop name, a region and the numbers -- nothing else.
 * The title, cover photo and icon are derived from the crop; fields the chain
 * does not keep (a backer count, a story) are not invented.
 */
export interface CampaignView extends ChainCampaign {
  title: string;
  /** Turkish product label; also the filter key. */
  product: string;
  productEn: string;
  productIcon: string;
  cover: string;
  farmerShort: string;
  zkThreshold: string;
  daysLeft: number;
  deadlineLabel: string;
  statusLabel: string;
  percent: number;
  isOpen: boolean;
}

export const STATUS_LABELS: Record<CampaignStatus, string> = {
  Funding: "Fonlanıyor",
  Funded: "Fonlandı",
  Disbursed: "Avans ödendi",
  Repaid: "Geri ödendi",
  Refunding: "İade ediliyor",
};

/** Covers for products the sample data has no photo for. */
const EXTRA_COVERS: Record<string, string> = {
  // Photography from the HARVEST.V2 design (public/assets).
  Kahve: "/assets/coffee.jpg",
  Pirinç: "/assets/rice.jpg",
  Buğday: "/assets/wheat.jpg",
  // Unsplash photo 484GsKrL5r8 ("a pile of potatoes on a dirt field").
  Patates:
    "https://images.unsplash.com/photo-1573196444577-af471298e034?ixlib=rb-4.1.0&q=85&fm=jpg&crop=entropy&cs=srgb&w=940",
};

const coverOf = (product: string) =>
  EXTRA_COVERS[product] ??
  sampleCampaigns.find((c) => c.product === product)?.cover ??
  successStories.find((s) => s.product === product)?.cover;

const PRODUCTS: { match: string[]; product: string; productEn: string; icon: string }[] = [
  { match: ["patates", "potato"], product: "Patates", productEn: "Potato", icon: "🥔" },
  { match: ["kahve", "coffee"], product: "Kahve", productEn: "Coffee", icon: "☕" },
  { match: ["pirinç", "pirinc", "rice"], product: "Pirinç", productEn: "Rice", icon: "🍚" },
  { match: ["fındık", "findik", "hazelnut"], product: "Fındık", productEn: "Hazelnut", icon: "🌰" },
  { match: ["zeytin", "olive"], product: "Zeytin", productEn: "Olive", icon: "🫒" },
  { match: ["buğday", "bugday", "wheat"], product: "Buğday", productEn: "Wheat", icon: "🌾" },
  { match: ["domates", "tomato"], product: "Domates", productEn: "Tomato", icon: "🍅" },
  { match: ["pamuk", "cotton"], product: "Pamuk", productEn: "Cotton", icon: "☁️" },
  { match: ["elma", "apple"], product: "Elma", productEn: "Apple", icon: "🍎" },
  { match: ["çay", "cay", "tea"], product: "Çay", productEn: "Tea", icon: "🍃" },
  { match: ["kiraz", "cherr"], product: "Kiraz", productEn: "Cherry", icon: "🍒" },
];

export function productOf(crop: string) {
  const c = crop.toLocaleLowerCase("tr");
  const hit = PRODUCTS.find((p) => p.match.some((m) => c.includes(m)));
  const product = hit?.product ?? crop;
  return {
    product,
    productEn: hit?.productEn ?? crop,
    icon: hit?.icon ?? "🌾",
    cover: coverOf(product) ?? coverOf("Buğday")!,
  };
}

export const formatUsdc = (amount: number, digits = 2) =>
  new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(amount);

export const formatTons = (kg: number) =>
  `${(kg / 1000).toLocaleString("tr-TR", { maximumFractionDigits: 1 })} ton`;

export const shortAddress = (addr: string) =>
  addr ? `${addr.slice(0, 5)}…${addr.slice(-5)}` : "";

export function toView(c: ChainCampaign, now = Date.now()): CampaignView {
  const { product, productEn, icon, cover } = productOf(c.crop);
  const msLeft = c.deadline * 1000 - now;
  return {
    ...c,
    title: `${c.crop} — ${c.season} Hasat Avansı`,
    product,
    productEn,
    productIcon: icon,
    cover,
    farmerShort: shortAddress(c.farmer),
    zkThreshold: `≥ ${formatTons(c.thresholdKg)}`,
    daysLeft: Math.max(0, Math.ceil(msLeft / 86_400_000)),
    deadlineLabel: new Date(c.deadline * 1000).toLocaleDateString("tr-TR", {
      day: "numeric",
      month: "long",
      year: "numeric",
    }),
    statusLabel: STATUS_LABELS[c.status] ?? c.status,
    percent: c.target > 0 ? Math.min(100, Math.round((c.raised / c.target) * 100)) : 0,
    isOpen: c.status === "Funding" && msLeft > 0,
  };
}
