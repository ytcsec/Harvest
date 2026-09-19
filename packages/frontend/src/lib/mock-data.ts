export interface Campaign {
  id: string;
  title: string;
  farmer: string;
  farmerType: string;
  location: string;
  product: string;
  productIcon: string;
  cover: string;
  target: number;
  raised: number;
  backers: number;
  daysLeft: number;
  zkThreshold: string;
  zkVerified: boolean;
  harvestDate: string;
  anchor: string;
  interestRate: number;
  story: string;
}

export interface Category {
  id: string;
  label: string;
  region: string;
}

export interface Cooperative {
  id: string;
  name: string;
  location: string;
  members: number;
  totalRaised: number;
  campaigns: number;
}

export interface SuccessStory {
  id: string;
  title: string;
  farmer: string;
  location: string;
  product: string;
  cover: string;
  repaid?: number;
  raised?: number;
  backers?: number;
  completed?: boolean;
  season?: string;
}

export interface Testimonial {
  name: string;
  role: string;
  initials: string;
  text: string;
}

export interface FAQ {
  q: string;
  a: string;
}

export const platformStats = {
  "totalRaised": 42850000,
  "activeFarmers": 1240,
  "activeCampaigns": 87,
  "successRate": 96
};

export const categories: Category[] = [
  {
    "id": "fındık",
    "label": "Fındık",
    "region": "Karadeniz"
  },
  {
    "id": "zeytin",
    "label": "Zeytin",
    "region": "Ege"
  },
  {
    "id": "buğday",
    "label": "Buğday",
    "region": "İç Anadolu"
  },
  {
    "id": "domates",
    "label": "Domates",
    "region": "Akdeniz"
  },
  {
    "id": "pamuk",
    "label": "Pamuk",
    "region": "GAP"
  },
  {
    "id": "elma",
    "label": "Elma",
    "region": "Isparta"
  },
  {
    "id": "çay",
    "label": "Çay",
    "region": "Rize"
  },
  {
    "id": "kiraz",
    "label": "Kiraz",
    "region": "Manisa"
  }
];

