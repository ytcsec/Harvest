# 🌾 Harvest

**Pre-harvest financing that does not force a farmer to disclose their capacity.**

*Rise In × Stellar Pro Hackathon 2026 — Genesis Track*

A Turkish grower proves, in zero knowledge, that a cooperative attested to a
harvest of **at least** some threshold. The real figure never leaves their
phone. The proof is verified **on chain** by a Soroban contract using Stellar's
native BN254 pairing host functions. Investors put in **Turkish lira** through a
Stellar anchor, and their money earns in a **yield vault** for as long as the
campaign is still filling.

| | |
| :-- | :-- |
| **Live contracts** | [verifier](https://stellar.expert/explorer/testnet/contract/CANPSPHJIKTFE7G63BO6TG5M53RU7DKRH26RWKHFCMO6GKQFQAKIKL3B) · [campaign](https://stellar.expert/explorer/testnet/contract/CDBFK23UIF6U2LQFLS5SHRFSKUQACKN6XL63DJ52F7CCWNKDBJHKTQRH) · [vault](https://stellar.expert/explorer/testnet/contract/CDJQVZFZ7NBBOCDOZVDAD2RWIDKC35MGPBGVYQVVZKCD7HFX5UMB34W3) |
| **Fiat rail** | [tr-mock-anchor.fly.dev](https://tr-mock-anchor.fly.dev) — SEP-1/6/10/12/38 |
| **Tests** | 17 contract · 11 circuit · 15 browser end-to-end |
| **Proving time** | ~520 ms, in the browser |

---

## 1. Why

Turkish growers spend cash between February and May — fertiliser, diesel,
pruning, labour — and see revenue in October. Three doors close that gap:
subsidised bank credit (which wants land registry, ÇKS registration, TARSİM
insurance and collateral), the cooperative (limited capital), or a **merchant
advance**.

The merchant advance is fast, and it is where the problem lives:

> **To get financed, a farmer must disclose their expected harvest. The party
> financing them is very often the party that will buy that harvest.**

"I will have 48 tonnes of hazelnuts" combined with "and I am short of cash
right now" is a complete negotiating position — for the other side. Come
harvest, the price gets broken. **Disclosure is the mechanism of the squeeze.**

So the farmer picks between two bad options: reveal the commercial secret and
get financed, or protect it and go without cash.

This is not a problem that wants a blockchain. It is an **information asymmetry**
problem, and zero-knowledge proof is the thing that is actually designed for it.

## 2. What Harvest does

The farmer holds a cooperative-signed statement of expected yield. In their
browser, they generate a Groth16 proof of:

> *"I hold an attestation signed by an accredited cooperative, and the expected
> harvest in it is at least **40 tonnes**. I am not showing you the attestation,
> the real tonnage, my parcel, or who I am."*

48,500 kg never leaves the device. What reaches the chain is the threshold, the
season, a nullifier, and the proof.

```
  cooperative signs 48,500 kg  ──►  browser: Groth16 proof  ──►  Soroban: BN254 pairing
        (private record)                (nothing sent)              "≥ 40,000 kg" ✓

  investor: 500 TRY ──► anchor ──► 10.22 USDC ──► campaign ──► DeFindex vault (earning)
                                                                      │
  harvest ──► farmer repays ──► investors claim principal + return + yield
                            └─► anonymous credit tier +1, keyed to the nullifier
```

## 3. Hackathon requirements

| Requirement | How Harvest meets it | Evidence |
| :--- | :--- | :--- |
| **1. Protocol integration** | Escrow *is* a vault position. Contributions are deposited on arrival via cross-contract call and only withdrawn at settlement. | [`harvest-campaign/src/lib.rs`](contracts/harvest-campaign/src/lib.rs) `vault_deposit` / `vault_withdraw` |
| **2. Anchor / local payments** | SEP-10 auth, SEP-38 quote, SEP-6 deposit and withdraw against a TRY anchor. Lira in, spendable USDC out, lira back to an IBAN. | [`anchor.mjs`](packages/sdk/src/anchor.mjs), [`anchor-roundtrip.mjs`](scripts/anchor-roundtrip.mjs) |
| **3. Core feature is load-bearing** | Remove the ZK and the farmer must publish their capacity — the product's entire reason to exist is gone. Remove the vault and nobody commits to a campaign early. | §4 below |
| **4. Soroban SDK, deployed to testnet** | Three contracts on `soroban-sdk 27.0.6`, deployed and initialised. | [`deployments.json`](deployments.json) |
| **5. Cite skill files used** | Two official skills genuinely consulted, with what each changed. | [`docs/SKILLS_USED.md`](docs/SKILLS_USED.md) |

### 4. Is each integration actually load-bearing?

The test is simple: **remove it and see whether the product still works.**

**Zero-knowledge — remove it and there is no product.** Without the proof the
farmer publishes a capacity figure to raise money, which is precisely the harm
Harvest exists to prevent. This is not a privacy feature bolted onto a
crowdfunding app; the crowdfunding exists to give the proof somewhere to matter.
`create_campaign` cannot be called without a proof that passes the pairing check.

**The vault — remove it and the funding mechanic stalls.** A campaign that fails
to reach its goal has held an investor's money idle for its whole funding
window. Under high inflation that is a real loss, so the rational move is to
wait until a campaign is nearly funded — and if everyone waits, nothing funds.
Yield-bearing escrow removes the penalty for committing early. The contract test
[`a_missed_target_returns_principal_plus_the_yield_earned_while_waiting`](contracts/harvest-campaign/src/test.rs)
asserts exactly this: a failed campaign still returns 330 USDC on 300 staked.

**The anchor — remove it and the farmer cannot buy fertiliser.** An advance
denominated in a token nobody in Giresun accepts is not an advance.

## 5. What is real, and what is not

Stated plainly, because being caught is far more expensive than volunteering it.

**Real:**
- The Groth16 circuit (9,981 constraints), proving and verification. No mocks.
- On-chain verification through `env.crypto().bn254()` in the Soroban host.
- USDC settlement on Stellar testnet. [This anchor deposit](https://stellar.expert/explorer/testnet/tx/ee7f7349008591e8f1c317c7881bc4c9b1da6358d9fb3d272bb1cc69b7b2a2f5)
  moved 500 TRY into 10.2211935 USDC.
- All three contracts deployed, initialised and exercised on testnet.

**Simulated or stubbed:**
- The anchor is a **sandbox**. The bank wire, the KYC and the lira payout are
  simulated; the USDC leg is genuine testnet activity.
- The vault is our own [`mock-defindex-vault`](contracts/mock-defindex-vault/src/lib.rs),
  implementing DeFindex's `VaultTrait` signatures exactly so the vault address
  can point at a live DeFindex vault with no code change. It exists so the
  contract tests do not depend on testnet liveness, and so a 45-day funding
  window's yield can be shown in a four-minute demo. **It is not a yield
  strategy.** See [ARCHITECTURE](docs/ARCHITECTURE.md#the-vault) for what
  swapping in the real vault involves.
- The cooperative's signing key is generated by the deploy script. In production
  it lives in the cooperative's HSM.
- The browser wallet is a keypair in `localStorage`, honestly labelled as such
  in the UI. Passkey smart wallets are on the roadmap; every signature already
  goes through one `sign(tx)` seam, so swapping them in touches one file.
- Contracts are **unaudited** and testnet-only.
- This repository was built in the days before the event, not during it.

## 6. Run it

```bash
npm install

# 1. Build the circuit and run the Groth16 setup (~2 min)
npm run circuit:build
npm run circuit:test          # 11 checks, including four ways to cheat

# 2. Contracts
npm run contracts:build
npm run contracts:test        # 17 tests against real proof fixtures

# 3. Deploy to testnet (idempotent; reuses deployments.json)
npm run deploy

# 4. Services
npm run issuer                # the cooperative, on :8787
npm run web                   # the app, on :5173
```

Verify the claims yourself:

```bash
node scripts/prove-on-testnet.mjs   # proof accepted, tampered claim refused
node scripts/anchor-roundtrip.mjs   # 500 TRY -> real testnet USDC
node scripts/e2e.mjs --headed       # watch the whole thing in a browser
```

**Windows note:** Rust's MSVC host toolchain needs the Windows SDK, which this
machine did not have. `contracts/` is pinned to `stable-x86_64-pc-windows-gnu`
via `rustup override`, and [`scripts/env.ps1`](scripts/env.ps1) explains the two
traps in detail. macOS and Linux need none of this.

## 7. Layout

```
circuits/          circom source, Groth16 setup, proof tests
contracts/
  harvest-verifier      BN254 pairing + issuer allow-list + caller binding
  harvest-campaign      lifecycle, vault escrow, anonymous reputation
  mock-defindex-vault   local twin of DeFindex's VaultTrait
packages/
  sdk/             encoding, attestation, anchor and Soroban clients
  issuer/          the cooperative's attestation service
  web/             the app (Turkish / English)
scripts/           deploy, and one script per claim this README makes
docs/              architecture, skills used, roadmap, demo script
```

## 8. Documentation

- [**ARCHITECTURE**](docs/ARCHITECTURE.md) — how it fits together, what was traded away, what broke along the way
- [**CONTRACTS**](docs/CONTRACTS.md) — contract reference
- [**SKILLS_USED**](docs/SKILLS_USED.md) — which official skill files were used, and what each changed
- [**ROADMAP**](docs/ROADMAP.md) — what comes after the hackathon
- [**DEMO**](docs/DEMO.md) — the four-minute run

---

Prove you can deliver. Reveal nothing else.
