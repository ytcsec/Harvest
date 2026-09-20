# Official Stellar skill files used

The submission guidelines ask teams to cite which specific skill files from
[skills.stellar.org](https://skills.stellar.org) they used during development.

Two were genuinely consulted, and what each changed is recorded below. Listing
skills that were not actually used would be worth nothing to a reviewer, so the
list is short.

---

## `skills/zk-proofs/SKILL.md`

Source: [stellar/stellar-dev-skill](https://github.com/stellar/stellar-dev-skill/blob/main/skills/zk-proofs/SKILL.md)

The single most useful document in this build. Consulted while choosing the
curve and while debugging point encoding.

**What it settled — curve choice.** The skill states that Groth16 over BN254 is
available from Protocol 25 (CAP-0074) and that *"Circom's default output works
here."* BLS12-381 arrived earlier and has the more mature official example, so
the default instinct was to use it. The skill's confirmation that BN254 is
supported is what made it safe to stay on circom's native curve — which matters
enormously here, because Baby Jubjub (the curve circomlib's EdDSA and Poseidon
gadgets are built on) is defined over BN254's scalar field and does not exist
over BLS12-381. Choosing BLS12-381 would have meant hand-rolling a signature
scheme and Poseidon parameterisation for a different field.

**What it confirmed — encoding.** *"Point encodings are uncompressed
big-endian."* This matched what had been worked out the hard way from the host's
`bn254 G1 deserialize: the two flag bits must be unset` error, and gave
confidence the fix was principled rather than a coincidence that happened to
pass. (The 96/192-byte sizes it quotes are BLS12-381; BN254 is 64/128.)

**What it shaped — the three gotchas.** The skill names three failure modes, and
each maps onto a specific defence in `harvest-verifier`:

| Skill's warning | Where it is answered |
| :--- | :--- |
| *"A valid proof only shows some witness satisfies the circuit"* — the contract must independently validate what the public inputs mean | The accredited-issuer allow-list, and the typed `CapacityClaim` that fixes signal order so callers cannot permute it into a different statement. `tests/data/rogue-issuer.json` is a cryptographically perfect proof under a self-signed key, and the test asserts it is refused. |
| *"Valid proofs can be replayed"* — bind nonces into public inputs, keep an on-chain nullifier set | `address_binding` in the public signals, plus the `DataKey::Nullifier` registry in `harvest-campaign`. Both have dedicated tests. |
| Curve/verifier mismatch | `encodeVerificationKey()` rejects any verification key that is not `groth16` over `bn128` before it can reach a deploy. |

**What it shaped — module layout.** Its recommendation to separate
*"verification gateway → policy layer → application logic"* is why this is
several contracts rather than one: `harvest-verifier` (crypto + accreditation
policy), `harvest-campaign` and `harvest-registry` (state transitions, one for
financing and one for membership), and a vault referenced only by address. The
same separation is what let the verifier be deployed twice, once per circuit,
with no code change.

**What was read and not needed.** The skill's Poseidon caveat — that CAP-0075
exposes Poseidon *permutations* rather than ready-made hash functions, so a
contract recomputing a Merkle root must replicate the circuit's exact sponge
construction — does not apply here, because Harvest never recomputes a Poseidon
hash on chain. The nullifier is carried as a public signal and stored verbatim.
Noting it because it is the trap Harvest would hit first if commitments moved
on chain.

---

## `skills/standards/SKILL.md`

Source: [stellar/stellar-dev-skill](https://github.com/stellar/stellar-dev-skill/blob/main/skills/standards/SKILL.md)

Consulted when choosing how to integrate the fiat rail.

**What it settled — SEP-6 over SEP-24.** The skill splits them cleanly: SEP-6 is
the *"programmatic, API-first"* deposit/withdrawal flow, SEP-24 the *"hosted
interactive"* one. Harvest wants the deposit to happen inside its own investor
screen, alongside the campaign it is funding, rather than in an anchor-hosted
popup — so SEP-6. This also matched what the TR anchor implements.

**What it confirmed — the auth and KYC pairing.** SEP-10 for web authentication
and SEP-12 for KYC data are named as part of the same fiat-rail bundle, which is
the combination `AnchorClient` implements.

**Where it was thin.** SEP-38 is not covered in the skill's high-value list. The
quote flow in `anchor.mjs` was written against the SEP-38 specification and the
anchor's own behaviour instead. The skill's own framing is fair here: *"Treat
this file as a routing map, not a source of final governance/status truth."*

---

## Reference material outside the skills

For completeness, since these did as much work as the skills did:

- [`stellar/soroban-examples/groth16_verifier`](https://github.com/stellar/soroban-examples/tree/main/groth16_verifier)
  — the BLS12-381 verifier and its fixture loader. The pairing structure in
  `verify_groth16` follows it directly; the BN254 encoding differences were
  found from there.
- [`paltalabs/defindex`](https://github.com/paltalabs/defindex/blob/main/apps/contracts/vault/src/interface.rs)
  — `VaultTrait`, read to match `deposit` / `withdraw` signatures exactly.
- [`kaankacar/tr-mock-anchor`](https://github.com/kaankacar/tr-mock-anchor)
  — the TRY anchor sandbox, and the source of the units trap documented in
  ARCHITECTURE.
- `docs.rs/soroban-sdk/27.0.6` — confirming `crypto::bn254` exists and what it
  exposes.
