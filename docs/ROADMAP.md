# Roadmap

What exists, what was deliberately deferred, and what comes next.

---

## Shipped

- circom capacity circuit, 9,981 constraints, Groth16 over BN254
- On-chain verification through Soroban's BN254 host functions
- Accredited-issuer allow-list, nullifier registry, caller binding
- Campaign lifecycle with escrow in a real DeFindex vault (created through DeFindex's testnet factory) and pull-based settlement
- Anonymous reputation keyed to the nullifier
- TRY anchor integration: SEP-1/6/10/12/38, both directions in the app: lira in to USDC, USDC out to an IBAN
- Cooperative attestation service that never sees the farmer's secret
- Next.js app with in-browser proving and wallets through Stellar Wallets Kit (Freighter, xBull, Albedo, ...)
- Passkey smart wallets (smart-account-kit + OpenZeppelin smart accounts): sign in with Face ID / Windows Hello, no seed phrase, no XLM; proven end to end on testnet by `scripts/passkey-e2e.mjs`
- Turkish and English throughout the app, with USDC / USD / TRY display
- 43 tests across circuit, contract and browser layers, plus testnet scripts for the full lifecycle and the fiat round trip

---

## Next, in priority order

### 1. Passkey wallets without the browser-held helper account

Passkey sign-in works today, with one account kept in the browser that pays fees
and talks to the anchor, because SDF's relayer proxy sits on a domain Turkish
networks block and the TR anchor only offers SEP-10 (G-accounts). The next step
removes it: fees through a self-hosted OpenZeppelin Relayer, and anchors that
support SEP-45 so a contract account authenticates on its own. Grower onboarding
is the metric the hackathon counts, and a grower will not manage a seed phrase.

### 2. Yield on the DeFindex vault

The escrow is already a real DeFindex vault holding the anchor's USDC, but on
testnet it has no strategy: DeFindex's testnet Blend strategy only takes Blend's
own testnet USDC. On mainnet, attach a Blend USDC strategy to the same vault and
idle escrow starts earning; no contract change is needed.

### 3. Cross-season reputation

The nullifier is `Poseidon(farmerSecret, season)`, so it is per-season by
construction and history does not currently chain. A second circuit proving
*"I know the secret behind both N₂₀₂₅ and N₂₀₂₆"* links seasons without ever
revealing the secret or the identity. This is the natural next circuit and it is
what turns the reputation tier from a gesture into a real retention mechanism.

### 4. Off-chain campaign index

`listCampaigns` reads every campaign by id through simulation. Fine at demo
scale, useless at a thousand. Index the contract's events instead.

### 5. Production trusted setup

Phase 1 currently falls back to a locally generated ceremony because every
Hermez mirror has been returning 403 since 2026-09
([iden3/snarkjs#636](https://github.com/iden3/snarkjs/issues/636)). Before any
real money: pull a real ceremony file, and run a multi-party phase 2 rather than
a single local contribution.

---

## Deferred, with reasons

| | Why it was cut | When it earns its place |
| :--- | :--- | :--- |
| **Circle CCTP** | Requirement #2 asks for a Turkish lira rail, which the anchor already provides. A second cross-chain flow diluted the story without carrying load. | When diaspora investors are a real segment rather than a slide. |
| **Reflector oracle** | Not on the eligible partner list, and the anchor already uses it internally for USD/TRY — so it is in the stack transitively. Writing a mock oracle on top would have been theatre. | Parametric frost/drought insurance, where an oracle genuinely triggers a payout. |
| **x402 agentic payments** | Workshop-aligned and cheap, but not load-bearing. Gated behind the core four. | An agent that verifies ÇKS documents before the cooperative signs, paying per call. |
| **Secondary market for positions** | Out of scope for two days. | When investors want out before harvest — a transferable position token on a Stellar DEX. |

---

## Beyond the hackathon

**Traction is the thing to work on next, and it is not code.** The event's own
metrics count how many teams *captured real traction* and *onboarded real
users*, and most teams skip both.

- Pre-register 3–5 growers through one cooperative before demo day. A letter of
  intent or even a screenshot of the conversation counts.
- Onboard judges and attendees live at the booth with passkeys, and show the
  count on screen.

**Regulatory path.** Turkey has a licensed debt-based crowdfunding regime under
SPK. Scaling means partnering with a licensed platform rather than routing
around it. *(Confirm the current communiqué number before citing it publicly.)*

**Where this goes if it works.** The capacity proof is not specific to
hazelnuts, or to financing. Any situation where a producer must prove a
threshold to a counterparty who benefits from knowing the exact figure has the
same shape: export quota compliance, EU Green Deal carbon and pesticide limits,
insurance underwriting. The circuit is the reusable part; the campaign contract
is one application of it.
