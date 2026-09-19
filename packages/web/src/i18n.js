/**
 * Turkish and English copy.
 *
 * Turkish is the default: the product is for Turkish growers, and a jury that
 * opens it should land in the language the actual user speaks. English is there
 * because the jury is mixed and the SCF reviewers who read this later are not.
 */

import { useCallback, useEffect, useState } from "react";

export const LANGS = { tr: "Türkçe", en: "English" };

const dict = {
  tr: {
    "app.name": "Harvest",
    "app.tagline": "Kapasiteni açıklama. Kredibiliteni kanıtla.",
    "app.network": "Stellar Testnet",

    "nav.farmer": "Çiftçi",
    "nav.investor": "Yatırımcı",
    "nav.proof": "Kanıt",

    "wallet.title": "Cüzdan",
    "wallet.create": "Cüzdan oluştur",
    "wallet.creating": "Oluşturuluyor…",
    "wallet.none": "Henüz cüzdan yok.",
    "wallet.demo": "Demo cüzdanı — anahtar bu tarayıcıda tutuluyor",
    "wallet.balance": "Bakiye",
    "wallet.fund": "Testnet XLM al",
    "wallet.copy": "Kopyala",
    "wallet.copied": "Kopyalandı",

    "farmer.title": "Hasat öncesi finansman",
    "farmer.subtitle":
      "Rekolteni açıklamadan, eşiğin üstünde olduğunu kanıtla ve kampanyanı aç.",
    "farmer.step1": "Kooperatif belgesi",
    "farmer.step1.desc":
      "Kooperatifin, kendi kayıtlarındaki rekolte tahminini imzalar. İmza cihazına iner.",
    "farmer.member": "Üyelik numarası",
    "farmer.request": "Belgeyi al",
    "farmer.requesting": "İmzalanıyor…",
    "farmer.attested": "Kooperatifin kayıtlarındaki tahmin",
    "farmer.private": "Bu sayı cihazından çıkmayacak",
    "farmer.issuer": "İmzalayan",

    "farmer.step2": "Eşiği seç",
    "farmer.step2.desc":
      "Piyasanın göreceği tek sayı bu. Gerçek rekoltenden düşük tutmak, pazarlık gücünü korur.",
    "farmer.threshold": "Açıklanacak eşik",
    "farmer.headroom": "Gizli kalan pay",
    "farmer.tooHigh": "Eşik, belgedeki tahminden yüksek olamaz — devre kanıt üretmez.",

    "farmer.step3": "Kanıtı üret",
    "farmer.step3.desc":
      "Groth16 kanıtı bu tarayıcıda üretilir. Rekolte, parsel ve kimlik hiçbir yere gönderilmez.",
    "farmer.generate": "Kanıt üret",
    "farmer.generating": "Kanıt üretiliyor…",
    "farmer.proofReady": "Kanıt hazır",
    "farmer.provingTime": "Üretim süresi",
    "farmer.onchain": "Zincire gidecek olan",
    "farmer.staysHere": "Cihazda kalan",
    "farmer.inspect": "Gönderilecek veriyi incele",

    "farmer.step4": "Kampanyayı aç",
    "farmer.step4.desc": "Kanıt zincirde doğrulanır; geçmezse kampanya açılmaz.",
    "farmer.crop": "Ürün",
    "farmer.region": "Bölge",
    "farmer.target": "Hedef (USDC)",
    "farmer.days": "Süre (gün)",
    "farmer.returnBps": "Getiri (%)",
    "farmer.create": "Kampanyayı aç",
    "farmer.creating": "Zincire yazılıyor…",
    "farmer.created": "Kampanya açıldı",

    "farmer.step5": "IBAN'a çek",
    "farmer.step5.desc":
      "Toplanan avans anchor üzerinden Türk lirası olarak banka hesabına iner.",
    "farmer.withdraw": "IBAN'a çek",

    "investor.title": "Kampanyaları fonla",
    "investor.subtitle":
      "Türk lirası yatır, USDC'ye dönüşsün. Kampanya beklerken paran kasada getiri üretir.",
    "investor.step1": "Türk lirası yatır",
    "investor.step1.desc":
      "Banka havalesiyle TL gönder, cüzdanına testnet USDC düşsün. Anchor limiti: 50–3.000 TL.",
    "investor.amountTry": "Tutar (TL)",
    "investor.rate": "Kur",
    "investor.willReceive": "Alacağın",
    "investor.deposit": "Yatırma başlat",
    "investor.instructions": "Havale bilgileri",
    "investor.simulate": "Havaleyi simüle et",
    "investor.simulating": "Bekleniyor…",
    "investor.settled": "USDC cüzdanına geçti",

    "investor.step2": "Kampanyalar",
    "investor.step2.desc": "Her kampanya, zincirde doğrulanmış bir kapasite kanıtına dayanır.",
    "investor.noCampaigns": "Henüz kampanya yok. Çiftçi sekmesinden bir tane aç.",
    "investor.raised": "Toplanan",
    "investor.of": "/",
    "investor.verified": "ZK doğrulandı",
    "investor.atLeast": "en az",
    "investor.fund": "Fonla",
    "investor.funding": "Gönderiliyor…",
    "investor.amountUsdc": "Tutar (USDC)",
    "investor.inVault": "Kasada",
    "investor.yield": "Getiri",

    "proof.title": "Zincir üstü doğrulama",
    "proof.subtitle":
      "Çalışan bir şeyi göstermek kolaydır. Asıl mesele, çalışmayanın reddedildiğini görmek.",
    "proof.none": "Önce Çiftçi sekmesinde bir kanıt üret.",
    "proof.verify": "Geçerli kanıtı doğrula",
    "proof.tamper": "Eşiği 90 tona şişir ve tekrar dene",
    "proof.replay": "Başka bir hesaptan tekrar gönder",
    "proof.checking": "Zincire soruluyor…",
    "proof.accepted": "KABUL EDİLDİ",
    "proof.rejected": "REDDEDİLDİ",
    "proof.acceptedWhy": "BN254 eşleştirme kontrolü Soroban host'unda geçti.",
    "proof.rejectedWhy": "Kanıt bu iddiayı desteklemiyor.",
    "proof.replayWhy": "Kanıt çiftçinin adresine bağlı.",
    "proof.contract": "Sözleşme",

    "common.error": "Hata",
    "common.close": "Kapat",
    "common.viewTx": "İşlemi gör",
    "common.tonnes": "ton",
    "common.kg": "kg",
    "common.step": "Adım",
    "common.locked": "Önceki adımı tamamla",
  },

  en: {
    "app.name": "Harvest",
    "app.tagline": "Prove you can deliver. Reveal nothing else.",
    "app.network": "Stellar Testnet",

    "nav.farmer": "Farmer",
    "nav.investor": "Investor",
    "nav.proof": "Proof",

    "wallet.title": "Wallet",
    "wallet.create": "Create wallet",
    "wallet.creating": "Creating…",
    "wallet.none": "No wallet yet.",
    "wallet.demo": "Demo wallet — the key lives in this browser",
    "wallet.balance": "Balance",
    "wallet.fund": "Get testnet XLM",
    "wallet.copy": "Copy",
    "wallet.copied": "Copied",

    "farmer.title": "Pre-harvest financing",
    "farmer.subtitle":
      "Prove your harvest clears a threshold without disclosing it, then open a campaign.",
    "farmer.step1": "Cooperative attestation",
    "farmer.step1.desc":
      "The cooperative signs the yield figure from its own records. The signature lands on your device.",
    "farmer.member": "Membership number",
    "farmer.request": "Request attestation",
    "farmer.requesting": "Signing…",
    "farmer.attested": "Yield on the cooperative's records",
    "farmer.private": "This number will not leave your device",
    "farmer.issuer": "Signed by",

    "farmer.step2": "Choose the threshold",
    "farmer.step2.desc":
      "This is the only figure the market sees. Keeping it below your real yield is what protects your bargaining position.",
    "farmer.threshold": "Threshold to disclose",
    "farmer.headroom": "Kept private",
    "farmer.tooHigh": "The threshold cannot exceed the attested yield — the circuit will refuse.",

    "farmer.step3": "Generate the proof",
    "farmer.step3.desc":
      "The Groth16 proof is built in this browser. The yield, the parcel and your identity are never sent anywhere.",
    "farmer.generate": "Generate proof",
    "farmer.generating": "Proving…",
    "farmer.proofReady": "Proof ready",
    "farmer.provingTime": "Proving time",
    "farmer.onchain": "Goes on chain",
    "farmer.staysHere": "Stays on this device",
    "farmer.inspect": "Inspect what gets submitted",

    "farmer.step4": "Open the campaign",
    "farmer.step4.desc": "The proof is verified on chain. If it does not hold, no campaign exists.",
    "farmer.crop": "Crop",
    "farmer.region": "Region",
    "farmer.target": "Target (USDC)",
    "farmer.days": "Window (days)",
    "farmer.returnBps": "Return (%)",
    "farmer.create": "Open campaign",
    "farmer.creating": "Writing to chain…",
    "farmer.created": "Campaign opened",

    "farmer.step5": "Withdraw to IBAN",
    "farmer.step5.desc":
      "The advance leaves through the anchor and arrives as Turkish lira in a bank account.",
    "farmer.withdraw": "Withdraw to IBAN",

    "investor.title": "Fund a campaign",
    "investor.subtitle":
      "Deposit lira, receive USDC. While a campaign is still filling, your money earns in the vault.",
    "investor.step1": "Deposit Turkish lira",
    "investor.step1.desc":
      "Wire lira and testnet USDC lands in your wallet. Anchor limits: 50–3,000 TRY.",
    "investor.amountTry": "Amount (TRY)",
    "investor.rate": "Rate",
    "investor.willReceive": "You receive",
    "investor.deposit": "Start deposit",
    "investor.instructions": "Transfer details",
    "investor.simulate": "Simulate the wire",
    "investor.simulating": "Waiting…",
    "investor.settled": "USDC landed in your wallet",

    "investor.step2": "Campaigns",
    "investor.step2.desc": "Every campaign rests on a capacity proof verified on chain.",
    "investor.noCampaigns": "No campaigns yet. Open one from the Farmer tab.",
    "investor.raised": "Raised",
    "investor.of": "of",
    "investor.verified": "ZK verified",
    "investor.atLeast": "at least",
    "investor.fund": "Fund",
    "investor.funding": "Sending…",
    "investor.amountUsdc": "Amount (USDC)",
    "investor.inVault": "In vault",
    "investor.yield": "Yield",

    "proof.title": "On-chain verification",
    "proof.subtitle":
      "Showing something that works is easy. What matters is watching the chain refuse something that does not.",
    "proof.none": "Generate a proof on the Farmer tab first.",
    "proof.verify": "Verify the honest proof",
    "proof.tamper": "Inflate the threshold to 90t and retry",
    "proof.replay": "Replay it from another account",
    "proof.checking": "Asking the chain…",
    "proof.accepted": "ACCEPTED",
    "proof.rejected": "REJECTED",
    "proof.acceptedWhy": "The BN254 pairing check passed inside the Soroban host.",
    "proof.rejectedWhy": "The proof does not support this claim.",
    "proof.replayWhy": "The proof is bound to the farmer's address.",
    "proof.contract": "Contract",

    "common.error": "Error",
    "common.close": "Close",
    "common.viewTx": "View transaction",
    "common.tonnes": "t",
    "common.kg": "kg",
    "common.step": "Step",
    "common.locked": "Finish the previous step",
  },
};

const STORAGE_KEY = "harvest.lang";

export function useI18n() {
  const [lang, setLang] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) ?? "tr";
    } catch {
      return "tr";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      /* private mode */
    }
    document.documentElement.lang = lang;
  }, [lang]);

  // Missing keys surface as the key itself rather than blank space, so a gap in
  // one language is obvious during review instead of invisible.
  const t = useCallback((key) => dict[lang][key] ?? dict.tr[key] ?? key, [lang]);

  return { lang, setLang, t };
}

/** Numbers read very differently in the two locales; format per language. */
export const fmt = (lang, value, opts = {}) =>
  new Intl.NumberFormat(lang === "tr" ? "tr-TR" : "en-US", opts).format(value);