export const campaigns: Campaign[] = [
  {
    "id": "giresun-findik-koop",
    "title": "Giresun Fındık Kooperatifi — 2025 Hasat Avansı",
    "farmer": "Aksu Fındık Üretici Kooperatifi",
    "farmerType": "Kooperatif",
    "location": "Giresun, Bulancak",
    "product": "Fındık",
    "productIcon": "🌰",
    "cover": "https://images.pexels.com/photos/32920565/pexels-photo-32920565.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
    "target": 1800000,
    "raised": 1224000,
    "backers": 47,
    "daysLeft": 21,
    "zkThreshold": "850 ton",
    "zkVerified": true,
    "harvestDate": "Ağustos 2025",
    "anchor": "Vibrant Anchor (TL)",
    "interestRate": 8.5,
    "story": "68 üye çiftçimiz, 2025 sezonu için hasat öncesi avans arıyor. Zincir üstü ZK kanıtı ile toplam üretimin 850 tonun üzerinde olduğunu, tam miktarı açıklamadan gösteriyoruz. Rakiplerimize karşı ticari sırrımız güvende, yatırımcılara ise eşik güvencesi net."
  },
  {
    "id": "ayvalik-zeytinyagi",
    "title": "Ayvalık Zeytinyağı — Erken Hasat Finansmanı",
    "farmer": "Ege Zeytin Üreticileri Birliği",
    "farmerType": "Birlik",
    "location": "Balıkesir, Ayvalık",
    "product": "Zeytin",
    "productIcon": "🫒",
    "cover": "https://images.unsplash.com/photo-1609763951640-c0d7bd98b257?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNTl8MHwxfHNlYXJjaHwxfHxvbGl2ZSUyMGdyb3ZlfGVufDB8fHx8MTc4OTUzMjUxOHww&ixlib=rb-4.1.0&q=85",
    "target": 950000,
    "raised": 812000,
    "backers": 32,
    "daysLeft": 8,
    "zkThreshold": "120 ton yağlık",
    "zkVerified": true,
    "harvestDate": "Ekim 2025",
    "anchor": "Vibrant Anchor (TL)",
    "interestRate": 7.9,
    "story": "Ayvalık Memecik zeytiniyle sıkma yağlık üretimi. ZK kanıtı, ağaç sayısı ve önceki üç yıl rekoltemizin ortalamasından türetilmiş 120 ton eşiğini doğruluyor. Gerçek rekolte, ihalede rakiplere avantaj vermemek için gizli kalıyor."
  },
  {
    "id": "konya-bugday",
    "title": "Konya Ovası Buğday — Ekmeklik Sertifikalı Tohum",
    "farmer": "Mehmet Yılmaz Çiftliği",
    "farmerType": "Bireysel Üretici",
    "location": "Konya, Cihanbeyli",
    "product": "Buğday",
    "productIcon": "🌾",
    "cover": "https://images.unsplash.com/photo-1529511582893-2d7e684dd128?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzh8MHwxfHNlYXJjaHwxfHx3aGVhdCUyMGZpZWxkfGVufDB8fHx8MTc4OTUzMjUxOHww&ixlib=rb-4.1.0&q=85",
    "target": 420000,
    "raised": 168000,
    "backers": 19,
    "daysLeft": 34,
    "zkThreshold": "480 ton",
    "zkVerified": true,
    "harvestDate": "Temmuz 2025",
    "anchor": "Vibrant Anchor (TL)",
    "interestRate": 9.2,
    "story": "1,200 dekar sertifikalı ekmeklik buğday. Uydu görüntüsü + toprak sensörü verilerinden üretilen ZK kanıtı, üretimimin 480 tonun üzerinde olacağını rakiplerime dekar bazında verimimi açıklamadan gösteriyor."
  },
  {
    "id": "antalya-domates",
    "title": "Antalya Sera Domatesi — Kış Hasat Avansı",
    "farmer": "Kumluca Sera Üreticileri",
    "farmerType": "Kooperatif",
    "location": "Antalya, Kumluca",
    "product": "Domates",
    "productIcon": "🍅",
    "cover": "https://images.unsplash.com/photo-1566218246241-934ad8b38ea6?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwxfHx0b21hdG8lMjBncmVlbmhvdXNlfGVufDB8fHx8MTc4OTUzMjUxOHww&ixlib=rb-4.1.0&q=85",
    "target": 680000,
    "raised": 646000,
    "backers": 54,
    "daysLeft": 4,
    "zkThreshold": "2,400 ton",
    "zkVerified": true,
    "harvestDate": "Kasım 2025 — Nisan 2026",
    "anchor": "Vibrant Anchor (TL)",
    "interestRate": 8,
    "story": "124 üyemizle toplam 340 dekar sera. Rusya ve AB ihracatına giden domates için hasat öncesi işletme sermayesi. ZK proof, tesise entegre IoT tartım verilerinden üretilen 2,400 ton eşik kanıtını sunuyor."
  },
  {
    "id": "sanliurfa-pamuk",
    "title": "Şanlıurfa Pamuk — GAP Sulama Alanı 2025",
    "farmer": "Harran Pamuk Kooperatifi",
    "farmerType": "Kooperatif",
    "location": "Şanlıurfa, Harran",
    "product": "Pamuk",
    "productIcon": "☁️",
    "cover": "https://images.unsplash.com/photo-1502395809857-fd80069897d0?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA2MTJ8MHwxfHNlYXJjaHwxfHxjb3R0b24lMjBmaWVsZHxlbnwwfHx8fDE3ODk1MzI1MTh8MA&ixlib=rb-4.1.0&q=85",
    "target": 2400000,
    "raised": 984000,
    "backers": 41,
    "daysLeft": 27,
    "zkThreshold": "3,200 ton kütlü",
    "zkVerified": true,
    "harvestDate": "Eylül — Ekim 2025",
    "anchor": "Vibrant Anchor (TL)",
    "interestRate": 9.5,
    "story": "92 üyeli kooperatif, 4,800 dekar sulu pamuk. Girdi maliyetleri (gübre, mazot, işçilik) için hasat avansı. Tekstil ihracatçılarına verilen taahhütlerimizi ifşa etmeden ZK eşik kanıtı sunuyoruz."
  },
  {
    "id": "isparta-elma",
    "title": "Isparta Elma — Soğuk Hava Deposu + Hasat Avansı",
    "farmer": "Eğirdir Meyve Üreticileri Kooperatifi",
    "farmerType": "Kooperatif",
    "location": "Isparta, Eğirdir",
    "product": "Elma",
    "productIcon": "🍎",
    "cover": "https://images.unsplash.com/photo-1600752085601-1ec2646cd736?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NDh8MHwxfHNlYXJjaHwxfHxhcHBsZSUyMG9yY2hhcmR8ZW58MHx8fHwxNzg5NTMyNTE4fDA&ixlib=rb-4.1.0&q=85",
    "target": 1150000,
    "raised": 322000,
    "backers": 23,
    "daysLeft": 42,
    "zkThreshold": "1,800 ton",
    "zkVerified": true,
    "harvestDate": "Eylül 2025",
    "anchor": "Vibrant Anchor (TL)",
    "interestRate": 8.7,
    "story": "Golden ve Starking çeşitleri. Hasat sonrası soğuk hava depolamasıyla fiyat dalgalanmasından korunuyoruz. ZK kanıtı, 1,800 ton eşiğini ağaç sayısı ve son 5 yılın çeyreklik verimlerinden türetiyor."
  }
];

