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
        │   HarvestCampaign        │───────►│  vault (DeFindex ABI)  │
        │   nullifier registry     │◄───────│  deposit / withdraw    │
        │   pull-based settlement  │        └────────────────────────┘
        │   anonymous reputation   │
        └────────────┬─────────────┘
                     │ USDC
                     ▼
        ┌──────────────────────────┐
        │  TR anchor  SEP-6/10/38  │  ⇄  Turkish lira / IBAN
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
keeps the local twin and the real vault interchangeable.

**Swapping in the real vault** is a one-line change to `deployments.json`, with
one precondition: the live vault must be denominated in the *same* USDC the
anchor settles (`GBBD47IF…`). A vault holding a different USDC would make the
fiat rail and the escrow two unrelated systems wearing the same label.

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

---

## Things deliberately left out

| Cut | Why |
| :--- | :--- |
| **Circle CCTP** | Requirement #2 asks for a *Turkish lira* rail, which the anchor already provides. A cross-chain flow for a diaspora narrative would have diluted the story without carrying load. |
| **Reflector oracle** | Not on the eligible partner list — and the anchor already uses Reflector internally for its USD/TRY rate, so it is in the stack transitively. Saying that honestly beats writing a mock oracle. |
| **A mocked harvest oracle** | Replaced by the cooperative's real EdDSA signature, which the circuit needed anyway. Real cryptography instead of a stub. |
| **x402 agentic payments** | Workshop-aligned and cheap to add, but not load-bearing. Gated behind the core four being finished. |
| **Passkey smart wallets** | The highest-value remaining item. Deliberately sequenced after the three hard requirements so there was always a working demo. See [ROADMAP](ROADMAP.md). |

---

## Testing

| Layer | Count | What it actually proves |
| :--- | ---: | :--- |
| Circuit | 11 | A real proof verifies, and four distinct cheats are refused: overclaiming the threshold, editing the yield under an old signature, self-signing the attestation, and tampering with public signals after the fact. |
| Contract | 17 | The pairing runs in the Soroban host over real circom artefacts. Covers accept, wrong statement, unaccredited issuer, replay, revocation, and the full campaign lifecycle including a failed campaign returning principal + yield. |
| Browser | 15 | The real app against the real cooperative service and the deployed contracts. Asserts the payload excludes the private yield, and that the live contract refuses both an inflated claim and a replay. |

The negative cases outnumber the positive ones on purpose. A proof system that
has only ever been shown accepting things has not been shown to do anything.
