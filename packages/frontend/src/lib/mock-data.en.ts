/**
 * English versions of the showcase content in `mock-data.ts`. Same records,
 * same numbers, translated text; names of people, cooperatives and places are
 * proper nouns and stay as they are.
 */
import {
  cooperatives as coopsTr,
  successStories as storiesTr,
  testimonials as testimonialsTr,
  type Category,
  type Cooperative,
  type FAQ,
  type SuccessStory,
  type Testimonial,
} from "@/lib/mock-data";

export const categories: Category[] = [
  { id: "fındık", label: "Hazelnut", region: "Black Sea" },
  { id: "zeytin", label: "Olive", region: "Aegean" },
  { id: "buğday", label: "Wheat", region: "Central Anatolia" },
  { id: "domates", label: "Tomato", region: "Mediterranean" },
  { id: "pamuk", label: "Cotton", region: "Southeast" },
  { id: "elma", label: "Apple", region: "Isparta" },
  { id: "çay", label: "Tea", region: "Rize" },
  { id: "kiraz", label: "Cherry", region: "Manisa" },
];

/** Organisation names in English; place names stay as they are. */
const orgNames: Record<string, string> = {
  "Aksu Fındık Kooperatifi": "Aksu Hazelnut Cooperative",
  "Ege Zeytin Üreticileri": "Aegean Olive Growers",
  "Harran Pamuk Kooperatifi": "Harran Cotton Cooperative",
  "Eğirdir Meyve Kooperatifi": "Eğirdir Fruit Cooperative",
  "Kumluca Sera Üreticileri": "Kumluca Greenhouse Growers",
  "Doğu Karadeniz Çay Birliği": "Eastern Black Sea Tea Union",
  "Alaşehir Meyve Kooperatifi": "Alaşehir Fruit Cooperative",
  "Karadeniz Fındık Kooperatifi": "Black Sea Hazelnut Cooperative",
  "Aksu Fındık Üretici Kooperatifi": "Aksu Hazelnut Growers Cooperative",
  "Ege Zeytin Üreticileri Birliği": "Aegean Olive Growers Union",
  "Mehmet Yılmaz Çiftliği": "Mehmet Yılmaz Farm",
  "Eğirdir Meyve Üreticileri Kooperatifi": "Eğirdir Fruit Growers Cooperative",
};
const org = (name: string) => orgNames[name] ?? name;

export const cooperatives: Cooperative[] = coopsTr.map((c) => ({ ...c, name: org(c.name) }));

const storyTitles: Record<string, string> = {
  "rize-cay-2024": "Rize Tea Cooperative — 2024 season",
  "manisa-kiraz-2024": "Manisa Cherry Growers — export season",
  "ordu-findik-2024": "Ordu Hazelnut — early-payment purchase",
};

export const successStories: SuccessStory[] = storiesTr.map((s) => ({
  ...s,
  farmer: org(s.farmer),
  title: storyTitles[s.id] ?? s.title,
}));

const testimonialText: Record<string, { role: string; text: string }> = {
  "Osman Kaya": {
    role: "Hazelnut grower, Giresun",
    text: "Thanks to HARVEST I had my money for labour and fertiliser before the harvest. I did not have to tell rival buyers my real tonnage; the ZK proof was enough for the investor.",
  },
  "Elif Demir": {
    role: "Investor, Istanbul",
    text: "Cooperatives' output thresholds are proven cryptographically. The lira return through the anchor is clear and far more transparent than traditional agricultural funds.",
  },
  "Carlos Mejía": {
    role: "Coffee grower, Cauca, Colombia",
    text: "Once buyers learned our yield, they pushed the price down. Here we only proved the threshold, and the advance arrived in USDC within two days.",
  },
  "Grace Wanjiru": {
    role: "Tea cooperative treasurer, Kericho, Kenya",
    text: "None of our members wanted to look after a secret key. We signed in with the fingerprint on a phone and opened our campaign.",
  },
  "Ahmet Şen": {
    role: "Cooperative chair, Ayvalık",
    text: "The year before, we spent month after month with banks for early-harvest financing. This time we were funded in 72 hours, and our trade secret stayed safe.",
  },
};

export const testimonials: Testimonial[] = testimonialsTr.map((t) => ({
  ...t,
  ...(testimonialText[t.name] ?? {}),
}));

export const faqs: FAQ[] = [
  {
    q: "How do you prove the farmer's declaration?",
    a: "The yield is signed not by the farmer but by an accredited cooperative, from its own records. The farmer generates a Groth16 zero-knowledge proof in the browser showing that the signed yield clears the stated threshold. The contract on Soroban verifies both the proof and the cooperative's accredited signature; the \"≥ X tonnes\" claim rests on cryptography, not trust, and the real figure stays private.",
  },
  {
    q: "Can't a farmer ask for too much and cheat?",
    a: "They can ask, but the advance only unlocks if backers raise at least the campaign's minimum. If that floor is not reached by the deadline, the farmer draws nothing and every contribution is refunded from the vault. Asking for more than the harvest can back only raises the bar they must clear, so over-asking works against the farmer.",
  },
  {
    q: "What exactly does the ZK proof show, and what does it not?",
    a: "The ZK proof proves only the statement \"my output will be above X tonnes\". The real harvest, yield per hectare, customer contracts and your prices are not disclosed. Your trade secret is protected from competitors.",
  },
  {
    q: "How do lira payments work through the Stellar anchor?",
    a: "The investor deposits lira, a licensed Stellar anchor such as Vibrant tokenises it and locks it into the HARVEST smart contract. After the harvest, the payment to the grower leaves through the same anchor to the grower's bank account in lira.",
  },
  {
    q: "What data is the proof generated from?",
    a: "Satellite imagery (Sentinel-2), soil sensors (moisture, NDVI), tree and field counts, the previous 3-5 years of yield history and optional IoT weighing devices. All data inputs stay encrypted; only the threshold proof is published.",
  },
  {
    q: "What is my risk as an investor?",
    a: "The main risk is a failed harvest (frost, drought, disease). It is partly reduced by agricultural insurance integration. If the harvest falls below the threshold, repayment is made pro rata from the insurance payout through the anchor plus the remaining collateral.",
  },
  {
    q: "How are interest rates set?",
    a: "They range from 7.5% to 10.5% depending on the crop, geography, the grower's or cooperative's history, the ZK threshold's safety margin and the time left until harvest. Each campaign card shows it clearly.",
  },
];

export const howItWorksSteps = [
  { n: 1, t: "Register and verify", d: "Sign up as a cooperative chair or an individual grower. Deed or membership verification takes 5 minutes." },
  { n: 2, t: "Connect your data", d: "Connect satellite imagery, soil sensors, tree and field counts and past yield records." },
  { n: 3, t: "Generate the ZK proof", d: "\"My output is above X tonnes\" is proven cryptographically. The real amount stays private." },
  { n: 4, t: "Open a campaign", d: "Set the target advance, harvest date and your cooperative's story. Live in 15 minutes." },
  { n: 5, t: "Get funded", d: "Investors back you in their own currency through a Stellar anchor. Waiting funds earn yield." },
  { n: 6, t: "Harvest and repay", d: "The grower repays the advance with interest after the harvest. Investors receive their money in local currency." },
];

export const platformStats = {
  totalRaised: 42850000,
  activeFarmers: 1240,
  activeCampaigns: 87,
  successRate: 96,
};
