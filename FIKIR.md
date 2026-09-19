# HARVEST — Revize Fikir Dokümanı

> Rise In × Stellar **Pro Hackathon 2026** · Genesis Track · Grand Pera, İstanbul · 19–20 Eylül 2026
>
> Bu doküman fikrin *neden bu hale getirildiğini* anlatır. Teknik teslimler `docs/` altında ve İngilizcedir.

---

## 1. Tek cümlelik konum

**Harvest, çiftçinin hasat kapasitesini hiç kimseye açıklamadan, kapasitesinin bir eşiğin üstünde olduğunu kriptografik olarak kanıtlayarak hasat öncesi finansman almasını sağlayan Stellar protokolüdür.**

Slogan (TR): *Kapasiteni açıklama. Kredibiliteni kanıtla.*
Slogan (EN): *Prove you can deliver. Reveal nothing else.*

---

## 2. Problem — ve neden gerçekten bir problem

Türk üreticisi şubat–mayıs arası nakit yakar (gübre, mazot, budama, işçilik), parayı ise ekim–kasımda görür. Bu boşluğu kapatan üç kapı var:

| Kapı | Gerçekte ne oluyor |
| :--- | :--- |
| Ziraat Bankası / sübvansiyonlu kredi | ÇKS kaydı, TARSİM poliçesi, teminat ister. Küçük üreticinin çoğu elenir; süreç haftalar sürer. |
| Tüccar / aracı avansı | Para hemen gelir. Karşılığında hasat, *fiyatı sonra tüccarın belirleyeceği* bir taahhüde bağlanır. |
| Kooperatif avansı | Sınırlı sermaye, sınırlı kapsam. |

Kritik nokta — ve projenin bütün varlık sebebi şu:

> **Finansman için çiftçi tam rekolte tahminini açıklamak zorundadır. Onu finanse eden taraf, çoğu zaman hasadını satın alacak olan taraftır.**

"Bu sene 48 ton fındığım olacak" bilgisi, nakde sıkışmış olduğu bilgisiyle birleştiğinde karşı tarafa tam bir pazarlık üstünlüğü verir. Hasat vakti fiyat kırılır. **İfşa, kıskacın kurulma yöntemidir.**

Çiftçi iki kötü seçenek arasında sıkışır:

- **Ya** ticari sırrını açar, finansmanı alır, hasatta ezilir.
- **Ya da** sırrını korur ve nakitsiz kalır.

Bu bir "blokzincir kullanalım" problemi değil; **bilgi asimetrisi** problemidir ve sıfır bilgi ispatı bu problemin literatürdeki tam karşılığıdır.

---

## 3. Çözüm

Çiftçi, kooperatifinden / TARSİM'den aldığı **imzalı rekolte belgesini** telefonunda tutar. Tarayıcıda bir **Groth16 sıfır bilgi ispatı** üretir ve şunu kanıtlar:

> *"Yetkili bir kurumun imzasını taşıyan bir belgem var; bu belgedeki beklenen rekolte en az **40 ton**. Belgeyi, gerçek tonajı, ada/parsel bilgimi ve kimliğimi göstermiyorum."*

Gerçek sayı (örn. 48.500 kg) cihazdan **hiç çıkmaz**. Zincire yalnızca ispat, eşik ve bir nullifier yazılır. İspat **Soroban akıllı sözleşmesinde, zincir üstünde** doğrulanır — off-chain bir "güven bize" servisinde değil.

Doğrulanan çiftçi kampanya açar. Yatırımcılar **banka havalesiyle TL** yatırır, para zincirde USDC olur, **DeFindex kasasında** kampanya boyunca getiri üretir, hedef tutarsa çiftçi avansı çeker ve **kendi IBAN'ına TL olarak** indirir. Tam tur: TL girer, TL çıkar.

---

## 4. Neden eski plandan farklı — ve neden kesmek gerekti

Önceki plan 7 entegrasyon sayıyordu (Passkey, Reflector, DeFindex, ZK itibar, AI x402, CCTP, traction). Üç sebeple revize edildi:

**(a) Jüri sayı değil, taşıyıcılık ölçüyor.** Handbook'un 3. şartı birebir şöyle: *"Core Feature: the integration is load-bearing, part of what the product does."* Yedi sığ entegrasyon, üç derin entegrasyondan daha zayıf puan alır.

