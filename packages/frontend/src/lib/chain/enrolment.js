/**
 * Membership enrolment, in the tab.
 *
 * A farmer applies to the cooperative once: the cooperative checks their
 * documents against its own file and signs a membership credential over
 * `Poseidon(farmerSecret)`. The browser turns that credential into a Groth16
 * proof and registers it on chain.
 *
 * What the chain learns is the document mask -- which checks passed. The
 * identity document, the parcel and the land area are private circuit inputs
 * and never leave this file, which `assertNothingLeaked` enforces at runtime
 * rather than trusting a comment.
 *
 * The enrolment artefacts are another ~9 MB, so unlike the capacity ones they
 * are not prefetched: an investor who never registers never downloads them.
 */

import "./polyfills";
import { tl } from "../../i18n/runtime";
import { addressBinding } from "@harvest/sdk/attestation";
import {
  DOC,
  REQUIRED_MASK,
  buildEnrolmentInput,
  computeEnrolmentNullifier,
  docsInMask,
  maskIsSufficient,
} from "@harvest/sdk/enrolment";
import { encodeClaim, encodeProof } from "@harvest/sdk/encoding";
import { SorobanClient, addressToScVal, bytesN, claimToScVal, proofToScVal } from "@harvest/sdk/soroban";

import { ISSUER_URL, deployments } from "./deployments";
import { commitmentForIssuer, farmerSecret } from "./prover";

export { DOC, REQUIRED_MASK, docsInMask, maskIsSufficient };

const WASM_URL = "/zk/harvest_enrolment.wasm";
const ZKEY_URL = "/zk/harvest_enrolment_final.zkey";
const VKEY_URL = "/zk/harvest_enrolment_verification_key.json";

const soroban = new SorobanClient();
const read = (contractId, method, args = []) =>
  soroban.read({ contractId, method, args, source: deployments.deployer });

let snarkjsPromise = null;
const loadSnarkjs = () => (snarkjsPromise ??= import("snarkjs"));

// ------------------------------------------------------------- cooperative --

async function issuerJson(path, init) {
  let res;
  try {
    res = await fetch(`${ISSUER_URL}${path}`, init);
  } catch {
    throw new Error(
      tl(
        `Kooperatif servisine ulaşılamadı (${ISSUER_URL}). Depo kökünde "npm run issuer" çalışıyor mu?`,
        `Could not reach the cooperative service (${ISSUER_URL}). Is "npm run issuer" running at the repo root?`,
      ),
    );
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error ?? tl(`kooperatif servisi ${res.status} döndü`, `cooperative service returned ${res.status}`));
    err.code = body.code;
    err.status = res.status;
    err.checks = body.checks;
    throw err;
  }
  return body;
}

/** The documents the cooperative wants to see, and which are mandatory. */
export const fetchRequirements = () => issuerJson("/enrolment");

/**
 * Submit an application.
 *
 * There is no membership to pick. `documents.cks` is the key: the ÇKS number is
 * the state's own farmer registry, it exists before any cooperative
 * relationship does, and it is where the parcel and the registered area come
 * from. The membership number comes back in the response -- it is what the
 * applicant earns, not something they have to know first.
 *
 * The land area is read from the cooperative's record rather than this form, so
 * an applicant cannot inflate the figure the circuit tests against the floor.
 */
export const applyForMembership = async ({ applicant, documents, crop }) =>
  issuerJson("/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      // Poseidon of the farmer's secret. The cooperative binds the membership
      // to this and never sees the secret behind it.
      farmerCommitment: await commitmentForIssuer(),
      applicant,
      documents,
      // Only consulted when the cooperative has no record under this ÇKS
      // number and has to open one. For an existing member its own file
      // decides what is growing there.
      crop,
    }),
  });

// --------------------------------------------------------------- the proof --

/**
 * Build the enrolment proof from a credential the cooperative just signed.
 *
 * @param {object} args
 * @param {object} args.issuer      `{ ax, ay }` as decimal strings.
 * @param {object} args.credential  `{ applicantRef, parcelId, landDecares, attrMask, season }`.
 * @param {object} args.signature   `{ sigR8x, sigR8y, sigS }`.
 * @param {string} args.address     The Stellar address the enrolment binds to.
 * @param {(stage: string) => void} [args.onStage]
 */
