import React, { useCallback, useEffect, useState } from 'react';
import { Sprout, CheckCircle2 } from 'lucide-react';

import Navbar from './components/Navbar.jsx';
import PasskeyModal from './components/PasskeyModal.jsx';
import FarmerZKFlow from './components/FarmerZKFlow.jsx';
import InvestorMarketplace from './components/InvestorMarketplace.jsx';
import DeFindexWidget from './components/DeFindexWidget.jsx';
import AnchorModal from './components/AnchorModal.jsx';

import { balances, createWallet, forgetWallet, loadWallet, signerFor } from './lib/wallet.js';
import { deployments, fundCampaign, listCampaigns, vaultStats } from './lib/harvest.js';
import { prefetchProvingArtifacts } from './lib/prover.js';

/** Purely decorative: the contract stores a crop name, not an icon. */
function cropGlyph(crop = '') {
  const c = crop.toLocaleLowerCase('tr');
  if (c.includes('fındık') || c.includes('findik') || c.includes('hazelnut')) return '🌰';
  if (c.includes('zeytin') || c.includes('olive')) return '🫒';
  if (c.includes('pamuk') || c.includes('cotton')) return '🌱';
  if (c.includes('buğday') || c.includes('wheat')) return '🌾';
  if (c.includes('üzüm') || c.includes('grape')) return '🍇';
  return '🌾';
}

/**
 * Maps a campaign as the contract stores it onto the shape the reference's
 * marketplace cards expect, so the card markup stays untouched.
 *
 * Fields the chain does not keep -- an investor headcount, a per-campaign APY --
 * are not invented. Their slots carry the nearest real fact instead: the
 * campaign id, and the vault shares the campaign actually holds.
 */
