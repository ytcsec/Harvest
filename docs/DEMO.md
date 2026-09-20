# Demo — five minutes

```bash
npm run issuer      # :8787  the cooperative service
npm run frontend    # :3000  the app
```

Have a second tab open on
[stellar.expert](https://stellar.expert/explorer/testnet/contract/CD6CVVLDQGQ5OVQWPKTHVLNHFIPKXCFJGGLRMADOXQ7YGXED7RTYZHXP).
The language switch is in the header; the labels quoted below are the English
ones.

---

## 0:00 — the problem, in one sentence

> "A Turkish hazelnut grower needs cash in March and gets paid in October. To
> borrow, they have to tell the lender how much they will harvest. The lender is
> usually the same person who will buy that harvest. So disclosing is how the
> price gets broken — and not disclosing means no money."

Do not explain zero-knowledge yet. Let the screen do it.

## 0:30 — the cooperative opens a record

Farmer tab → **Create a demo wallet** (pre-create this before the judges
arrive; friendbot plus the trustline is ~20 s of dead air) → `/kayit`.

Name and national id → ÇKS number, title deed, optional TARSİM → **Send
documents to the cooperative**.

> "The cooperative checks three documents and measures the parcel. Watch what
> reaches the chain."

**Generate the ZK enrolment proof**.

> "Four bits. ÇKS checked, deed checked, insurance not provided, and — this one
> is computed inside the circuit — the holding is over ten decares. The registry
> insists on those. The identity, the parcel and the actual land area are on the
> dashed panel: they stayed on this device."

## 1:30 — the attestation and the choice

`/create` → pick the membership the cooperative just issued → **Get the signed
record**.

> "48.5 tonnes is what the cooperative's own records say. It is on the dashed
> panel again. That is where it stays."

Drag the threshold down to ~38 tonnes.

> "This is the only number the market will ever see. The 10.5 tonnes on the
> right is what keeps the grower's bargaining position intact at harvest."

The two panels are the pitch. Let them sit for a beat.

## 2:00 — proving

**Generate ZK proof.** The stage list runs: witness, proving key, Groth16,
local check, then the Soroban verifier.

> "That proof was built in this browser. Nothing was uploaded. The last line is
> the chain checking it — a BN254 pairing inside the Soroban host, not a server
> we control."

## 2:20 — the part that matters

Directly below the proof: **Test the contract: false claims with the same
proof**.

**Claim a threshold of 90 tonnes with the same proof** → *Rejected: the proof
does not support this claim.*

**Send the same proof from another account** → *Rejected: the proof is bound to
another account.*

> "Same proof both times. The chain refuses both. Nothing was submitted — the
> verifier is being asked in simulation."

**Spend the most time here.** Anyone can show a green tick. Two refusals are
what make the green one mean something.

## 3:00 — opening the campaign

Step 3, **Campaign terms**: target advance, harvest return, funding period, and
**Minimum to draw**.

> "50% minimum. If this campaign only reaches 60% of its target, the grower
> still gets financed — and draws the rest as it arrives. All-or-nothing is a
> choice in this dropdown, not the only option."

**Publish on Stellar** → open the transaction link.

## 3:20 — partial funding, live

Investor tab → fund half the target.

> "That USDC did not stay in our contract. It went into a DeFindex vault in the
> same transaction."

Farmer tab → **Draw the advance**.

> "Half the target, in the grower's wallet, while funding is still open. The
> vault yield earned so far did not go with it — it stays for the investors."

Investor tab → fund the rest → farmer tab → **Draw the advance** again.

> "Every later contribution is drawable too. Then the campaign closes into
> repayment, and the grower owes what was actually drawn plus the agreed
> return — not the return on a target they never received."

## 4:10 — the lira rail, and why the vault is not decoration

Investor tab → **Top up in TRY** → 500 TRY.

> "Real SEP-10 authentication, a SEP-38 price, real testnet USDC landing in the
> wallet. Lira in, spendable balance out. The advance leaves through the same
> anchor to an IBAN."

> "And the vault is load-bearing, not a nice extra. In an economy running this
> much inflation, backing a campaign that then fails means your money sat idle
> for 45 days — a real loss. So the rational move is to wait until a campaign is
> nearly funded. If everyone waits, nothing funds. Yield-bearing escrow removes
> the penalty for going first, and our contract test asserts it: a *failed*
> campaign returns more than was staked."

## 4:45 — close

> "Zero-knowledge, so the grower keeps their commercial secret. A minimum
> instead of all-or-nothing, so a partly funded season still happens. A vault,
> so committing early costs nothing. A lira anchor, so the money is actually
> spendable."

---

## Questions you will get

**"Is the ZK real or a mock?"**
Real. circom, 9,981 constraints for capacity and 10,149 for enrolment, Groth16
over BN254, verified on chain with `env.crypto().bn254()`. `npm run verify`
runs it in front of them; the rejection cases are the proof.

**"Is the vault really DeFindex?"**
Yes — created through the DeFindex factory on testnet, denominated in the same
USDC the anchor settles. Say the next part plainly: its strategy list is empty,
so it holds the money without earning on it. The yield accounting is real in
the contract and exercised by the tests against a mock vault.

**"What happens if the campaign only half fills?"**
The grower named a minimum when opening it. Above the minimum they draw what
was raised and keep drawing as more arrives; below it, at the deadline, the
whole vault position comes back to investors — principal plus whatever it
earned — and the attestation's nullifier is released so they can open a smaller
campaign the same season.

**"Why should a farmer repay?"**
The campaign sits under a cooperative membership, and the cooperative is the
buyer — repayment is netted from harvest proceeds, not chased from an
individual. On top of that, repayment raises an anonymous credit tier tied to
the nullifier, so defaulting costs next season's cheaper capital. That is the
mechanism microfinance already runs on.

**"Is this a security? What about regulation?"**
Turkey has a licensed debt-based crowdfunding regime under SPK. The scaling
path is partnership with a licensed platform, not ignoring it. *(Verify the
current communiqué number before citing it — do not quote a number you have
not checked.)*

**"What is the anchor?"**
`tr-mock-anchor.fly.dev`, a testnet sandbox. The bank wire and KYC are
simulated; the USDC settlement is genuine testnet activity with a transaction
hash.

**"Can a grower use a passkey instead of a wallet?"**
Yes — a WebAuthn smart account, built on `smart-account-kit`. The proof binds to
the contract address, so no circuit change was needed. The anchor still
authenticates classic accounts, so a browser-held ramp account carries that leg.

---

## Before the room

- [ ] Wallet pre-created and funded — friendbot plus a trustline is 20 s of dead air.
- [ ] `deployments.json` current, and the frontend restarted since the last deploy.
- [ ] The issuer running, with an unused membership left for the live enrolment.
- [ ] Proving artefacts warmed: load `/create` once so the 8 MB key is cached.
- [ ] A campaign already open, so the investor view is not empty
      (`node scripts/lifecycle-on-testnet.mjs` or `scripts/open-global-campaigns.mjs`).
- [ ] A rehearsal campaign with a 50% minimum for the drawdown beat, and enough
      USDC in the investor wallet to fund both halves.
- [ ] Explorer tab open on the campaign contract.
- [ ] Phone hotspot ready. Venue wifi fails; the whole ZK half still works offline,
      only the chain calls need network.
