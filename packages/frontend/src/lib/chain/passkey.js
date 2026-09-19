/**
 * Passkey sign-in: a smart wallet (a Soroban contract account) controlled by
 * a WebAuthn passkey -- Face ID, Touch ID, Windows Hello or a phone. No seed
 * phrase, no extension, and the user never holds XLM.
 *
 * Fees: the kit can hand submission to SDF's relayer proxy, but that lives on
 * *.workers.dev, which Turkish networks block at the TLS handshake. So this
 * browser keeps one friendbot-funded testnet account that pays the fees (the
 * kit's "dedicated deployer"). On mainnet that role is the OpenZeppelin Relayer.
 *
 * Built on Stellar's smart-account-kit and the OpenZeppelin smart-account
 * contracts already deployed on testnet; the account WASM and the WebAuthn
 * verifier below are the kit's published Protocol 27 deployment.
 *
 * The account is a C-address. It holds USDC through the token contract (no
 * trustline) and authorises campaign calls through `__check_auth`, so fund,
 * claim, create, disburse and repay all work unchanged.
 *
 * The lira anchor is the one thing it cannot talk to directly: the TR anchor
 * authenticates with SEP-10, which is for G-accounts only (contract accounts
 * need SEP-45, which the sandbox does not offer). So the anchor legs run
 * through a "ramp" account -- a plain keypair kept in this browser -- and the
 * USDC is moved between the ramp and the smart wallet with a token transfer.
 */

import "./polyfills";
import {
  Address,
  BASE_FEE,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  contract,
  nativeToScVal,
  rpc,
  scValToNative,
} from "@stellar/stellar-sdk";

import { tl } from "../../i18n/runtime";
import { deployments, explorerTx } from "./deployments";
import { addUsdcTrustline, balances as classicBalances, fundWithFriendbot } from "./wallet";

const RPC_URL = "https://soroban-testnet.stellar.org";
const PASSPHRASE = Networks.TESTNET;

/** smart-account-kit's testnet deployment (docs/deployments-protocol-27-2026-07-09.md). */
const KIT_CONFIG = {
  rpcUrl: RPC_URL,
  networkPassphrase: PASSPHRASE,
  accountWasmHash: "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a",
  webauthnVerifierAddress: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  rpName: "HARVEST",
};

const USDC_DECIMALS = 7;
const FEE_KEY = "harvest.passkey.fee.v1";

const server = new rpc.Server(RPC_URL);

let kitPromise;
/** Loaded on demand: WebAuthn and IndexedDB only exist in the browser. */
function loadKit() {
  kitPromise ??= import("smart-account-kit").then(
    ({ SmartAccountKit, IndexedDBStorage }) =>
      new SmartAccountKit({
        ...KIT_CONFIG,
        // Pays fees and salts wallet addresses; never a signer on the wallet.
        deployerSecret: browserAccount().keypair.secret(),
        storage: new IndexedDBStorage(),
      }),
  );
  return kitPromise;
}

let feeReady = null;
/** Friendbot the browser account once, so it can pay for submissions. */
function ensureFeeAccount() {
  feeReady ??= (async () => {
    const account = browserAccount();
    const b = await classicBalances(account.address);
    if (!b || !b.exists) await fundWithFriendbot(account.address);
  })().catch((err) => {
    feeReady = null;
    throw err;
  });
  return feeReady;
}

function passkeyError(err) {
  const message = err?.message ?? String(err);
  if (/NotAllowedError|abort|cancel|timed out|not allowed/i.test(message)) {
    return new Error(
      tl(
        "Passkey isteği iptal edildi ya da zaman aşımına uğradı.",
        "The passkey request was cancelled or timed out.",
      ),
    );
  }
  return err instanceof Error ? err : new Error(message);
}

/**
 * An `Error(Contract, #N)` from simulation or submission, with the code
 * attached the way `@harvest/sdk`'s ContractCallError has it, so the campaign
 * error table in harvest.js explains it the same way for every wallet kind.
 */