function toCard(c) {
  return {
    id: c.id,
    crop_type: c.crop,
    crop_icon: cropGlyph(c.crop),
    location: `${c.region} · ${c.season}`,
    farmer_name: `${c.farmer.slice(0, 5)}…${c.farmer.slice(-5)}`,
    harvest_date: new Date(c.deadline * 1000).toLocaleDateString('tr-TR'),
    target_amount: c.target,
    raised_amount: c.raised,
    vault_shares: c.shares,
    fixed_advance_return_rate: c.returnPercent,
    zk_min_threshold_tons: (c.thresholdKg / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 }),
    status: c.status === 'Funding' ? 'active' : 'funded',
    description: `Zincirde doğrulanmış kapasite kanıtına dayalı hasat öncesi avans. Durum: ${c.status}. Vade: ${new Date(c.deadline * 1000).toLocaleDateString('tr-TR')}.`
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState('explore');
  const [userRole, setUserRole] = useState('investor');
  const [isPasskeyOpen, setIsPasskeyOpen] = useState(false);
  const [isAnchorOpen, setIsAnchorOpen] = useState(false);

  const [wallet, setWallet] = useState(() => loadWallet());
  const [creating, setCreating] = useState(null);
  const [funds, setFunds] = useState({ xlm: 0, usdc: null });

  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [vault, setVault] = useState({});

  const [toastMessage, setToastMessage] = useState('');

  const showToast = useCallback((msg) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 4500);
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!wallet) return;
    setFunds(await balances(wallet.address));
  }, [wallet]);

  // Reads are simulations, so they only need *an* existing account to run as --
  // not the viewer's. Falling back to the deployer lets the marketplace and the
  // vault banner be browsed before anyone connects a wallet, which is how the
  // reference behaved with its hardcoded data.
  const readSource = wallet?.address ?? deployments.deployer;

  const fetchCampaigns = useCallback(async () => {
    setLoadingCampaigns(true);
    try {
      const list = await listCampaigns(readSource);
      setCampaigns(list.map(toCard));
    } catch {
      setCampaigns([]);
    } finally {
      setLoadingCampaigns(false);
    }
    try {
      setVault(await vaultStats(readSource));
    } catch {
      setVault({});
    }
  }, [readSource]);

  useEffect(() => {
    refreshBalances();
    fetchCampaigns();
    const timer = setInterval(refreshBalances, 12_000);
    return () => clearInterval(timer);
  }, [refreshBalances, fetchCampaigns]);

  useEffect(() => {
    // 8 MB of proving artefacts; start them early so the farmer flow feels
    // instant when it gets there.
    prefetchProvingArtifacts();
  }, []);

  async function handleCreateWallet() {
    setCreating('funding');
    try {
      const created = await createWallet(setCreating);
      setWallet(created);
      showToast('Cüzdan oluşturuldu ve fonlandı.');
    } finally {
      setCreating(null);
    }
  }

  const handleFundCampaign = async (campaignId, amount) => {
    if (funds.usdc !== null && funds.usdc < amount) {
      showToast('Yetersiz USDC bakiyesi! Lütfen Stellar Anchor üzerinden TL yükleyin.');
      return;
    }
    try {
      await fundCampaign({
        address: wallet.address,
        sign: signerFor(wallet.keypair),
        id: campaignId,
        amountUsdc: amount
      });
      showToast(`${amount.toLocaleString('tr-TR')} USDC fonlama başarılı! Fonlar kasada getiri üretiyor.`);
      await Promise.all([fetchCampaigns(), refreshBalances()]);
    } catch (err) {
      showToast(`Fonlama başarısız: ${err.message}`);
    }
  };

  const vaultApyLabel =
    vault.pricePerShare === undefined ? '—' : `${vault.pricePerShare.toFixed(4)} / pay`;

  return (
    <div className="min-h-screen bg-[#060907] text-gray-100 flex flex-col justify-between selection:bg-emerald-500 selection:text-black">

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 max-w-sm p-4 rounded-2xl glass-panel border border-emerald-400/50 bg-[#0a1810] shadow-2xl text-xs font-semibold text-emerald-300 flex items-center space-x-3">
          <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        userRole={userRole}
        setUserRole={setUserRole}
        balances={funds}
        onOpenPasskey={() => setIsPasskeyOpen(true)}
        onOpenAnchor={() => (wallet ? setIsAnchorOpen(true) : setIsPasskeyOpen(true))}
        isConnected={Boolean(wallet)}
        walletAddress={wallet?.address}
        vaultApyLabel={vaultApyLabel}
      />

      {/* Vault Yield Banner */}
      <DeFindexWidget stats={vault} />

      {/* Main Content Area */}
      <main className="flex-1 pb-16">
        {activeTab === 'explore' && (
          <InvestorMarketplace
            campaigns={campaigns}
            onFundCampaign={handleFundCampaign}
            userBalanceUsdc={funds.usdc}
            loading={loadingCampaigns}
          />
        )}

        {activeTab === 'farmer_zk' && (
          <FarmerZKFlow
            wallet={wallet}
            notify={showToast}
            onCampaignCreated={() => {
              fetchCampaigns();
              showToast('ZK İspatlı yeni hasat kampanyası Stellar Testnet üzerinde yayınlandı!');
            }}
          />
        )}
      </main>

      {/* Wallet Modal */}
      <PasskeyModal
        isOpen={isPasskeyOpen}
        onClose={() => setIsPasskeyOpen(false)}
        onCreate={handleCreateWallet}
        creating={creating}
        wallet={wallet}
        onForget={() => {
          forgetWallet();
          setWallet(null);
          setFunds({ xlm: 0, usdc: null });
          setCampaigns([]);
        }}
      />

      {/* Stellar TRY Anchor Modal */}
      <AnchorModal
        isOpen={isAnchorOpen && Boolean(wallet)}
        onClose={() => setIsAnchorOpen(false)}
        wallet={wallet}
        balances={funds}
        onSettled={refreshBalances}
      />

      {/* Footer & Hackathon Credits */}
      <footer className="border-t border-emerald-950/60 bg-[#040705] py-8 text-xs text-gray-400">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-2">
            <Sprout className="w-5 h-5 text-emerald-400" />
            <span className="text-white font-bold font-['Outfit'] text-sm">HARVEST PROTOCOL</span>
            <span>— Rise In x Stellar Pro Hackathon 2026</span>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-4 text-[11px] text-emerald-400/80">
            <a href={`https://stellar.expert/explorer/testnet/contract/${deployments.verifier}`} target="_blank" rel="noreferrer">
              • Soroban ZK Verifier (Groth16)
            </a>
            <a href={`https://stellar.expert/explorer/testnet/contract/${deployments.vault}`} target="_blank" rel="noreferrer">
              • Vault Yield Integration
            </a>
            <a href={deployments.anchor} target="_blank" rel="noreferrer">
              • Stellar TRY Anchor (SEP-6)
            </a>
            <a href={`https://stellar.expert/explorer/testnet/contract/${deployments.campaign}`} target="_blank" rel="noreferrer">
              • Campaign Contract
            </a>
          </div>

          <div className="text-gray-400">
            Deployed on <strong>Stellar Testnet</strong>
          </div>
        </div>
      </footer>

    </div>
  );
}
