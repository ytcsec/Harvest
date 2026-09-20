# Architecture

How Harvest fits together, which decisions were genuinely contested, and the
things that only became clear after they broke.

---

## The shape

```
                         farmer's documents + commitment
                                      │
                                      ▼
                         ┌────────────────────────┐
                         │ cooperative (issuer)   │  EdDSA-Poseidon over its
                         │ never sees the secret  │  own records; binds the
                         └───────────┬────────────┘  membership to a commitment
                                     │ signed credential, private
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ the farmer's device                                                          │
│   witness ──► Groth16 / BN254 ──► proof + 6 public signals                   │
│                                                                              │
│   private : yieldKg · parcelId · cropCode · landDecares · the signature      │
│   public  : issuer · threshold or docMask · season · nullifier ·             │
│             addressBinding                                                   │
└───────────────┬──────────────────────────────────┬───────────────────────────┘
                │ enrolment proof                  │ capacity proof
                ▼                                  ▼
    ┌────────────────────────┐         ┌────────────────────────┐
    │ Verifier · enrolment   │         │ Verifier · capacity    │
    │ key + issuer allowlist │         │ key + issuer allowlist │
    └───────────┬────────────┘         └───────────┬────────────┘
                │ verify_capacity                  │ verify_capacity
                ▼                                  ▼
    ┌────────────────────────┐         ┌────────────────────────┐
    │ HarvestRegistry        │         │ HarvestCampaign        │◄──► DeFindex
    │ document mask          │         │ nullifiers, drawdowns  │     USDC vault
    │ enrolment records      │         │ settlement, reputation │
    └────────────────────────┘         └───────────┬────────────┘
                                                   │ USDC
                                                   ▼
                                       TR anchor · SEP-1/6/10/12/38
                                             ⇄ Turkish lira / IBAN
```

