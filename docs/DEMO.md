# Demo — four minutes

```bash
npm run issuer    # :8787
npm run web       # :5173
```

Have a second tab open on
[stellar.expert](https://stellar.expert/explorer/testnet/contract/CANPSPHJIKTFE7G63BO6TG5M53RU7DKRH26RWKHFCMO6GKQFQAKIKL3B).

---

## 0:00 — the problem, in one sentence

> "A Turkish hazelnut grower needs cash in March and gets paid in October. To
> borrow, they have to tell the lender how much they will harvest. The lender is
> usually the same person who will buy that harvest. So disclosing is how the
> price gets broken — and not disclosing means no money."

Do not explain zero-knowledge yet. Let the screen do it.

## 0:30 — the attestation

Farmer tab → **Cüzdan oluştur** (pre-create this before the judges arrive; it
takes ~20 s for friendbot and the trustline).

Pick `GFK-2026-0142` → **Belgeyi al**.

> "The cooperative signs what its own records say: 48.5 tonnes. Note where that
> number is — it is on the dashed panel. That means it is on this device and it
> is going to stay there."

## 1:00 — the choice

Drag the threshold slider down to ~38 tonnes.

> "This is the only number the market will ever see. The 10.5 tonnes on the
> right is what keeps the grower's bargaining position intact at harvest."

The two panels are the pitch. Let them sit for a beat.

## 1:20 — proving

**Kanıt üret.**

> "That proof was just built in this browser. About half a second. Nothing was
> uploaded."

Open **Gönderilecek veriyi incele**.

> "This is the entire payload going to Stellar. Threshold, season, a nullifier,
> and the proof. Search it for 48500 — it is not there."

## 2:00 — the chain

**Kampanyayı aç** → open the transaction link.

> "The contract would not have accepted this transaction if the proof did not
> hold. That check ran a BN254 pairing inside the Soroban host, not in a server
> we control."

## 2:30 — the part that matters

Proof tab.

**Geçerli kanıtı doğrula** → green.

> "That is the chain's own verdict."

**Eşiği 90 tona şişir ve tekrar dene** → red.

> "Same proof. I only changed the claim to 90 tonnes. The chain refuses."

**Başka bir hesaptan tekrar gönder** → red.

> "And a valid proof lifted off the network and replayed from someone else's
> account is refused too — the proof is bound to the farmer's address."

**Spend the most time here.** Anyone can show a green tick. Two refusals are
what make the green one mean something.

## 3:10 — the lira rail

Investor tab → 500 TRY → **Yatırma başlat**.

> "Real SEP-10 authentication, real SEP-38 quote, real testnet USDC landing in
> the wallet. Turkish lira in, spendable balance out. The farmer withdraws the
> advance back to an IBAN through the same anchor."

## 3:30 — the vault, and why it is not decoration

Fund the campaign.

> "That USDC does not sit in our contract. It went straight into a yield vault
> and it stays there until the campaign settles.
>
> Here is why that is load-bearing rather than a nice extra. In an economy
> running this much inflation, backing a campaign that then fails to reach its
> goal means your money sat idle for 45 days — that is a real loss. So the
> rational move is to wait until a campaign is nearly funded. And if everyone
> waits, nothing ever funds.
>
> Yield-bearing escrow removes the penalty for going first. Our contract test
> asserts it: a *failed* campaign returns 330 USDC on 300 staked."

## 3:50 — close

> "Zero-knowledge, so the grower keeps their commercial secret. A vault, so
> committing early costs nothing. A lira anchor, so the money is actually
> spendable. Remove any one of the three and the product stops working."

---

## Questions you will get

**"Is the ZK real or a mock?"**
Real. circom, 9,981 constraints, Groth16 over BN254, verified on chain with
`env.crypto().bn254()`. `node scripts/prove-on-testnet.mjs` runs it in front of
them; the rejection cases are the proof.

**"Why should a farmer repay?"**
The campaign sits under a cooperative membership, and the cooperative is the
buyer — repayment is netted from harvest proceeds, not chased from an
individual. On top of that, repayment raises an anonymous credit tier tied to
the nullifier, so defaulting costs next season's cheaper capital. That is the
mechanism microfinance already runs on.

**"Is this a security? What about regulation?"**
Turkey has a licensed debt-based crowdfunding regime under SPK. The scaling
path is partnership with a licensed platform, not ignoring it. *(Verify the
current communiqué number before citing it — do not quote a number you have
not checked.)*

**"Is the vault really DeFindex?"**
Not on testnet right now — it is our own contract implementing DeFindex's
`VaultTrait` signatures exactly, so the vault address can point at a live
DeFindex vault with no code change. It exists so the tests do not depend on
testnet liveness and so 45 days of yield fits in four minutes. Say this plainly;
the README says it too.

**"What is the anchor?"**
`tr-mock-anchor.fly.dev`, a testnet sandbox. The bank wire and KYC are
simulated; the USDC settlement is genuine testnet activity with a transaction
hash.

---

## Before the room

- [ ] Wallet pre-created and funded — friendbot plus a trustline is 20 s of dead air.
- [ ] `npm run deploy` once, so `deployments.json` is current.
- [ ] Proving artefacts warmed: load the Farmer tab once so the 8 MB is cached.
- [ ] A campaign already open, so the Investor tab is not empty.
- [ ] Explorer tab open on the verifier.
- [ ] Phone hotspot ready. Venue wifi fails; the whole ZK half still works offline,
      only the chain calls need network.