export const cooperatives: Cooperative[] = [
  {
    "id": "aksu-findik",
    "name": "Aksu Fındık Kooperatifi",
    "location": "Giresun",
    "members": 68,
    "totalRaised": 3450000,
    "campaigns": 4
  },
  {
    "id": "ege-zeytin",
    "name": "Ege Zeytin Üreticileri",
    "location": "Balıkesir",
    "members": 142,
    "totalRaised": 2180000,
    "campaigns": 3
  },
  {
    "id": "harran-pamuk",
    "name": "Harran Pamuk Kooperatifi",
    "location": "Şanlıurfa",
    "members": 92,
    "totalRaised": 4200000,
    "campaigns": 5
  },
  {
    "id": "egirdir-meyve",
    "name": "Eğirdir Meyve Kooperatifi",
    "location": "Isparta",
    "members": 76,
    "totalRaised": 1670000,
    "campaigns": 3
  },
  {
    "id": "kumluca-sera",
    "name": "Kumluca Sera Üreticileri",
    "location": "Antalya",
    "members": 124,
    "totalRaised": 2890000,
    "campaigns": 4
  }
];

export const successStories: SuccessStory[] = [
  {
    "id": "rize-cay-2024",
    "title": "Rize Çay Kooperatifi — 2024 Sezonu",
    "farmer": "Doğu Karadeniz Çay Birliği",
    "location": "Rize, Fındıklı",
    "product": "Çay",
    "cover": "https://images.unsplash.com/photo-1593335663758-4da70281a917?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NDk1ODF8MHwxfHNlYXJjaHwxfHx0ZWElMjBwbGFudGF0aW9ufGVufDB8fHx8MTc4OTUzMjUxOHww&ixlib=rb-4.1.0&q=85",
    "raised": 1850000,
    "backers": 78,
    "completed": true
  },
  {
    "id": "manisa-kiraz-2024",
    "title": "Manisa Kiraz Üreticileri — İhracat Sezonu",
    "farmer": "Alaşehir Meyve Kooperatifi",
    "location": "Manisa, Alaşehir",
    "product": "Kiraz",
    "cover": "https://images.unsplash.com/photo-1625246333208-a202eeaf1b0c?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjAzNDR8MHwxfHNlYXJjaHw0fHxjaGVycnklMjBvcmNoYXJkfGVufDB8fHx8MTc4OTUzMjUxOHww&ixlib=rb-4.1.0&q=85",
    "raised": 720000,
    "backers": 34,
    "completed": true
  },
  {
    "id": "ordu-findik-2024",
    "title": "Ordu Fındık — Erken Ödemeli Alım",
    "farmer": "Karadeniz Fındık Kooperatifi",
    "location": "Ordu, Ünye",
    "product": "Fındık",
    "cover": "https://images.pexels.com/photos/32920566/pexels-photo-32920566.jpeg?auto=compress&cs=tinysrgb&dpr=2&h=650&w=940",
    "raised": 2340000,
    "backers": 96,
    "completed": true
  }
];

