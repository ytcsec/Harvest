import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, Cpu, Sparkles, CheckCircle2, AlertTriangle, ArrowRight, FileText, Send, Building2 } from 'lucide-react';

import { createCampaign, fetchMembers, requestAttestation } from '../lib/harvest.js';
import { commitmentForIssuer, proveCapacity } from '../lib/prover.js';
import { signerFor } from '../lib/wallet.js';

/**
 * Ported verbatim from the reference frontend -- same four steps, same panels,
 * same copy. What sits behind each button is the real protocol:
 *
 *   step 1  the cooperative service signs an EdDSA attestation over
 *           Poseidon(farmerSecret); it never sees the secret itself.
 *   step 2  snarkjs builds a real Groth16 proof over the 9,981-constraint
 *           circuit, in this tab. The reference's `zkEngine.js` produced its
 *           `pi_a` / `pi_b` / `pi_c` with Math.random(); that file is not used
 *           here and is not part of this app.
 *   step 3  `create_campaign`, which the contract refuses unless the proof
 *           passes the BN254 pairing check on chain.
 *
 * The private figures are read from the signed attestation rather than typed,
 * because in the real protocol the cooperative attests to its own records --
 * a farmer who could type any number would be attesting to nothing.
 */
export default function FarmerZKFlow({ onCampaignCreated, wallet, notify }) {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [proveStage, setProveStage] = useState(null);

  const [members, setMembers] = useState([]);
  const [membershipId, setMembershipId] = useState('');

  const [formData, setFormData] = useState({
    publicThresholdTons: 38,
    targetAmountUsdc: 120,
    fixedReturnRate: 15,
    days: 30,
    cropType: '',
    location: '',
    description: ''
  });

  const [attested, setAttested] = useState(null);
  const [zkProofResult, setZkProofResult] = useState(null);
  const [createdCampaign, setCreatedCampaign] = useState(null);

  useEffect(() => {
    fetchMembers()
      .then((list) => {
        setMembers(list);
        setMembershipId(list[0]?.membershipId ?? '');
      })
      .catch((err) => setErrorMessage(err.message));
  }, []);

  const member = members.find((m) => m.membershipId === membershipId);
  const rawEstimatedKg = attested ? Number(attested.attestation.expectedYieldKg) : (member?.expectedYieldKg ?? 0);
  const parcelLabel = attested?.display?.parcel ?? '—';

  // 1. Get the cooperative-signed attestation.
  const handleFetchCertificate = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const commitment = await commitmentForIssuer();
      const result = await requestAttestation(membershipId, commitment);
      setAttested(result);
      const real = Number(result.attestation.expectedYieldKg);
      setFormData((f) => ({
        ...f,
        publicThresholdTons: Math.floor((real * 0.8) / 1000),
        cropType: result.display.cropLabel.tr,
        location: result.display.region.tr,
        description: `Zincirde doğrulanmış kapasite kanıtına dayalı hasat öncesi avans kampanyası. ${result.display.cropLabel.tr} · ${result.display.region.tr} · ${result.attestation.season} sezonu.`
      }));
      setZkProofResult(null);
      setCreatedCampaign(null);
      setStep(2);
    } catch (err) {
      setErrorMessage(err.message || 'Sertifika alınamadı.');
    } finally {
      setIsLoading(false);
    }
  };

  // 2. Generate the Groth16 proof locally.
  const handleGenerateZKProof = async () => {
    setIsLoading(true);
    setErrorMessage('');
    setProveStage('witness');
    try {
      const result = await proveCapacity({
        issuer: attested.issuer,
        attestation: attested.attestation,
        signature: attested.signature,
        thresholdKg: Number(formData.publicThresholdTons) * 1000,
        address: wallet.address,
        onStage: setProveStage
      });
      setZkProofResult(result);
      notify?.(`ZK kanıtı üretildi — ${result.provingMs} ms`);
      setStep(3);
    } catch (err) {
      setErrorMessage(err.message || 'ZK Kanıtı üretilirken bir hata oluştu.');
    } finally {
      setIsLoading(false);
      setProveStage(null);
    }
  };

  // 3. Open the campaign on chain.
  const handleSubmitCampaign = async () => {
    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await createCampaign({
        address: wallet.address,
        sign: signerFor(wallet.keypair),
        claim: zkProofResult.claim,
        proof: zkProofResult.proof,
        crop: formData.cropType,
        region: formData.location,
        targetUsdc: Number(formData.targetAmountUsdc),
        days: Number(formData.days),
        returnPercent: Number(formData.fixedReturnRate)
      });
      setCreatedCampaign(res);
      onCampaignCreated?.();
      setStep(4);
    } catch (err) {
      setErrorMessage(err.message || 'Kampanya açılamadı.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4 sm:px-6">

      {/* Header */}
      <div className="text-center mb-8">
        <div className="inline-flex items-center space-x-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold mb-3">
          <Lock className="w-3.5 h-3.5" />
          <span>Zero-Knowledge Ticari Gizlilik Koruması</span>
        </div>
        <h2 className="text-3xl font-extrabold text-white font-['Outfit']">
          Hasat Öncesi ZK Avans Başvurusu
        </h2>
        <p className="text-sm text-gray-400 mt-2 max-w-2xl mx-auto">
          Gerçek rekoltenizi ve parsel büyüklüğünüzü rakiplerinize açmadan, yalnızca eşiği sağladığınızı kanıtlayarak Stellar üzerinde avans kampanyası açın.
        </p>
      </div>

      {/* Progress Steps */}
      <div className="grid grid-cols-4 gap-2 mb-8">
        {[
          { num: 1, title: 'Resmi Sertifika' },
          { num: 2, title: 'ZK Kanıt Motoru' },
          { num: 3, title: 'Kampanya Detayı' },
          { num: 4, title: 'Stellar Onayı' },
        ].map((s) => (
          <div
            key={s.num}
            className={`p-3 rounded-2xl border text-center transition-all ${
              step === s.num
                ? 'bg-emerald-600/20 border-emerald-500 text-white shadow-lg shadow-emerald-950'
                : step > s.num
                ? 'bg-[#0e1a13] border-emerald-900/50 text-emerald-400'
                : 'bg-[#09100c] border-emerald-950/40 text-gray-500'
            }`}
          >
            <div className="text-xs font-bold font-['Outfit']">ADIM {s.num}</div>
            <div className="text-[11px] font-medium truncate mt-0.5">{s.title}</div>
          </div>
        ))}
      </div>

      {/* Error Notification */}
      {errorMessage && (
        <div className="mb-6 p-4 rounded-2xl bg-red-950/50 border border-red-800/60 text-red-200 text-sm flex items-center space-x-3">
          <AlertTriangle className="w-5 h-5 text-red-400 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Step 1: Fetch Official Certificate */}
      {step === 1 && (
        <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-emerald-500/20 space-y-6">
          <div className="flex items-center space-x-3 border-b border-emerald-900/40 pb-4">
            <Building2 className="w-6 h-6 text-emerald-400" />
            <div>
              <h3 className="text-lg font-bold text-white font-['Outfit']">Kooperatif Veri Doğrulama</h3>
              <p className="text-xs text-gray-400">Resmi kaynaktan imzalı rekolte ve ekspertiz verisi çekilir.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Çiftçi / Birlik Üyeliği</label>
              <select
                value={membershipId}
                onChange={(e) => setMembershipId(e.target.value)}
                className="w-full px-4 py-3 rounded-xl glass-input text-sm"
              >
                {members.map((m) => (
                  <option key={m.membershipId} value={m.membershipId}>
                    {m.farmer} — {m.membershipId}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">ÇKS Kayıt No</label>
              <input
                type="text"
                value={member?.membershipId ?? ''}
                readOnly
                className="w-full px-4 py-3 rounded-xl glass-input text-sm opacity-80"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Ürün Tipi</label>
              <input
                type="text"
                value={member?.cropLabel?.tr ?? ''}
                readOnly
                className="w-full px-4 py-3 rounded-xl glass-input text-sm opacity-80"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Bölge</label>
              <input
                type="text"
                value={member?.region?.tr ?? ''}
                readOnly
                className="w-full px-4 py-3 rounded-xl glass-input text-sm opacity-80"
              />
            </div>
          </div>

          {/* Secret Data Highlight */}
          <div className="p-4 rounded-2xl bg-amber-950/20 border border-amber-500/30 space-y-2">
            <div className="flex items-center space-x-2 text-amber-300 text-xs font-bold">
              <Lock className="w-4 h-4 text-amber-400" />
              <span>GİZLİ TİCARİ VERİ (Kooperatif Kaydı)</span>
            </div>
            <p className="text-xs text-amber-200/70">
              Bu değer tarayıcınızda sıfır bilgi kanıtına (ZK Proof) girdi olarak kullanılır ve asla internete/zincire sızdırılmaz. Kooperatif kendi kaydını imzalar; bu yüzden elle değiştirilemez.
            </p>
            <div className="pt-2 flex items-center space-x-3">
              <input
                type="text"
                value={rawEstimatedKg.toLocaleString('tr-TR')}
                readOnly
                className="w-48 px-4 py-2.5 rounded-xl bg-black/50 border border-amber-500/40 text-amber-300 font-mono font-bold text-base"
              />
              <span className="text-sm font-semibold text-gray-300">Kilogram (kg)</span>
            </div>
          </div>

          <button
            onClick={handleFetchCertificate}
            disabled={isLoading || !membershipId || !wallet}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-green-600 hover:from-emerald-500 hover:to-green-500 text-black font-extrabold text-sm shadow-xl shadow-emerald-950 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span>Sertifika Doğrulanıyor...</span>
            ) : (
              <>
                <span>Resmi İmzalı Sertifikayı Al</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          {!wallet && (
            <p className="text-[11px] text-amber-300/80 text-center">
              Önce sağ üstten cüzdan oluşturun.
            </p>
          )}
        </div>
      )}

      {/* Step 2: Zero-Knowledge Proof Generation */}
      {step === 2 && (
        <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-emerald-500/30 space-y-6">
          <div className="flex items-center justify-between border-b border-emerald-900/40 pb-4">
            <div className="flex items-center space-x-3">
              <Cpu className={`w-6 h-6 text-emerald-400 ${isLoading ? 'animate-spin' : ''}`} />
              <div>
                <h3 className="text-lg font-bold text-white font-['Outfit']">Tarayıcı İçi ZK İspat Devresi</h3>
                <p className="text-xs text-emerald-400">Groth16 / Circom İstemci Tarafı Matematiksel Kanıt</p>
              </div>
            </div>
            <span className="px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 text-xs font-mono font-bold">
              BN254 · 9.981 constraints
            </span>
          </div>

          {/* Privacy Demonstration Visual */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-2xl bg-[#09130d] border border-red-950/60 space-y-2">
              <div className="flex items-center space-x-2 text-xs font-bold text-red-400">
                <Lock className="w-4 h-4" />
                <span>GİZLİ TUTULAN VERİLER</span>
              </div>
              <ul className="text-xs text-gray-400 space-y-1">
                <li>• Gerçek Rekolte: <strong>{rawEstimatedKg.toLocaleString('tr-TR')} kg</strong></li>
                <li>• Parsel &amp; Ada No: <strong>{parcelLabel}</strong></li>
                <li>• Çiftçinin kimliği ve üyelik kaydı</li>
              </ul>
              <div className="text-[10px] text-red-400/80 italic pt-1">
                🚫 Bu veriler cihazınızdan asla ayrılmaz.
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-[#0b1d12] border border-emerald-500/40 space-y-2">
              <div className="flex items-center space-x-2 text-xs font-bold text-emerald-400">
                <ShieldCheck className="w-4 h-4" />
                <span>STELLAR'A YAZILACAK AÇIK BEYAN</span>
              </div>
              <div className="text-xs text-gray-300">
                "Bu üreticinin hasat tahmini en az <strong>{formData.publicThresholdTons} Ton</strong>dur ve akredite kooperatif tarafından onaylıdır."
              </div>
              <div className="pt-2">
                <label className="block text-[11px] text-emerald-300 font-medium mb-1">Açık Eşik Tonajı (Ton):</label>
                <input
                  type="number"
                  min="1"
                  max={Math.floor(rawEstimatedKg / 1000)}
                  value={formData.publicThresholdTons}
                  onChange={(e) => setFormData({ ...formData, publicThresholdTons: e.target.value })}
                  className="w-full px-3 py-2 rounded-xl bg-black/60 border border-emerald-500/40 text-emerald-300 font-mono font-bold text-sm"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  Gizli kalan pay: {((rawEstimatedKg - Number(formData.publicThresholdTons) * 1000) / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 1 })} ton
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleGenerateZKProof}
            disabled={isLoading || Number(formData.publicThresholdTons) * 1000 > rawEstimatedKg}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 via-green-500 to-teal-500 hover:opacity-95 text-black font-extrabold text-sm shadow-xl shadow-emerald-950 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span className="flex items-center space-x-2">
                <Sparkles className="w-5 h-5 animate-spin" />
                <span>ZK-SNARK Matematiksel Kanıtı Üretiliyor{proveStage ? ` · ${proveStage}` : ''}...</span>
              </span>
            ) : (
              <>
                <ShieldCheck className="w-5 h-5 text-black" />
                <span>Tarayıcıda ZK Proof Üret &amp; Devam Et</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Step 3: Campaign Setup & Soroban Submission */}
      {step === 3 && (
        <div className="glass-panel p-6 sm:p-8 rounded-3xl border border-emerald-500/30 space-y-6">
          <div className="flex items-center space-x-3 border-b border-emerald-900/40 pb-4">
            <FileText className="w-6 h-6 text-emerald-400" />
            <div>
              <h3 className="text-lg font-bold text-white font-['Outfit']">Hasat Avansı Kampanyasını Başlat</h3>
              <p className="text-xs text-gray-400">Yatırımcılardan toplanacak avans miktarı ve vade şartları.</p>
            </div>
          </div>

          {/* Proof Badge */}
          <div className="p-3 rounded-xl badge-zk flex items-center justify-between text-xs text-emerald-300">
            <div className="flex items-center space-x-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              <span>ZK Proof Hazır: <strong>≥ {formData.publicThresholdTons} Ton Doğrulandı</strong></span>
            </div>
            <span className="font-mono text-[10px] text-emerald-400/80">Groth16 · {zkProofResult?.provingMs} ms</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Hedef Avans Fonu (USDC)</label>
              <input
                type="number"
                value={formData.targetAmountUsdc}
                onChange={(e) => setFormData({ ...formData, targetAmountUsdc: e.target.value })}
                className="w-full px-4 py-3 rounded-xl glass-input text-sm font-bold text-white"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Yatırımcı Hasat Getiri Oranı (%)</label>
              <input
                type="number"
                step="0.5"
                value={formData.fixedReturnRate}
                onChange={(e) => setFormData({ ...formData, fixedReturnRate: e.target.value })}
                className="w-full px-4 py-3 rounded-xl glass-input text-sm font-bold text-amber-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Fonlama Süresi (gün)</label>
              <input
                type="number"
                value={formData.days}
                onChange={(e) => setFormData({ ...formData, days: e.target.value })}
                className="w-full px-4 py-3 rounded-xl glass-input text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1.5">Lokasyon</label>
              <input
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                className="w-full px-4 py-3 rounded-xl glass-input text-sm"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-300 mb-1.5">Ürün</label>
            <input
              type="text"
              value={formData.cropType}
              onChange={(e) => setFormData({ ...formData, cropType: e.target.value })}
              className="w-full px-4 py-3 rounded-xl glass-input text-sm"
            />
          </div>

          <button
            onClick={handleSubmitCampaign}
            disabled={isLoading}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-green-600 hover:from-emerald-400 hover:to-green-500 text-black font-extrabold text-sm shadow-xl shadow-emerald-950 transition-all flex items-center justify-center space-x-2 disabled:opacity-50"
          >
            {isLoading ? (
              <span>Soroban Kontratına Yazılıyor...</span>
            ) : (
              <>
                <Send className="w-5 h-5 text-black" />
                <span>Kampanyayı Stellar Testnet'te Yayınla</span>
              </>
            )}
          </button>
        </div>
      )}

      {/* Step 4: Success Screen */}
      {step === 4 && (
        <div className="glass-panel p-8 rounded-3xl border border-emerald-500/40 text-center space-y-6">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-emerald-400" />
          </div>

          <div>
            <h3 className="text-2xl font-bold text-white font-['Outfit']">Kampanyanız Başarıyla Yayınlandı!</h3>
            <p className="text-sm text-emerald-400/80 mt-1">
              Sıfır bilgi kanıtınız Soroban akıllı sözleşmesinde doğrulandı.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-[#09130e] border border-emerald-900/50 text-left space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-gray-400">ZK İspat Eşiği:</span>
              <span className="text-emerald-400 font-bold">≥ {formData.publicThresholdTons} Ton Doğrulandı</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Hedef Avans:</span>
              <span className="text-white font-bold">{Number(formData.targetAmountUsdc).toLocaleString('tr-TR')} USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-400">Kampanya No:</span>
              <span className="text-white font-bold">#{String(createdCampaign?.value ?? '')}</span>
            </div>
            <div className="flex justify-between items-start gap-3">
              <span className="text-gray-400 shrink-0">Stellar Testnet TX:</span>
              <a
                href={createdCampaign?.explorer}
                target="_blank"
                rel="noreferrer"
                className="text-emerald-300 truncate max-w-[220px] underline underline-offset-2"
              >
                İşlemi gör
              </a>
            </div>
          </div>

          <button
            onClick={() => {
              setStep(1);
              setZkProofResult(null);
              setAttested(null);
              setCreatedCampaign(null);
            }}
            className="px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs transition-all"
          >
            Yeni Kampanya Aç
          </button>
        </div>
      )}

    </div>
  );
}
