/**
 * Crop and region names are written on chain in one language: Turkish for the
 * Turkish cooperatives, English for the others. These tables give the other
 * language; a name missing here is shown as stored.
 */

type Names = { tr: string; en: string };

export const CROP_NAMES: Record<string, Names> = {
  "Giresun Tombul Fındık": { tr: "Giresun Tombul Fındık", en: "Giresun Tombul Hazelnut" },
  "Erken Hasat Sızma Zeytinyağı": { tr: "Erken Hasat Sızma Zeytinyağı", en: "Early-Harvest Extra Virgin Olive Oil" },
  "Ege Uzun Lifli Pamuk": { tr: "Ege Uzun Lifli Pamuk", en: "Aegean Long-Staple Cotton" },
  "Tokat Patatesi": { tr: "Tokat Patatesi", en: "Tokat Potato" },
  "Cauca Specialty Coffee": { tr: "Cauca Özel Kahvesi", en: "Cauca Specialty Coffee" },
  "Lao Cai Terrace Rice": { tr: "Lào Cai Teras Pirinci", en: "Lao Cai Terrace Rice" },
  "Kericho Highland Tea": { tr: "Kericho Yayla Çayı", en: "Kericho Highland Tea" },
  "Vidarbha Organic Cotton": { tr: "Vidarbha Organik Pamuğu", en: "Vidarbha Organic Cotton" },
  "Kostanay Hard Wheat": { tr: "Kostanay Sert Buğdayı", en: "Kostanay Hard Wheat" },
  "Maule Valley Cherries": { tr: "Maule Vadisi Kirazı", en: "Maule Valley Cherries" },
};

export const REGION_NAMES: Record<string, Names> = {
  "Tokat / Merkez": { tr: "Tokat / Merkez", en: "Tokat / Central" },
  "Cauca, Colombia": { tr: "Cauca, Kolombiya", en: "Cauca, Colombia" },
  "Lao Cai, Vietnam": { tr: "Lào Cai, Vietnam", en: "Lao Cai, Vietnam" },
  "Kericho, Kenya": { tr: "Kericho, Kenya", en: "Kericho, Kenya" },
  "Maharashtra, India": { tr: "Maharashtra, Hindistan", en: "Maharashtra, India" },
  "Kostanay, Kazakhstan": { tr: "Kostanay, Kazakistan", en: "Kostanay, Kazakhstan" },
  "Maule, Chile": { tr: "Maule, Şili", en: "Maule, Chile" },
};

export const cropName = (crop: string, locale: "tr" | "en") => CROP_NAMES[crop]?.[locale] ?? crop;
export const regionName = (region: string, locale: "tr" | "en") => REGION_NAMES[region]?.[locale] ?? region;
