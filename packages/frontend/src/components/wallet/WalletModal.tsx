"use client";

import React, { useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  ExternalLink,
  Fingerprint,
  KeyRound,
  Loader2,
  ShieldCheck,
  Wallet as WalletIcon,
  X,
} from "lucide-react";

import { useWallet } from "@/components/wallet/WalletProvider";
import { explorerAccount } from "@/lib/chain/deployments";
import { useLocale } from "@/i18n/LocaleProvider";

/**
 * Sign-in: the user's own wallet through Stellar Wallets Kit (Freighter,
 * xBull, Albedo, Lobstr, Hana, ...), or -- for someone without one -- a demo
 * keypair generated in this browser.
 *
 * A fresh testnet account needs two things before the app is
 * useful: friendbot XLM to exist on chain, and a USDC trustline so the anchor
 * and the campaigns can pay it. The "prepare account" button does both.
 */
export function WalletModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const {
    wallet,
    balances,
    creating,
    onTestnet,
    networkName,
    connectWallet,
    createDemo,
    createPasskey,
    connectPasskey,
    prepareAccount,
    forget,
    openAnchor,
  } = useWallet();
  const { t, number } = useLocale();
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const attempt = (fn: () => Promise<void>) => async () => {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleForget = () => {
    if (wallet?.kind === "demo") {
      const ok = window.confirm(t("wallet.deleteConfirm"));
      if (!ok) return;
    }
    forget();
    onClose();
  };

  const [kitBefore, kitAfter = ""] = t("wallet.kitNote").split("{freighter}");
  const needsSetup = Boolean(wallet && balances.known && (!balances.exists || balances.usdc === null));
  const wrongNetwork = wallet?.kind === "kit" && onTestnet === false;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={creating ? undefined : onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-md w-full p-6 md:p-8 relative shadow-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-title"
        data-testid="wallet-modal"
      >
        <button
          type="button"
          data-testid="wallet-close"
          onClick={onClose}
          aria-label={t("common.close")}
          className="absolute top-5 right-5 p-2 rounded-full text-stone-400 hover:text-stone-900 hover:bg-stone-100"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-6">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-100 flex items-center justify-center mb-4">
            <WalletIcon className="w-6 h-6 text-amber-700" />
          </div>
          <h3 id="wallet-title" className="text-xl font-bold text-stone-900">
            {wallet ? t("wallet.titleConnected") : t("wallet.titleConnect")}
          </h3>
          <p className="text-sm text-stone-600 mt-1">
            {wallet
              ? wallet.kind === "kit"
                ? t("wallet.kitConnected", { name: wallet.name ?? t("wallet.walletFallback") })
                : wallet.kind === "passkey"
                  ? t("wallet.passkeyConnected")
                  : t("wallet.demoConnected")
              : t("wallet.intro")}
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-900 text-xs break-words">
            {error}
          </div>
        )}

        {creating ? (
          <div className="py-8 text-center space-y-3">
            <Loader2 className="w-10 h-10 text-amber-600 animate-spin mx-auto" />
            <p className="text-sm font-semibold text-stone-900">{t(`wallet.stages.${creating}`)}</p>
            <p className="text-xs text-stone-500">{t("wallet.realTx")}</p>
          </div>
        ) : wallet ? (
          <div className="space-y-5">
            {wrongNetwork && (
              <div className="p-3 rounded-xl bg-rose-50 border border-rose-100 flex items-start gap-2.5 text-xs text-rose-900">
                <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <span>
                  {t("wallet.wrongNetwork", {
                    name: wallet.name ?? t("wallet.yourWallet"),
                    network: networkName ?? "?",
                  })}
                </span>
              </div>
            )}

            <div className="bg-stone-50 border border-stone-100 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-stone-500">{t("wallet.address")}</span>
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white border border-stone-200 text-stone-700">
                  {wallet.kind === "kit"
                    ? wallet.name ?? t("wallet.walletFallback")
                    : wallet.kind === "passkey"
                      ? t("wallet.passkeyBadge")
                      : t("wallet.demoBadge")}
                </span>
              </div>
              <div data-testid="wallet-address" className="font-mono text-xs text-stone-900 break-all">
                {wallet.address}
              </div>
              <a
                href={explorerAccount(wallet.address)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800 mt-2"
              >
                <span>{t("common.openExplorer")}</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>

            {needsSetup ? (
              <div className="p-4 rounded-2xl bg-amber-50 border border-amber-100 space-y-3">
                <div className="text-sm font-semibold text-amber-900">{t("wallet.notReady")}</div>
                <ul className="text-xs text-amber-900 space-y-1">
                  <li>{balances.exists ? "✓" : "•"} {t("wallet.needXlm")}</li>
                  <li>{balances.usdc !== null ? "✓" : "•"} {t("wallet.needTrustline")}</li>
                </ul>
                <button
                  type="button"
                  onClick={attempt(prepareAccount)}
                  disabled={wrongNetwork}
                  className="w-full h-11 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {t("wallet.prepare")}
                </button>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-stone-50 border border-stone-100 rounded-2xl p-4">
                    <div className="text-xs text-stone-500">USDC</div>
                    <div className="text-lg font-bold text-stone-900">
                      {balances.usdc === null ? "—" : number(balances.usdc, 4)}
                    </div>
                  </div>
                  {wallet.kind === "passkey" ? (
                    <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4">
                      <div className="text-xs text-emerald-700">{t("wallet.feesSponsored")}</div>
                      <div className="text-lg font-bold text-emerald-900">{t("wallet.sponsored")}</div>
                    </div>
                  ) : (
                    <div className="bg-stone-50 border border-stone-100 rounded-2xl p-4">
                      <div className="text-xs text-stone-500">{t("wallet.feeXlm")}</div>
                      <div className="text-lg font-bold text-stone-900">{number(balances.xlm, 2)}</div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => openAnchor("deposit")}
                    disabled={!balances.known}
                    className="h-11 rounded-full bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <ArrowDownToLine className="w-4 h-4" />
                    <span>{t("wallet.topUp")}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openAnchor("withdraw")}
                    disabled={!balances.known}
                    className="h-11 rounded-full border border-stone-200 text-stone-800 hover:bg-stone-50 text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <ArrowUpFromLine className="w-4 h-4" />
                    <span>{t("wallet.withdraw")}</span>
                  </button>
                </div>
              </>
            )}

            <button
              type="button"
              data-testid="wallet-forget"
              onClick={handleForget}
              className="w-full text-xs font-semibold text-stone-500 hover:text-rose-700"
            >
              {wallet.kind === "kit"
                ? t("wallet.disconnect")
                : wallet.kind === "passkey"
                  ? t("wallet.signOut")
                  : t("wallet.deleteDemo")}
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <button
              type="button"
              onClick={attempt(connectWallet)}
              className="w-full h-12 bg-stone-900 hover:bg-stone-800 text-white rounded-full font-semibold text-sm inline-flex items-center justify-center gap-2 transition-colors"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{t("wallet.connectKit")}</span>
            </button>

            <p className="text-xs text-stone-500 text-center">
              {kitBefore}
              <a
                href="https://www.freighter.app"
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-amber-700 hover:text-amber-800"
              >
                Freighter
              </a>
              {kitAfter}
            </p>

            <div className="flex items-center gap-3 text-[11px] text-stone-400">
              <div className="flex-1 h-px bg-stone-200" />
              <span>{t("wallet.or")}</span>
              <div className="flex-1 h-px bg-stone-200" />
            </div>

            <div className="p-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 space-y-3">
              <div className="flex items-center gap-2 text-sm font-semibold text-stone-900">
                <Fingerprint className="w-4 h-4 text-emerald-700" />
                <span>{t("wallet.passkeyTitle")}</span>
              </div>
              <p className="text-xs text-stone-600">{t("wallet.passkeyIntro")}</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={attempt(createPasskey)}
                  className="h-11 rounded-full bg-emerald-700 hover:bg-emerald-800 text-white text-sm font-semibold transition-colors"
                >
                  {t("wallet.passkeyCreate")}
                </button>
                <button
                  type="button"
                  onClick={attempt(connectPasskey)}
                  className="h-11 rounded-full border border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-50 text-sm font-semibold transition-colors"
                >
                  {t("wallet.passkeyConnect")}
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3 text-[11px] text-stone-400">
              <div className="flex-1 h-px bg-stone-200" />
              <span>{t("wallet.or")}</span>
              <div className="flex-1 h-px bg-stone-200" />
            </div>

            <button
              type="button"
              data-testid="wallet-create-demo"
              onClick={attempt(createDemo)}
              className="w-full h-11 border border-stone-200 text-stone-800 hover:bg-stone-50 rounded-full text-sm font-semibold inline-flex items-center justify-center gap-2 transition-colors"
            >
              <KeyRound className="w-4 h-4" />
              <span>{t("wallet.createDemo")}</span>
            </button>
            <div className="p-3 rounded-xl bg-stone-50 border border-stone-100 flex items-start gap-2.5 text-xs text-stone-600">
              <AlertCircle className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
              <span>{t("wallet.demoNote")}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