Separate contracts rather than one, following the ZK skill's advice to keep
cryptography, policy and state transitions in separate modules: the verifier is
pure and reusable, the registry and the campaign contract each hold their own
state, and the vault is swappable by address. The registry and the campaign
contract do **not** call each other — see
[Enrolment is a parallel track](#enrolment-is-a-parallel-track).

---

## The circuits

Two circuits, six public signals each, both Groth16 over BN254.

| Circuit | Constraints | Proves |
| :--- | ---: | :--- |
| `harvest_capacity.circom` | 9,981 | *"I hold an attestation signed by (Ax, Ay) whose expected yield is ≥ T, for season S, and my nullifier is N."* |
| `harvest_enrolment.circom` | 10,149 | *"An accredited cooperative checked my documents, the checks it passed are the bits in M, and my holding clears the area floor."* |

Constraint counts are the ones recorded in `circuits/build/*setup-provenance.json`
by the local build.

Every public capacity signal is there for a reason, and removing any of them
opens a hole:

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

### The land bit

The enrolment circuit takes `landDecares` as a private input and publishes one
bit of it: whether it clears `MIN_DECARES = 10`, one hectare. The comparison
happens in the circuit, so the registry can insist on a productive holding
without anyone publishing how much land the farmer works. The other three mask
bits are the document checks the cooperative signed — ÇKS registration, title
deed or lease, TARSİM insurance — and the deployed registry requires mask `11`:
the first two documents plus the land bit.

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
payload is an `ScVal` or a bare `ScAddress`. It also works unchanged for a `C…`
contract address, which is what made passkey smart accounts a frontend change
rather than a circuit change.

### One implementation, two deployments

Capacity and enrolment publish six signals each, in the same order, so the same
verifier wasm serves both — deployed twice, each instance holding one
verification key. An enrolment proof submitted to the capacity instance fails
the pairing, which is the property that keeps one proof type from being
accepted as the other. In the shared wire format, `threshold_kg` carries
kilograms for capacity and the document mask for enrolment.

---

## Enrolment is a parallel track

The registry verifies and stores enrolments; the campaign contract verifies
capacity proofs. Neither calls the other.

That is a deliberate simplification with an honest cost. The app checks the
registry before it lets a farmer open a campaign, and the cooperative service
gates attestation on its own record of the membership — but the *contract* does
not require a registry lookup, so an accredited issuer can sign a usable
capacity credential outside the application's enrolment sequence. Wiring the
campaign contract to the registry would close that gap and cost a cross-contract
call on every campaign creation; it is a policy decision, not a cryptographic
one, and it is recorded rather than hidden.

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
keeps the local twin and the real vault interchangeable.

The recorded deployment is a real vault created through the DeFindex factory,
denominated in the *same* USDC the anchor settles (`GBBD47IF…`). That
precondition is not a detail: a vault holding a different USDC would make the
fiat rail and the escrow two unrelated systems wearing the same label.

Two things the deployment made concrete. The vault locks a minimum liquidity
amount out of its first deposit, so `deploy-defindex.mjs` seeds it with 1 USDC
from the deployer — if a campaign made that first deposit, it would recover less
than it put in. And its strategy list is empty, so the recorded vault does not
actually earn: the yield accounting below is exercised by the tests against the
mock, not by testnet.

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
| Below the minimum at the deadline | full vault position — principal **plus** yield earned while waiting | — |
| Minimum met | yield earned while the money waited | draws `raised − disbursed`, and draws again as more arrives |
| Repaid | yield + drawn principal + agreed return | repays what was drawn, from harvest proceeds |

The asymmetry in the first row is the whole argument for the vault being
load-bearing rather than decorative.

### Why the minimum exists

All-or-nothing crowdfunding has a failure mode that costs a farmer their
season: 80% funded on the deadline returns every lira and finances nothing.
`min_bps` lets the farmer name the raise that is still viable — half the target,
typically — and draw it while funding stays open. Each later contribution is
drawable too, so the campaign does not have to choose between starting late and
starting small.

The obligation follows the drawdowns, not the target: `amount_due` is
`disbursed + disbursed × return_bps / 10_000`. A farmer who drew half the target
repays the return on half, and the investors who funded the other half are
repaid out of the same pro-rata pool.

Two consequences worth stating plainly. Once the minimum is met the refund path
closes — `close_unfunded` refuses — so a campaign whose farmer never calls
`disburse` sits in `Funding` and its investors cannot claim. And because
`disburse` takes the whole vault position each time, the yield earned between
drawdowns is booked to the investors at each one, not at the end.

---

## Anonymous reputation

Repayments accrue to the **nullifier**, never to an address:

```rust
DataKey::Reputation(BytesN<32>) -> u32
```

Since the nullifier is `Poseidon(farmerSecret, season)` and the secret never
leaves the device, a farmer builds a cheaper cost of capital across seasons
while remaining unidentified. `quoted_rate_bps` drops 200 bps per completed
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

---

## The browser

Next.js 14 with React 18, Turkish and English, proving in the browser with
snarkjs over artifacts copied out of `circuits/build` by a `predev`/`prebuild`
step. Three ways to hold an account: a wallet through Stellar Wallets Kit, a
throwaway testnet demo wallet, or a WebAuthn passkey smart account built on
`smart-account-kit`.

Two things that bite anyone working in this tree:

**One Stellar SDK, not two.** The frontend pins `~16.3` and `smart-account-kit`
resolves its own copy; two copies mean XDR objects that fail `instanceof` across
the signing seam. `next.config.js` aliases the browser imports onto one copy.

**The passkey account is a `C…` address, the anchor authenticates `G…`.** So a
browser-held ramp account does the SEP-10 leg and moves USDC to and from the
smart wallet, and pays transaction fees. That is a demo shape, not a design: a
production anchor supporting contract accounts removes the ramp entirely.

---

## Things deliberately left out

| Cut | Why |
| :--- | :--- |
| **Circle CCTP** | Requirement #2 asks for a *Turkish lira* rail, which the anchor already provides. A cross-chain flow for a diaspora narrative would have diluted the story without carrying load. |
| **Reflector oracle** | Not on the eligible partner list — and the anchor already uses Reflector internally for its USD/TRY rate, so it is in the stack transitively. Saying that honestly beats writing a mock oracle. |
| **A mocked harvest oracle** | Replaced by the cooperative's real EdDSA signature, which the circuit needed anyway. Real cryptography instead of a stub. |
| **x402 agentic payments** | Workshop-aligned and cheap to add, but not load-bearing. Gated behind the core requirements being finished. |
| **A registry check inside the campaign contract** | Enrolment is enforced by the app and the issuer, not by the campaign contract. See [Enrolment is a parallel track](#enrolment-is-a-parallel-track). |
| **A campaign share token** | Contributions are accounting entries in the campaign contract. A transferable position is a secondary-market feature, and settlement would have to change with it. See [ROADMAP](ROADMAP.md). |

---

## Testing

| Layer | Count | What it actually proves |
| :--- | ---: | :--- |
| Circuit | 30 | 11 capacity and 19 enrolment checks: a real proof verifies, and the cheats are refused — overclaiming the threshold, editing the yield under an old signature, self-signing the attestation, tampering with public signals, a holding under the area floor, and re-using a credential. |
| Contract | 28 | 8 verifier, 13 campaign, 7 registry. The pairing runs in the Soroban host over real circom artefacts. Covers accept, wrong statement, unaccredited issuer, replay, revocation, the mask policy, and the full campaign lifecycle including partial drawdowns and a failed campaign returning principal + yield. |
| Testnet scripts | — | `verify`, `enrol`, `anchor`, `lifecycle-on-testnet`, `partial-funding-on-testnet` and `passkey-e2e` run against the deployed contracts with balance assertions. |
| Browser | — | Playwright against the real app, the real cooperative service and the deployed contracts. Asserts the payload excludes the private yield, and that the live contract refuses both an inflated claim and a replay. |

The negative cases outnumber the positive ones on purpose. A proof system that
has only ever been shown accepting things has not been shown to do anything.