**(b) Rakip çakışması gerçek.** [Kumbara](https://github.com/keyboord01/kumbara) adlı bir Scale Track takımı **Passkey + TR anchor + DeFindex + Reflector** kombinasyonunu zaten kurmuş durumda. Aynı dörtlüyle çıkarsak doğrudan kıyaslanırız. Ayrışmamız ZK olmak zorunda — ve *gerçek* olmak zorunda.

**(c) Sahte kriptografi, teknik jüride ölümcül.** Eski `zkEngine.js` dosyasında ispat `Math.random()` ile üretiliyordu. Stellar jürisi bu dosyayı açarsa proje biter. Kriptografi ya gerçek olur ya hiç olmaz.

### Kesilenler ve gerekçeleri

| Kesilen | Gerekçe | Nereye gitti |
| :--- | :--- | :--- |
| **Circle CCTP** | Şart #2 *Türk lirası* rayı istiyor; bunu anchor zaten karşılıyor. CCTP "gurbetçi" anlatısı için ayrı bir cross-chain akış demek — hikâyeyi dağıtır, taşıyıcı değildir. | Yol haritası |
| **Reflector Oracle** | Uygun entegrasyon partneri listesinde yok. Ayrıca kullandığımız anchor USD/TRY kuru için Reflector'ı zaten *içeride* kullanıyor — bunu dürüstçe "dolaylı olarak stack'imizde" diye söylemek, sahte bir oracle mock'u yazmaktan iyidir. | Yol haritası + dürüst atıf |
| **Mock oracle ile hasat tetikleme** | Yerine kooperatifin **gerçek EdDSA imzası** geçti. Zaten ZK devresinin ihtiyacı olan şey buydu. Mock yerine gerçek kriptografi. | Devrenin içine girdi |
| **AI x402** | Workshop #1 içeriği, jüri görmeyi sever. Ama taşıyıcı değil. Çekirdek 4 sütun yeşile dönmeden başlanmayacak. | Opsiyonel Faz 5 |

### Kalan 4 sütun — her biri neden taşıyıcı

Bir entegrasyonun "load-bearing" olduğunun testi: **çıkarınca ürün çalışıyor mu?**

| Sütun | Çıkarırsak ne olur |
| :--- | :--- |
| **ZK (zincir üstü Groth16)** | Çiftçi kapasitesini yayınlamak zorunda kalır. Projenin varlık sebebi yok olur. Bu bir özellik değil, **ürünün kendisi**. |
| **DeFindex** | Hedefi tutmayan bir kampanyada para 45 gün boşta bekledi demektir. Yüksek enflasyon ortamında bu *gerçek* bir kayıptır ve kimse erken taahhüt vermez. Kampanya modeli çöker. Escrow'un kendisi bir vault pozisyonudur; sözleşme cross-contract `deposit`/`withdraw` çağırır. |
| **Anchor (SEP-6/10/12/38)** | Çiftçi gübreyi USDC ile satın alamaz. Ürün, kullanılamaz bakiye üreten bir demoya döner. |
| **Passkey akıllı cüzdan** | Seed phrase'i olan bir çiftçi yok. Onboarding sıfırlanır — ki hackathonun saydığı metriklerden biri tam olarak *"how many onboarded real users"*. |

---

## 5. Ekonomik model — "neden geri ödesin?" sorusunun cevabı

Bu, jürinin ve yatırımcının soracağı ilk sorudur. Üç katmanlı cevap:

1. **Kooperatif aracılığı.** Çiftçi bireysel bir borçlu değil; kampanya kooperatif üyeliğine bağlı. Kooperatif, ürünü alan ve çiftçiye ödeme yapan taraftır — geri ödeme, hasat alım bedelinden mahsup edilir. Temerrüt tek tek çiftçi kovalamakla değil, **mevcut ticari ilişkiyle** yönetilir.
2. **ZK itibar çarkı.** Başarılı geri ödeme, çiftçinin *kimliğini açmadan* anonim kredi seviyesini yükseltir (nullifier üzerinden). Bir sonraki sezon daha ucuz finansman. Geri ödememenin bedeli gelecekteki erişimin kaybıdır — mikrofinansın kanıtlanmış mekanizması.
3. **Faz 2: parametrik sigorta.** Don/kuraklık kaynaklı temerrüt, yatırımcının değil sigortanın riski olur.

**Yasal zemin:** Türkiye'de SPK'nın *Kitle Fonlaması Tebliği* borçlanmaya dayalı kitle fonlamasını düzenliyor. Harvest'in ölçeklenme yolu lisanslı bir kitle fonlaması platformuyla ortaklık — "regülasyonu görmezden gelen kripto demosu" değil.
*(Pitch öncesi tebliğ numarası ve güncel durumu teyit et — kaynak göstermeden iddia etme.)*

---

## 6. Demo akışı (jüriye anlatılacak ~4 dakika)

1. **Çiftçi girişi** — FaceID / parmak izi. Seed phrase yok, XLM yok. *(~15 sn)*
2. **Belge** — kooperatiften imzalı rekolte belgesi cihaza düşer.
3. **İspat** — tarayıcıda Groth16 üretilir. Ekranda gerçek tonaj gösterilir ve *"bu sayı cihazdan çıkmadı"* vurgulanır; zincire giden payload açıkça gösterilir: sadece eşik + ispat + nullifier.
4. **Zincir üstü doğrulama** — Soroban `verify_proof` çağrısı, Stellar Expert linki jüriye açılır. **Ardından geçersiz bir ispat denenir ve sözleşme reddeder.**
5. **Yatırımcı** — TR anchor üzerinden TL havalesi → testnet USDC cüzdana düşer.
6. **Fonlama** — USDC kampanyaya, kampanyadan DeFindex kasasına. Getiri ekranda canlı işler.
7. **Çekim** — çiftçi avansı çeker, anchor'dan IBAN'a TL olarak iner. Tur kapanır.

> **Kritik demo detayı:** 4. adımdaki *geçersiz ispat reddi*, sunumun en değerli 20 saniyesidir. Çalışan bir şeyi göstermek kolaydır; **çalışmayanı reddettiğini göstermek** sistemin gerçek olduğunu kanıtlar.

---

## 7. Teknik gerçekler (araştırmayla teyit edildi)

- **Anchor:** `tr-mock-anchor.fly.dev` — SEP-1/6/10/12/38. API key yok, SEP-10 auth. **TRY token vermiyor, USDC veriyor** → zincirdeki muhasebe birimi USDC, TL fiat bacağı. Limit: 50–3.000 TRY/yatırma, min 1 USDC/çekme. Kur: Reflector USD/TRY + 50bps spread.
- **ZK:** Stellar'ın resmî `soroban-examples/groth16_verifier` örneği BN254 ve BLS12-381 destekliyor, **Circom fixture'larıyla test edilmiş**. `soroban-verifier-gen` snarkjs `verification_key.json`'ını Soroban crate'ine çeviriyor. Yol: circom (BN254, circomlib tam uyumlu) → snarkjs → Soroban verifier.
- **soroban-sdk:** güncel stabil **27.0.6**. *(Eski taslak 21.0.0 kullanıyordu.)*
- **DeFindex vault arayüzü:** `deposit(amounts_desired, amounts_min, from, invest)` / `withdraw(...)`.

---

## 8. Kod dışı: traction planı

Handbook'un ölçtüğü metrikler: *kaç takım core feature entegrasyonu yaptı, kaçı anchor entegrasyonu yaptı, **kaçı gerçek traction yakaladı, kaçı gerçek kullanıcı onboard etti***.

Son ikisi kod yazmadan kazanılır ve çoğu takım atlar:

- [ ] Demo gününden önce **1 kooperatifle** konuşup 3–5 çiftçinin ön kaydını almak (isim + ürün + ihtiyaç tutarı). Niyet mektubu veya yazışma ekran görüntüsü bile sayılır.
- [ ] Etkinlik günü **standda jüriye ve katılımcılara passkey ile canlı onboarding** yaptırmak; onboard edilen kullanıcı sayısını canlı sayaçta göstermek.
- [ ] Deck'te bu sayıları **slayt olarak** göstermek. *"Şu an N gerçek kullanıcımız var"* cümlesi, mimari diyagramdan daha çok iş görür.

---

## 9. Kapsam sınırları — dürüstçe

README'ye ve sunuma açıkça yazılacak, çünkü yakalanmak inisiyatifle söylemekten çok daha pahalıdır:

- Anchor **sandbox**tır; banka havalesi ve KYC simüle edilir, USDC yerleşimi testnette **gerçektir**.
- Kooperatif imza anahtarı demo için bizim ürettiğimiz bir anahtardır; üretimde kurumun HSM'inde olur.
- Kontratlar **testnet**tedir ve **denetlenmemiştir**.
- Geri ödeme uygulaması (temerrüt/haciz) sözleşme kapsamı dışıdır; kooperatif mutabakatıyla yürür.
- Hackathon öncesi hazırlık yapıldığı, sorulursa açıkça söylenecek.
