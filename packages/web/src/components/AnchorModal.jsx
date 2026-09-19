import React, { useEffect, useState } from 'react';
import { ArrowDownUp, Send, CheckCircle2, X, ShieldCheck } from 'lucide-react';

import { anchorDeposit, anchorQuote, anchorWithdraw } from '../lib/harvest.js';
import { challengeSignerFor } from '../lib/wallet.js';

/**
 * Ported from the reference frontend, with the same header, mode switch,
 * amount field and success state.
 *
 * Underneath it runs the real SEP handshake against tr-mock-anchor.fly.dev:
 * SEP-10 auth, SEP-38 quote, SEP-6 deposit, then polling until the anchor
 * reports `completed` and real testnet USDC has landed.
 *
 * The reference collected a sender bank and IBAN on the deposit side. The real
 * anchor works the other way round -- it *issues* the IBAN and the reference
 * code to wire to -- so that block renders the instructions coming back rather
 * than inputs going out. Keeping the inputs would have meant shipping two
 * fields that go nowhere.
 */
export default function AnchorModal({ isOpen, onClose, wallet, balances, onSettled }) {
  const [activeMode, setActiveMode] = useState('deposit');
  const [amountTry, setAmountTry] = useState('500');
  const [amountUsdc, setAmountUsdc] = useState('5');
  const [iban, setIban] = useState('TR33 0006 1005 1987 1234 5678 90');
  const [bankName, setBankName] = useState('Ziraat Bankası');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusLine, setStatusLine] = useState(null);
  const [instructions, setInstructions] = useState(null);
  const [quote, setQuote] = useState(null);
  const [successResult, setSuccessResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isOpen || activeMode !== 'deposit') return undefined;
    let cancelled = false;
    anchorQuote(Number(amountTry) || 0)
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => { cancelled = true; };
  }, [isOpen, activeMode, amountTry, successResult]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsProcessing(true);
    setError(null);
    try {
      if (activeMode === 'deposit') {
        const { deposit, settled } = await anchorDeposit({
          address: wallet.address,
          challengeSigner: challengeSignerFor(wallet.keypair),
          amountTry: Number(amountTry),
          onStatus: (s) => {
            setStatusLine(s);
            if (deposit?.instructions) setInstructions(deposit.instructions);
          }
        });
        setInstructions(deposit.instructions ?? null);
        setSuccessResult({
          message: `${Number(amountTry).toLocaleString('tr-TR')} TL karşılığı ${settled.amount_out} USDC cüzdanınıza geçti.`,
          txId: settled.stellar_transaction_id
        });
        await onSettled?.();
      } else {
        const res = await anchorWithdraw({
          address: wallet.address,
          challengeSigner: challengeSignerFor(wallet.keypair),
          amountUsdc: Number(amountUsdc)
        });
        setSuccessResult({
          message: `Çekim talebi açıldı. ${Number(amountUsdc)} USDC'yi anchor'a gönderdiğinizde karşılığı ${iban} numaralı hesaba geçecek.`,
          withdrawal: res
        });
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsProcessing(false);
      setStatusLine(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-lg my-auto p-6 sm:p-8 glass-panel rounded-3xl border border-emerald-500/30 shadow-2xl">

        {/* Close */}
        <button
          onClick={() => {
            setSuccessResult(null);
            setError(null);
            onClose();
          }}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-white"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 mx-auto mb-3 rounded-2xl bg-emerald-500/20 border border-emerald-400/40 flex items-center justify-center">
            <ArrowDownUp className="w-7 h-7 text-emerald-400" />
          </div>
          <h3 className="text-xl font-bold text-white font-['Outfit']">Stellar TRY Anchor (SEP-6 / SEP-10 / SEP-38)</h3>
          <p className="text-xs text-gray-400 mt-0.5">
            Türk Lirası banka havalesi / FAST ile Stellar Testnet USDC köprüsü
          </p>
        </div>

        {/* Mode Switcher */}
        <div className="grid grid-cols-2 gap-2 p-1.5 rounded-2xl bg-[#09140e] border border-emerald-950 mb-6">
          <button
            type="button"
            onClick={() => { setActiveMode('deposit'); setSuccessResult(null); setError(null); }}
            className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
              activeMode === 'deposit' ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
            }`}
          >
            TL Yatır (Yatırımcı)
          </button>
          <button
            type="button"
            onClick={() => { setActiveMode('withdraw'); setSuccessResult(null); setError(null); }}
            className={`py-2.5 rounded-xl text-xs font-bold transition-all ${
              activeMode === 'withdraw' ? 'bg-emerald-600 text-white shadow-md' : 'text-gray-400 hover:text-white'
            }`}
          >
            Avansı IBAN'a Çek (Çiftçi)
          </button>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-200 text-xs">
            {error}
          </div>
        )}

        {successResult ? (
          <div className="py-6 text-center space-y-4">
            <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto" />
            <h4 className="text-lg font-bold text-white">İşlem Başarıyla Gerçekleşti!</h4>
            <p className="text-xs text-gray-300 max-w-sm mx-auto">{successResult.message}</p>
            {successResult.txId && (
              <a
                href={`https://stellar.expert/explorer/testnet/tx/${successResult.txId}`}
                target="_blank"
                rel="noreferrer"
                className="inline-block text-xs text-emerald-300 underline underline-offset-2"
              >
                İşlemi Stellar Expert'te gör
              </a>
            )}
            <div>
              <button
                onClick={() => { setSuccessResult(null); onClose(); }}
                className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
              >
                Tamam
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">

            {activeMode === 'deposit' ? (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">İşlem Tutarı (TRY)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="50"
                      max="3000"
                      step="50"
                      value={amountTry}
                      onChange={(e) => setAmountTry(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl glass-input text-base font-bold font-mono text-white"
                      required
                    />
                    <span className="absolute right-4 top-3 text-xs font-bold text-emerald-400">TRY</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">Anchor limiti: 50 – 3.000 TL</p>
                </div>

                {quote && (
                  <div className="p-3.5 rounded-xl bg-[#08120d] border border-emerald-900/40 text-xs space-y-1.5">
                    <div className="flex justify-between">
                      <span className="text-gray-400">Kur (SEP-38):</span>
                      <span className="text-white font-mono">1 USDC = {Number(quote.price).toFixed(2)} TRY</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-gray-400">Alacağınız:</span>
                      <span className="text-emerald-300 font-mono font-bold">{Number(quote.buy_amount).toFixed(4)} USDC</span>
                    </div>
                  </div>
                )}

                {instructions && (
                  <div className="p-3.5 rounded-xl bg-[#09140e] border border-emerald-950 text-xs space-y-1.5">
                    <div className="font-bold text-emerald-300 mb-1">Havale Bilgileri (anchor tarafından verildi)</div>
                    {Object.entries(instructions).map(([k, v]) => (
                      <div key={k} className="flex justify-between gap-3">
                        <span className="text-gray-400 shrink-0">{k}:</span>
                        <span className="text-white font-mono text-right break-all">{String(v.value ?? v)}</span>
                      </div>
                    ))}
                  </div>
                )}

                {statusLine && (
                  <p className="text-xs text-emerald-300">Anchor işliyor — {statusLine}</p>
                )}
              </>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">İşlem Tutarı (USDC)</label>
                  <div className="relative">
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={amountUsdc}
                      onChange={(e) => setAmountUsdc(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl glass-input text-base font-bold font-mono text-white"
                      required
                    />
                    <span className="absolute right-4 top-3 text-xs font-bold text-emerald-400">USDC</span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-1">
                    Mevcut bakiye: {balances?.usdc === null || balances?.usdc === undefined ? '—' : `${balances.usdc.toFixed(4)} USDC`}
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">Hedef Banka</label>
                  <select
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl glass-input text-xs font-medium text-white"
                  >
                    <option value="Ziraat Bankası">Ziraat Bankası (Tarım Destekli)</option>
                    <option value="İş Bankası">Türkiye İş Bankası</option>
                    <option value="Garanti BBVA">Garanti BBVA</option>
                    <option value="Yapı Kredi">Yapı Kredi</option>
                    <option value="Vakıfbank">Vakıfbank</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                    Hasat Avansının Yatacağı IBAN
                  </label>
                  <input
                    type="text"
                    value={iban}
                    onChange={(e) => setIban(e.target.value)}
                    className="w-full px-4 py-3 rounded-xl glass-input text-xs font-mono text-white"
                    required
                  />
                </div>
              </>
            )}

            <div className="p-3 rounded-xl bg-[#09140e] border border-emerald-950 text-xs text-gray-400 flex items-start space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>
                Anchor bir sandbox: banka havalesi, KYC ve TL ödemesi simüle edilir. USDC ayağı gerçek Stellar testnet hareketidir.
              </span>
            </div>

            <button
              type="submit"
              disabled={isProcessing || !wallet}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-black font-extrabold text-xs shadow-xl shadow-emerald-950 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
            >
              {isProcessing ? (
                <span>İşlem Anchor Tarafından Onaylanıyor...</span>
              ) : (
                <>
                  <Send className="w-4 h-4 text-black" />
                  <span>{activeMode === 'deposit' ? 'TL Yatırmayı Onayla' : 'Avansı IBAN\'a Aktar'}</span>
                </>
              )}
            </button>

          </form>
        )}

      </div>
    </div>
  );
}
