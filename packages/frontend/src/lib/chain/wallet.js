/**
 * Wallets.
 *
 * Two kinds, one shape. Everything else in the app sees only
 *
 *   { kind, address, sign(tx) -> signed XDR, signChallenge(xdr, passphrase) -> signed XDR }
 *
 * so the contracts, the anchor and the UI do not care which one is connected.
 *
 * - **Kit**: the user's own wallet through Stellar Wallets Kit (Freighter,
 *   xBull, Albedo, Lobstr, Hana, ...). Keys never touch this page; every
 *   signature is approved in the wallet.
 * - **Demo**: a keypair generated in the tab and kept in `localStorage`, for
 *   someone without a wallet. Honestly labelled as such in the UI.
 *
 * Passkey smart wallets remain the roadmap item (docs/ROADMAP.md); they would
 * be a third kind behind the same shape.
 */

import "./polyfills";
import { tl } from "../../i18n/runtime";
import {
  Asset,
  BASE_FEE,
  Horizon,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";

const DEMO_SECRET_KEY = "harvest.wallet.v1";
const KIND_KEY = "harvest.wallet.kind";
const HORIZON = "https://horizon-testnet.stellar.org";

export const TESTNET_PASSPHRASE = Networks.TESTNET;

export const USDC = {
  code: "USDC",
  issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

const horizon = new Horizon.Server(HORIZON);
const usdcAsset = new Asset(USDC.code, USDC.issuer);

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode: the wallet just will not survive a reload */
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* nothing stored */
    }
  },
};

// ------------------------------------------------------- stellar wallets kit --

/** The Wallets Kit modal, in Harvest's colours rather than the kit's blue. */
const KIT_THEME = {
  background: "#FFFFFF",
  "background-secondary": "#FBF8F3",
  "foreground-strong": "#1C1917",
  foreground: "#292524",
  "foreground-secondary": "#57534E",
  primary: "#D97706",
  "primary-foreground": "#FFFFFF",
  transparent: "rgba(0, 0, 0, 0)",
  lighter: "#FAFAF9",
  light: "#F5F5F4",
  "light-gray": "#D6D3D1",
  gray: "#A8A29E",
  danger: "#DC2626",
  border: "rgba(28, 25, 23, 0.12)",
  shadow: "0 20px 40px -12px rgba(28, 25, 23, 0.25)",
  "border-radius": "1rem",
  "font-family": "var(--font-inter), -apple-system, 'Segoe UI', sans-serif",
};

let kitPromise = null;

/**
 * Stellar Wallets Kit, loaded and initialised once.
 *
 * Imported lazily: the kit and its wallet modules touch `window` and
 * `localStorage` when they load, which must not happen during server
 * rendering. The kit keeps the chosen wallet and address in localStorage
 * itself, so a reload reconnects without asking again.
 */
function loadKit() {
  kitPromise ??= Promise.all([
    import("@creit.tech/stellar-wallets-kit/sdk"),
    import("@creit.tech/stellar-wallets-kit/modules/utils"),
    import("@creit.tech/stellar-wallets-kit/types"),
  ]).then(([{ StellarWalletsKit }, { defaultModules }, { Networks: KitNetworks }]) => {
    StellarWalletsKit.init({
      modules: defaultModules(),
      network: KitNetworks.TESTNET,
      theme: KIT_THEME,
      authModal: { showInstallLabel: true, hideUnsupportedWallets: false },
    });
    return StellarWalletsKit;
  });
  return kitPromise;
}

function kitError(error) {
  const message = error?.error?.message ?? error?.message ?? String(error);
  if (/reject|declin|denied|cancel|closed/i.test(message)) {
    return new Error(tl("İşlem cüzdanda reddedildi ya da pencere kapatıldı.", "The request was rejected in the wallet or the window was closed."));
  }
  return new Error(`${tl("Cüzdan", "Wallet")}: ${message}`);
}

/**
 * The network the connected wallet is pointed at, or null when the wallet
 * cannot say (Albedo, for one, does not implement `getNetwork`).
 *
 * @returns {Promise<{name: string, passphrase: string, isTestnet: boolean} | null>}
 */
