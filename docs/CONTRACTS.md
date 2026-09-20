# Contract reference

All on Stellar testnet, `soroban-sdk 27.0.6`, built for `wasm32v1-none`. The
addresses below are the ones recorded in [`deployments.json`](../deployments.json),
which the frontend imports at build time.

| Contract | Address |
| :--- | :--- |
| `HarvestVerifier` · capacity key | [`CANPSPHJ…KL3B`](https://stellar.expert/explorer/testnet/contract/CANPSPHJIKTFE7G63BO6TG5M53RU7DKRH26RWKHFCMO6GKQFQAKIKL3B) |
| `HarvestVerifier` · enrolment key | [`CBAZKAVJ…SB3W`](https://stellar.expert/explorer/testnet/contract/CBAZKAVJLF6BLNXEVYWWM5POXI5ADUIVZYTQE35EPEDZLVUV373NSB3W) |
| `HarvestRegistry` | [`CB5VQGRS…BJFQ`](https://stellar.expert/explorer/testnet/contract/CB5VQGRSHEAEVG4U47KAYUN5VSTTTWPKEJHJ7WYLSROGEV7EFJWSBJFQ) |
| `HarvestCampaign` | [`CD6CVVLD…ZHXP`](https://stellar.expert/explorer/testnet/contract/CD6CVVLDQGQ5OVQWPKTHVLNHFIPKXCFJGGLRMADOXQ7YGXED7RTYZHXP) |
| DeFindex vault (USDC) | [`CBO3I46J…YNQN`](https://stellar.expert/explorer/testnet/contract/CBO3I46J5JK7TXN2S2VSUYVHOEMQZ3WGNFVXSSUNTU3C53NZ3YHHYNQN) |
| DeFindex factory | [`CDSCWE4G…4A32`](https://stellar.expert/explorer/testnet/contract/CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32) |
| USDC (SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Amounts are `i128` in stroops (7 decimals), matching USDC on Stellar. The two
verifier rows are the *same wasm* deployed twice, each initialized with a
different verification key — see [Two deployments, one implementation](#two-deployments-one-implementation).

---

## HarvestVerifier

Groth16 verification over BN254, plus the three policy checks a bare pairing
cannot provide.

### Types

```rust
struct VerificationKey { alpha: Bn254G1Affine, beta: Bn254G2Affine,
                         gamma: Bn254G2Affine, delta: Bn254G2Affine,
                         ic: Vec<Bn254G1Affine> }   // len == 7

struct Proof { a: Bn254G1Affine, b: Bn254G2Affine, c: Bn254G1Affine }

struct CapacityClaim {
    issuer_ax: BytesN<32>,        // accredited Baby Jubjub key, x
    issuer_ay: BytesN<32>,        //                             y
    threshold_kg: u64,            // capacity: kilograms; enrolment: document mask
    season: u32,
    nullifier: BytesN<32>,        // Poseidon(farmerSecret, season[, tag])
    address_binding: BytesN<32>,  // sha256(strkey), high byte cleared
}
```

`CapacityClaim` is a struct rather than a signal vector so callers cannot
reorder the public inputs into a different statement than the circuit was
compiled for. The contract expands it in canonical order:
`[issuerAx, issuerAy, threshold, season, nullifier, addressBinding]`.

### Functions

| Function | Auth | Notes |
| :--- | :--- | :--- |
| `initialize(admin, vk)` | admin | Once only. Rejects a key whose `ic` length does not match the public signal count. The VK is deliberately not updatable — rotating it would silently change which circuit the chain trusts. |
| `accredit_issuer(ax, ay, label)` | admin | Adds a cooperative signing key. |
| `revoke_issuer(ax, ay)` | admin | Outstanding proofs from that issuer stop verifying immediately. |
| `is_accredited(ax, ay) -> bool` | — | |
| `address_binding(who) -> BytesN<32>` | — | Public so clients derive it rather than guessing. |
| `verify_capacity(caller, claim, proof)` | — | **The gate.** `Ok(())` only if the pairing passes *and* the issuer is accredited *and* the proof is bound to `caller`. Errors rather than returning `false`, so a caller cannot forget to check. |
| `check_capacity(caller, claim, proof) -> bool` | — | Same checks, reports instead of trapping. Used by the UI's rejection demo, where failure is the point. |

### Errors

| # | Meaning |
| ---: | :--- |
| 1 / 2 | `AlreadyInitialized` / `NotInitialized` |
| 3 | `NotAuthorized` — not the admin |
| 4 | `MalformedVerificationKey` — `ic` length ≠ signals + 1 |
| 5 | `IssuerNotAccredited` — valid maths, unrecognised signer |
| 6 | `AddressBindingMismatch` — proof was made for another account |
| 7 | `InvalidProof` — the pairing check failed |
| 8 | `UnsupportedAddressFormat` — strkey was not 56 characters |

### Two deployments, one implementation

Capacity and enrolment are different circuits with different verification keys,
but both publish six signals in the same order, so one implementation serves
both. Each deployment holds exactly one key and therefore accepts exactly one
kind of proof — an enrolment proof sent to the capacity verifier fails the
pairing, and the registry's own tests assert it.

In the shared wire format, `threshold_kg` carries kilograms for a capacity
claim and the document mask for an enrolment claim.

---

## HarvestRegistry

Records that an accredited cooperative checked a farmer's documents, without
recording who the farmer is.

```rust
struct Registration {
    nullifier: BytesN<32>,   // Poseidon(farmerSecret, season, ENROLMENT_TAG)
    farmer: Address,         // the account that will open campaigns
    doc_mask: u64,           // which checks the proof published
    season: u32,
    registered_at: u64,
}
```

No name, no identity reference, no parcel, no land area. The nullifier is the
only handle and is unlinkable to the person without their secret.

| Bit | Meaning | Required by the configured registry |
| ---: | :--- | :--- |
| `1` | ÇKS farmer registration checked | Yes |
| `2` | Title deed or lease checked | Yes |
| `4` | TARSİM insurance checked | No |
| `8` | Private land area clears the circuit's floor of 10 decares | Yes |

The deployed registry requires mask `11` — bits 1, 2 and 8. Bit 8 is computed
*inside* the circuit from the privately signed area, so the chain learns that
the holding is large enough without learning how large.

| Function | Auth | Notes |
| :--- | :--- | :--- |
| `initialize(admin, verifier, required_mask)` | admin | Wires the enrolment verifier and the mask an enrolment has to clear. |
| `register(farmer, claim, proof) -> count` | farmer | Checks the mask first, then the nullifier, then calls `verify_capacity`. A valid proof for an insufficient mask is refused before any pairing runs. |
| `is_registered(nullifier) -> bool` | — | Has this enrolment nullifier been spent? |
| `registration_of(nullifier)` | — | The record above. |
| `registration_of_address(farmer)` / `is_address_registered(farmer)` | — | Lets the app ask "is this account enrolled?" without holding the secret. |
| `registered_count() -> u32` | — | |
| `config() -> (admin, verifier, required_mask)` | — | |

### Errors

| # | Meaning |
| ---: | :--- |
| 1 / 2 | `AlreadyInitialized` / `NotInitialized` |
| 3 | `AlreadyRegistered` — this secret already enrolled for this season |
| 4 | `InsufficientDocuments` — the proof is valid, but the mask does not cover what the registry insists on |
| 5 | `NotFound` |

### Events

`(member, enrolled)` with `(farmer, mask, season)`.

---

## HarvestCampaign

Lifecycle, vault escrow, partial drawdowns and anonymous reputation.

| From | Call | To | When |
| :--- | :--- | :--- | :--- |
| `Funding` | `fund` | `Funding` | A contribution arrives and goes into the vault |
| `Funding` | `fund` | `Funded` | The contribution that reaches the target |
| `Funding` | `disburse` | `Funding` | The minimum is met and funding is still open: draw now, draw again as more arrives |
| `Funding` | `disburse` | `Disbursed` | Same, but the deadline has passed — the drawdown closes funding |
| `Funded` | `disburse` | `Disbursed` | The target was reached; the rest is drawn and funding closes |
| `Funding` | `close_unfunded` | `Refunding` | The deadline passed below the minimum |
| `Disbursed` | `repay` | `Repaid` | The farmer repays what was drawn plus the return |
| `Repaid` / `Refunding` | `claim` | — | Each investor takes their pro-rata share, once |

`min_bps` is what makes the left-hand branch possible: the share of the target,
in basis points, that has to be raised before the farmer may draw. `5_000` is
half the target; `10_000` is the classic all-or-nothing campaign. The minimum
itself is `(target × min_bps + 9_999) / 10_000` — rounded up, never down.

```rust
struct Campaign {
    id: u32, farmer: Address, crop: String, region: String,
    season: u32, threshold_kg: u64, nullifier: BytesN<32>,
    target: i128, raised: i128, shares: i128, deadline: u64,
    return_bps: u32,
    min_bps: u32,          // minimum share of the target before a drawdown
    disbursed: i128,       // principal paid to the farmer so far
    status: CampaignStatus,
    investor_pool: i128,   // fixed once the campaign is terminal
}
```

| Function | Auth | Notes |
| :--- | :--- | :--- |
| `initialize(admin, verifier, vault, token)` | admin | Wires the three addresses. |
| `create_campaign(farmer, claim, proof, crop, region, target, deadline, return_bps, min_bps)` | farmer | Calls `verify_capacity` first — the whole transaction reverts if the proof does not hold. Then spends the nullifier. `min_bps` is the ninth argument; a client built against the earlier all-or-nothing interface fails the call. |
| `fund(investor, id, amount) -> shares` | investor | Transfers USDC in and deposits it into the vault in the same call. Nothing idles in this contract. |
| `disburse(id) -> paid` | farmer | Pays out `raised − disbursed`, the part not yet drawn. Callable again every time more arrives. Once funding has closed — target reached or deadline passed — it also moves the campaign to `Disbursed`, which is what opens repayment, even when there was nothing new to pay. |
| `close_unfunded(id) -> recovered` | — | Only after the deadline and only **below** the minimum. Unwinds the whole position, so the pool is principal **plus** yield, and releases the nullifier so the farmer can try again this season with a smaller target. |
| `amount_due(id) -> i128` | — | `disbursed + disbursed × return_bps / 10_000`. The farmer owes what was drawn, not what was targeted. |
| `repay(id) -> tier` | farmer | Adds the repayment to the pool and increments the nullifier's tier. |
| `claim(investor, id) -> payout` | investor | Pro rata against contribution. Once per investor. |
| `get_campaign(id)`, `campaign_count()`, `investment_of(id, who)`, `has_claimed(id, who)`, `config()` | — | Views. |
| `reputation_of(nullifier) -> u32` | — | Completed repayments behind an anonymous handle. |
| `quoted_rate_bps(nullifier) -> u32` | — | 1500 bps, −200 per completed season, floor 900. Indicative: `create_campaign` still takes its own `return_bps`. |

### Errors

| # | Meaning |
| ---: | :--- |
| 1 / 2 | `AlreadyInitialized` / `NotInitialized` |
| 3 | `NotFound` |
| 4 | `NullifierAlreadyUsed` — this attestation already opened a campaign this season |
| 5 | `InvalidAmount` |
| 6 | `WrongStatus` |
| 7 | `DeadlineNotReached` |
| 8 | `DeadlinePassed` |
| 9 | `ExceedsTarget` |
| 10 | `NothingToClaim` |
| 11 | `AlreadyClaimed` |
| 12 | `InvalidParameters` — non-positive target, `return_bps` above 10,000, or `min_bps` outside 1–10,000 |
| 14 | `BelowMinimum` — a drawdown before `min_bps` of the target is raised |
| 15 | `NothingToDisburse` — nothing new to draw while funding is still open |

**13 is deliberately skipped.** A campaign call surfaces errors from the USDC
token contract too, and callers already read `#13` from the token as "no
trustline". Reusing it here would have made a missing trustline and a campaign
rule indistinguishable in the interface.

### Events

`(campaign, created|funded|disburse|repaid|claimed|unfunded)`

---

## The vault

The campaign contract talks to a vault through `DefindexVaultClient`, which
mirrors `paltalabs/defindex`'s `VaultTrait` exactly, so the vault address can
point at a live DeFindex vault or at the local twin with no code change.

The recorded deployment is a **real DeFindex vault**, created through the
factory for the same Circle testnet USDC the anchor settles and seeded with
1 USDC so the campaign contract is not the depositor that pays the vault's
locked minimum liquidity. Its strategy list is empty, so it does not currently
earn: the yield accounting the contract implements is exercised by the tests
against the mock, not by the recorded vault.

### MockDefindexVault

| Function | Notes |
| :--- | :--- |
| `deposit(amounts_desired, amounts_min, from, invest)` | Returns `(amounts, shares, report)`. Shares are priced against current holdings, so late depositors do not dilute earlier ones. |
| `withdraw(df_amount, min_amounts_out, from)` | Burns shares, returns underlying. |
| `balance(id)`, `total_shares()`, `fetch_total_managed_funds()`, `accrued_yield()` | Views. |
| `price_per_share()` | Underlying per 1e7 shares. Starts at 1e7. |
| `accrue_yield(amount)` | **Demo lever, manager only.** Records an accrual for display. The share price is derived from the vault's *actual* token balance, so this cannot fake yield that is not there — the tokens have to really be minted to the vault. |

It is not a yield strategy. It exists so contract tests do not depend on testnet
liveness and so a 45-day funding window fits in a four-minute demo.

---

## Superseded addresses

`deployments.json` keeps them under `legacy`, and their campaigns stay readable
on chain. Campaigns do **not** migrate to a replacement contract: they are
opened again, and their ids restart, so an id noted from an earlier deployment
no longer refers to the same campaign.

| Address | Why it was replaced |
| :--- | :--- |
| `CDBFK23U…TQRH` | Escrowed into `mock-defindex-vault`; superseded by the DeFindex vault |
| `CCB6E5GR…GG63` | All-or-nothing campaign contract; superseded by the minimum-threshold version |
| `CDXKZAQI…AKVO` | A same-day parallel redeploy of the all-or-nothing pair made on the enrolment branch |
