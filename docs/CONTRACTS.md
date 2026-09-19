# Contract reference

All on Stellar testnet, `soroban-sdk 27.0.6`, built for `wasm32v1-none`.

| Contract | Address | Size |
| :--- | :--- | ---: |
| `HarvestVerifier` | [`CANPSPHJ…KL3B`](https://stellar.expert/explorer/testnet/contract/CANPSPHJIKTFE7G63BO6TG5M53RU7DKRH26RWKHFCMO6GKQFQAKIKL3B) | 11,905 B |
| `HarvestCampaign` | [`CDBFK23U…TQRH`](https://stellar.expert/explorer/testnet/contract/CDBFK23UIF6U2LQFLS5SHRFSKUQACKN6XL63DJ52F7CCWNKDBJHKTQRH) | 19,324 B |
| `MockDefindexVault` | [`CDJQVZFZ…34W3`](https://stellar.expert/explorer/testnet/contract/CDJQVZFZ7NBBOCDOZVDAD2RWIDKC35MGPBGVYQVVZKCD7HFX5UMB34W3) | 7,833 B |
| USDC (SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | — |

Amounts are `i128` in stroops (7 decimals), matching USDC on Stellar.

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
    threshold_kg: u64,            // the only capacity fact revealed
    season: u32,
    nullifier: BytesN<32>,        // Poseidon(farmerSecret, season)
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
| 4 | `MalformedVerificationKey` — `ic` length ≠ signals + 1 |
| 5 | `IssuerNotAccredited` — valid maths, unrecognised signer |
| 6 | `AddressBindingMismatch` — proof was made for another account |
| 7 | `InvalidProof` — the pairing check failed |
| 8 | `UnsupportedAddressFormat` — strkey was not 56 characters |

---

## HarvestCampaign

Lifecycle, vault escrow and anonymous reputation.

```
Funding ──(target reached)──► Funded ──(farmer draws)──► Disbursed ──(repay)──► Repaid
   │
   └──(deadline passed, target missed)──► Refunding
```

| Function | Auth | Notes |
| :--- | :--- | :--- |
| `initialize(admin, verifier, vault, token)` | admin | Wires the three addresses. |
| `create_campaign(farmer, claim, proof, crop, region, target, deadline, return_bps)` | farmer | Calls `verify_capacity` first — the whole transaction reverts if the proof does not hold. Then spends the nullifier. |
| `fund(investor, id, amount) -> shares` | investor | Transfers USDC in and deposits it into the vault in the same call. Nothing idles in this contract. |
| `close_unfunded(id) -> recovered` | — | After the deadline on a campaign that missed. Unwinds the whole position, so the pool is principal **plus** yield. |
| `disburse(id) -> advance` | farmer | Pays out `raised`; the funding-window yield stays for investors. |
| `amount_due(id) -> i128` | — | `raised + raised × return_bps / 10_000`. |
| `repay(id) -> tier` | farmer | Adds the repayment to the pool and increments the nullifier's tier. |
| `claim(investor, id) -> payout` | investor | Pro rata against contribution. Once per investor. |
| `get_campaign(id)`, `campaign_count()`, `investment_of(id, who)`, `has_claimed(id, who)` | — | Views. |
| `reputation_of(nullifier) -> u32` | — | Completed repayments behind an anonymous handle. |
| `quoted_rate_bps(nullifier) -> u32` | — | 1500 bps, −200 per completed season, floor 900. |

### Errors

| # | Meaning |
| ---: | :--- |
| 4 | `NullifierAlreadyUsed` — this attestation already opened a campaign this season |
| 6 | `WrongStatus` |
| 7 | `DeadlineNotReached` |
| 8 | `DeadlinePassed` |
| 9 | `ExceedsTarget` |
| 11 | `AlreadyClaimed` |

### Events

`(campaign, created|funded|disburse|repaid|claimed|unfunded)`

---

## MockDefindexVault

A local twin of DeFindex's `VaultTrait`, with matching signatures so the vault
address can point at either.

| Function | Notes |
| :--- | :--- |
| `deposit(amounts_desired, amounts_min, from, invest)` | Returns `(amounts, shares, report)`. Shares are priced against current holdings, so late depositors do not dilute earlier ones. |
| `withdraw(df_amount, min_amounts_out, from)` | Burns shares, returns underlying. |
| `balance(id)`, `total_shares()`, `fetch_total_managed_funds()` | Views. |
| `price_per_share()` | Underlying per 1e7 shares. Starts at 1e7. |
| `accrue_yield(amount)` | **Demo lever, manager only.** Records an accrual for display. The share price is derived from the vault's *actual* token balance, so this cannot fake yield that is not there — the tokens have to really be minted to the vault. |

It is not a yield strategy. It exists so contract tests do not depend on testnet
liveness and so a 45-day funding window fits in a four-minute demo.
