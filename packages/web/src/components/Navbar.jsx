import React from 'react';
import { ShieldCheck, ArrowDownUp, Sprout, TrendingUp, KeyRound, Sparkles } from 'lucide-react';

/**
 * Ported verbatim from the reference frontend. The only changes are to what
 * fills the slots: the balance is the wallet's real USDC read from Horizon,
 * the vault APY chip reports the deployed vault's real price per share, and
 * the wallet button shows the real account.
 */
export default function Navbar({
  activeTab,
  setActiveTab,
  userRole,
  setUserRole,
  balances,
  onOpenPasskey,
  onOpenAnchor,
  isConnected,
  walletAddress,
  vaultApyLabel
}) {
  return (
    <header className="sticky top-0 z-50 glass-panel border-b border-emerald-950/60 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">

          {/* Logo */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('explore')}>
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-emerald-600 via-emerald-500 to-green-400 p-0.5 shadow-lg shadow-emerald-900/30">
              <div className="w-full h-full bg-[#08120d] rounded-[14px] flex items-center justify-center">
                <Sprout className="w-7 h-7 text-emerald-400" />
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="text-2xl font-extrabold tracking-tight text-white font-['Outfit']">HARVEST</span>
                <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  ZK &amp; STELLAR
                </span>
              </div>
              <p className="text-xs text-emerald-400/70 font-medium">Hasat Öncesi Gizli Finansman Protokolü</p>
            </div>
          </div>

          {/* Role Switcher */}
          <div className="hidden md:flex items-center bg-[#0d1611] p-1 rounded-xl border border-emerald-900/40">
            <button
              onClick={() => {
                setUserRole('investor');
                setActiveTab('explore');
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                userRole === 'investor'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <TrendingUp className="w-4 h-4" />
              <span>Yatırımcı Portali</span>
            </button>

            <button
              onClick={() => {
                setUserRole('farmer');
                setActiveTab('farmer_zk');
              }}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                userRole === 'farmer'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-900/40'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              <ShieldCheck className="w-4 h-4" />
              <span>Çiftçi &amp; ZK Başvuru</span>
            </button>
          </div>

          {/* Navigation Items & Actions */}
          <div className="flex items-center space-x-3">

            {/* DeFindex Yield Tag */}
            <div className="hidden lg:flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs font-medium">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              <span>DeFindex Kasa: <strong>{vaultApyLabel}</strong></span>
            </div>

            {/* Stellar TRY Anchor Button */}
            <button
              onClick={onOpenAnchor}
              className="flex items-center space-x-2 px-3.5 py-2 rounded-xl bg-[#112017] hover:bg-[#162b1f] border border-emerald-800/40 text-emerald-300 text-xs font-semibold transition-all"
              title="Stellar TRY Anchor (SEP-6 / SEP-10 / SEP-38)"
            >
              <ArrowDownUp className="w-4 h-4 text-emerald-400" />
              <div className="text-left">
                <span className="block text-[10px] text-gray-400 leading-none">Bakiye</span>
                <span className="text-white font-bold text-xs">
                  {balances?.usdc === null || balances?.usdc === undefined
                    ? '— USDC'
                    : `${balances.usdc.toFixed(2)} USDC`}
                </span>
              </div>
            </button>

            {/* Wallet Button */}
            <button
              onClick={onOpenPasskey}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white text-xs font-bold shadow-lg shadow-emerald-950/50 transition-all border border-emerald-400/30"
            >
              <KeyRound className="w-4 h-4 text-emerald-200" />
              <span>
                {isConnected
                  ? `${walletAddress?.substring(0, 6)}...${walletAddress?.substring(walletAddress.length - 4)}`
                  : 'Cüzdan Oluştur'}
              </span>
            </button>

          </div>

        </div>
      </div>
    </header>
  );
}
