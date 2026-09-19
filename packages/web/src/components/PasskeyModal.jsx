import React, { useState } from 'react';
import { KeyRound, ShieldCheck, Fingerprint, Smartphone, CheckCircle2, X, AlertCircle } from 'lucide-react';

/**
 * The reference's Passkey modal, kept structurally intact -- same gradient
 * badge, same panel, same scanning and success states, same classes.
 *
 * One thing is deliberately not carried over. The reference faked WebAuthn with
 * a `setTimeout` and handed back `"GCPASSKEY77XQ9A" + Math.random()`, which is
 * not an address any network would accept. Here the same button creates a real
 * Stellar testnet account: friendbot funds it and a USDC trustline is opened,
 * and the address shown afterwards is one you can open in an explorer.
 *
 * Passkeys remain the roadmap item they always were -- Soroban exposes
 * `secp256r1_verify`, and every signature in this app goes through one
 * `sign(tx)` seam -- so the note at the bottom says so rather than the button
 * pretending it already happened.
 */
export default function PasskeyModal({ isOpen, onClose, onCreate, creating, wallet, onForget }) {
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const step = creating ? 'scanning' : wallet ? 'success' : 'idle';

  const handleCreate = async () => {
    setError(null);
    try {
      await onCreate();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto">
      <div className="relative w-full max-w-md my-auto p-6 glass-panel rounded-3xl border border-emerald-500/30 shadow-2xl shadow-emerald-950/80">

        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-xl text-gray-400 hover:text-white hover:bg-emerald-950/40"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 p-0.5 shadow-lg shadow-emerald-900/40">
            <div className="w-full h-full bg-[#0a140f] rounded-[14px] flex items-center justify-center">
              <Fingerprint className="w-8 h-8 text-emerald-400" />
            </div>
          </div>
          <h3 className="text-xl font-bold text-white font-['Outfit']">Stellar Smart Wallet</h3>
          <p className="text-xs text-emerald-400/80 mt-1">
            Tarayıcınızda bir Stellar testnet hesabı oluşturulur, fonlanır ve USDC hattı açılır.
          </p>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-red-950/50 border border-red-800/60 text-red-200 text-xs">
            {error}
          </div>
        )}

        {step === 'idle' && (
          <div className="space-y-4">
            <div className="p-4 rounded-2xl bg-[#08120d] border border-emerald-900/40 space-y-3">
              <div className="flex items-center justify-between text-xs text-gray-300">
                <span className="flex items-center space-x-2">
                  <Smartphone className="w-4 h-4 text-emerald-400" />
                  <span>Cüzdan Kurulumu</span>
                </span>
                <span className="text-emerald-400 font-semibold">Stellar Testnet</span>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-1">
                <div className="p-3 rounded-xl border bg-black/30 border-emerald-950/50 text-gray-300 text-xs font-semibold flex items-center justify-center space-x-2">
                  <KeyRound className="w-4 h-4 text-emerald-400" />
                  <span>Friendbot XLM</span>
                </div>
                <div className="p-3 rounded-xl border bg-black/30 border-emerald-950/50 text-gray-300 text-xs font-semibold flex items-center justify-center space-x-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <span>USDC Trustline</span>
                </div>
              </div>
            </div>

            <div className="p-3 rounded-xl bg-amber-950/20 border border-amber-800/40 flex items-start space-x-2.5 text-xs text-amber-200/80">
              <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span>
                Demo cüzdanı: gizli anahtar bu tarayıcının localStorage'ında tutulur. Gerçek para için kullanmayın.
              </span>
            </div>

            <button
              onClick={handleCreate}
              className="w-full py-3.5 px-4 rounded-xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-black font-extrabold text-sm shadow-xl shadow-emerald-950/80 transition-all flex items-center justify-center space-x-2"
            >
              <Fingerprint className="w-5 h-5 text-black" />
              <span>Cüzdan Oluştur</span>
            </button>
          </div>
        )}

        {step === 'scanning' && (
          <div className="py-8 text-center space-y-4">
            <div className="w-20 h-20 mx-auto rounded-full bg-emerald-500/10 border-2 border-emerald-400 flex items-center justify-center animate-pulse">
              <Fingerprint className="w-10 h-10 text-emerald-400" />
            </div>
            <p className="text-sm font-semibold text-white">
              {creating === 'trustline' ? 'USDC trustline açılıyor...' : 'Friendbot hesabı fonluyor...'}
            </p>
            <p className="text-xs text-gray-400">Stellar Testnet üzerinde gerçek işlem gönderiliyor</p>
          </div>
        )}

        {step === 'success' && (
          <div className="py-6 text-center space-y-3">
            <CheckCircle2 className="w-16 h-16 text-emerald-400 mx-auto" />
            <h4 className="text-lg font-bold text-white">Cüzdan Bağlandı</h4>
            <p className="text-[11px] text-emerald-300 font-mono break-all px-4">{wallet.address}</p>
            <a
              href={`https://stellar.expert/explorer/testnet/account/${wallet.address}`}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-xs text-emerald-400 underline underline-offset-2"
            >
              Hesabı Stellar Expert'te aç
            </a>
            <div className="pt-2">
              <button
                onClick={() => { onForget(); onClose(); }}
                className="px-5 py-2.5 rounded-xl bg-black/40 hover:bg-black/60 text-gray-300 font-bold text-xs"
              >
                Cüzdanı Sil
              </button>
            </div>
          </div>
        )}

        <div className="mt-5 p-3 rounded-xl bg-emerald-950/20 border border-emerald-800/30 flex items-start space-x-2.5 text-xs text-emerald-300/80">
          <Fingerprint className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <span>
            Passkey (FaceID / TouchID) akıllı cüzdan yol haritasında: Soroban <code>secp256r1_verify</code>'ı yerel olarak sunuyor ve buradaki her imza tek bir <code>sign(tx)</code> noktasından geçiyor.
          </span>
        </div>

      </div>
    </div>
  );
}
