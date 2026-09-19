"use client";

import "@/lib/chain/polyfills";

import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { Transaction } from "@stellar/stellar-sdk";
import { AlertTriangle, CheckCircle2 } from "lucide-react";

import {
  addUsdcTrustline,
  balances as fetchBalances,
  connectWallet as connectKitWallet,
  createDemoWallet,
  forgetWallet,
  fundWithFriendbot,
  restoreWallet,
  walletNetwork,
} from "@/lib/chain/wallet";
import { connectPasskeyWallet, createPasskeyWallet, passkeyBalances } from "@/lib/chain/passkey";
import { WalletModal } from "@/components/wallet/WalletModal";
import { AnchorModal } from "@/components/wallet/AnchorModal";
import { useLocale } from "@/i18n/LocaleProvider";

export interface Wallet {
  /**
   * "kit": the user's own wallet via Stellar Wallets Kit. "demo": a keypair in
   * this browser. "passkey": a smart wallet (C-address) behind a WebAuthn passkey.
   */
  kind: "kit" | "demo" | "passkey";
  /** Kit wallets only: which wallet was picked (Freighter, xBull, ...). */
  name?: string;
  address: string;
  /** Signs a Soroban/classic transaction; resolves to signed XDR. */
  sign: (tx: Transaction) => Promise<string>;
  /** Signs a SEP-10 challenge for the anchor. */
  signChallenge: (xdr: string, passphrase: string) => Promise<string>;
  /** Passkey only: contract call signed by the passkey, submitted by the relayer. */
  invoke?: (call: { contractId: string; method: string; args: unknown[] }) => Promise<{
    hash: string;
    value: unknown;
    explorer: string;
  }>;
  /** Passkey only: the G-account that talks to the anchor on the wallet's behalf. */
  ramp?: () => Wallet;
  /** Passkey only: the ramp, funded by friendbot and with a USDC trustline. */
  prepareRamp?: () => Promise<Wallet>;
  /** Passkey only: move USDC the anchor paid the ramp into the smart wallet. */
  sweepRamp?: () => Promise<string | null>;
  /** Passkey only: move USDC from the smart wallet to the ramp before a withdrawal. */
  fundRamp?: (amountUsdc: number) => Promise<unknown>;
}

export interface Balances {
  /** False until Horizon has answered for the current wallet. */
  known: boolean;
  /** False until friendbot has created the account on testnet. */
  exists: boolean;
  xlm: number;
  /** null means the account has no USDC trustline. */
  usdc: number | null;
}

export type CreatingStage = "funding" | "trustline" | "ready" | "connecting" | "passkey" | null;
export type AnchorMode = "deposit" | "withdraw";
type Toast = { message: string; tone: "success" | "error" } | null;

interface WalletContextValue {
  wallet: Wallet | null;
  /** False until the stored connection has been restored on the client. */
  ready: boolean;
  balances: Balances;
  /** Kit wallets only: null until known, or when the wallet cannot say. */
  onTestnet: boolean | null;
  networkName: string | null;
  creating: CreatingStage;
  connectWallet: () => Promise<void>;
  createDemo: () => Promise<void>;
  createPasskey: () => Promise<void>;
  connectPasskey: () => Promise<void>;
  /** Friendbot + USDC trustline for an account that lacks either. */
  prepareAccount: () => Promise<void>;
  forget: () => void;
  refreshBalances: () => Promise<void>;
  openWallet: () => void;
  openAnchor: (mode?: AnchorMode) => void;
  notify: (message: string, tone?: "success" | "error") => void;
}

