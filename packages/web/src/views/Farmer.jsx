import { useEffect, useState } from "react";

import { ErrorNote, Kv, Step, fmt } from "../App.jsx";
import { commitmentForIssuer, proveCapacity } from "../lib/prover.js";
import {
  createCampaign,
  fetchMembers,
  requestAttestation,
} from "../lib/harvest.js";
import { signerFor } from "../lib/wallet.js";

/**
 * The farmer's path: attestation -> threshold -> proof -> campaign.
 *
 * The screen is built around one idea, so the layout keeps returning to it: at
 * every step the real yield is shown on a dashed panel marked "stays on this
 * device", and the threshold on a solid one marked "goes on chain". A judge
 * should be able to see what is being protected without reading a word of the
 * copy.
 */
export default function Farmer({ t, lang, wallet, onProof }) {
  const [members, setMembers] = useState([]);
  const [membershipId, setMembershipId] = useState("");
  const [attested, setAttested] = useState(null);
  const [threshold, setThreshold] = useState(0);
  const [proof, setProof] = useState(null);
  const [stage, setStage] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);
  const [created, setCreated] = useState(null);

  const [form, setForm] = useState({ target: 120, days: 30, returnPercent: 15 });

  useEffect(() => {
    fetchMembers()
      .then((list) => {
        setMembers(list);
        setMembershipId(list[0]?.membershipId ?? "");
      })
      .catch((err) => setError(err.message));
  }, []);

  const member = members.find((m) => m.membershipId === membershipId);

  async function onAttest() {
    setError(null);
    setBusy("attest");
    try {
      const commitment = await commitmentForIssuer();
      const result = await requestAttestation(membershipId, commitment);
      setAttested(result);
      // Default to a threshold well under the real figure: the whole point is
      // that the farmer discloses less than they have.
      const real = Number(result.attestation.expectedYieldKg);
      setThreshold(Math.floor((real * 0.8) / 1000) * 1000);
      setProof(null);
      setCreated(null);
      setForm((f) => ({
        ...f,
        crop: result.display.cropLabel[lang],
        region: result.display.region[lang],
      }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  async function onProve() {
    setError(null);
    setBusy("prove");
    setStage("witness");
    try {
      const result = await proveCapacity({
        issuer: attested.issuer,
        attestation: attested.attestation,
        signature: attested.signature,
        thresholdKg: threshold,
        address: wallet.address,
        onStage: setStage,
      });
      setProof(result);
      onProof({ ...result, address: wallet.address });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
      setStage(null);
    }
  }

  async function onCreate() {
    setError(null);
    setBusy("create");
    try {
      const res = await createCampaign({
        address: wallet.address,
        sign: signerFor(wallet.keypair),
        claim: proof.claim,
        proof: proof.proof,
        crop: form.crop ?? attested.display.cropLabel[lang],
        region: form.region ?? attested.display.region[lang],
        targetUsdc: form.target,
        days: form.days,
        returnPercent: form.returnPercent,
      });
      setCreated(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(null);
    }
  }

  const realYield = attested ? Number(attested.attestation.expectedYieldKg) : 0;
  const tonnes = (kg) => `${fmt(lang, kg / 1000, { maximumFractionDigits: 1 })} ${t("common.tonnes")}`;

  return (
    <>
      <div className="intro">
        <h2>{t("farmer.title")}</h2>
        <p>{t("farmer.subtitle")}</p>
      </div>

      <ErrorNote error={error} />

      {/* ---------------------------------------------------- attestation -- */}
      <Step
        n={1}
        title={t("farmer.step1")}
        desc={t("farmer.step1.desc")}
        done={Boolean(attested)}
        locked={!wallet}
      >
        <div className="row">
          <div>
            <label>{t("farmer.member")}</label>
            <select value={membershipId} onChange={(e) => setMembershipId(e.target.value)}>
              {members.map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.membershipId} — {m.farmer} ({m.cropLabel[lang]})
                </option>
              ))}
            </select>
          </div>
          <div className="narrow">
            <button className="btn" onClick={onAttest} disabled={busy === "attest" || !membershipId}>
              {busy === "attest" ? <span className="spinner" /> : t("farmer.request")}
            </button>
          </div>
        </div>

        {attested && (
          <>
            <div className="split">
              <div className="pane private">
                <div className="pane-label">🔒 {t("farmer.private")}</div>
                <div className="big">{tonnes(realYield)}</div>
                <div className="sub">{t("farmer.attested")}</div>
              </div>
              <div className="pane">
                <div className="pane-label">{t("farmer.issuer")}</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>{attested.issuer.label}</div>
                <div className="sub">{attested.display.parcel}</div>
              </div>
            </div>
            <p className="note">
              {member?.farmer} · {attested.display.region[lang]} · {attested.attestation.season}
            </p>
          </>
        )}
      </Step>

      {/* ------------------------------------------------------ threshold -- */}
      <Step
        n={2}
        title={t("farmer.step2")}
        desc={t("farmer.step2.desc")}
        done={Boolean(proof)}
        locked={!attested}
      >
        {attested && (
          <>
            <label>
              {t("farmer.threshold")}: <strong>{tonnes(threshold)}</strong>
            </label>
            <input
              type="range"
              min={1000}
              max={realYield}
              step={500}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
            />
            <div className="split">
              <div className="pane public">
                <div className="pane-label">👁 {t("farmer.onchain")}</div>
                <div className="big">≥ {tonnes(threshold)}</div>
                <div className="sub">{t("investor.verified")}</div>
              </div>
              <div className="pane private">
                <div className="pane-label">🔒 {t("farmer.headroom")}</div>
                <div className="big">{tonnes(realYield - threshold)}</div>
                <div className="sub">{t("farmer.private")}</div>
              </div>
            </div>
            {threshold > realYield && <div className="alert">{t("farmer.tooHigh")}</div>}
          </>
        )}
      </Step>

      {/* ---------------------------------------------------------- proof -- */}
      <Step
        n={3}
        title={t("farmer.step3")}
        desc={t("farmer.step3.desc")}
        done={Boolean(proof)}
        locked={!attested}
      >
        <button className="btn" onClick={onProve} disabled={busy === "prove" || threshold > realYield}>
          {busy === "prove" ? (
            <>
              <span className="spinner" /> {t("farmer.generating")}
              {stage ? ` · ${stage}` : ""}
            </>
          ) : (
            t("farmer.generate")
          )}
        </button>

        {proof && (
          <>
            <div style={{ marginTop: 16 }}>
              <span className="badge">✓ {t("farmer.proofReady")}</span>{" "}
              <span className="chip">
                {t("farmer.provingTime")}: {proof.provingMs} ms
              </span>
            </div>

            <div style={{ marginTop: 14 }}>
              <Kv k={t("farmer.threshold")} v={`≥ ${tonnes(proof.claim.threshold_kg)}`} />
              <Kv k="nullifier" v={`${proof.claim.nullifier.slice(0, 20)}…`} mono />
              <Kv k="season" v={proof.claim.season} />
            </div>

            <details>
              <summary>{t("farmer.inspect")}</summary>
              <pre className="payload">
{JSON.stringify({ claim: proof.claim, proof: proof.proof }, null, 2)}
              </pre>
              <p className="note">
                {t("farmer.staysHere")}: {fmt(lang, Number(proof.private.yieldKg))} {t("common.kg")}
                {" · "}parcel {String(proof.private.parcelId).slice(0, 12)}…
              </p>
            </details>
          </>
        )}
      </Step>

      {/* ------------------------------------------------------- campaign -- */}
      <Step
        n={4}
        title={t("farmer.step4")}
        desc={t("farmer.step4.desc")}
        done={Boolean(created)}
        locked={!proof}
      >
        <div className="row">
          <div>
            <label>{t("farmer.crop")}</label>
            <input
              type="text"
              value={form.crop ?? ""}
              onChange={(e) => setForm({ ...form, crop: e.target.value })}
            />
          </div>
          <div>
            <label>{t("farmer.region")}</label>
            <input
              type="text"
              value={form.region ?? ""}
              onChange={(e) => setForm({ ...form, region: e.target.value })}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <div>
            <label>{t("farmer.target")}</label>
            <input
              type="number"
              value={form.target}
              min={1}
              onChange={(e) => setForm({ ...form, target: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>{t("farmer.days")}</label>
            <input
              type="number"
              value={form.days}
              min={1}
              onChange={(e) => setForm({ ...form, days: Number(e.target.value) })}
            />
          </div>
          <div>
            <label>{t("farmer.returnBps")}</label>
            <input
              type="number"
              value={form.returnPercent}
              min={0}
              max={100}
              onChange={(e) => setForm({ ...form, returnPercent: Number(e.target.value) })}
            />
          </div>
        </div>

        <div className="btn-row">
          <button className="btn" onClick={onCreate} disabled={busy === "create"}>
            {busy === "create" ? (
              <>
                <span className="spinner" /> {t("farmer.creating")}
              </>
            ) : (
              t("farmer.create")
            )}
          </button>
        </div>

        {created && (
          <div className="verdict ok">
            <span className="mark">✓</span>
            <div>
              <div className="label">
                {t("farmer.created")} #{String(created.value ?? "")}
              </div>
              <div className="why">
                <a href={created.explorer} target="_blank" rel="noreferrer">
                  {t("common.viewTx")}
                </a>
              </div>
            </div>
          </div>
        )}
      </Step>
    </>
  );
}
