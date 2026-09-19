# Demo: four minutes

A Turkish step-by-step version with preparation and troubleshooting is in
[DEMO-REHBERI.md](DEMO-REHBERI.md).

```bash
npm run issuer      # the cooperative, :8787
npm run frontend    # the app, :3000
```

Have a second tab open on the
[verifier on stellar.expert](https://stellar.expert/explorer/testnet/contract/CANPSPHJIKTFE7G63BO6TG5M53RU7DKRH26RWKHFCMO6GKQFQAKIKL3B).

---

## 0:00: the problem, in one sentence

> "A Turkish grower needs cash in March and gets paid in October. To borrow,
> they have to tell the lender how much they will harvest, and the lender is
> usually the one who will buy that harvest. Disclosing is how the price gets
> broken; not disclosing means no money."

Do not explain zero-knowledge yet. Let the screen do it.

## 0:30: the attestation

Connect the farmer's wallet (Freighter through Stellar Wallets Kit, prepared in
advance) → **Kampanya Başlat** → member **Kemal Güler (GFK-2026-0418)** →
**İmzalı Sertifikayı Al**.

> "The cooperative signs what its own records say: 120 tonnes of potatoes.
> That number is in the amber panel, on this device, and it stays here."

## 1:00: the choice

Set the public threshold to 95 tonnes.

> "This is the only number the market will ever see. The rest is what keeps
> the grower's bargaining position intact at harvest."

## 1:20: proving

**ZK Kanıtı Üret.** About a second in the browser, then the verifier contract
checks it and the panel says the Soroban verifier accepted it.

> "A Groth16 proof over BN254, built in this tab. The yield never left the
> laptop."

## 1:50: the part that matters

In the **Sözleşmeyi sına** box, press both **Dene** buttons:

- the same proof claiming double the threshold → **rejected**
- the same proof sent from another account → **rejected**

> "Anyone can show a green tick. The chain refusing a lie told with a perfectly
> valid proof is what makes the green tick mean something."

Spend the most time here. Then **Stellar'da Yayınla** and open the transaction
link.

## 2:40: the lira rail and the vault

Switch to the investor wallet (disconnect, connect). Campaign list → point at the
DeFindex strip → **Tokat Patatesi** → **USDC ile Destekle** → 60.

> "The investor's lira came in through a Stellar anchor: SEP-10 login, SEP-38
> quote, SEP-6 deposit, real testnet USDC in the wallet. That USDC does not sit
> in our contract. It went straight into a DeFindex vault and stays there until
> the campaign settles. If the campaign misses its target, investors get it
> back from the vault."

## 3:20: back to lira

Switch to Kemal Güler's wallet → **Avansı Çek** → **Avansı IBAN'a Çek** → pick a
bank card → **USDC Gönder ve TL'ye Çevir**. The steps tick off; the result shows
the lira amount and a FAST reference.

> "The advance went back through the same anchor: the IBAN over SEP-12, the
> USDC paid to the anchor with its memo, lira out. Remove the ZK, the vault or
> the anchor and the product stops working."

---

## Questions you will get

**"Is the ZK real or a mock?"**
Real. circom, 9,981 constraints, Groth16 over BN254, verified on chain with
`env.crypto().bn254()`. The two rejections in the demo are the evidence.

**"Why should a farmer repay?"**
The campaign sits under a cooperative membership, and the cooperative is the
buyer, so repayment is netted from harvest proceeds rather than chased from an
individual. Repayment also raises an anonymous credit tier tied to the
nullifier, so defaulting costs next season's cheaper capital.

**"Is this a security? What about regulation?"**
Turkey has a licensed debt-based crowdfunding regime under SPK. The scaling path
is partnership with a licensed platform. *(Verify the current communiqué number
before citing it.)*

**"Is the vault really DeFindex? Where is the yield?"**
Yes: a real DeFindex vault created through DeFindex's testnet factory, holding
the USDC the anchor settles. On testnet it earns nothing, because DeFindex's
testnet Blend strategy only accepts Blend's own test USDC. On mainnet the same
vault takes a Blend USDC strategy. The contract tests show the yield path with a
test twin: a failed campaign returns 330 USDC on 300 staked.

**"What is the anchor?"**
`tr-mock-anchor.fly.dev`, a testnet sandbox. The bank wire and KYC are
simulated; the USDC legs are genuine testnet transactions with hashes.

---

## Before the room

- [ ] Both services running, campaigns visible on the Kampanyalar page.
- [ ] Investor wallet prepared and loaded with 3,000 TRY (about 61 USDC).
- [ ] Kemal Güler's key (campaign #6 in `.harvest/demo-farmers.json`) imported
      into Freighter and the account prepared.
- [ ] One Freighter signature rehearsed on the demo laptop.
- [ ] Proving artefacts warmed: open Kampanya Başlat once so the 8 MB is cached.
- [ ] Explorer tab open on the verifier.
- [ ] Phone hotspot ready; the proof works offline, the chain calls do not.
