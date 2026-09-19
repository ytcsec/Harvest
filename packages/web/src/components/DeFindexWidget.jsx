import React from 'react';
import { Sparkles } from 'lucide-react';

/**
 * Ported verbatim from the reference frontend.
 *
 * The three metric cards keep their exact slots; what fills them is read from
 * the deployed vault (`fetch_total_managed_funds`, `price_per_share`,
 * `accrued_yield`) instead of being hardcoded, so the numbers match what an
 * explorer would show.
 */
export default function DeFindexWidget({ stats }) {
  const s = stats ?? {};

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-amber-500/20 relative overflow-hidden">

        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-6">

          {/* Left info */}
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs font-bold">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Resmi Hackathon Entegrasyon Ortağı: DeFindex</span>
            </div>
            <h3 className="text-2xl font-bold text-white font-['Outfit']">
              Atıl Fon Yok: <span className="text-gradient-gold">DeFindex Kasa Getirisi</span>
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              HARVEST protokolünde toplanan avanslar hasat vadesi gelene kadar boşta beklemez. Soroban akıllı sözleşmelerimiz, toplanan fonları <strong>kasaya</strong> yönlendirerek yatırımcılara kampanya süresince ilave pasif getiri sağlar. Aşağıdaki değerler kasanın <strong>şu anki zincir üstü durumudur</strong>.
            </p>
          </div>

          {/* Right Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 w-full lg:w-auto">
            <div className="p-4 rounded-2xl bg-[#0e1712] border border-amber-500/20">
              <span className="block text-[10px] text-gray-400 font-medium">Kasadaki Toplam Değer</span>
              <span className="text-lg font-black text-amber-300 font-mono">
                {s.managedUsdc === undefined ? '—' : `${s.managedUsdc.toLocaleString('tr-TR', { maximumFractionDigits: 2 })} USDC`}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-[#0e1712] border border-emerald-500/20">
              <span className="block text-[10px] text-gray-400 font-medium">Pay Başına Fiyat</span>
              <span className="text-lg font-black text-emerald-400 font-mono">
                {s.pricePerShare === undefined ? '—' : s.pricePerShare.toFixed(4)}
              </span>
            </div>

            <div className="p-4 rounded-2xl bg-[#0e1712] border border-teal-500/20 col-span-2 sm:col-span-1">
              <span className="block text-[10px] text-gray-400 font-medium">Biriken Getiri</span>
              <span className="text-xs font-bold text-teal-300 truncate block font-mono">
                {s.accruedUsdc === undefined ? '—' : `${s.accruedUsdc.toLocaleString('tr-TR', { maximumFractionDigits: 4 })} USDC`}
              </span>
            </div>
          </div>

        </div>

      </div>
    </div>
  );
}
