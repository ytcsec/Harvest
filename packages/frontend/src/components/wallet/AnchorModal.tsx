"use client";

import React, { useEffect, useState } from "react";
import {
  ArrowDownUp,
  CheckCircle2,
  Circle,
  ExternalLink,
  Loader2,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";

import { useWallet, type AnchorMode } from "@/components/wallet/WalletProvider";
import {
  anchorDeposit,
  anchorQuote,
  anchorWithdraw,
  anchorWithdrawQuote,
  formatIban,
  isTurkishIban,
  normalizeIban,
  randomTurkishIban,
} from "@/lib/chain/harvest";
import { explorerTx } from "@/lib/chain/deployments";
import { useLocale } from "@/i18n/LocaleProvider";

/** The stages each direction walks through, in order; labels come from the dictionary. */
const DEPOSIT_STEPS = ["authenticating", "requesting", "wiring", "settling"];
const WITHDRAW_STEPS = ["authenticating", "kyc", "requesting", "paying", "settling"];

/**
 * Passkey wallets are contract accounts, which SEP-10 cannot authenticate, so
 * the anchor legs run through a ramp account and USDC moves between the two.
 */
const PASSKEY_DEPOSIT_STEPS = ["ramp", ...DEPOSIT_STEPS, "sweep"];
const PASSKEY_WITHDRAW_STEPS = ["ramp", "toRamp", ...WITHDRAW_STEPS];

/** Anchor-side SEP-6 statuses arrive while settling; they all mean "the settling step". */
const stepIndex = (steps: string[], status: string | null) => {
  if (!status) return -1;
  const i = steps.indexOf(status);
  return i === -1 ? steps.indexOf("settling") : i;
};

const WITHDRAW_MIN = 1;
const WITHDRAW_MAX = 300;

/** EFT bank codes, which sit in positions 5-9 of a Turkish IBAN. */
const BANKS = [
  { name: "Ziraat Bankası", short: "Ziraat", code: "00010" },
  { name: "Türkiye İş Bankası", short: "İş Bankası", code: "00064" },
  { name: "Garanti BBVA", short: "Garanti", code: "00062" },
  { name: "Yapı Kredi", short: "Yapı Kredi", code: "00067" },
  { name: "Vakıfbank", short: "Vakıfbank", code: "00015" },
];

const makeSamples = (): Record<string, string> =>
  Object.fromEntries(BANKS.map((b) => [b.name, randomTurkishIban(b.code)]));

interface Quote {
  price: string;
  buy_amount: string;
}

type Success =
  | { kind: "deposit"; amountTry: number; amountUsdc: string; txId?: string }
  | {
      kind: "withdraw";
      amountUsdc: number;
      amountTry: string;
      iban: string;
      paymentHash: string;
      reference?: string;
      moreInfoUrl?: string;
    };

/**
 * The lira rail against tr-mock-anchor.fly.dev: SEP-10 auth, SEP-38 quotes,
 * SEP-12 payout details and SEP-6 deposit/withdraw.
 *
 * Deposit: the anchor issues the IBAN and reference to wire to, so that side
 * shows the instructions coming back. Withdraw: the user's IBAN goes to the
 * anchor through SEP-12, the wallet pays the USDC to the anchor with the memo
 * it handed out, and the modal waits until the anchor reports the lira paid.
 */
export function AnchorModal({ initialMode, onClose }: { initialMode: AnchorMode; onClose: () => void }) {
  const { wallet, balances, refreshBalances } = useWallet();
  const { t, tList, number } = useLocale();
  const [mode, setMode] = useState<AnchorMode>(initialMode);
  const [amountTry, setAmountTry] = useState("500");
  const [amountUsdc, setAmountUsdc] = useState("5");
  // One ready-made IBAN per bank so a demo never stops to type 26 digits.
  const [samples, setSamples] = useState(makeSamples);
  const [bank, setBank] = useState(BANKS[0].name);
  const [iban, setIban] = useState(() => formatIban(samples[BANKS[0].name]));
  const [processing, setProcessing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [instructions, setInstructions] = useState<Record<string, unknown> | null>(null);
  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Success | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Who the anchor sees: the wallet itself, or a passkey wallet's ramp account.
  const passkey = wallet?.kind === "passkey";
  const anchorAccount = wallet && passkey && wallet.ramp ? wallet.ramp() : wallet;

  const quoteAmount = mode === "deposit" ? Number(amountTry) || 0 : Number(amountUsdc) || 0;

  useEffect(() => {
    if (!anchorAccount) return undefined;
    let cancelled = false;
    setQuote(null);
    setQuoteError(null);
    if (quoteAmount <= 0) return undefined;
    // Debounced: every keystroke in the amount field would otherwise be a
    // round trip to the anchor.
    const timer = window.setTimeout(() => {
      const request =
        mode === "deposit"
          ? anchorQuote({
              address: anchorAccount.address,
              challengeSigner: anchorAccount.signChallenge,
              amountTry: quoteAmount,
            })
          : anchorWithdrawQuote({
              address: anchorAccount.address,
              challengeSigner: anchorAccount.signChallenge,
              amountUsdc: quoteAmount,
            });
      request
        .then((q: Quote) => {
          if (!cancelled) setQuote(q);
        })
        .catch((err: Error) => {
          if (!cancelled) setQuoteError(err.message);
        });
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // anchorAccount is rebuilt each render; its address is what matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, quoteAmount, anchorAccount?.address]);

  if (!wallet) return null;

  const pickBank = (name: string) => {
    setBank(name);
    setIban(formatIban(samples[name]));
  };

  const regenerateSamples = () => {
    const next = makeSamples();
    setSamples(next);
    setIban(formatIban(next[bank]));
  };

  const withdrawAmount = Number(amountUsdc) || 0;
  const ibanValid = isTurkishIban(iban);
  const withdrawProblem =
    mode !== "withdraw"
      ? null
      : withdrawAmount < WITHDRAW_MIN || withdrawAmount > WITHDRAW_MAX
        ? t("anchor.limitError", { min: WITHDRAW_MIN, max: WITHDRAW_MAX })
        : balances.usdc === null || withdrawAmount > balances.usdc
          ? t("anchor.balanceError")
          : !ibanValid
            ? t("anchor.ibanError")
            : null;

  const switchMode = (next: AnchorMode) => {
    setMode(next);
    setSuccess(null);
    setError(null);
    setInstructions(null);
    setPaymentHash(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (withdrawProblem) return;
    setProcessing(true);
    setError(null);
    setPaymentHash(null);
    try {
      let account = wallet;
      if (passkey && wallet.prepareRamp) {
        setStatus("ramp");
        account = await wallet.prepareRamp();
      }
      if (mode === "deposit") {
        const { settled } = await anchorDeposit({
          address: account.address,
          challengeSigner: account.signChallenge,
          amountTry: Number(amountTry),
          onStatus: setStatus,
          onInstructions: setInstructions,
        });
        if (passkey && wallet.sweepRamp) {
          setStatus("sweep");
          await wallet.sweepRamp();
        }
        setSuccess({
          kind: "deposit",
          amountTry: Number(amountTry),
          amountUsdc: settled.amount_out,
          txId: settled.stellar_transaction_id,
        });
      } else {
        if (passkey && wallet.fundRamp) {
          setStatus("toRamp");
          await wallet.fundRamp(withdrawAmount);
        }
        const { settled, paymentHash: hash } = await anchorWithdraw({
          wallet: account,
          amountUsdc: withdrawAmount,
          iban,
          bankName: bank,
          onStatus: setStatus,
          onPayment: ({ hash: h }: { hash: string }) => setPaymentHash(h),
        });
        setSuccess({
          kind: "withdraw",
          amountUsdc: withdrawAmount,
          amountTry: settled.amount_out,
          iban: settled.to ?? normalizeIban(iban),
          paymentHash: hash,
          reference: settled.external_transaction_id,
          moreInfoUrl: settled.more_info_url,
        });
      }
      await refreshBalances();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setProcessing(false);
      setStatus(null);
    }
  };

  const inputClass =
    "w-full h-11 px-4 rounded-xl border border-stone-200 focus:border-amber-500 focus:outline-none text-sm text-stone-900";
  const baseSteps = mode === "deposit" ? DEPOSIT_STEPS : WITHDRAW_STEPS;
  const baseLabels = tList(mode === "deposit" ? "anchor.depositSteps" : "anchor.withdrawSteps");
  const steps = passkey ? (mode === "deposit" ? PASSKEY_DEPOSIT_STEPS : PASSKEY_WITHDRAW_STEPS) : baseSteps;
  const stepLabels = steps.map((key) =>
    baseSteps.includes(key) ? baseLabels[baseSteps.indexOf(key)] : t(`anchor.passkeySteps.${key}`),
  );
  const current = stepIndex(steps, status);
  const [paidBefore, paidAfter = ""] = t("anchor.paymentSent").split("{link}");

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto"
      onClick={processing ? undefined : onClose}
    >
      <div
        className="bg-white rounded-3xl max-w-lg w-full p-6 md:p-8 relative shadow-2xl my-auto"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="anchor-title"
      >
        <button
          type="button"
          onClick={onClose}
          disabled={processing}
          aria-label={t("common.close")}
          className="absolute top-5 right-5 p-2 rounded-full text-stone-400 hover:text-stone-900 hover:bg-stone-100 disabled:opacity-40"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="mb-6">
          <div className="w-12 h-12 rounded-2xl bg-emerald-50 border border-emerald-100 flex items-center justify-center mb-4">
            <ArrowDownUp className="w-6 h-6 text-emerald-700" />
          </div>
          <h3 id="anchor-title" className="text-xl font-bold text-stone-900">
            {t("anchor.title")}
          </h3>
          <p className="text-sm text-stone-600 mt-1">
            {mode === "deposit"
              ? t("anchor.depositIntro")
              : t("anchor.withdrawIntro")}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-1 p-1 rounded-full bg-stone-100 mb-6">
          {(
            [
              ["deposit", t("anchor.tabDeposit")],
              ["withdraw", t("anchor.tabWithdraw")],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => switchMode(id)}
              disabled={processing}
              className={`h-9 rounded-full text-xs font-semibold transition-colors ${
                mode === id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-900"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-50 border border-rose-100 text-rose-900 text-xs break-words">
            {error}
            {paymentHash && (
              <span className="block mt-1">
                {paidBefore}
                <a href={explorerTx(paymentHash)} target="_blank" rel="noreferrer" className="underline">
                  {t("anchor.paymentLink")}
                </a>
                {paidAfter}
              </span>
            )}
          </div>
        )}

        {success ? (
          <div className="text-center py-2 space-y-4">
            <div className="w-14 h-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 className="w-8 h-8" />
            </div>

            {success.kind === "deposit" ? (
              <p className="text-sm text-stone-700 max-w-sm mx-auto">
                {t("anchor.depositDone", {
                  try: number(success.amountTry, 0),
                  usdc: number(Number(success.amountUsdc), 4),
                })}
              </p>
            ) : (
              <div className="text-left bg-stone-50 border border-stone-100 rounded-2xl p-4 text-xs text-stone-600 space-y-1.5">
                <div className="text-sm font-semibold text-stone-900 mb-1">
                  {t("anchor.withdrawDone", {
                    usdc: `${number(success.amountUsdc, 2)} USDC`,
                    try: number(Number(success.amountTry), 2),
                  })}
                </div>
                <div className="flex justify-between gap-3">
                  <span>{t("anchor.iban")}</span>
                  <span className="font-mono text-stone-900">{success.iban}</span>
                </div>
                {success.reference && (
                  <div className="flex justify-between gap-3">
                    <span>{t("anchor.fastRef")}</span>
                    <span className="font-mono text-stone-900">{success.reference}</span>
                  </div>
                )}
                <p className="text-[11px] text-stone-500 pt-1">
                  {t("anchor.sandboxDone")}
                </p>
              </div>
            )}

            <div className="flex flex-col items-center gap-1.5">
              {(success.kind === "deposit" ? success.txId : success.paymentHash) && (
                <a
                  href={explorerTx((success.kind === "deposit" ? success.txId : success.paymentHash) as string)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800"
                >
                  <span>{t("anchor.viewUsdcTx")}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
              {success.kind === "withdraw" && success.moreInfoUrl && (
                <a
                  href={success.moreInfoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-800"
                >
                  <span>{t("anchor.anchorRecord")}</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              className="w-full h-11 bg-stone-900 text-white rounded-full font-semibold text-sm"
            >
              {t("common.ok")}
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "deposit" ? (
              <>
                <div>
                  <label htmlFor="anchor-try" className="text-xs font-semibold text-stone-700 block mb-1.5">
                    {t("anchor.amountTry")}
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 font-bold text-stone-400">₺</span>
                    <input
                      id="anchor-try"
                      type="number"
                      min={50}
                      max={3000}
                      step={50}
                      value={amountTry}
                      onChange={(e) => setAmountTry(e.target.value)}
                      disabled={processing}
                      className={`${inputClass} pl-8 font-bold`}
                      required
                    />
                  </div>
                  <p className="text-xs text-stone-500 mt-1">{t("anchor.limitTry")}</p>
                </div>

                {instructions && (
                  <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100 text-xs space-y-1.5">
                    <div className="font-semibold text-stone-900 mb-1">{t("anchor.instructions")}</div>
                    {Object.entries(instructions).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3">
                        <span className="text-stone-500 shrink-0">{k}</span>
                        <span className="font-mono text-stone-900 text-right break-all">
                          {String((v as { value?: unknown })?.value ?? v)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <>
                <div>
                  <label htmlFor="anchor-usdc" className="text-xs font-semibold text-stone-700 block mb-1.5">
                    {t("anchor.amountUsdc")}
                  </label>
                  <input
                    id="anchor-usdc"
                    type="number"
                    min={WITHDRAW_MIN}
                    max={WITHDRAW_MAX}
                    step="any"
                    value={amountUsdc}
                    onChange={(e) => setAmountUsdc(e.target.value)}
                    disabled={processing}
                    className={`${inputClass} font-bold`}
                    required
                  />
                  <div className="flex justify-between text-xs text-stone-500 mt-1">
                    <span>
                      {t("anchor.balance", { amount: balances.usdc === null ? "—" : `${number(balances.usdc, 4)} USDC` })}
                    </span>
                    {balances.usdc !== null && balances.usdc > 0 && (
                      <button
                        type="button"
                        disabled={processing}
                        onClick={() =>
                          setAmountUsdc(String(Math.min(WITHDRAW_MAX, Math.floor(balances.usdc! * 100) / 100)))
                        }
                        className="font-semibold text-amber-700 hover:text-amber-800"
                      >
                        {t("anchor.all")}
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <label htmlFor="anchor-bank" className="text-xs font-semibold text-stone-700 block mb-1.5">
                    {t("anchor.bank")}
                  </label>
                  <select
                    id="anchor-bank"
                    value={bank}
                    onChange={(e) => pickBank(e.target.value)}
                    disabled={processing}
                    className={`${inputClass} bg-white`}
                  >
                    {BANKS.map((b) => (
                      <option key={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="anchor-iban" className="text-xs font-semibold text-stone-700 block mb-1.5">
                    {t("anchor.ibanLabel")}
                  </label>
                  <input
                    id="anchor-iban"
                    value={iban}
                    onChange={(e) => setIban(e.target.value)}
                    disabled={processing}
                    placeholder="TR00 0000 0000 0000 0000 0000 00"
                    aria-invalid={Boolean(iban) && !ibanValid}
                    className={`${inputClass} font-mono text-xs ${iban && !ibanValid ? "border-rose-300" : ""}`}
                    required
                  />
                  <div className="mt-2">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[11px] text-stone-500">{t("anchor.samples")}</span>
                      <button
                        type="button"
                        onClick={regenerateSamples}
                        disabled={processing}
                        className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:text-amber-800"
                      >
                        <RefreshCw className="w-3 h-3" />
                        <span>{t("anchor.regenerate")}</span>
                      </button>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {BANKS.map((b) => {
                        const sample = samples[b.name];
                        const active = normalizeIban(iban) === sample;
                        return (
                          <button
                            key={b.name}
                            type="button"
                            onClick={() => pickBank(b.name)}
                            disabled={processing}
                            title={formatIban(sample)}
                            className={`px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                              active
                                ? "border-amber-500 bg-amber-50"
                                : "border-stone-200 hover:border-amber-300 bg-white"
                            }`}
                          >
                            <span className="block text-[11px] font-semibold text-stone-800">{b.short}</span>
                            <span className="block font-mono text-[10px] text-stone-500">
                              {sample.slice(0, 4)} … {sample.slice(-4)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}

            {quote && (
              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-100 text-xs text-stone-600 space-y-1.5">
                <div className="flex justify-between">
                  <span>{t("anchor.rate")}</span>
                  <span className="font-mono text-stone-900">
                    1 USDC ≈{" "}
                    {number(mode === "deposit" ? Number(quote.price) : 1 / Number(quote.price), 2)} TL
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>{mode === "deposit" ? t("anchor.youGet") : t("anchor.toIban")}</span>
                  <span className="font-mono font-bold text-emerald-700">
                    {mode === "deposit"
                      ? `${number(Number(quote.buy_amount), 4)} USDC`
                      : `${number(Number(quote.buy_amount), 2)} TL`}
                  </span>
                </div>
              </div>
            )}
            {quoteError && !quote && <p className="text-xs text-stone-500 break-words">{t("anchor.quoteFailed", { error: quoteError })}</p>}

            {processing && (
              <ol className="bg-amber-50 border border-amber-100 rounded-2xl p-4 space-y-2 text-xs" aria-live="polite">
                {steps.map((key, i) => (
                  <li key={key} className="flex items-center gap-2">
                    {i < current ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    ) : i === current ? (
                      <Loader2 className="w-4 h-4 text-amber-700 animate-spin shrink-0" />
                    ) : (
                      <Circle className="w-4 h-4 text-stone-300 shrink-0" />
                    )}
                    <span className={i <= current ? "text-stone-900" : "text-stone-400"}>{stepLabels[i]}</span>
                  </li>
                ))}
                {((mode === "withdraw" && status === "paying" && !passkey) || status === "toRamp") && (
                  <li className="text-[11px] text-amber-900 pl-6">{t("anchor.approveInWallet")}</li>
                )}
              </ol>
            )}

            {withdrawProblem && !processing && (
              <p className="text-xs text-rose-700">{withdrawProblem}</p>
            )}

            {passkey && anchorAccount && (
              <p className="text-xs text-stone-500 break-words">
                {t("anchor.rampNote", { ramp: `${anchorAccount.address.slice(0, 5)}…${anchorAccount.address.slice(-5)}` })}
              </p>
            )}

            <div className="flex items-start gap-2 text-xs text-stone-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <span>{t("anchor.sandboxNote")}</span>
            </div>

            <button
              type="submit"
              disabled={processing || Boolean(withdrawProblem)}
              className="w-full h-12 bg-amber-600 hover:bg-amber-700 text-white rounded-full font-semibold text-sm transition-colors disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              <span>
                {processing
                  ? t("anchor.processing")
                  : mode === "deposit"
                    ? t("anchor.submitDeposit")
                    : t("anchor.submitWithdraw")}
              </span>
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