export const testimonials: Testimonial[] = [
  {
    "name": "Osman Kaya",
    "role": "Fındık Üreticisi, Giresun",
    "initials": "OK",
    "text": "HARVEST sayesinde hasat öncesi işçi ve gübre param cebimde. Rakip alıcılara gerçek tonajımı söylemek zorunda kalmadım — ZK kanıtı yatırımcıya yetti."
  },
  {
    "name": "Elif Demir",
    "role": "Yatırımcı, İstanbul",
    "initials": "ED",
    "text": "Kooperatiflerin üretim eşiği kriptografik olarak kanıtlanıyor. Anchor üzerinden TL geri dönüş net, geleneksel tarım fonlarına göre çok daha şeffaf."
  },
  {
    "name": "Ahmet Şen",
    "role": "Kooperatif Başkanı, Ayvalık",
    "initials": "AŞ",
    "text": "Erken hasat finansmanı için önceki yıl bankalarla ay ay uğraşıyorduk. Şimdi 72 saatte fonlandık. Ticari sırrımız da güvende."
  },
  {
    "name": "Carlos Mejía",
    "role": "Kahve Üreticisi, Cauca (Kolombiya)",
    "initials": "CM",
    "text": "Alıcılar rekoltemizi öğrenince fiyatı aşağı çekiyordu. Burada yalnızca eşiği kanıtladık; avans USDC olarak iki günde geldi."
  },
  {
    "name": "Grace Wanjiru",
    "role": "Çay Kooperatifi Saymanı, Kericho (Kenya)",
    "initials": "GW",
    "text": "Üyelerimizin hiçbiri gizli anahtar saklamak istemedi. Telefondaki parmak iziyle giriş yapıp kampanyamızı açtık."
  }
];

export const faqs: FAQ[] = [
  {
    "q": "ZK kanıtı tam olarak neyi gösteriyor, neyi göstermiyor?",
    "a": "ZK kanıtı yalnızca \"üretimim X tonun üzerinde olacak\" ifadesini kanıtlar. Gerçek hasat miktarı, dekar başına verim, müşteri kontratları veya fiyatlarınız ifşa edilmez. Rakiplerinize karşı ticari sırrınız korunur."
  },
  {
    "q": "TL ödemeleri Stellar anchor üzerinden nasıl işliyor?",
    "a": "Yatırımcı TL yatırır, Vibrant gibi lisanslı bir Stellar anchor bunu tokenize eder ve HARVEST akıllı sözleşmesine kilitler. Hasat sonrası çiftçi ödemesi de aynı anchor üzerinden çiftçinin banka hesabına TL olarak çıkar."
  },
  {
    "q": "Kanıt hangi verilerden üretiliyor?",
    "a": "Uydu görüntüsü (Sentinel-2), toprak sensörleri (nem, NDVI), ağaç/dekar sayımı, önceki 3-5 yıl rekolte geçmişi ve isteğe bağlı IoT tartım cihazları. Tüm veri girdileri şifreli kalır, sadece eşik kanıtı publish edilir."
  },
  {
    "q": "Yatırımcı olarak riskim nedir?",
    "a": "Ana risk: hasat başarısızlığı (don, kuraklık, hastalık). Bu risk kısmen tarım sigortası entegrasyonu ile azaltılır. Eşiğin altında hasat durumunda, anchor üzerinden sigorta ödemesi + kalan teminatla oransal geri ödeme yapılır."
  },
  {
    "q": "Faiz oranları nasıl belirleniyor?",
    "a": "Ürün tipi, coğrafya, çiftçi/kooperatif geçmişi, ZK eşiği güvenlik marjı ve hasata kalan süreye göre %7.5 - %10.5 arasında değişir. Her kampanya kartında net gösterilir."
  }
];

export const howItWorksSteps = [
  {
    n: 1,
    t: "Kayıt & Kimlik",
    d: "Kooperatif başkanı veya bireysel üretici olarak kaydol. Tapu / üyelik doğrulama 5 dakika."
  },
  {
    n: 2,
    t: "Veri Bağla",
    d: "Uydu görüntüsü, toprak sensörü, ağaç/dekar sayısı ve geçmiş rekolte kayıtlarını bağla."
  },
  {
    n: 3,
    t: "ZK Kanıtı Üret",
    d: "“Üretimim X ton üzerinde” ifadesi kriptografik olarak kanıtlanır. Gerçek miktar gizli kalır."
  },
  {
    n: 4,
    t: "Kampanya Aç",
    d: "Hedef avans tutarını, hasat tarihini ve kooperatif hikayeni belirle. 15 dakikada yayında."
  },
  {
    n: 5,
    t: "TL ile Fonlan",
    d: "Yatırımcılar Stellar anchor üzerinden TL ile destek olur. Bekleyen fonlar getiri üretir."
  },
  {
    n: 6,
    t: "Hasat & Geri Ödeme",
    d: "Çiftçi hasattan sonra avansı faizi ile geri öder. Yatırımcı parasını TL olarak hesabına alır."
  }
];
