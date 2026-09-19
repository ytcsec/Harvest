/**
 * Soroban contract access for the browser and for scripts.
 *
 * Contract structs cross the wire as `ScVal::Map` with symbol keys in sorted
 * order, and the numeric widths have to match the Rust declarations exactly --
 * a `u64` sent as an `i128` is not coerced, it is a type error at the host. The
 * builders here encode `CapacityClaim` and `Proof` once, correctly, so no
 * caller has to reason about it.
 */

import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";

export const TESTNET_RPC = "https://soroban-testnet.stellar.org";
export const TESTNET_PASSPHRASE = Networks.TESTNET;

/** USDC and the vault both use 7 decimals, Stellar's native precision. */
export const STROOPS = 10_000_000n;
export const toStroops = (amount) => BigInt(Math.round(Number(amount) * 1e7));
export const fromStroops = (raw) => Number(BigInt(raw)) / 1e7;

const sym = (s) => xdr.ScVal.scvSymbol(s);
const bytes = (hex) => xdr.ScVal.scvBytes(Buffer.from(hex.replace(/^0x/, ""), "hex"));

/**
 * Struct -> ScVal::Map.
 *
 * Soroban requires map keys in sorted order; an unsorted map is rejected by
 * the host rather than silently reordered.
 */
function structToScVal(fields) {
  const entries = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, val]) => new xdr.ScMapEntry({ key: sym(key), val }));
  return xdr.ScVal.scvMap(entries);
}

/** `CapacityClaim`, matching the contract's field names and widths. */
export function claimToScVal(claim) {
  return structToScVal({
    address_binding: bytes(claim.address_binding),
    issuer_ax: bytes(claim.issuer_ax),
    issuer_ay: bytes(claim.issuer_ay),
    nullifier: bytes(claim.nullifier),
    season: nativeToScVal(Number(claim.season), { type: "u32" }),
    threshold_kg: nativeToScVal(BigInt(claim.threshold_kg), { type: "u64" }),
  });
}

/** `Proof`: a 64-byte G1, a 128-byte G2, a 64-byte G1. */
export function proofToScVal(proof) {
  return structToScVal({
    a: bytes(proof.a),
    b: bytes(proof.b),
    c: bytes(proof.c),
  });
}

export const addressToScVal = (addr) => new Address(addr).toScVal();
/** A `BytesN<N>` argument, from a hex string. Length is checked by the host. */
export const bytesN = (hex) => bytes(hex);
export const i128 = (v) => nativeToScVal(BigInt(v), { type: "i128" });
export const u32 = (v) => nativeToScVal(Number(v), { type: "u32" });
export const u64 = (v) => nativeToScVal(BigInt(v), { type: "u64" });
export const str = (v) => nativeToScVal(String(v), { type: "string" });

export class SorobanClient {
  constructor({ rpcUrl = TESTNET_RPC, networkPassphrase = TESTNET_PASSPHRASE } = {}) {
    this.server = new rpc.Server(rpcUrl);
    this.networkPassphrase = networkPassphrase;
  }

  /**
   * Simulate without submitting. Used for views, and to surface a contract
   * error before it costs a transaction.
   */
  async read({ contractId, method, args = [], source }) {
    const account = await this.server.getAccount(source);
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (rpc.Api.isSimulationError(sim)) {
      throw new ContractCallError(method, sim.error);
    }
    return sim.result?.retval ? scValToNative(sim.result.retval) : null;
  }

  /**
   * Simulate, sign and submit, then wait for the result.
   *
   * @param {(tx: import("@stellar/stellar-sdk").Transaction) => Promise<string>|string} sign
   *        Returns signed XDR. Lets a passkey wallet, Freighter or a raw
   *        keypair all drive the same path.
   */
  async invoke({ contractId, method, args = [], source, sign, timeoutMs = 60_000 }) {
    const account = await this.server.getAccount(source);
    const built = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(new Contract(contractId).call(method, ...args))
      .setTimeout(60)
      .build();

    const sim = await this.server.simulateTransaction(built);
    if (rpc.Api.isSimulationError(sim)) {
      throw new ContractCallError(method, sim.error);
    }

    // Simulation fills in the footprint and resource fees; skipping this is the
    // usual cause of an otherwise-inexplicable txInsufficientResourceFee.
    const prepared = rpc.assembleTransaction(built, sim).build();
    const signedXdr = await sign(prepared);
    const signed = TransactionBuilder.fromXDR(signedXdr, this.networkPassphrase);

    const sent = await this.server.sendTransaction(signed);
    if (sent.status === "ERROR") {
      throw new ContractCallError(method, JSON.stringify(sent.errorResult ?? sent));
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const got = await this.server.getTransaction(sent.hash);
      if (got.status === "SUCCESS") {
        return {
          hash: sent.hash,
          value: got.returnValue ? scValToNative(got.returnValue) : null,
          explorer: `https://stellar.expert/explorer/testnet/tx/${sent.hash}`,
        };
      }
      if (got.status === "FAILED") {
        throw new ContractCallError(method, `transaction ${sent.hash} failed on chain`);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
    throw new ContractCallError(method, `transaction ${sent.hash} did not confirm in ${timeoutMs}ms`);
  }
}

/**
 * Contract errors arrive as `Error(Contract, #N)`. The raw form tells a user
 * nothing, so map the codes back to what actually went wrong.
 */
export class ContractCallError extends Error {
  constructor(method, detail) {
    const text = String(detail);
    const code = Number(/Error\(Contract, #(\d+)\)/.exec(text)?.[1] ?? NaN);
    super(`${method}: ${CONTRACT_ERRORS[code] ?? text}`);
    this.name = "ContractCallError";
    this.code = code;
    this.raw = text;
  }
}

/** Mirrors the `#[contracterror]` enums. Verifier codes then campaign codes. */
const CONTRACT_ERRORS = {
  4: "verification key does not match the circuit's public signal count",
  5: "that signing key is not an accredited cooperative",
  6: "this proof was generated for a different account",
  7: "the proof does not support this claim",
  8: "unsupported address format",
};

export const CAMPAIGN_ERRORS = {
  3: "campaign not found",
  4: "this attestation has already opened a campaign this season",
  5: "invalid amount",
  6: "the campaign is not in the right state for that",
  7: "the deadline has not passed yet",
  8: "the funding deadline has passed",
  9: "that would take the campaign past its target",
  10: "nothing to claim",
  11: "already claimed",
  12: "invalid campaign parameters",
};

/** Sign with a raw secret key. The browser demo wallet and scripts use this. */
export function keypairSigner(secret) {
  const keypair = Keypair.fromSecret(secret);
  return (tx) => {
    tx.sign(keypair);
    return tx.toXDR();
  };
}