const EMPTY: Balances = { known: false, exists: false, xlm: 0, usdc: null };

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet() {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside <WalletProvider>");
  return ctx;
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [ready, setReady] = useState(false);
  const [funds, setFunds] = useState<Balances>(EMPTY);
  const [onTestnet, setOnTestnet] = useState<boolean | null>(null);
  const [networkName, setNetworkName] = useState<string | null>(null);
  const { t } = useLocale();
  const [creating, setCreating] = useState<CreatingStage>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const [anchorMode, setAnchorMode] = useState<AnchorMode | null>(null);
  const [toast, setToast] = useState<Toast>(null);

  // The stored connection lives in localStorage and the extension, both of
  // which only exist on the client.
  useEffect(() => {
    let cancelled = false;
    restoreWallet().then((restored: Wallet | null) => {
      if (cancelled) return;
      setWallet(restored);
      setReady(true);
    });
    // 8 MB of proving artefacts; start them early so the farmer flow feels
    // instant when it gets there. Imported lazily so the circom code stays out
    // of pages that never prove anything.
    import("@/lib/chain/prover").then((m) => m.prefetchProvingArtifacts());
    return () => {
      cancelled = true;
    };
  }, []);

  // Follow the network the wallet is pointed at. The kit reports the network
  // it was configured with, not the wallet's own, so ask the wallet.
  useEffect(() => {
    if (wallet?.kind !== "kit") {
      setOnTestnet(null);
      setNetworkName(null);
      return undefined;
    }
    let cancelled = false;
    const check = () =>
      walletNetwork().then((n: { name: string; isTestnet: boolean } | null) => {
        if (cancelled) return;
        setOnTestnet(n ? n.isTestnet : null);
        setNetworkName(n ? n.name : null);
      });
    check();
    const timer = window.setInterval(check, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [wallet]);

  const notify = useCallback((message: string, tone: "success" | "error" = "success") => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 5000);
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!wallet) return;
    const next =
      wallet.kind === "passkey" ? await passkeyBalances(wallet.address) : await fetchBalances(wallet.address);
    if (next) setFunds(next);
  }, [wallet]);

  useEffect(() => {
    setFunds(EMPTY);
    if (!wallet) return undefined;
    refreshBalances();
    const timer = window.setInterval(refreshBalances, 12_000);
    return () => window.clearInterval(timer);
  }, [wallet, refreshBalances]);

  const connectWallet = useCallback(async () => {
    // The kit opens its own wallet picker; ours would sit on top of it.
    setWalletOpen(false);
    try {
      const connected: Wallet = await connectKitWallet();
      setWallet(connected);
      notify(t("wallet.toastKit", { name: connected.name ?? t("wallet.walletFallback") }));
    } finally {
      // Back to our modal: it shows the account setup, or the error.
      setWalletOpen(true);
    }
  }, [notify, t]);

  const createDemo = useCallback(async () => {
    setCreating("funding");
    try {
      const created: Wallet = await createDemoWallet(setCreating);
      setWallet(created);
      notify(t("wallet.toastDemo"));
    } finally {
      setCreating(null);
    }
  }, [notify, t]);

  const createPasskey = useCallback(async () => {
    setCreating("passkey");
    try {
      const created: Wallet = await createPasskeyWallet();
      setWallet(created);
      notify(t("wallet.toastPasskeyCreated"));
    } finally {
      setCreating(null);
    }
  }, [notify, t]);

  const connectPasskey = useCallback(async () => {
    setCreating("passkey");
    try {
      const connected: Wallet = await connectPasskeyWallet();
      setWallet(connected);
      notify(t("wallet.toastPasskey"));
    } finally {
      setCreating(null);
    }
  }, [notify, t]);

  const prepareAccount = useCallback(async () => {
    if (!wallet) return;
    try {
      if (!funds.exists) {
        setCreating("funding");
        await fundWithFriendbot(wallet.address);
      }
      if (funds.usdc === null) {
        setCreating("trustline");
        await addUsdcTrustline(wallet);
      }
      await refreshBalances();
      notify(t("wallet.toastReady"));
    } finally {
      setCreating(null);
    }
  }, [wallet, funds, refreshBalances, notify, t]);

  const forget = useCallback(() => {
    forgetWallet(wallet?.kind);
    setWallet(null);
  }, [wallet]);

  const openAnchor = useCallback(
    (mode: AnchorMode = "deposit") => {
      // The anchor pays USDC to the account, so it needs the trustline first.
      if (!wallet || !funds.exists || funds.usdc === null) {
        setWalletOpen(true);
        return;
      }
      setWalletOpen(false);
      setAnchorMode(mode);
    },
    [wallet, funds],
  );

  const value: WalletContextValue = {
    wallet,
    ready,
    balances: funds,
    onTestnet,
    networkName,
    creating,
    connectWallet,
    createDemo,
    createPasskey,
    connectPasskey,
    prepareAccount,
    forget,
    refreshBalances,
    openWallet: () => setWalletOpen(true),
    openAnchor,
    notify,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}

      <WalletModal isOpen={walletOpen} onClose={() => setWalletOpen(false)} />
      {anchorMode && wallet && (
        <AnchorModal initialMode={anchorMode} onClose={() => setAnchorMode(null)} />
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 z-[60] max-w-sm p-4 rounded-2xl bg-white shadow-2xl border text-sm font-medium flex items-start gap-3 ${
            toast.tone === "error"
              ? "border-rose-200 text-rose-900"
              : "border-emerald-200 text-stone-800"
          }`}
        >
          {toast.tone === "error" ? (
            <AlertTriangle className="w-5 h-5 text-rose-500 shrink-0" />
          ) : (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          )}
          <span>{toast.message}</span>
        </div>
      )}
    </WalletContext.Provider>
  );
}
