import { useCallback, useEffect, useState } from "react";

import { fmt, LANGS, useI18n } from "./i18n.js";
import { balances, createWallet, loadWallet, shorten } from "./lib/wallet.js";
import { deployments, explorerContract } from "./lib/harvest.js";
import { prefetchProvingArtifacts } from "./lib/prover.js";
import Farmer from "./views/Farmer.jsx";
import Investor from "./views/Investor.jsx";
import Proof from "./views/Proof.jsx";

export default function App() {
  const { lang, setLang, t } = useI18n();
  const [tab, setTab] = useState("farmer");
  const [wallet, setWallet] = useState(() => loadWallet());
  const [funds, setFunds] = useState({ xlm: 0, usdc: null });
  const [creating, setCreating] = useState(null);

  // The last proof produced on the Farmer tab. Lifted to the app so the Proof
  // tab can run the accept/reject demonstration against the very proof the
  // judge just watched being generated, rather than a canned one.
  const [lastProof, setLastProof] = useState(null);

  const refresh = useCallback(async () => {
    if (!wallet) return;
    setFunds(await balances(wallet.address));
  }, [wallet]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 12_000);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    // 8 MB of proving artefacts; start them early so the farmer flow feels
    // instant when it gets there.
    prefetchProvingArtifacts();
  }, []);

  async function onCreateWallet() {
    try {
      setCreating("funding");
      const created = await createWallet(setCreating);
      setWallet(created);
      setCreating(null);
    } catch (err) {
      setCreating(null);
      alert(`${t("common.error")}: ${err.message}`);
    }
  }

  const shared = { t, lang, wallet, funds, refresh };

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <h1>🌾 {t("app.name")}</h1>
          <span className="tag">{t("app.tagline")}</span>
        </div>

        <span className="chip">
          <span className="dot" />
          {t("app.network")}
        </span>

        <WalletChip
          t={t}
          wallet={wallet}
          funds={funds}
          creating={creating}
          onCreate={onCreateWallet}
        />

        <div className="langs" role="group" aria-label="language">
          {Object.entries(LANGS).map(([code, label]) => (
            <button
              key={code}
              aria-pressed={lang === code}
              onClick={() => setLang(code)}
              title={label}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {[
          ["farmer", t("nav.farmer")],
          ["investor", t("nav.investor")],
          ["proof", t("nav.proof")],
        ].map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {tab === "farmer" && <Farmer {...shared} onProof={setLastProof} />}
      {tab === "investor" && <Investor {...shared} />}
      {tab === "proof" && <Proof {...shared} lastProof={lastProof} />}

      <footer>
        <div>
          {t("proof.contract")}:{" "}
          <a href={explorerContract(deployments.verifier)} target="_blank" rel="noreferrer">
            {shorten(deployments.verifier)}
          </a>
          {" · "}
          <a href={explorerContract(deployments.campaign)} target="_blank" rel="noreferrer">
            {shorten(deployments.campaign)}
          </a>
          {" · "}
          <a href="https://tr-mock-anchor.fly.dev" target="_blank" rel="noreferrer">
            tr-mock-anchor
          </a>
        </div>
      </footer>
    </div>
  );
}

function WalletChip({ t, wallet, funds, creating, onCreate }) {
  const [copied, setCopied] = useState(false);

  if (!wallet) {
    return (
      <button className="btn" onClick={onCreate} disabled={Boolean(creating)}>
        {creating ? (
          <>
            <span className="spinner" /> {t("wallet.creating")}
          </>
        ) : (
          t("wallet.create")
        )}
      </button>
    );
  }

  return (
    <button
      className="chip mono"
      title={wallet.address}
      onClick={() => {
        navigator.clipboard?.writeText(wallet.address);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? t("wallet.copied") : shorten(wallet.address)}
      {" · "}
      {funds.usdc === null ? "— USDC" : `${funds.usdc.toFixed(2)} USDC`}
    </button>
  );
}

/** Shared bits the views reuse. */
export function Step({ n, title, desc, done, locked, children }) {
  return (
    <section className={`card${done ? " done" : ""}${locked ? " locked" : ""}`}>
      <div className="card-head">
        <span className="stepno">{done ? "✓" : n}</span>
        <h3>{title}</h3>
      </div>
      {desc && <p className="desc">{desc}</p>}
      {children}
    </section>
  );
}

export function Kv({ k, v, mono }) {
  return (
    <div className="kv">
      <span className="k">{k}</span>
      <span className={`v${mono ? " mono" : ""}`}>{v}</span>
    </div>
  );
}

export function ErrorNote({ error }) {
  if (!error) return null;
  return <div className="alert">{error}</div>;
}

export { fmt };