function contractFailure(method, detail) {
  const text = typeof detail === "string" ? detail : detail?.message ?? JSON.stringify(detail);
  const err = new Error(`${method}: ${text}`);
  const code = /Error\(Contract, #(\d+)\)/.exec(text)?.[1] ?? detail?.contractCode;
  if (code !== undefined) err.code = Number(code);
  return err;
}

async function waitFor(hash, method) {
  for (let i = 0; i < 60; i += 1) {
    const got = await server.getTransaction(hash);
    if (got.status === "SUCCESS") return got;
    if (got.status === "FAILED") throw contractFailure(method, `transaction ${hash} failed on chain`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw contractFailure(method, `transaction ${hash} did not confirm`);
}

/**
 * Call a contract as the smart wallet: simulate to record the auth the call
 * needs, have the passkey sign it, and submit with the browser account paying.
 */
async function invokeAsPasskey(kit, { contractId, method, args = [] }) {
  await ensureFeeAccount();
  const tx = await contract.AssembledTransaction.build({
    contractId,
    method,
    args,
    networkPassphrase: PASSPHRASE,
    rpcUrl: RPC_URL,
    parseResultXdr: (v) => v,
  });
  if (tx.simulation && rpc.Api.isSimulationError(tx.simulation)) {
    throw contractFailure(method, tx.simulation.error);
  }
  let result;
  try {
    result = await kit.signAndSubmit(tx, { forceMethod: "rpc" });
  } catch (err) {
    throw passkeyError(err);
  }
  if (!result.success) throw contractFailure(method, result.error);
  const got = await waitFor(result.hash, method);
  return {
    hash: result.hash,
    value: got.returnValue ? scValToNative(got.returnValue) : null,
    explorer: explorerTx(result.hash),
  };
}

const toUnits = (amount) => BigInt(Math.round(Number(amount) * 10 ** USDC_DECIMALS));

/** The smart wallet's USDC, read from the token contract. */
async function usdcBalanceOf(address) {
  const tx = await contract.AssembledTransaction.build({
    contractId: deployments.usdc,
    method: "balance",
    args: [new Address(address).toScVal()],
    networkPassphrase: PASSPHRASE,
    rpcUrl: RPC_URL,
    parseResultXdr: (v) => scValToNative(v),
  });
  if (tx.simulation && rpc.Api.isSimulationError(tx.simulation)) return 0;
  return Number(tx.result ?? 0n) / 10 ** USDC_DECIMALS;
}

// -------------------------------------------------------------------- ramp --

/**
 * The browser-held G-account: it pays the passkey wallet's fees, and it is the
 * "ramp" that talks to the anchor, since SEP-10 cannot authenticate a
 * contract account. It never holds the user's funds for longer than a
 * deposit or a withdrawal takes.
 */
let browserKeypair = null;
function browserAccount() {
  if (!browserKeypair) {
    let secret = null;
    try {
      secret = window.localStorage.getItem(FEE_KEY);
    } catch {
      /* storage blocked: a fresh account for this page still works */
    }
    browserKeypair = secret ? Keypair.fromSecret(secret) : Keypair.random();
    if (!secret) {
      try {
        window.localStorage.setItem(FEE_KEY, browserKeypair.secret());
      } catch {
        /* see above */
      }
    }
  }
  const keypair = browserKeypair;
  return {
    kind: /** @type {const} */ ("demo"),
    address: keypair.publicKey(),
    sign: async (tx) => {
      tx.sign(keypair);
      return tx.toXDR();
    },
    signChallenge: async (xdr, passphrase) => {
      const challenge = TransactionBuilder.fromXDR(xdr, passphrase);
      challenge.sign(keypair);
      return challenge.toXDR();
    },
    keypair,
  };
}

/** Friendbot XLM and a USDC trustline, once, so the anchor can pay the ramp. */
async function readyRamp(ramp) {
  const b = await classicBalances(ramp.address);
  if (b && !b.exists) await fundWithFriendbot(ramp.address);
  if (!b || !b.exists || b.usdc === null) await addUsdcTrustline(ramp);
  return ramp;
}

/** USDC from the ramp's classic balance into the smart wallet, via the token contract. */
async function rampToSmart(ramp, smartAddress, amount) {
  const account = await server.getAccount(ramp.address);
  const built = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: PASSPHRASE })
    .addOperation(
      new Contract(deployments.usdc).call(
        "transfer",
        new Address(ramp.address).toScVal(),
        new Address(smartAddress).toScVal(),
        nativeToScVal(toUnits(amount), { type: "i128" }),
      ),
    )
    .setTimeout(60)
    .build();
  const prepared = await server.prepareTransaction(built);
  prepared.sign(ramp.keypair);
  const sent = await server.sendTransaction(prepared);
  if (sent.status === "ERROR") throw contractFailure("transfer", JSON.stringify(sent.errorResult ?? sent));
  await waitFor(sent.hash, "transfer");
  return sent.hash;
}

// ------------------------------------------------------------------ wallet --

function passkeyWallet(kit, address) {
  const ramp = () => browserAccount();
  return {
    kind: /** @type {const} */ ("passkey"),
    name: "Passkey",
    address,
    invoke: (call) => invokeAsPasskey(kit, call),
    sign: async () => {
      throw new Error(
        tl(
          "Passkey cüzdanı klasik işlem imzalamaz; kontrat çağrıları passkey ile onaylanır.",
          "A passkey wallet does not sign classic transactions; contract calls are approved with the passkey.",
        ),
      );
    },
    signChallenge: async () => {
      throw new Error(
        tl(
          "Anchor SEP-10 ile yalnızca G hesaplarını doğrular; passkey için aracı hesap kullanılır.",
          "The anchor's SEP-10 only authenticates G accounts; passkey wallets go through the ramp account.",
        ),
      );
    },
    /** The G-account the anchor sees for this wallet (enough for SEP-10 and quotes). */
    ramp,
    /** The same account, funded and trusted on first use. */
    prepareRamp: () => readyRamp(ramp()),
    /** After a deposit: every USDC the anchor paid the ramp goes on to the smart wallet. */
    sweepRamp: async () => {
      const r = await readyRamp(ramp());
      const b = await classicBalances(r.address);
      if (!b?.usdc) return null;
      return rampToSmart(r, address, b.usdc);
    },
    /** Before a withdrawal: move USDC from the smart wallet to the ramp (passkey-signed). */
    fundRamp: async (amount) => {
      const r = await readyRamp(ramp());
      return invokeAsPasskey(kit, {
        contractId: deployments.usdc,
        method: "transfer",
        args: [
          new Address(address).toScVal(),
          new Address(r.address).toScVal(),
          nativeToScVal(toUnits(amount), { type: "i128" }),
        ],
      });
    },
  };
}

/** Create a passkey and deploy a smart wallet for it; the browser account pays. */
export async function createPasskeyWallet() {
  await ensureFeeAccount();
  const kit = await loadKit();
  let created;
  try {
    created = await kit.createWallet("HARVEST", `harvest-${new Date().toISOString().slice(0, 10)}`, {
      autoSubmit: true,
      forceMethod: "rpc",
    });
  } catch (err) {
    throw passkeyError(err);
  }
  if (created.submitResult && !created.submitResult.success) {
    throw new Error(created.submitResult.error?.message ?? "wallet deployment failed");
  }
  store("passkey");
  return passkeyWallet(kit, created.contractId);
}

/** Sign in with a passkey created earlier, on this or another device. */
export async function connectPasskeyWallet() {
  const kit = await loadKit();
  let connected;
  try {
    connected = await kit.connectWallet({ prompt: true });
  } catch (err) {
    throw passkeyError(err);
  }
  if (!connected?.contractId) {
    throw new Error(tl("Bu passkey'e bağlı bir cüzdan bulunamadı.", "No wallet was found for this passkey."));
  }
  store("passkey");
  return passkeyWallet(kit, connected.contractId);
}

/** The stored passkey session, without prompting. */
export async function restorePasskeyWallet() {
  try {
    const kit = await loadKit();
    const connected = await kit.connectWallet();
    return connected?.contractId ? passkeyWallet(kit, connected.contractId) : null;
  } catch {
    return null;
  }
}

export async function forgetPasskeyWallet() {
  try {
    const kit = await loadKit();
    await kit.disconnect();
  } catch {
    /* nothing stored */
  }
}

/** Same shape as wallet.js `balances`; a contract account has no trustline to miss. */
export async function passkeyBalances(address) {
  try {
    return { known: true, exists: true, xlm: 0, usdc: await usdcBalanceOf(address) };
  } catch {
    return null;
  }
}

export const isContractAddress = (address) => typeof address === "string" && address.startsWith("C");

function store(kind) {
  try {
    window.localStorage.setItem("harvest.wallet.kind", kind);
  } catch {
    /* storage blocked */
  }
}
