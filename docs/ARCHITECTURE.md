# Architecture

How Harvest fits together, which decisions were genuinely contested, and the
things that only became clear after they broke.

---

## The shape

```
┌───────────────────────── the farmer's device ─────────────────────────┐
│                                                                        │
│  farmerSecret ──► Poseidon ──► commitment ─────────┐                   │
│                                                     │                  │
│  ┌── circom witness ──────────────────────────┐    │                  │
│  │ private: yieldKg, parcelId, cropCode,      │    │                  │
│  │          farmerSecret, EdDSA signature     │    │                  │
│  │ public : issuerAx, issuerAy, threshold,    │    │                  │
│  │          season, nullifier, addressBinding │    │                  │
│  └───────────────────┬────────────────────────┘    │                  │
│                      ▼                              │                  │
│              Groth16 / BN254  ~520 ms               │                  │
│                      │                              │                  │
└──────────────────────┼──────────────────────────────┼──────────────────┘
                       │ proof + 6 public signals     │ commitment only
                       ▼                              ▼
        ┌──────────────────────────┐      ┌──────────────────────────┐
        │   HarvestVerifier        │      │   cooperative (issuer)   │
        │   env.crypto().bn254()   │      │   EdDSA-Poseidon signer  │
        │   + issuer allow-list    │      │   never sees the secret  │
        │   + caller binding       │      └──────────────────────────┘
        └────────────┬─────────────┘
                     │ verify_capacity (reverts if false)
                     ▼
        ┌──────────────────────────┐        ┌────────────────────────┐
        │   HarvestCampaign        │───────►│  DeFindex vault        │
        │   nullifier registry     │◄───────│  deposit / withdraw    │
        │   pull-based settlement  │        └────────────────────────┘
        │   anonymous reputation   │
        └────────────┬─────────────┘
                     │ USDC
                     ▼
        ┌──────────────────────────┐
        │  TR anchor SEP-6/10/12/38│  ⇄  Turkish lira / IBAN
        └──────────────────────────┘
```

Three contracts rather than one, following the ZK skill's advice to keep
cryptography, policy and state transitions in separate modules: the verifier is
pure and reusable, the campaign contract holds all the lifecycle state, and the
vault is swappable by address.

---

## The circuit

`circuits/harvest_capacity.circom` — 9,981 constraints, BN254, six public
signals.

It proves one sentence: *"I hold an attestation signed by (Ax, Ay) whose
expected yield is ≥ T, for season S, and my nullifier is N."*

Every public signal is there for a reason, and removing any of them opens a hole:

| Signal | Without it |
| :--- | :--- |
| `issuerAx`, `issuerAy` | A farmer signs their own attestation and proves against it perfectly. |
| `threshold` | Nothing is being claimed. |
| `seasonId` | A 2026 attestation funds a 2027 campaign. |
| `nullifier` | One attestation opens unlimited simultaneous campaigns, and there is no way to accrue repayment history without an identity. |
| `addressBinding` | Anyone watching the network lifts a valid proof and replays it from their own account. |

The signature is verified **inside** the circuit (`EdDSAPoseidonVerifier`, the
bulk of the constraint count) rather than on chain. That is deliberate: checking
it on chain would mean publishing the signed message, and the signed message
commits to the yield. The expensive option is the only private one.

### Why BN254 and not BLS12-381

Both are available on Soroban, and BLS12-381 arrived first (CAP-0059) with the
more battle-tested example. BN254 (CAP-0074) won anyway:

Baby Jubjub — the curve circomlib's EdDSA and Poseidon gadgets are built on — is
**defined over BN254's scalar field**. It does not exist over BLS12-381. Going
BLS12-381 would have meant abandoning circomlib and hand-rolling a signature
scheme and a Poseidon parameterisation for a different field, with the JS and
circuit sides needing to agree exactly. That is a large amount of unaudited
cryptography to write in a week.

The official ZK skill confirms the choice: *"Groth16 over BN254 (Protocol 25+,
CAP-0074) — Circom's default output works here."*

