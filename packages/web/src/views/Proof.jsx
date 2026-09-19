import { useState } from "react";

import { ErrorNote, Kv, Step } from "../App.jsx";
import { checkProofOnChain, deployments, explorerContract } from "../lib/harvest.js";

/**
 * The demonstration that decides whether anyone believes the rest.
 *
 * Every step of the farmer flow *claims* the chain is verifying a real proof.
 * This screen makes the chain say so out loud -- and, more usefully, makes it
 * say no. Three checks run against the deployed verifier through simulation,
 * so each verdict is the contract's own, returned in about a second and costing
 * nothing.
 *
 * The rejections are the point. A demo that only ever shows green is
 * indistinguishable from a progress bar.
 */
export default function Proof({ t, wallet, lastProof }) {
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  async function run(key, { claim, address }) {
    setError(null);
    setBusy(key);
    try {
      const verdict = await checkProofOnChain({
        address,
        claim,
        proof: lastProof.proof,
        source: wallet.address,
      });
      setResults((r) => ({ ...r, [key]: Boolean(verdict) }));
    } catch (err) {
      setError(err.message);
      setResults((r) => ({ ...r, [key]: false }));
    } finally {
      setBusy(null);
    }
  }

  const checks = lastProof
    ? [
        {
          key: "honest",
          label: t("proof.verify"),
          expect: true,
          why: t("proof.acceptedWhy"),
          payload: { claim: lastProof.claim, address: lastProof.address },
        },
        {
          key: "tampered",
          label: t("proof.tamper"),
          expect: false,
          why: t("proof.rejectedWhy"),
          payload: {
            claim: { ...lastProof.claim, threshold_kg: 90_000 },
            address: lastProof.address,
          },
        },
        {
          key: "replay",
          label: t("proof.replay"),
          expect: false,
          why: t("proof.replayWhy"),
          // A different, unrelated account: the binding in the proof no longer
          // matches what the contract derives from the caller.
          payload: {
            claim: lastProof.claim,
            address: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
          },
        },
      ]
    : [];

  return (
    <>
      <div className="intro">
        <h2>{t("proof.title")}</h2>
        <p>{t("proof.subtitle")}</p>
      </div>

      <ErrorNote error={error} />

      <Step n={1} title={t("proof.title")} locked={!wallet}>
        {!lastProof && <p className="desc">{t("proof.none")}</p>}

        {lastProof && (
          <>
            <Kv k={t("farmer.threshold")} v={`≥ ${lastProof.claim.threshold_kg} kg`} />
            <Kv k="season" v={lastProof.claim.season} />
            <Kv k="nullifier" v={`${lastProof.claim.nullifier.slice(0, 24)}…`} mono />
            <Kv k={t("farmer.provingTime")} v={`${lastProof.provingMs} ms`} />

            <div className="btn-row">
              {checks.map((c) => (
                <button
                  key={c.key}
                  className={`btn${c.expect ? "" : " danger"}`}
                  onClick={() => run(c.key, c.payload)}
                  disabled={busy === c.key}
                >
                  {busy === c.key ? (
                    <>
                      <span className="spinner" /> {t("proof.checking")}
                    </>
                  ) : (
                    c.label
                  )}
                </button>
              ))}
            </div>

            {checks.map((c) =>
              results[c.key] === undefined ? null : (
                <div key={c.key} className={`verdict ${results[c.key] ? "ok" : "no"}`}>
                  <span className="mark">{results[c.key] ? "✓" : "✕"}</span>
                  <div>
                    <div className="label">
                      {results[c.key] ? t("proof.accepted") : t("proof.rejected")}
                      {results[c.key] === c.expect ? "" : "  ⚠ unexpected"}
                    </div>
                    <div className="why">
                      {c.label} — {c.why}
                    </div>
                  </div>
                </div>
              ),
            )}

            <details>
              <summary>{t("farmer.inspect")}</summary>
              <pre className="payload">
{JSON.stringify({ claim: lastProof.claim, proof: lastProof.proof }, null, 2)}
              </pre>
            </details>

            <p className="note">
              {t("proof.contract")}:{" "}
              <a href={explorerContract(deployments.verifier)} target="_blank" rel="noreferrer">
                {deployments.verifier}
              </a>
            </p>
          </>
        )}
      </Step>
    </>
  );
}