export async function proveEnrolment({ issuer, credential, signature, address, onStage = () => {} }) {
  const secret = farmerSecret();
  const season = BigInt(credential.season);

  onStage("witness");
  const input = await buildEnrolmentInput({
    issuerPub: { Ax: BigInt(issuer.ax), Ay: BigInt(issuer.ay) },
    seasonId: season,
    farmerSecret: secret,
    applicantRef: BigInt(credential.applicantRef),
    parcelId: BigInt(credential.parcelId),
    landDecares: BigInt(credential.landDecares),
    attrMask: BigInt(credential.attrMask),
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
    throw new Error(
      tl(
        "kanıt yerel doğrulamadan geçemedi, zincire gönderilmiyor",
        "the proof failed local verification and will not be sent on chain",
      ),
    );
  }

  const claim = encodeClaim(publicSignals);
  const encoded = encodeProof(proof);
  assertNothingLeaked({ claim, proof: encoded, publicSignals }, [
    BigInt(credential.applicantRef),
    BigInt(credential.parcelId),
    secret,
  ]);

  onStage("done");
  return {
    claim,
    proof: encoded,
    publicSignals,
    provingMs,
    docMask: claim.threshold_kg,
    nullifier: (await computeEnrolmentNullifier(secret, season)).toString(),
  };
}

/**
 * Refuse to hand back a payload containing anything meant to stay private.
 *
 * The land area is deliberately not in the list the caller passes: it is a
 * small integer, so a substring search over 77-digit group elements would fire
 * on coincidence. It is covered by the exact public-signal check below instead.
 */
function assertNothingLeaked(payload, secrets) {
  const serialized = JSON.stringify(payload);
  for (const secret of secrets) {
    if (serialized.includes(secret.toString())) {
      throw new Error(
        tl("zincire gidecek veride gizli bir değer bulundu, işlem durduruldu", "a private value was found in the on-chain payload; stopped"),
      );
    }
  }
}

/** The land area must not be one of the six values the contract reads. */
export const landStaysPrivate = (publicSignals, landDecares) =>
  !publicSignals.some((s) => BigInt(s) === BigInt(landDecares));

// ------------------------------------------------------------- the registry --

/** Ask the enrolment verifier, in simulation, before spending a transaction. */
export async function checkEnrolmentOnChain({ address, claim, proof }) {
  return (
    (await read(deployments.enrolmentVerifier, "check_capacity", [
      addressToScVal(address),
      claimToScVal(claim),
      proofToScVal(proof),
    ])) === true
  );
}

/** Record the enrolment on chain. Spends the nullifier; a second call reverts. */
export async function registerOnChain({ address, sign, invoke, claim, proof }) {
  const args = [addressToScVal(address), claimToScVal(claim), proofToScVal(proof)];
  const call = invoke
    ? invoke({ contractId: deployments.registry, method: "register", args })
    : soroban.invoke({ contractId: deployments.registry, method: "register", args, source: address, sign });
  try {
    return await call;
  } catch (err) {
    throw new Error(explainRegistryError(err));
  }
}

/** Contract error codes, as sentences a farmer can act on. */
const REGISTRY_ERRORS = {
  3: () => tl("Bu kayıt zaten kullanılmış.", "This enrolment has already been used."),
  4: () =>
    tl(
      "Kooperatifin doğruladığı belgeler kayıt için yeterli değil.",
      "The documents the cooperative verified do not meet the registry's requirements.",
    ),
};

function explainRegistryError(err) {
  const text = String(err?.message ?? err);
  const code = Number(/Error\(Contract, #(\d+)\)/.exec(text)?.[1] ?? NaN);
  return REGISTRY_ERRORS[code]?.() ?? text;
}

/** Is this account enrolled? Cheap enough for the app to ask on every load. */
export async function isRegistered(address) {
  if (!deployments.registry) return false;
  return (await read(deployments.registry, "is_address_registered", [addressToScVal(address)])) === true;
}

/**
 * Has *this browser's identity* already enrolled for the season?
 *
 * The one that matters, and not the same question as `isRegistered`. The
 * nullifier is Poseidon(farmerSecret, season, tag) -- it follows the secret in
 * localStorage, not the wallet. Creating a fresh demo wallet gives a new
 * address while the secret stays put, so an address-keyed check reports "free"
 * right up until `register` reverts with AlreadyRegistered, after the farmer
 * has waited out a 9 MB download and a proof.
 */
export async function isIdentityEnrolled(season) {
  if (!deployments.registry || !season) return false;
  const nullifier = await computeEnrolmentNullifier(farmerSecret(), BigInt(season));
  const hex = nullifier.toString(16).padStart(64, "0");
  return (await read(deployments.registry, "is_registered", [bytesN(hex)])) === true;
}

/** The enrolment behind an account, or `null`. */
export async function registrationOf(address) {
  if (!deployments.registry) return null;
  try {
    const r = await read(deployments.registry, "registration_of_address", [addressToScVal(address)]);
    if (!r) return null;
    return {
      docMask: Number(r.doc_mask),
      season: Number(r.season),
      registeredAt: Number(r.registered_at),
      nullifier: r.nullifier,
    };
  } catch {
    return null;
  }
}

export async function registeredCount() {
  if (!deployments.registry) return 0;
  return Number((await read(deployments.registry, "registered_count")) ?? 0);
}

/** Warm the ~9 MB of enrolment artefacts once the farmer is on the form. */
export function prefetchEnrolmentArtifacts() {
  loadSnarkjs();
  fetch(ZKEY_URL).catch(() => {});
  fetch(WASM_URL).catch(() => {});
}