### The trusted setup, honestly

Phase 1 should be the Hermez ceremony. Every published mirror has returned 403
since roughly 2026-09-14 ([iden3/snarkjs#636](https://github.com/iden3/snarkjs/issues/636)),
so `build.mjs` tries all three and then generates phase 1 locally, recording
which path it took in `circuits/build/setup-provenance.json`.

A single-contributor ceremony is only as sound as the machine that ran it.
That is acceptable for testnet and it is **not** acceptable for real money. The
build refuses to pretend otherwise.

---

## Point encoding: the part that cost the most

snarkjs emits decimal strings. Soroban's host wants bytes. The mapping is not
the obvious one, and both mistakes fail in ways that point somewhere else.

**Big-endian, flag bits clear.** Soroban's host is arkworks-backed, so
`ark_serialize`'s `serialize_uncompressed` looks like the natural conversion. It
is not: arkworks writes field elements **little-endian** and packs point flags
into the top bits of the final byte. The host's deserialiser rejects both:

```
bn254 G1 deserialize: the two flag bits must be unset
```

**G2 is imaginary-part first.** snarkjs writes `pi_b[0] = [x.c0, x.c1]`. The
host wants `x.c1 || x.c0`. Getting this backwards sails past the flag check and
then fails with `bn254 G2: point not on curve` — which reads like a corrupt
proof and is actually a field-ordering bug.

Sizes for BN254: `Fq`/`Fr` 32 bytes, G1 64, G2 128. (The ZK skill quotes 96/192
for BLS12-381.)

Because this is encoded independently in Rust (tests) and JavaScript (deploy,
browser), the two can drift — and drift surfaces as an unexplained
`InvalidProof` from a live contract, which is close to undebuggable in a demo.
So `checkEncodingAgainstFixture()` re-derives the JS encoding from the same
fixture the Rust tests verify, and `scripts/deploy.mjs` runs it before every
deploy.

---

## What the verifier enforces beyond the pairing

The ZK skill's first gotcha is the one worth internalising: *"A valid proof only
shows some witness satisfies the circuit."* The contract still has to decide
what the public inputs **mean**.

1. **Issuer allow-list.** The proof commits to the signing key; the contract
   checks that key is an accredited cooperative. `rogue-issuer.json` is a fixture
   of a *cryptographically flawless* proof under a self-generated key, and the
   test asserts it is refused anyway.
2. **Canonical signal order.** Callers pass a typed `CapacityClaim`, never a raw
   vector, so they cannot permute signals into a different statement than the
   circuit was compiled for.
3. **Caller binding.** `sha256(strkey)` with the leading byte cleared. The
   clearing matters: a full 256-bit digest could reduce onto the same BN254
   field element as another, and the binding would stop being injective.

Hashing the **strkey** rather than the XDR encoding was chosen so a browser can
reproduce it in one line with no XDR library and no ambiguity about whether the
payload is an `ScVal` or a bare `ScAddress`.

---

## The vault

`DefindexVaultClient` mirrors `paltalabs/defindex`'s `VaultTrait` exactly:

```rust
fn deposit(e, amounts_desired: Vec<i128>, amounts_min: Vec<i128>, from: Address, invest: bool)
    -> (Vec<i128>, i128, Option<Vec<Option<AssetInvestmentAllocation>>>)
fn withdraw(e, df_amount: i128, min_amounts_out: Vec<i128>, from: Address) -> Vec<i128>
```

`deposit`'s third return value is a per-strategy report whose types live in
DeFindex's own crates. Harvest decodes it as an opaque `Val` and discards it,
which avoids vendoring those types purely to throw the value away — and is what
keeps the test twin and the real vault interchangeable.

**The escrow is a real DeFindex vault.** The precondition for using one is that
it holds the *same* USDC the anchor settles (`GBBD47IF…`); a vault holding a
different USDC would make the fiat rail and the escrow two unrelated systems
wearing the same label. DeFindex's own testnet USDC vault fails that test: it
holds Blend's testnet USDC (`CAQCFVLO…`). So
[`scripts/deploy-defindex.mjs`](../scripts/deploy-defindex.mjs) creates a vault
through DeFindex's testnet factory with the anchor's USDC as its only asset, and
deploys a campaign contract initialised with that vault's address. The contract
code did not change.

Two consequences worth stating:

- **No yield on testnet.** DeFindex's testnet Blend strategy only accepts Blend's
  USDC, so no strategy is attached and escrow sits idle. On mainnet the same vault
  takes a Blend USDC strategy. Wiring our own Blend pool on testnet (pool, oracle,
  backstop, strategy, and a borrower so interest exists at all) was weighed and
  left out: hours of work for a few stroops of visible yield.
- **Minimum liquidity.** A DeFindex vault locks a small amount of shares on its
  first deposit. If a campaign had made that deposit it would recover slightly
  less than it put in, and `disburse`, which pays the farmer exactly `raised`,
  would fail. The deploy script seeds the vault with 1 USDC first; after that,
  with no yield, shares stay 1:1 with USDC and nothing is lost to rounding.
  [`scripts/lifecycle-on-testnet.mjs`](../scripts/lifecycle-on-testnet.mjs)
  checks the amounts at every step to prove it.

`mock-defindex-vault` stays in the repository for the contract tests, which
should not depend on testnet and which exercise the yield paths.

### The authorization depth problem

The vault *pulls* tokens, so the transfer happens two invocations below Harvest.
Soroban auto-authorizes a contract's **direct** sub-calls only. Without
pre-authorizing the nested transfer the deposit fails with an authorization
error that points nowhere near the cause:

```rust
env.authorize_as_current_contract(vec![env,
    InvokerContractAuthEntry::Contract(SubContractInvocation {
        context: ContractContext { contract: token_addr, fn_name: Symbol::new(env, "transfer"), args },
        sub_invocations: vec![env],
    }),
]);
```

---

## Settlement

Pull-based, not push. Each terminal path fixes an `investor_pool` and investors
claim pro rata against their contribution.

Pushing to a list of addresses would make settlement O(n) in a single
transaction and let one unfunded or hostile account block everyone else's exit.

| Path | Pool | Farmer |
| :--- | :--- | :--- |
| Goal missed | full vault position — principal **plus** yield earned while waiting | — |
| Goal met | yield earned during funding | draws `raised` |
| Repaid | yield + principal + agreed return | repaid from harvest proceeds |

The asymmetry in the "goal missed" row is the whole argument for the vault being
load-bearing rather than decorative.

---

## Anonymous reputation

Repayments accrue to the **nullifier**, never to an address:

```rust
DataKey::Reputation(BytesN<32>) -> u32
```

Since the nullifier is `Poseidon(farmerSecret, season)` and the secret never
leaves the device, a farmer builds a cheaper cost of capital across seasons
while remaining unidentified. `quoted_rate_bps` drops 200bps per completed
season, floored at 900.

Two honest limitations: the nullifier is per-season by construction, so
cross-season history needs a second circuit proving *"I know the secret behind
nullifier N₂₀₂₅ and N₂₀₂₆"* — which is the natural next circuit but is not
written. And a farmer who loses their secret loses the history, not the funds.

---

## Turkish lira, and why the chain is denominated in USDC

The TR anchor settles **USDC**, not a TRY token. Lira is the fiat leg only.

An earlier draft of this project put a "TRY token" on chain. That design cannot
work: no anchor will redeem a token it did not issue, so the fiat rail and the
ledger would be disconnected. Denominating in the asset the anchor actually
settles is what makes lira-in/lira-out a single system.

One trap worth recording: SEP-6 `/deposit` prices its `amount` in **lira**, not
in the asset being delivered. Passing a USDC figure fails with `amount below
minimum (50.00 TRY)`, which reads like a limits problem and is a units problem.

### The way back: USDC to an IBAN

The withdrawal runs in four steps, all driven from the app:

1. **SEP-12.** The payout IBAN goes to the anchor as customer data
   (`PUT /customer`, `bank_account_number`). SEP-6 `/withdraw` has no bank field
   for `bank_account`; without this step the sandbox pays out to an IBAN of its
   own and the one the user typed goes nowhere.
2. **SEP-6 `/withdraw`.** The anchor answers with its treasury address and a memo.
3. **The payment.** The user's wallet sends the USDC to that address with that
   memo; the anchor attributes incoming payments to withdrawals by the memo.
4. **Polling** `/transaction` until the anchor reports the lira paid.

The anchor rejects an IBAN with a bad ISO 13616 checksum. That check runs in the
browser too, before anything is sent, so a typo can never cost the user the USDC
leg. [`scripts/anchor-roundtrip.mjs`](../scripts/anchor-roundtrip.mjs) proves both
directions on testnet.

---

## Wallets

Every signature in the app goes through one shape, `{ sign(tx), signChallenge(xdr) }`.
Behind it, users connect their own wallet through **Stellar Wallets Kit**
(Freighter, xBull, Albedo, LOBSTR, Hana and the kit's other default modules), so
the app holds no keys. For someone without a wallet there is a demo keypair kept
in `localStorage`, labelled as such. The kit is imported lazily because its wallet
modules touch `window` and `localStorage` on load, which must not happen during
server rendering. Before asking for a signature the app checks the wallet's
network and refuses early with a clear message if it is not on testnet.

A fresh testnet account can do nothing useful until friendbot has funded it and a
USDC trustline exists; without the trustline the token contract refuses any
transfer to it with `Error(Contract, #13)`. The app detects this and puts one
"prepare account" step in front of every action that moves USDC.

### Passkey smart wallets

The third sign-in is a passkey: Face ID, Touch ID, Windows Hello or a phone,
with no seed phrase, no extension and no XLM on the user's side. It uses
Stellar's `smart-account-kit` and the OpenZeppelin smart-account contracts the
kit has already deployed on testnet (account WASM `1b5f4534…`, WebAuthn verifier
`CC7EKIHQ…OM3F`). The wallet is a C-address. It holds USDC through the token
contract (no trustline), and the campaign's `require_auth` is answered by the
passkey signature through the account's `__check_auth`, so fund, claim, create,
disburse and repay work without any contract change. The verifier binds proofs
to `sha256(strkey)`, which covers `C…` addresses as well as `G…`.

A contract account cannot be a transaction source, so these wallets expose
`invoke({contractId, method, args})` next to `sign`: the app simulates to record
the auth the call needs, the passkey signs it, and a fee account submits.

Two things did not work as documented and shaped the design:

- **Fees.** The kit can hand submission to SDF's relayer proxy, but it lives on
  `*.workers.dev`, and Turkish networks reset the TLS handshake to that domain.
  A demo from Türkiye would hang. Each browser therefore keeps one
  friendbot-funded testnet account that pays the fees (the kit's "dedicated
  deployer"). On mainnet that role belongs to the OpenZeppelin Relayer.
- **The anchor.** The TR anchor authenticates with SEP-10, which only knows
  G-accounts; contract accounts need SEP-45, which the sandbox does not offer.
  The lira legs run through the same browser account as a ramp: a deposit lands
  there and is moved into the smart wallet with a token transfer, and a
  withdrawal moves the USDC to the ramp (passkey-signed) before the usual SEP-6
  payment. The UI says so in the anchor window.

[`scripts/passkey-e2e.mjs`](../scripts/passkey-e2e.mjs) runs the whole path on
testnet with a software P-256 authenticator: deploy a smart account, bring lira
in through the anchor, and fund a campaign with a passkey-signed call.

The kit pins `@stellar/stellar-sdk` 16.3, and its generated bindings resolve
whatever SDK is hoisted next to them. XDR objects from one SDK copy are not
recognised by another, so `next.config.js` aliases every `@stellar/stellar-sdk`
import in the bundle to one copy.

---

## Language and currency

Every string in the web app lives in two dictionaries,
`packages/frontend/src/i18n/tr.ts` and `en.ts`. TypeScript makes `en` match
`tr`'s shape exactly, so a missing translation fails the build, and the files
can be reused as is by a redesigned frontend. The first visit follows the
browser language; the choice is kept in `localStorage`. Errors thrown by the
chain layer (outside React) use a small runtime helper, `tl(tr, en)`, that
follows the same picker.

Amounts are USDC on chain. The display currency can be USDC, USD (1:1) or TRY,
converted with the anchor's live mid rate from its `/health` endpoint.

---

## Things deliberately left out

| Cut | Why |
| :--- | :--- |
| **Circle CCTP** | Requirement #2 asks for a *Turkish lira* rail, which the anchor already provides. A cross-chain flow for a diaspora narrative would have diluted the story without carrying load. |
| **Reflector oracle** | Not on the eligible partner list — and the anchor already uses Reflector internally for its USD/TRY rate, so it is in the stack transitively. Saying that honestly beats writing a mock oracle. |
| **A mocked harvest oracle** | Replaced by the cooperative's real EdDSA signature, which the circuit needed anyway. Real cryptography instead of a stub. |
| **x402 agentic payments** | Workshop-aligned and cheap to add, but not load-bearing. Gated behind the core four being finished. |

---

## Problems met while wiring the web app

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| Every anchor call failed in the browser with "Illegal invocation" | `AnchorClient` stored `globalThis.fetch` and called it as a method. Node accepts that; browsers do not. | The default `fetch` is a wrapper function ([`anchor.mjs`](../packages/sdk/src/anchor.mjs)). |
| The SEP-38 quote never appeared | Every SEP-38 call needs the SEP-10 token, including the indicative price. | One SEP-10 session per wallet, opened when the anchor window opens and shared by quote, deposit and withdraw. |
| After the escrow moved to DeFindex, the app still read the old campaign contract | Contract ids were injected into the Next.js bundle through an environment variable, and webpack's cache served a module compiled with the old value. | The app imports `deployments.json` directly, so webpack tracks the file. |
| "Withdraw advance" failed with `Error(Contract, #13)` | The farmer's fresh account had no USDC trustline. The token's error numbers overlap the campaign contract's. | A "prepare account" step before any USDC-moving action; token errors mapped by call. |
| Node scripts finished their work and never exited | snarkjs keeps its curve worker threads alive. | `curve_bn128.terminate()` at the end of every proving script. |

---

## Testing

| Layer | Count | What it actually proves |
| :--- | ---: | :--- |
| Circuit | 11 | A real proof verifies, and four distinct cheats are refused: overclaiming the threshold, editing the yield under an old signature, self-signing the attestation, and tampering with public signals after the fact. |
| Contract | 17 | The pairing runs in the Soroban host over real circom artefacts. Covers accept, wrong statement, unaccredited issuer, replay, revocation, and the full campaign lifecycle including a failed campaign returning principal + yield. |
| Browser | 15 | The earlier Vite app against the real cooperative service and the deployed contracts. Asserts the payload excludes the private yield, and that the live contract refuses both an inflated claim and a replay. |
| Testnet lifecycle | 1 script | [`lifecycle-on-testnet.mjs`](../scripts/lifecycle-on-testnet.mjs): two fresh accounts funded in lira through the anchor, a real proof, then create, fund, disburse, repay and claim against the DeFindex vault, with the money checked at each step. |
| Fiat round trip | 1 script | [`anchor-roundtrip.mjs`](../scripts/anchor-roundtrip.mjs): lira in to USDC, then USDC out to an IBAN through SEP-12 and SEP-6. |

The negative cases outnumber the positive ones on purpose. A proof system that
has only ever been shown accepting things has not been shown to do anything.