export async function walletNetwork() {
  const kit = await loadKit();
  try {
    const n = await kit.getNetwork();
    return {
      name: n.network,
      passphrase: n.networkPassphrase,
      isTestnet: n.networkPassphrase === TESTNET_PASSPHRASE,
    };
  } catch {
    return null;
  }
}

async function kitSign(xdr, address, networkPassphrase = TESTNET_PASSPHRASE) {
  const kit = await loadKit();
  // Checked here rather than left to the wallet: signing a testnet
  // transaction while the wallet is on mainnet fails with a message that
  // does not say what to do about it.
  const network = await walletNetwork();
  if (network && network.passphrase !== networkPassphrase) {
    throw new Error(
      tl(
        `Cüzdanınız şu an "${network.name}" ağında. Cüzdan ayarlarından Testnet'e geçin.`,
        `Your wallet is on "${network.name}". Switch it to Testnet in the wallet settings.`,
      ),
    );
  }
  let res;
  try {
    res = await kit.signTransaction(xdr, { networkPassphrase, address });
  } catch (err) {
    throw kitError(err);
  }
  if (res.signerAddress && res.signerAddress !== address) {
    throw new Error(tl("Cüzdanda farklı bir hesap seçili. Bağlantıyı kesip yeniden bağlanın.", "A different account is selected in the wallet. Disconnect and connect again."));
  }
  return res.signedTxXdr;
}

/**
 * A wallet connected through Stellar Wallets Kit: Freighter, xBull, Albedo,
 * Lobstr, Hana, Rabet and the rest of the kit's default modules. Keys stay
 * in the wallet; every signature is approved there.
 */
export function kitWallet(address, name) {
  return {
    kind: /** @type {const} */ ("kit"),
    name: name ?? tl("Stellar cüzdanı", "Stellar wallet"),
    address,
    sign: (tx) => kitSign(tx.toXDR(), address),
    signChallenge: (xdr, passphrase) => kitSign(xdr, address, passphrase),
  };
}

/** Opens the Wallets Kit picker and returns the account the user approved. */
export async function connectWallet() {
  const kit = await loadKit();
  let address;
  try {
    ({ address } = await kit.authModal());
  } catch (err) {
    throw kitError(err);
  }
  if (!address) throw new Error(tl("Cüzdan bir hesap paylaşmadı. Cüzdanın kilidi açık mı?", "The wallet did not share an account. Is it unlocked?"));
  store.set(KIND_KEY, "kit");
  return kitWallet(address, kit.selectedModule?.productName);
}

// --------------------------------------------------------------------- demo --

function demoWallet(keypair) {
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
  };
}

/**
 * Create a demo wallet: a fresh keypair, funded by friendbot, with a USDC
 * trustline.
 *
 * @param {(stage: "funding" | "trustline" | "ready") => void} [onProgress]
 */
export async function createDemoWallet(onProgress = () => {}) {
  const keypair = Keypair.random();
  const wallet = demoWallet(keypair);

  onProgress("funding");
  await fundWithFriendbot(wallet.address);

  onProgress("trustline");
  await addUsdcTrustline(wallet);

  store.set(DEMO_SECRET_KEY, keypair.secret());
  store.set(KIND_KEY, "demo");
  onProgress("ready");
  return wallet;
}

// ------------------------------------------------------------------ shared --

/** The wallet this browser was last connected with, if it is still usable. */
export async function restoreWallet() {
  const kind = store.get(KIND_KEY);

  if (kind === "passkey") {
    // Imported lazily: passkey.js builds on this module.
    const { restorePasskeyWallet } = await import("./passkey");
    return restorePasskeyWallet();
  }

  if (kind === "kit") {
    try {
      const kit = await loadKit();
      // The kit restores the chosen wallet and address from its own storage.
      const { address } = await kit.getAddress();
      return address ? kitWallet(address, kit.selectedModule?.productName) : null;
    } catch {
      return null;
    }
  }
  // A connection made before the kit (direct Freighter) cannot be restored
  // through it; the user connects once more.
  if (kind === "freighter") return null;

  // Demo wallets created before the kind was recorded have only the secret.
  const secret = store.get(DEMO_SECRET_KEY);
  if (!secret) return null;
  try {
    return demoWallet(Keypair.fromSecret(secret));
  } catch {
    return null;
  }
}

