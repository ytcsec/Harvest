# Contract reference

All on Stellar testnet, `soroban-sdk 27.0.6`, built for `wasm32v1-none`.

| Contract | Address | Size |
| :--- | :--- | ---: |
| `HarvestVerifier` | [`CANPSPHJ…KL3B`](https://stellar.expert/explorer/testnet/contract/CANPSPHJIKTFE7G63BO6TG5M53RU7DKRH26RWKHFCMO6GKQFQAKIKL3B) | 11,905 B |
| `HarvestCampaign` | [`CD6CVVLD…HZXP`](https://stellar.expert/explorer/testnet/contract/CD6CVVLDQGQ5OVQWPKTHVLNHFIPKXCFJGGLRMADOXQ7YGXED7RTYZHXP) | 21,169 B |
| DeFindex vault (escrow) | [`CBO3I46J…YNQN`](https://stellar.expert/explorer/testnet/contract/CBO3I46J5JK7TXN2S2VSUYVHOEMQZ3WGNFVXSSUNTU3C53NZ3YHHYNQN) | DeFindex's vault WASM |
| DeFindex factory (DeFindex's own) | [`CDSCWE4G…4A32`](https://stellar.expert/explorer/testnet/contract/CDSCWE4GLNBYYTES2OCYDFQA2LLY4RBIAX6ZI32VSUXD7GO6HRPO4A32) | |
| USDC (SAC) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` | |

All addresses are also in [`deployments.json`](../deployments.json), which the app and the scripts read.

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
Funding ──(target reached)──► Funded ──(farmer draws the rest)──► Disbursed ──(repay)──► Repaid
   │  └─(minimum met: farmer draws what has come in, again as more arrives)
   │
   ├──(deadline passed, minimum met, farmer draws)──► Disbursed
   └──(deadline passed, minimum missed)──► Refunding
```

| Function | Auth | Notes |
| :--- | :--- | :--- |
| `initialize(admin, verifier, vault, token)` | admin | Wires the three addresses. |
| `create_campaign(farmer, claim, proof, crop, region, target, deadline, return_bps, min_bps)` | farmer | Calls `verify_capacity` first — the whole transaction reverts if the proof does not hold. Then spends the nullifier. `min_bps` is the share of the target after which the farmer can draw (5000 = 50%; 10000 = all or nothing). |
| `fund(investor, id, amount) -> shares` | investor | Transfers USDC in and deposits it into the vault in the same call. Nothing idles in this contract. |
| `close_unfunded(id) -> recovered` | — | After the deadline on a campaign that missed its **minimum**. Unwinds the whole position, so the pool is principal **plus** yield, and releases the nullifier so the farmer can open a smaller campaign for the same season. |
| `disburse(id) -> advance` | farmer | Once the minimum is met, pays out everything raised and not yet drawn; callable again as more arrives. The funding-window yield stays for investors. After the target or the deadline it also moves the campaign to `Disbursed`, which opens repayment. |
| `amount_due(id) -> i128` | — | `disbursed + disbursed × return_bps / 10_000`: the farmer repays only what was drawn. |
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
| 14 | `BelowMinimum` — less than the campaign's minimum has been raised |
| 15 | `NothingToDisburse` — nothing new to draw, and funding is still open |

### Token errors seen through campaign calls

The USDC token contract's own errors surface through campaign calls and reuse
some of the same numbers: `#13` is a missing trustline (the account cannot
receive USDC), `#10` from `fund` or `repay` is an insufficient balance. The app
maps them by call rather than by number alone.

### Events

`(campaign, created|funded|disburse|repaid|claimed|unfunded)`

---

## DeFindex vault

The escrow. A real DeFindex vault, created by [`scripts/deploy-defindex.mjs`](../scripts/deploy-defindex.mjs)
through DeFindex's own testnet factory (`create_defindex_vault`) with one asset,
the Circle testnet USDC the TR anchor settles, and a vault fee of 0.

| Function | Used by | Notes |
| :--- | :--- | :--- |
| `deposit(amounts_desired, amounts_min, from, invest)` | campaign `fund` | The campaign pre-authorises the nested USDC transfer, then deposits. |
| `withdraw(withdraw_shares, min_amounts_out, from)` | campaign `disburse`, `close_unfunded` | Burns the campaign's shares, returns USDC to the campaign. |
| `fetch_total_managed_funds()` | app | Idle and invested amounts per asset. |
| `total_supply()`, `get_asset_amounts_per_shares(shares)` | app | Share count and the USDC value of one share. |

Two things specific to this deployment:

- **No strategy is attached on testnet.** DeFindex's testnet Blend strategy only
  takes Blend's own testnet USDC (`CAQCFVLO…`), not the Circle USDC the anchor
  pays, so escrowed funds sit idle and earn nothing. On mainnet the same vault
  takes a Blend USDC strategy.
- **It was seeded with 1 USDC before any campaign used it.** A DeFindex vault
  locks a minimum-liquidity amount on its first deposit. Had a campaign made that
  deposit it would get slightly less back, and `disburse`, which pays the farmer
  the full amount raised, would fail. After the seed, shares stay 1:1 with USDC.

The full lifecycle against this vault is exercised by
[`scripts/lifecycle-on-testnet.mjs`](../scripts/lifecycle-on-testnet.mjs).

## MockDefindexVault (tests only)

A local twin of DeFindex's `VaultTrait`, with matching signatures. The contract
tests use it so they do not depend on testnet, and because it can simulate yield.
It is no longer deployed as the escrow.

| Function | Notes |
| :--- | :--- |
| `deposit(amounts_desired, amounts_min, from, invest)` | Returns `(amounts, shares, report)`. Shares are priced against current holdings, so late depositors do not dilute earlier ones. |
| `withdraw(df_amount, min_amounts_out, from)` | Burns shares, returns underlying. |
| `balance(id)`, `total_shares()`, `fetch_total_managed_funds()` | Views. |
| `price_per_share()` | Underlying per 1e7 shares. Starts at 1e7. |
| `accrue_yield(amount)` | **Demo lever, manager only.** Records an accrual for display. The share price is derived from the vault's *actual* token balance, so this cannot fake yield that is not there — the tokens have to really be minted to the vault. |

It is not a yield strategy.
