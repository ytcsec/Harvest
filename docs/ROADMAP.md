# Roadmap

What exists, what was deliberately deferred, and what comes next.

---

## Shipped

- circom capacity circuit, 9,981 constraints, Groth16 over BN254
- circom enrolment circuit, 10,149 constraints: cooperative membership and
  selective document disclosure, with the land-area comparison inside the proof
- On-chain verification through Soroban's BN254 host functions, one verifier
  implementation deployed twice — one verification key each
- Accredited-issuer allow-list, nullifier registries, caller binding
- `HarvestRegistry`: enrolment records keyed to a nullifier, required document
  mask, duplicate refusal — no identity on chain
- Campaign lifecycle with vault escrow and pull-based settlement
- **Partial funding**: `min_bps` names the minimum viable raise; the farmer
  draws at the minimum and keeps drawing as contributions arrive, and repays
  what was drawn rather than what was targeted
- A real DeFindex vault, created through the factory for the USDC the anchor
  settles
- Anonymous reputation keyed to the nullifier
- TRY anchor integration: SEP-1/6/10/12/38, round trip confirmed on testnet
- Cooperative attestation service that never sees the farmer's secret
- Next.js app in Turkish and English with in-browser proving
- WebAuthn passkey smart accounts through `smart-account-kit`
- 30 circuit and 28 contract tests, plus Playwright and testnet suites

---

## Next, in priority order

### 1. A strategy behind the vault

The recorded vault is a real DeFindex vault with an **empty strategy list**, so
it holds the escrow without earning on it. Every yield argument in this project
— the reason committing early is not punished — depends on that slot being
filled. Attach a strategy for the settlement asset, then define what happens to
withdrawal liquidity, fees and a loss, none of which the contract currently
models.

### 2. Cross-season reputation

The nullifier is `Poseidon(farmerSecret, season)`, so it is per-season by
construction and history does not currently chain. A second circuit proving
*"I know the secret behind both N₂₀₂₅ and N₂₀₂₆"* links seasons without ever
revealing the secret or the identity. This is the natural next circuit and it is
what turns the reputation tier from a gesture into a real retention mechanism.

### 3. Enrolment enforced on chain

The registry verifies and stores enrolments, but the campaign contract does not
consult it: an accredited issuer can sign a capacity credential that opens a
campaign outside the application's enrolment sequence. Requiring a registry
lookup in `create_campaign` closes that gap at the cost of a cross-contract call
per campaign. Decide it deliberately rather than leaving it implicit.

### 4. Production issuer operations

Attestation is authorized by matching a commitment, which is a lookup, not a
signed possession challenge. The service also has local JSON persistence and
permissive CORS. Before real farmer records: authenticated sessions, access
control, durable storage, and a signing key that does not live in a file next to
the server.

### 5. Off-chain campaign index

`listCampaigns` reads every campaign by id through simulation. Fine at demo
scale, useless at a thousand. Index the contract's events instead, and add
storage renewal while doing it.

### 6. Production trusted setup

Phase 1 currently falls back to a locally generated ceremony because every
Hermez mirror has been returning 403 since 2026-09
([iden3/snarkjs#636](https://github.com/iden3/snarkjs/issues/636)). Before any
real money: pull a real ceremony file, and run a multi-party phase 2 rather than
a single local contribution — for both circuits.

---

## Deferred, with reasons

| | Why it was cut | When it earns its place |
| :--- | :--- | :--- |
| **Circle CCTP** | Requirement #2 asks for a Turkish lira rail, which the anchor already provides. A second cross-chain flow diluted the story without carrying load. | When diaspora investors are a real segment rather than a slide. |
| **Reflector oracle** | Not on the eligible partner list, and the anchor already uses it internally for USD/TRY — so it is in the stack transitively. Writing a mock oracle on top would have been theatre. | Parametric frost/drought insurance, where an oracle genuinely triggers a payout. |
| **x402 agentic payments** | Workshop-aligned and cheap, but not load-bearing. Gated behind the core requirements. | An agent that verifies ÇKS documents before the cooperative signs, paying per call. |
| **Secondary market for positions** | Out of scope for two days, and settlement would have to change: contributions are accounting entries, not a transferable token. | When investors want out before harvest — a position token on a Stellar DEX. |
| **A repayment deadline in the contract** | There is no default timer, collateral or collection flow; after a drawdown, investor claims depend on the farmer repaying. Encoding a deadline without a legal structure behind it would be decoration. | Alongside the licensed-platform partnership, where default has a real remedy. |

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