/**
 * Forget the connection. For a kit wallet this disconnects the kit; revoking
 * the site's permission is done in the wallet itself. For a demo wallet the
 * secret key is deleted.
 */
export function forgetWallet(kind) {
  store.remove(KIND_KEY);
  if (kind === "kit") loadKit().then((kit) => kit.disconnect()).catch(() => {});
  if (kind === "demo") store.remove(DEMO_SECRET_KEY);
  if (kind === "passkey") import("./passkey").then((m) => m.forgetPasskeyWallet()).catch(() => {});
}

/** Friendbot funds a new testnet account; it answers 400 if already funded. */
export async function fundWithFriendbot(address) {
  const res = await fetch(`https://friendbot.stellar.org?addr=${address}`);
  if (!res.ok && res.status !== 400) {
    throw new Error(tl(`friendbot hesabı fonlamadı: ${res.status}`, `friendbot did not fund the account: ${res.status}`));
  }
}

/**
 * Open the USDC trustline. Without it the anchor deposit completes and the
 * USDC arrives as a claimable balance the user then has to go and find.
 */
export async function addUsdcTrustline(wallet) {
  const account = await horizon.loadAccount(wallet.address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(Operation.changeTrust({ asset: usdcAsset }))
    .setTimeout(120)
    .build();
  const signed = await wallet.sign(tx);
  await horizon.submitTransaction(TransactionBuilder.fromXDR(signed, TESTNET_PASSPHRASE));
}

/**
 * Send USDC to an address with a memo, signed by the connected wallet.
 *
 * This is how an anchor withdrawal is funded: the anchor hands out its
 * treasury address and a memo, and matches the incoming payment by the memo.
 * A payment without the right memo is not attributed to the withdrawal.
 *
 * @param {{address: string, sign: (tx: any) => Promise<string>}} wallet
 * @param {{destination: string, amount: string|number, memo: string, memoType?: "id"|"text"|"hash"}} payment
 * @returns {Promise<string>} the transaction hash
 */
export async function payUsdcWithMemo(wallet, { destination, amount, memo, memoType = "id" }) {
  const memoValue =
    memoType === "id"
      ? Memo.id(String(memo))
      : memoType === "hash"
        ? Memo.hash(Buffer.from(memo, "base64"))
        : Memo.text(String(memo));

  const account = await horizon.loadAccount(wallet.address);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: TESTNET_PASSPHRASE,
  })
    .addOperation(
      Operation.payment({ destination, asset: usdcAsset, amount: Number(amount).toFixed(7) }),
    )
    .addMemo(memoValue)
    .setTimeout(120)
    .build();
  const signed = await wallet.sign(tx);
  const res = await horizon.submitTransaction(TransactionBuilder.fromXDR(signed, TESTNET_PASSPHRASE));
  return res.hash;
}

/**
 * @returns {Promise<{known: true, exists: boolean, xlm: number, usdc: number|null} | null>}
 *   `usdc: null` means "no trustline", which is a different problem from zero.
 *   Resolves to null when Horizon could not be reached, so a network blip is
 *   not mistaken for an account that does not exist.
 */
export async function balances(address) {
  let account;
  try {
    account = await horizon.loadAccount(address);
  } catch (err) {
    if (err?.response?.status === 404 || err?.name === "NotFoundError") {
      return { known: true, exists: false, xlm: 0, usdc: null };
    }
    return null;
  }
  const xlm = account.balances.find((b) => b.asset_type === "native");
  const usdc = account.balances.find(
    (b) => b.asset_code === USDC.code && b.asset_issuer === USDC.issuer,
  );
  return {
    known: true,
    exists: true,
    xlm: xlm ? Number(xlm.balance) : 0,
    usdc: usdc ? Number(usdc.balance) : null,
  };
}

export const shorten = (addr) => (addr ? `${addr.slice(0, 5)}…${addr.slice(-5)}` : "");
