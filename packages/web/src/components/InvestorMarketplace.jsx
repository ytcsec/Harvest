import React, { useState } from 'react';
import { ShieldCheck, TrendingUp, Sparkles, MapPin, ArrowUpRight, CheckCircle2, Coins } from 'lucide-react';

/**
 * Ported verbatim from the reference frontend.
 *
 * The markup, copy and layout are unchanged. The campaign objects that feed it
 * are built in App.jsx from `listCampaigns()` -- i.e. read back from the
 * deployed contract -- rather than from a hardcoded array, and amounts are in
 * the USDC the contract actually settles in.
 */
export default function InvestorMarketplace({ campaigns, onFundCampaign, userBalanceUsdc, loading }) {
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [fundAmount, setFundAmount] = useState('10');
  const [isFunding, setIsFunding] = useState(false);
  const [filter, setFilter] = useState('all');

  const filteredCampaigns = campaigns.filter((c) => {
    if (filter === 'active') return c.status === 'active';
    if (filter === 'funded') return c.status === 'funded';
    return true;
  });

  const handleFundSubmit = async (e) => {
    e.preventDefault();
    if (!selectedCampaign) return;
    setIsFunding(true);
    try {
      await onFundCampaign(selectedCampaign.id, parseFloat(fundAmount));
      setSelectedCampaign(null);
    } finally {
      setIsFunding(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">

      {/* Top Banner & Value Proposition */}
      <div className="mb-10 p-8 rounded-3xl glass-panel border border-emerald-500/20 relative overflow-hidden">
        <div className="absolute right-0 top-0 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="max-w-3xl relative z-10">
          <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Stellar DeFindex Kasa Entegrasyonu</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight font-['Outfit']">
            Doğrulanmış Tarım Hasatlarına <span className="text-gradient-emerald">Güvenle Yatırım Yapın</span>
          </h1>
          <p className="text-sm text-gray-300 mt-2 leading-relaxed">
            Çiftçinin ticari kapasite sırrını ifşa etmeden <strong>Zero-Knowledge kanıtı</strong> ile doğruladığı avans kampanyalarını TL ile fonlayın. Paranız hasat vadesini beklerken <strong>kasada</strong> ek getiri üretir.
          </p>

          <div className="flex flex-wrap gap-4 pt-6">
            <div className="flex items-center space-x-3 px-4 py-2.5 rounded-2xl bg-[#09140e] border border-emerald-900/40">
              <ShieldCheck className="w-5 h-5 text-emerald-400" />
              <div>
                <span className="block text-[10px] text-gray-400 font-medium">ZK Doğrulama</span>
                <span className="text-xs font-bold text-white">100% On-Chain</span>
              </div>
            </div>

            <div className="flex items-center space-x-3 px-4 py-2.5 rounded-2xl bg-[#09140e] border border-emerald-900/40">
              <TrendingUp className="w-5 h-5 text-amber-400" />
              <div>
                <span className="block text-[10px] text-gray-400 font-medium">Bekleme Getirisi</span>
                <span className="text-xs font-bold text-amber-300">Kasada çalışır</span>
              </div>
            </div>

            <div className="flex items-center space-x-3 px-4 py-2.5 rounded-2xl bg-[#09140e] border border-emerald-900/40">
              <Coins className="w-5 h-5 text-emerald-300" />
              <div>
                <span className="block text-[10px] text-gray-400 font-medium">Ödeme Yolu</span>
                <span className="text-xs font-bold text-white">Stellar TRY Anchor (SEP-6)</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-2 bg-[#0c1611] p-1.5 rounded-2xl border border-emerald-950/60">
          {['all', 'active', 'funded'].map((tabKey) => (
            <button
              key={tabKey}
              onClick={() => setFilter(tabKey)}
              className={`px-4 py-2 rounded-xl text-xs font-bold transition-all ${
                filter === tabKey
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-950'
                  : 'text-gray-400 hover:text-gray-200'
              }`}
            >
              {tabKey === 'all' && 'Tüm Kampanyalar'}
              {tabKey === 'active' && 'Aktif Fonlananlar'}
              {tabKey === 'funded' && 'Hedefe Ulaşanlar'}
            </button>
          ))}
        </div>

        <div className="text-xs text-emerald-400 font-medium">
          Toplam <strong>{filteredCampaigns.length}</strong> hasat fırsatı
        </div>
      </div>

      {loading && (
        <p className="text-xs text-gray-400 mb-4">Kampanyalar zincirden okunuyor…</p>
      )}

      {!loading && filteredCampaigns.length === 0 && (
        <div className="glass-panel rounded-3xl p-10 text-center border border-emerald-900/40 text-sm text-gray-400">
          Henüz kampanya yok. “Çiftçi &amp; ZK Başvuru” sekmesinden bir tane açın.
        </div>
      )}

      {/* Campaign Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredCampaigns.map((camp) => {
          const progressPercent = Math.min(100, Math.round((camp.raised_amount / camp.target_amount) * 100));

          return (
            <div
              key={camp.id}
              className="glass-panel glass-panel-hover rounded-3xl p-6 border border-emerald-900/40 flex flex-col justify-between"
            >
              <div>
                {/* Header with Crop Icon & ZK Badge */}
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center space-x-3">
                    <span className="text-3xl p-2.5 rounded-2xl bg-emerald-950/40 border border-emerald-800/30">
                      {camp.crop_icon || '🌾'}
                    </span>
                    <div>
                      <h3 className="font-bold text-base text-white font-['Outfit'] line-clamp-1">{camp.crop_type}</h3>
                      <p className="text-xs text-gray-400 flex items-center space-x-1 mt-0.5">
                        <MapPin className="w-3 h-3 text-emerald-400" />
                        <span>{camp.location}</span>
                      </p>
                    </div>
                  </div>

                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    camp.status === 'active'
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  }`}>
                    {camp.status === 'active' ? 'Aktif' : 'Tamamlandı'}
                  </span>
                </div>

                {/* ZK Proof Verified Box */}
                <div className="mb-4 p-3 rounded-2xl badge-zk flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-2">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    <span className="text-emerald-300 font-semibold">
                      ZK İspatı: <strong>≥ {camp.zk_min_threshold_tons} Ton</strong>
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-400 font-mono">Doğrulandı</span>
                </div>

                <p className="text-xs text-gray-300 line-clamp-2 mb-4 leading-relaxed">
                  {camp.description}
                </p>

                {/* Progress Bar */}
                <div className="space-y-1.5 mb-4">
                  <div className="flex justify-between text-xs font-semibold">
                    <span className="text-gray-300">Toplanan: {camp.raised_amount?.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} USDC</span>
                    <span className="text-emerald-400 font-bold">%{progressPercent}</span>
                  </div>
                  <div className="w-full h-2.5 bg-black/60 rounded-full overflow-hidden p-0.5 border border-emerald-950">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-green-400 rounded-full transition-all duration-500"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="flex justify-between text-[11px] text-gray-500 font-medium">
                    <span>Hedef: {camp.target_amount?.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} USDC</span>
                    <span>Kampanya #{camp.id}</span>
                  </div>
                </div>

                {/* Financial Metrics */}
                <div className="grid grid-cols-2 gap-2 p-3 rounded-2xl bg-[#09130d] border border-emerald-950/80 mb-5 text-xs">
                  <div>
                    <span className="block text-[10px] text-gray-400 font-medium">Hasat Getiri Primi</span>
                    <span className="text-amber-400 font-extrabold text-sm font-mono">
                      +%{camp.fixed_advance_return_rate}
                    </span>
                  </div>
                  <div>
                    <span className="block text-[10px] text-gray-400 font-medium">Kasadaki Payı</span>
                    <span className="text-emerald-400 font-extrabold text-sm font-mono">
                      {camp.vault_shares?.toLocaleString('tr-TR', { maximumFractionDigits: 3 })}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Button */}
              <div>
                {camp.status === 'active' ? (
                  <button
                    onClick={() => {
                      setSelectedCampaign(camp);
                      setFundAmount(String(Math.max(1, Math.min(10, camp.target_amount - camp.raised_amount))));
                    }}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-black font-extrabold text-xs shadow-lg shadow-emerald-950 transition-all flex items-center justify-center space-x-2"
                  >
                    <span>USDC ile Fonla</span>
                    <ArrowUpRight className="w-4 h-4" />
                  </button>
                ) : (
                  <div className="w-full py-3 rounded-xl bg-emerald-950/30 border border-emerald-800/20 text-center text-xs text-emerald-400 font-semibold flex items-center justify-center space-x-1.5">
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Fonlama Tamamlandı &amp; Kasada</span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Funding Modal */}
      {selectedCampaign && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
          <div className="relative w-full max-w-lg p-6 sm:p-8 glass-panel rounded-3xl border border-emerald-500/30 shadow-2xl">

            <div className="flex items-start justify-between mb-4 border-b border-emerald-900/40 pb-4">
              <div>
                <span className="text-xs text-emerald-400 font-semibold">Hasat Öncesi Fonlama</span>
                <h3 className="text-xl font-bold text-white font-['Outfit'] mt-0.5">
                  {selectedCampaign.crop_type}
                </h3>
              </div>
              <button
                onClick={() => setSelectedCampaign(null)}
                className="p-1 rounded-xl text-gray-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFundSubmit} className="space-y-4">

              <div className="p-4 rounded-2xl bg-[#08120d] border border-emerald-900/40 space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Üretici:</span>
                  <span className="text-white font-semibold font-mono">{selectedCampaign.farmer_name}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">ZK İspat Durumu:</span>
                  <span className="text-emerald-400 font-semibold">≥ {selectedCampaign.zk_min_threshold_tons} Ton (Doğrulandı)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Hasat Vadesi:</span>
                  <span className="text-white">{selectedCampaign.harvest_date}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Kalan Tutar:</span>
                  <span className="text-amber-400 font-bold font-mono">
                    {Math.max(0, selectedCampaign.target_amount - selectedCampaign.raised_amount).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} USDC
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1.5">
                  Yatırılacak Tutar (USDC)
                </label>
                <div className="relative">
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    className="w-full px-4 py-3.5 rounded-2xl glass-input text-lg font-bold text-white font-mono"
                    required
                  />
                  <span className="absolute right-4 top-4 text-xs font-bold text-emerald-400">USDC</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-1">
                  Mevcut Bakiye: <strong>{userBalanceUsdc === null || userBalanceUsdc === undefined ? '—' : `${userBalanceUsdc.toFixed(4)} USDC`}</strong>
                </p>
              </div>

              {/* Vault Yield Preview */}
              <div className="p-3.5 rounded-2xl bg-amber-950/20 border border-amber-500/30 text-xs text-amber-200/90 flex items-center space-x-3">
                <Sparkles className="w-5 h-5 text-amber-400 shrink-0" />
                <span>
                  Yatırdığınız <strong>{parseFloat(fundAmount || 0).toLocaleString('tr-TR')} USDC</strong>, bu sözleşmenin bakiyesinde durmaz; geldiği anda <strong>kasaya yatırılır</strong> ve kampanya kapanana kadar getiri üretir.
                </span>
              </div>

              <div className="pt-2 flex items-center space-x-3">
                <button
                  type="button"
                  onClick={() => setSelectedCampaign(null)}
                  className="w-1/3 py-3.5 rounded-xl bg-black/40 hover:bg-black/60 text-gray-300 font-bold text-xs"
                >
                  Vazgeç
                </button>
                <button
                  type="submit"
                  disabled={isFunding}
                  className="w-2/3 py-3.5 rounded-xl bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-400 hover:to-green-400 text-black font-extrabold text-xs shadow-lg shadow-emerald-950 disabled:opacity-50"
                >
                  {isFunding ? 'Soroban Onaylanıyor...' : 'Fonlamayı Onayla'}
                </button>
              </div>

            </form>

          </div>
        </div>
      )}

    </div>
  );
}
