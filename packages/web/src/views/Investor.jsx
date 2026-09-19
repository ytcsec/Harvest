import { useCallback, useEffect, useState } from "react";

import { ErrorNote, Kv, Step, fmt } from "../App.jsx";
import { anchorDeposit, anchorQuote, fundCampaign, listCampaigns } from "../lib/harvest.js";
import { challengeSignerFor, signerFor } from "../lib/wallet.js";

/**
 * The investor's path: lira in, then back a campaign.
 *
 * The deposit step is the hackathon's fiat-rail requirement made visible --
 * a real SEP-10 handshake, a real SEP-38 quote, and real testnet USDC landing
 * in the wallet. The funding step then shows where that USDC goes: not into
 * this contract's balance, but straight into the vault.
 */
export default function Investor({ t, lang, wallet, funds, refresh }) {
  const [amountTry, setAmountTry] = useState(500);
  const [quote, setQuote] = useState(null);
  const [depositStatus, setDepositStatus] = useState(null);
  const [instructions, setInstructions] = useState(null);
  const [campaigns, setCampaigns] = useState([]);
  const [amounts, setAmounts] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [settled, setSettled] = useState(null);

  const reload = useCallback(async () => {
    if (!wallet) return;
    try {
      setCampaigns(await listCampaigns(wallet.address));
    } catch (err) {
      setError(err.message);
    }
  }, [wallet]);

  useEffect(() => {
    reload();
  }, [reload]);

  // A quote needs an authenticated session, so it only appears once the user
  // has been through the anchor at least once. Failing quietly here is right:
  // the rate is a nicety, the deposit is the function.
  useEffect(() => {
    let cancelled = false;
    anchorQuote(amountTry)
      .then((q) => !cancelled && setQuote(q))
      .catch(() => !cancelled && setQuote(null));
    return () => {
      cancelled = true;
    };
  }, [amountTry, settled]);

  async function onDeposit() {
    setError(null);
    setBusy("deposit");
    setSettled(null);
    try {
      const { deposit, settled: done } = await anchorDeposit({
        address: wallet.address,
        challengeSigner: challengeSignerFor(wallet.keypair),
        amountTry,
        onStatus: (s) => {
          setDepositStatus(s);
          if (deposit?.instructions) setInstructions(deposit.instructions);
        },
      });
      setInstructions(deposit.instructions ?? null);
      setSettled(done);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
      setDepositStatus(null);
    }
  }

  async function onFund(id) {
    setError(null);
    setBusy(`fund-${id}`);
    try {
      await fundCampaign({
        address: wallet.address,
        sign: signerFor(wallet.keypair),
        id,
        amountUsdc: Number(amounts[id] ?? 0),
      });
      await Promise.all([reload(), refresh()]);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="intro">
        <h2>{t("investor.title")}</h2>
        <p>{t("investor.subtitle")}</p>
      </div>

      <ErrorNote error={error} />

      {/* -------------------------------------------------------- deposit -- */}
      <Step
        n={1}
        title={t("investor.step1")}
        desc={t("investor.step1.desc")}
        done={Boolean(settled)}
        locked={!wallet}
      >
        <div className="row">
          <div>
            <label>{t("investor.amountTry")}</label>
            <input
              type="number"
              min={50}
              max={3000}
              step={50}
              value={amountTry}
              onChange={(e) => setAmountTry(Number(e.target.value))}
            />
          </div>
          <div className="narrow">
            <button
              className="btn"
              onClick={onDeposit}
              disabled={busy === "deposit" || amountTry < 50 || amountTry > 3000}
            >
              {busy === "deposit" ? <span className="spinner" /> : t("investor.deposit")}
            </button>
          </div>
        </div>

        {quote && (
          <div style={{ marginTop: 14 }}>
            <Kv k={t("investor.rate")} v={`1 USDC = ${Number(quote.price).toFixed(2)} TRY`} />
            <Kv
              k={t("investor.willReceive")}
              v={`${Number(quote.buy_amount).toFixed(4)} USDC`}
            />
          </div>
        )}

        {depositStatus && (
          <p className="note">
            <span className="spinner" /> {t("investor.simulating")} — {depositStatus}
          </p>
        )}

        {instructions && (
          <details open={!settled}>
            <summary>{t("investor.instructions")}</summary>
            <div style={{ marginTop: 10 }}>
              {Object.entries(instructions).map(([k, v]) => (
                <Kv key={k} k={k} v={String(v.value ?? v)} mono />
              ))}
            </div>
          </details>
        )}

        {settled && (
          <div className="verdict ok">
            <span className="mark">✓</span>
            <div>
              <div className="label">{t("investor.settled")}</div>
              <div className="why">
                {settled.amount_out} USDC
                {settled.stellar_transaction_id && (
                  <>
                    {" · "}
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${settled.stellar_transaction_id}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {t("common.viewTx")}
                    </a>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </Step>

      {/* ------------------------------------------------------ campaigns -- */}
      <Step n={2} title={t("investor.step2")} desc={t("investor.step2.desc")} locked={!wallet}>
        {campaigns.length === 0 && <p className="desc">{t("investor.noCampaigns")}</p>}

        {campaigns.map((c) => {
          const pct = c.target > 0 ? Math.min(100, (c.raised / c.target) * 100) : 0;
          return (
            <div className="campaign" key={c.id}>
              <div className="top">
                <div>
                  <div className="crop">{c.crop}</div>
                  <div className="region">
                    {c.region} · {c.season}
                  </div>
                </div>
                <span className="badge">
                  🔒 {t("investor.verified")} · {t("investor.atLeast")}{" "}
                  {fmt(lang, c.thresholdKg / 1000, { maximumFractionDigits: 1 })}{" "}
                  {t("common.tonnes")}
                </span>
              </div>

              <div className="bar">
                <span style={{ width: `${pct}%` }} />
              </div>
              <div className="kv" style={{ borderTop: 0, paddingTop: 0 }}>
                <span className="k">
                  {t("investor.raised")} {fmt(lang, c.raised, { maximumFractionDigits: 2 })}{" "}
                  {t("investor.of")} {fmt(lang, c.target, { maximumFractionDigits: 2 })} USDC
                </span>
                <span className="v">
                  {c.status} · +{c.returnPercent}%
                </span>
              </div>

              {c.shares > 0 && (
                <p className="note">
                  {t("investor.inVault")}: {fmt(lang, c.shares, { maximumFractionDigits: 4 })}{" "}
                  shares
                </p>
              )}

              {c.status === "Funding" && (
                <div className="row" style={{ marginTop: 12 }}>
                  <div>
                    <label>{t("investor.amountUsdc")}</label>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={amounts[c.id] ?? ""}
                      placeholder={String(Math.min(10, Math.max(1, c.target - c.raised)))}
                      onChange={(e) => setAmounts({ ...amounts, [c.id]: e.target.value })}
                    />
                  </div>
                  <div className="narrow">
                    <button
                      className="btn"
                      onClick={() => onFund(c.id)}
                      disabled={busy === `fund-${c.id}` || !Number(amounts[c.id])}
                    >
                      {busy === `fund-${c.id}` ? (
                        <span className="spinner" />
                      ) : (
                        t("investor.fund")
                      )}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        <p className="note">
          {t("wallet.balance")}: {funds.usdc === null ? "—" : funds.usdc.toFixed(4)} USDC
        </p>
      </Step>
    </>
  );
}
