/**
 * Browser wallet.
 *
 * A Stellar keypair generated in the tab and kept in `localStorage`.
 *
 * This is honestly labelled as a demo wallet throughout the UI, and it is not
 * where the product ends up: farmers onboard through a passkey smart wallet, so
 * their address is a contract (`C...`) authorised by a device biometric with no
 * key material to lose. That path is on the roadmap in docs/ROADMAP.md; what is
 * here is the smallest thing that lets the rest of the flow -- attestation,
 * proving, the anchor, the contracts -- be real rather than mocked.
 *
 * Nothing about the protocol depends on this choice. Every signature goes
 * through one `sign(tx)` callback, so swapping in passkeys or Freighter touches
 * this file and nothing else.
 */

import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const STORAGE_KEY = "harvest.wallet.v1";
const HORIZON = "https://horizon-testnet.stellar.org";

export const USDC = {
  code: "USDC",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

const horizon = new Horizon.Server(HORIZON);
const usdcAsset = new Asset(USDC.code, USDC.issuer);

export function loadWallet() {
  try {
    const secret = localStorage.getItem(STORAGE_KEY);
    if (!secret) return null;
    const keypair = Keypair.fromSecret(secret);
    return { address: keypair.publicKey(), keypair };
  } catch {
    return null;
  }
}

/**
 * Create a wallet, fund it from friendbot, and open a USDC trustline.
 *
 * The trustline matters: a classic Stellar account cannot receive an issued
 * asset without one, so without this the anchor deposit completes and the USDC
 * arrives as a claimable balance the user then has to go and find.
 */
export async function createWallet(onProgress = () => {}) {
  const keypair = Keypair.random();

  onProgress("funding");
  const res = await fetch(`https://friendbot.stellar.org?addr=${keypair.publicKey()}`);
  if (!res.ok && res.status !== 400) {
    throw new Error(`friendbot refused the account: ${res.status}`);
  }

  onProgress("trustline");
  const account = await horizon.loadAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: usdcAsset }))
    .setTimeout(60)
    .build();
  tx.sign(keypair);
  await horizon.submitTransaction(tx);

  localStorage.setItem(STORAGE_KEY, keypair.secret());
  onProgress("ready");
  return { address: keypair.publicKey(), keypair };
}

export function forgetWallet() {
  localStorage.removeItem(STORAGE_KEY);
}

/** @returns {Promise<{xlm: number, usdc: number|null}>} */
export async function balances(address) {
  try {
    const account = await horizon.loadAccount(address);
    const xlm = account.balances.find((b) => b.asset_type === "native");
    const usdc = account.balances.find(
      (b) => b.asset_code === USDC.code && b.asset_issuer === USDC.issuer,
    );
    return {
      xlm: xlm ? Number(xlm.balance) : 0,
      // null means "no trustline", which is a different problem from "zero".
      usdc: usdc ? Number(usdc.balance) : null,
    };
  } catch {
    return { xlm: 0, usdc: null };
  }
}

/** Signs a Soroban transaction. The single seam a passkey wallet would replace. */
export function signerFor(keypair) {
  return (tx) => {
    tx.sign(keypair);
    return tx.toXDR();
  };
}

/** Signs a SEP-10 challenge for anchor authentication. */
export function challengeSignerFor(keypair) {
  return (xdrString, passphrase) => {
    const challenge = TransactionBuilder.fromXDR(xdrString, passphrase);
    challenge.sign(keypair);
    return challenge.toXDR();
  };
}

export const shorten = (addr) => (addr ? `${addr.slice(0, 5)}…${addr.slice(-5)}` : "");
