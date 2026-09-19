/**
 * Groth16 proving, in the tab.
 *
 * This file is the privacy claim. The witness is assembled from the farmer's
 * secret, the cooperative's signature and the attested yield, and the proving
 * key turns it into a proof -- all locally. Nothing in here makes a network
 * request with private data, and `assertNothingLeaked()` is a runtime check
 * that keeps it that way rather than a comment hoping it stays true.
 *
 * Copied from the earlier Vite app (removed; see git history); only the messages
 * are translated.
 *
 * The artefacts are ~8 MB and are fetched lazily on first proof so the app
 * still loads instantly for an investor who never proves anything.
 */

import "./polyfills";
import { tl } from "../../i18n/runtime";
import {
  addressBinding,
  buildCircuitInput,
  computeNullifier,
  farmerCommitment,
  randomFarmerSecret,
} from "@harvest/sdk/attestation";
import { encodeClaim, encodeProof } from "@harvest/sdk/encoding";

const WASM_URL = "/zk/harvest_capacity.wasm";
const ZKEY_URL = "/zk/harvest_capacity_final.zkey";
const VKEY_URL = "/zk/verification_key.json";
const SECRET_KEY = "harvest.farmerSecret.v1";

let snarkjsPromise = null;
const loadSnarkjs = () => (snarkjsPromise ??= import("snarkjs"));

/**
 * The farmer's long-lived secret.
 *
 * Kept per browser so the nullifier -- and therefore the anonymous repayment
 * history built on it -- survives a reload. Losing it does not lose funds; it
 * loses the reputation tier, which is exactly the trade a real wallet would
 * back up.
 */
export function farmerSecret() {
  let stored = null;
  try {
    stored = localStorage.getItem(SECRET_KEY);
  } catch {
    /* private mode */
  }
  if (stored) return BigInt(stored);
  const fresh = randomFarmerSecret();
  try {
    localStorage.setItem(SECRET_KEY, fresh.toString());
  } catch {
    /* ephemeral is fine */
  }
  return fresh;
}

/** The value sent to the cooperative. Poseidon of the secret, not the secret. */
export async function commitmentForIssuer() {
  return (await farmerCommitment(farmerSecret())).toString();
}

/**
 * Throw the farmer identity away and start a new one.
 *
 * The enrolment nullifier is Poseidon(farmerSecret, season, tag), so the chain
 * will not accept a second enrolment for the same secret in the same season --
 * and it has no way to forget one. If the cooperative's records are cleared
 * (which a demo reset does) while the chain keeps its side, a browser ends up
 * registered on chain and unknown to the cooperative, unable to go either way.
 * A fresh secret is the only exit, and it costs the anonymous reputation tier,
 * which in that state is empty anyway.
 */
export function resetFarmerSecret() {
  try {
    localStorage.removeItem(SECRET_KEY);
  } catch {
    /* private mode: the secret was never persisted to begin with */
  }
}

/**
 * Build a capacity proof.
 *
 * @param {object} args
 * @param {object} args.issuer         `{ ax, ay }` as decimal strings.
 * @param {object} args.attestation    `{ expectedYieldKg, parcelId, cropCode, season }`.
 * @param {object} args.signature      `{ sigR8x, sigR8y, sigS }`.
 * @param {bigint|number} args.thresholdKg  The only figure that becomes public.
 * @param {string} args.address        The Stellar address the proof binds to.
 * @param {(stage: string) => void} [args.onStage]
 */
export async function proveCapacity({
  issuer,
  attestation,
  signature,
  thresholdKg,
  address,
  onStage = () => {},
}) {
  const secret = farmerSecret();
  const season = BigInt(attestation.season);
  const yieldKg = BigInt(attestation.expectedYieldKg);
  const threshold = BigInt(thresholdKg);

  if (threshold > yieldKg) {
    // Worth catching here with a sentence a farmer can act on: the circuit's
    // own failure is an unsatisfied-constraint error deep in the witness
    // calculator, which tells the user nothing.
    throw new Error(
      tl(
        `Eşik (${threshold} kg) kooperatifin onayladığı rekoltenin (${yieldKg} kg) üstünde. ` +
          `Devre doğru olmayan bir iddia için kanıt üretmez.`,
        `The threshold (${threshold} kg) is above the yield the cooperative attested (${yieldKg} kg). ` +
          `The circuit does not produce proofs for false claims.`,
      ),
    );
  }

  onStage("witness");
  const input = await buildCircuitInput({
    issuerPub: { Ax: BigInt(issuer.ax), Ay: BigInt(issuer.ay) },
    threshold,
    seasonId: season,
    farmerSecret: secret,
    yieldKg,
    parcelId: BigInt(attestation.parcelId),
    cropCode: BigInt(attestation.cropCode),
    signature: {
      sigR8x: BigInt(signature.sigR8x),
      sigR8y: BigInt(signature.sigR8y),
      sigS: BigInt(signature.sigS),
    },
    binding: addressBinding(address),
  });

  onStage("loading");
  const snarkjs = await loadSnarkjs();

  onStage("proving");
  const started = performance.now();
  const { proof, publicSignals } = await snarkjs.groth16.fullProve(input, WASM_URL, ZKEY_URL);
  const provingMs = Math.round(performance.now() - started);

  onStage("checking");
  const vkey = await (await fetch(VKEY_URL)).json();
  if (!(await snarkjs.groth16.verify(vkey, publicSignals, proof))) {
    throw new Error(tl("kanıt yerel doğrulamadan geçemedi, zincire gönderilmiyor", "the proof failed local verification and will not be sent on chain"));
  }

  const claim = encodeClaim(publicSignals);
  const encoded = encodeProof(proof);
  assertNothingLeaked({ claim, proof: encoded, publicSignals }, [
    yieldKg,
    BigInt(attestation.parcelId),
    secret,
  ]);

  onStage("done");
  return {
    claim,
    proof: encoded,
    publicSignals,
    provingMs,
    nullifier: (await computeNullifier(secret, season)).toString(),
    private: { yieldKg, parcelId: BigInt(attestation.parcelId) },
  };
}

/**
 * Refuse to hand back a payload containing anything that was supposed to stay
 * private. A belt-and-braces check on the circuit's own guarantee -- cheap, and
 * it turns a catastrophic silent regression into a loud failure.
 */
function assertNothingLeaked(payload, secrets) {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) {
    if (serialized.includes(secret.toString())) {
      throw new Error(tl("zincire gidecek veride gizli bir değer bulundu, işlem durduruldu", "a private value was found in the on-chain payload; stopped"));
    }
  }
}

/** Warm the 8 MB of artefacts before the user presses the button. */
export function prefetchProvingArtifacts() {
  loadSnarkjs();
  fetch(ZKEY_URL).catch(() => {});
  fetch(WASM_URL).catch(() => {});
}
