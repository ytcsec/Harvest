/**
 * The cooperative's attestation service.
 *
 * Stands in for a Giresun hazelnut cooperative (or TARSIM) issuing signed
 * statements of expected harvest. In production this runs inside the
 * cooperative with its signing key in an HSM; here the key is generated once by
 * `scripts/deploy.mjs` and cached in `.harvest/issuer-key.json`.
 *
 * ## The privacy property this service is responsible for
 *
 * It signs over `Poseidon(farmerSecret)`, never the secret. So the cooperative
 * -- which is also frequently the buyer -- learns nothing that lets it link a
 * campaign back to a member, and cannot reconstruct the nullifier that anchors
 * the farmer's anonymous credit history.
 *
 * What it *does* know is the yield, because it measured it. That is the point:
 * the cooperative is the accredited source of the figure. The chain still never
 * sees it.
 *
 * ## Why the registry exists
 *
 * A cooperative only attests to what its own records say. `REGISTRY` stands in
 * for those records, so the service cannot be talked into signing an arbitrary
 * number -- which would make the whole accreditation chain meaningless.
 */

import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cropCodeOf,
  issuerPublicKey,
  parcelIdOf,
  signAttestationForCommitment,
} from "../sdk/src/attestation.mjs";
import {
  DOC,
  DOC_LABELS,
  MIN_DECARES,
  REQUIRED_MASK,
  applicantRefOf,
  docMaskFor,
  signEnrolmentForCommitment,
} from "../sdk/src/enrolment.mjs";
import { bytesToBigInt, sha256 } from "../sdk/src/bytes.mjs";
import { fieldToHex } from "../sdk/src/encoding.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PORT = Number(process.env.ISSUER_PORT ?? 8787);
const LABEL = "Giresun Findik Tarim Satis Kooperatifi";

const keyPath = process.env.ISSUER_KEY_PATH ?? join(ROOT, ".harvest", "issuer-key.json");
if (!existsSync(keyPath)) {
  console.error(`No issuer key at ${keyPath}. Run: npm run deploy`);
  process.exit(1);
}
const issuerKey = Buffer.from(JSON.parse(readFileSync(keyPath, "utf8")).secret, "hex");
const issuerPub = await issuerPublicKey(issuerKey);

/**
 * The cooperative's member records: measured expected yield per registered
 * parcel, plus the ÇKS and title-deed references an applicant has to match.
 *
 * Keyed by membership number because that is the cooperative's own filing, but
 * nothing is ever *looked up* by it -- applications come in with a ÇKS number
 * (see `findByCks`) and the membership number goes back out as the result.
 * Nothing outside this file ever sees more than one record at a time.
 */
const REGISTRY = {
  "GFK-2026-0142": {
    farmer: "Ahmet Yılmaz",
    nationalId: "10000000146",
    parcel: "Giresun/Bulancak ada 214 parsel 7",
    crop: "findik",
    cropLabel: { tr: "Giresun Tombul Fındık", en: "Giresun Round Hazelnut" },
    region: { tr: "Giresun / Bulancak", en: "Giresun / Bulancak" },
    expectedYieldKg: 48_500,
    season: 2026,
    // What the cooperative has on file. An applicant must produce documents
    // matching these before the membership is bound to their commitment.
    cksNo: "CKS-2026-104271",
    deedRef: "Giresun/Bulancak ada 214 parsel 7",
    landDecares: 310,
  },
  "GFK-2026-0207": {
    farmer: "Ayşe Demir",
    nationalId: "20000000232",
    parcel: "Balikesir/Edremit ada 88 parsel 12",
    crop: "zeytinyagi",
    cropLabel: { tr: "Erken Hasat Sızma Zeytinyağı", en: "Early Harvest Olive Oil" },
    region: { tr: "Balıkesir / Edremit", en: "Balikesir / Edremit" },
    expectedYieldKg: 62_000,
    season: 2026,
    cksNo: "CKS-2026-118840",
    deedRef: "Balikesir/Edremit ada 88 parsel 12",
    landDecares: 145,
  },
  "GFK-2026-0311": {
    farmer: "Mehmet Kaya",
    nationalId: "30000000328",
    parcel: "Aydin/Soke ada 51 parsel 3",
    crop: "pamuk",
    cropLabel: { tr: "Ege Uzun Lifli Pamuk", en: "Aegean Long-Staple Cotton" },
    region: { tr: "Aydın / Söke", en: "Aydin / Soke" },
    expectedYieldKg: 91_500,
    season: 2026,
    cksNo: "CKS-2026-127503",
    deedRef: "Aydin/Soke ada 51 parsel 3",
    landDecares: 620,
  },
  "GFK-2026-0418": {
    farmer: "Kemal Güler",
    nationalId: "40000000414",
    parcel: "Tokat/Merkez ada 132 parsel 5",
    crop: "patates",
    cropLabel: { tr: "Tokat Patatesi", en: "Tokat Potato" },
    region: { tr: "Tokat / Merkez", en: "Tokat / Merkez" },
    expectedYieldKg: 120_000,
    season: 2026,
    cksNo: "CKS-2026-133964",
    deedRef: "Tokat/Merkez ada 132 parsel 5",
    landDecares: 480,
  },
  "GFK-2026-0418": {
    farmer: "Kemal Güler",
    parcel: "Tokat/Merkez ada 132 parsel 5",
    crop: "patates",
    cropLabel: { tr: "Tokat Patatesi", en: "Tokat Potato" },
    region: { tr: "Tokat / Merkez", en: "Tokat / Merkez" },
    expectedYieldKg: 120_000,
    season: 2026,
  },
};

// ---------------------------------------------------------------------------
// Enrolment records
// ---------------------------------------------------------------------------

/**
 * Which membership has been claimed, and by which farmer commitment.
 *
 * This is the file that turns "knowing a member id" into "being that member".
 * Before it existed `/attest` signed a harvest attestation for anyone who typed
 * a number, so two browsers could each open a campaign against the same
 * grower's harvest. Now the first applicant to produce documents matching the
 * cooperative's file binds the membership to their commitment, permanently.
 *
 * The cooperative stores `Poseidon(farmerSecret)`, never the secret, so it
 * still cannot link a membership to the campaigns that secret goes on to open.
 */
const ENROLMENTS_PATH =
  process.env.ENROLMENTS_PATH ?? join(ROOT, ".harvest", "enrolments.json");

const loadEnrolments = () => {
  try {
    return existsSync(ENROLMENTS_PATH) ? JSON.parse(readFileSync(ENROLMENTS_PATH, "utf8")) : {};
  } catch {
    return {};
  }
};

let ENROLMENTS = loadEnrolments();

const saveEnrolments = () => {
  mkdirSync(dirname(ENROLMENTS_PATH), { recursive: true });
  writeFileSync(ENROLMENTS_PATH, JSON.stringify(ENROLMENTS, null, 2) + "\n");
};

/** `true` when this commitment is the one bound to this membership. */
const isEnrolled = (membershipId, commitment) =>
  ENROLMENTS[membershipId]?.farmerCommitment === String(commitment);

/** The season the cooperative is currently enrolling for. */
const SEASON = Math.max(...Object.values(REGISTRY).map((r) => r.season));

// ---------------------------------------------------------------------------
// Opening a record for someone the cooperative has not met
// ---------------------------------------------------------------------------

/**
 * Crops this cooperative takes on, and the yield it books per decare.
 *
 * The coefficients are the ones implied by the four seed records, so a member
 * the cooperative opens today is measured the same way as one it has had on
 * file for years.
 */
const CROPS = {
  findik: { label: { tr: "Fındık", en: "Hazelnut" }, kgPerDecare: 156 },
  zeytinyagi: { label: { tr: "Zeytinyağı", en: "Olive oil" }, kgPerDecare: 428 },
  pamuk: { label: { tr: "Pamuk", en: "Cotton" }, kgPerDecare: 148 },
  patates: { label: { tr: "Patates", en: "Potato" }, kgPerDecare: 250 },
};

/** Records the cooperative opened itself, kept so they survive a restart. */
const MEMBERS_PATH = process.env.MEMBERS_PATH ?? join(ROOT, ".harvest", "members.json");

const loadOpenedMembers = () => {
  try {
    return existsSync(MEMBERS_PATH) ? JSON.parse(readFileSync(MEMBERS_PATH, "utf8")) : {};
  } catch {
    return {};
  }
};

const OPENED = loadOpenedMembers();
Object.assign(REGISTRY, OPENED);

const saveOpenedMembers = () => {
  mkdirSync(dirname(MEMBERS_PATH), { recursive: true });
  writeFileSync(MEMBERS_PATH, JSON.stringify(OPENED, null, 2) + "\n");
};

/**
 * The area the cooperative books for a parcel it is seeing for the first time.
 *
 * Derived from the ÇKS number rather than taken from the applicant, and that is
 * the whole point: a figure the farmer can type is a figure they can inflate,
 * and both the eligibility bit the circuit computes and the harvest the
 * cooperative later attests to are built on this number. Deriving it keeps the
 * demo self-contained; a real cooperative sends someone to the field, and the
 * README says so.
 */
function bookedLandDecares(cksNo) {
  const digest = sha256(`land|${norm(cksNo)}`);
  return 60 + Number(bytesToBigInt(digest.subarray(0, 4)) % 541n); // 60..600 decares
}

/** The next membership number the cooperative has free. */
function nextMembershipId() {
  const taken = Object.keys(REGISTRY)
    .map((id) => Number(/GFK-\d{4}-(\d{4})/.exec(id)?.[1] ?? 0))
    .filter(Boolean);
  const next = Math.max(1000, ...taken) + 1;
  return `GFK-${SEASON}-${String(next).padStart(4, "0")}`;
}

/**
 * Open a membership for an applicant the cooperative has no record of.
 *
 * Everything the applicant supplies describes *them*: who they are, the parcel
 * on their deed, what they grow. Everything the proofs later depend on -- the
 * area and the expected harvest -- is decided here.
 */
function openMembership({ applicant, documents, crop }) {
  const landDecares = bookedLandDecares(documents.cks);
  const record = {
    farmer: String(applicant.fullName).trim().replace(/\s+/g, " "),
    nationalId: String(applicant.nationalId).trim(),
    parcel: String(documents.deed).trim(),
    crop,
    cropLabel: CROPS[crop].label,
    region: { tr: "Kayıtta belirtilen parsel", en: "As recorded on the deed" },
    expectedYieldKg: Math.round(landDecares * CROPS[crop].kgPerDecare),
    season: SEASON,
    cksNo: norm(documents.cks),
    deedRef: String(documents.deed).trim(),
    landDecares,
    openedAt: new Date().toISOString(),
  };
  const membershipId = nextMembershipId();
  REGISTRY[membershipId] = record;
  OPENED[membershipId] = record;
  saveOpenedMembers();
  console.log(`[apply] opened ${membershipId} for ${record.cksNo} (${crop}, ${landDecares} da)`);
  return { membershipId, record };
}

const norm = (v) => String(v ?? "").trim().toLocaleUpperCase("tr");

/**
 * Fold a name for comparison.
 *
 * Turkish diacritics are the difference between "Ayşe" and "Ayse", and a farmer
 * on a phone keyboard, or a form that lost its encoding somewhere, will produce
 * either. Refusing an application over a cedilla would be the kind of check that
 * looks rigorous and only ever catches the legitimate user, so the letters are
 * folded to ASCII and the spacing collapsed. The national id is compared
 * exactly; that is the part doing the real identity work.
 */
const TR_FOLD = { İ: "I", I: "I", ı: "i", Ş: "S", ş: "s", Ğ: "G", ğ: "g", Ü: "U", ü: "u", Ö: "O", ö: "o", Ç: "C", ç: "c" };
const foldName = (v) =>
  String(v ?? "")
    .replace(/[İIıŞşĞğÜüÖöÇç]/g, (c) => TR_FOLD[c] ?? c)
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Find a member by ÇKS number.
 *
 * The ÇKS number is the right key for an application because it exists before
 * any cooperative relationship does: it is the state's own farmer registry, and
 * it is where the parcel, the crop and the registered area come from. A
 * membership number would be circular -- you only have one once you are a
 * member, which is what the applicant is trying to become.
 *
 * The membership number is therefore an *output* of enrolment: the cooperative
 * has it on file, and hands it over once the paperwork checks out.
 */
function findByCks(cksNo) {
  const wanted = norm(cksNo);
  if (!wanted) return null;
  const hit = Object.entries(REGISTRY).find(([, r]) => norm(r.cksNo) === wanted);
  return hit ? { membershipId: hit[0], record: hit[1] } : null;
}

/**
 * The cooperative's examination of an application.
 *
 * Checks the documents the applicant presents against what the cooperative
 * already holds. Nothing here is a judgement call -- a real onboarding desk
 * compares paperwork to a file, and that is exactly what this does.
 *
 * Note what is *not* checked: the land area. The cooperative signs its own
 * recorded figure and the circuit decides whether it clears the floor, so the
 * applicant cannot inflate it and the cooperative cannot wave it through.
 */
function review(record, documents = {}) {
  const checks = [
    {
      bit: DOC.CKS,
      key: "cks",
      label: DOC_LABELS[DOC.CKS],
      required: true,
      // The lookup already matched on this, so reaching here means it passed.
      passed: norm(documents.cks) === norm(record.cksNo),
      reason: "ÇKS belge numarası kooperatif kaydıyla eşleşmiyor",
    },
    {
      bit: DOC.DEED,
      key: "deed",
      label: DOC_LABELS[DOC.DEED],
      required: true,
      passed: norm(documents.deed) === norm(record.deedRef),
      reason: "Tapu / kira kaydı kooperatif kaydıyla eşleşmiyor",
    },
    {
      bit: DOC.TARSIM,
      key: "tarsim",
      label: DOC_LABELS[DOC.TARSIM],
      required: false,
      passed: /^TRS-\d{4}-\d{5}$/i.test(String(documents.tarsim ?? "").trim()),
      reason: "TARSİM poliçe numarası TRS-YYYY-NNNNN biçiminde olmalı",
    },
  ];
  const attrMask = checks.reduce((m, c) => (c.passed ? m | c.bit : m), 0);
  return { checks, attrMask };
}

// ---------------------------------------------------------------------------

const json = (res, status, body) => {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(JSON.stringify(body, null, 2));
};

const readBody = (req) =>
  new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (c) => {
      raw += c;
      if (raw.length > 1e6) reject(new Error("body too large"));
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error(`invalid JSON: ${e.message}`));
      }
    });
    req.on("error", reject);
  });

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "OPTIONS") return json(res, 204, {});

  // Who this issuer is. The verifier contract holds the same (Ax, Ay) on its
  // accredited list; a client can compare the two to confirm it is talking to
  // a cooperative the chain actually trusts.
  if (url.pathname === "/issuer") {
    return json(res, 200, {
      label: LABEL,
      ax: fieldToHex(issuerPub.Ax),
      ay: fieldToHex(issuerPub.Ay),
    });
  }

  // There is deliberately no endpoint that lists the membership.
  //
  // There used to be a `GET /members`, and it published every grower's expected
  // yield without so much as an API key -- the exact figure the whole
  // zero-knowledge layer exists to keep from the market. A buyer could read all
  // of them with one request and never need a proof at all. A farmer's own
  // record now only comes back through `/my-membership`, which requires the
  // commitment that enrolled for it.

  // What an application has to produce. The form is driven off this rather than
  // hardcoded in the app, so the cooperative decides what it wants to see.
  if (url.pathname === "/enrolment") {
    return json(res, 200, {
      requiredMask: REQUIRED_MASK,
      minDecares: MIN_DECARES.toString(),
      // The season an enrolment would be issued for. The app needs it before
      // applying, to work out the nullifier this browser would spend and ask
      // the registry whether it already has.
      season: SEASON,
      // Crops the cooperative takes on. Only needed when it has no record under
      // the ÇKS number and has to open one; for an existing member its own file
      // decides, and a mismatch is not the applicant's to declare.
      crops: Object.entries(CROPS).map(([key, c]) => ({ key, label: c.label })),
      checks: [
        {
          bit: DOC.CKS,
          key: "cks",
          label: DOC_LABELS[DOC.CKS],
          required: true,
          placeholder: "CKS-2026-000000",
          help: {
            tr: "Çiftçi Kayıt Sistemi belgenizdeki numara.",
            en: "The number on your ÇKS farmer registration document.",
          },
        },
        {
          bit: DOC.DEED,
          key: "deed",
          label: DOC_LABELS[DOC.DEED],
          required: true,
          placeholder: "İl/İlçe ada 000 parsel 0",
          help: {
            tr: "Tapu ya da kira sözleşmenizdeki ada/parsel bilgisi.",
            en: "The ada/parsel reference on your title deed or lease.",
          },
        },
        {
          bit: DOC.TARSIM,
          key: "tarsim",
          label: DOC_LABELS[DOC.TARSIM],
          required: false,
          placeholder: "TRS-2026-00000",
          help: {
            tr: "Varsa TARSİM poliçe numaranız. Zorunlu değil.",
            en: "Your TARSİM policy number, if you have one. Not required.",
          },
        },
        {
          bit: DOC.LAND,
          key: "land",
          label: DOC_LABELS[DOC.LAND],
          required: true,
          computed: true,
          help: {
            tr: `Kooperatifin kaydındaki arazi büyüklüğü ${MIN_DECARES} dekarın üstünde mi — kanıt bunu hesaplar, büyüklüğü açıklamaz.`,
            en: `Whether the cooperative's recorded area clears ${MIN_DECARES} decares -- the proof computes this without revealing the area.`,
          },
        },
      ],
    });
  }

  // The application itself. The cooperative compares what is presented against
  // what it already holds, and on a match signs a membership credential over
  // Poseidon(farmerSecret) -- binding the membership to this farmer for good.
  if (url.pathname === "/apply" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }

    const { farmerCommitment, applicant = {}, documents = {} } = body;

    if (typeof farmerCommitment !== "string" || !/^\d+$/.test(farmerCommitment)) {
      return json(res, 400, {
        error: "farmerCommitment must be a decimal field element (Poseidon of the farmer's secret)",
      });
    }
    if (!String(applicant.fullName ?? "").trim() || !String(applicant.nationalId ?? "").trim()) {
      return json(res, 400, { error: "applicant.fullName and applicant.nationalId are required" });
    }

    // One identity, one membership. The chain enforces this per season through
    // the enrolment nullifier; the cooperative should not be handing out a
    // second record that could never be registered anyway.
    const already = Object.entries(ENROLMENTS).find(
      ([, e]) => e.farmerCommitment === farmerCommitment,
    );
    if (already) {
      return json(res, 409, {
        error: `that applicant is already enrolled as ${already[0]}`,
        code: "ALREADY_ENROLLED",
        membershipId: already[0],
      });
    }

    // The ÇKS number is the key. Either the cooperative already has a record
    // under it -- in which case the applicant has to prove they are the person
    // it is about -- or it does not, and the cooperative opens one.
    const found = findByCks(documents.cks);
    let membershipId;
    let record;

    if (found) {
      ({ membershipId, record } = found);

      // The applicant has to be the person the record is about.
      //
      // Without this the name and national id fields are decorative: anyone
      // holding a ÇKS number and a deed reference could enrol under any name,
      // and `applicantRef` -- the identity the credential binds to -- would
      // commit to whatever they typed rather than to whoever is on file.
      const identityMatches =
        norm(applicant.nationalId) === norm(record.nationalId) &&
        foldName(applicant.fullName) === foldName(record.farmer);
      if (!identityMatches) {
        console.log(`[apply] ${membershipId} REFUSED (identity does not match the record)`);
        return json(res, 422, {
          error: "the applicant does not match the farmer registry record for that ÇKS number",
          code: "IDENTITY_MISMATCH",
        });
      }
    } else {
      // A grower the cooperative has not met. It can take them on -- that is
      // what a cooperative is for -- but only it decides the two numbers the
      // proofs rest on. See `openMembership`.
      if (!/^CKS-\d{4}-\d{6}$/i.test(String(documents.cks ?? "").trim())) {
        return json(res, 422, {
          error: "ÇKS number must look like CKS-YYYY-NNNNNN",
          code: "CKS_MALFORMED",
        });
      }
      if (String(documents.deed ?? "").trim().length < 8) {
        return json(res, 422, {
          error: "a title deed or lease reference is required to open a membership",
          code: "DEED_REQUIRED",
        });
      }
      const crop = String(body.crop ?? "").trim();
      if (!CROPS[crop]) {
        return json(res, 422, {
          error: `crop must be one of: ${Object.keys(CROPS).join(", ")}`,
          code: "CROP_REQUIRED",
        });
      }
      ({ membershipId, record } = openMembership({ applicant, documents, crop }));
    }

    const existing = ENROLMENTS[membershipId];
    if (existing && existing.farmerCommitment !== farmerCommitment) {
      return json(res, 409, {
        error: "that farmer registry record is already enrolled to another applicant",
        code: "ALREADY_ENROLLED",
      });
    }

    const { checks, attrMask } = review(record, documents);
    const failedRequired = checks.filter((c) => c.required && !c.passed);
    if (failedRequired.length) {
      console.log(`[apply] ${membershipId} REFUSED (${failedRequired.map((c) => c.key).join(", ")})`);
      return json(res, 422, {
        error: "documents do not match the cooperative's records",
        code: "DOCUMENTS_REJECTED",
        checks,
      });
    }

    // The cooperative's own recorded area, not the applicant's claim.
    const landDecares = BigInt(record.landDecares);
    // Built from the cooperative's own record, not the form. They have just
    // been checked equal, and taking the canonical side keeps the identity
    // commitment stable across spelling and spacing.
    const applicantRef = applicantRefOf(`${record.nationalId}|${record.farmer}`);
    const parcelId = parcelIdOf(record.parcel);
    const docMask = docMaskFor(attrMask, landDecares);

    const signature = await signEnrolmentForCommitment(issuerKey, {
      farmerCommitment: BigInt(farmerCommitment),
      applicantRef,
      parcelId,
      landDecares,
      attrMask: BigInt(attrMask),
      seasonId: BigInt(record.season),
    });

    ENROLMENTS[membershipId] = {
      farmerCommitment,
      attrMask,
      docMask,
      season: record.season,
      approvedAt: new Date().toISOString(),
    };
    saveEnrolments();
    console.log(`[apply] ${membershipId} approved, mask ${docMask}`);

    return json(res, 200, {
      issuer: { label: LABEL, ax: issuerPub.Ax.toString(), ay: issuerPub.Ay.toString() },
      review: { checks, attrMask, docMask, sufficient: (docMask & REQUIRED_MASK) === REQUIRED_MASK },
      // The private half of the witness. The applicant already knows every one
      // of these -- it is their own paperwork -- so returning them costs no
      // privacy and saves the browser a second round trip. None of it is
      // published by the proof.
      credential: {
        applicantRef: applicantRef.toString(),
        parcelId: parcelId.toString(),
        landDecares: landDecares.toString(),
        attrMask: String(attrMask),
        season: String(record.season),
      },
      signature: {
        digest: signature.digest.toString(),
        sigR8x: signature.sigR8x.toString(),
        sigR8y: signature.sigR8y.toString(),
        sigS: signature.sigS.toString(),
      },
      // The membership number is handed over here rather than asked for: it is
      // what the applicant gets *out* of enrolling, not a prerequisite for it.
      membership: {
        membershipId,
        crop: record.crop,
        cropLabel: record.cropLabel,
        region: record.region,
        season: record.season,
      },
      display: { farmer: record.farmer, parcel: record.parcel, membershipId },
    });
  }

  // The caller's own member record, keyed by the commitment that enrolled for
  // it. This is the only route that returns an expected yield, and it returns
  // exactly one: the farmer's own. They measured it with the cooperative, so it
  // is theirs to see -- what the protocol keeps from the market is everyone
  // else's, which is why there is no endpoint that lists them.
  if (url.pathname === "/my-membership" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }
    const commitment = String(body.farmerCommitment ?? "");
    if (!/^\d+$/.test(commitment)) {
      return json(res, 400, { error: "farmerCommitment must be a decimal field element" });
    }
    const hit = Object.entries(ENROLMENTS).find(([, e]) => e.farmerCommitment === commitment);
    if (!hit) return json(res, 200, { membershipId: null });

    const [membershipId, enrolment] = hit;
    const record = REGISTRY[membershipId];
    return json(res, 200, {
      membershipId,
      docMask: enrolment.docMask,
      farmer: record.farmer,
      crop: record.crop,
      cropLabel: record.cropLabel,
      region: record.region,
      season: record.season,
      expectedYieldKg: record.expectedYieldKg,
    });
  }

  if (url.pathname === "/attest" && req.method === "POST") {
    let body;
    try {
      body = await readBody(req);
    } catch (err) {
      return json(res, 400, { error: err.message });
    }

    const { membershipId, farmerCommitment } = body;
    const record = REGISTRY[membershipId];
    if (!record) {
      return json(res, 404, { error: `no member record for ${membershipId}` });
    }
    if (typeof farmerCommitment !== "string" || !/^\d+$/.test(farmerCommitment)) {
      return json(res, 400, {
        error: "farmerCommitment must be a decimal field element (Poseidon of the farmer's secret)",
      });
    }

    // The gate. Without it this endpoint signs a harvest attestation for anyone
    // who knows a member id, and "an accredited cooperative vouched for this
    // grower" stops meaning anything.
    if (!isEnrolled(membershipId, farmerCommitment)) {
      console.log(`[attest] ${membershipId} REFUSED (not enrolled)`);
      return json(res, 403, {
        error: ENROLMENTS[membershipId]
          ? `${membershipId} is enrolled to a different applicant`
          : `${membershipId} has not completed membership enrolment`,
        code: "NOT_ENROLLED",
      });
    }

    const parcelId = parcelIdOf(record.parcel);
    const cropCode = cropCodeOf(record.crop);
    const signature = await signAttestationForCommitment(issuerKey, {
      yieldKg: BigInt(record.expectedYieldKg),
      parcelId,
      cropCode,
      seasonId: BigInt(record.season),
      farmerCommitment: BigInt(farmerCommitment),
    });

    console.log(`[attest] ${membershipId} (${record.crop}, season ${record.season})`);

    return json(res, 200, {
      issuer: { label: LABEL, ax: issuerPub.Ax.toString(), ay: issuerPub.Ay.toString() },
      attestation: {
        // The farmer knows all of these already; they are returned so the
        // browser can assemble the circuit witness without a second round trip.
        expectedYieldKg: String(record.expectedYieldKg),
        parcelId: parcelId.toString(),
        cropCode: cropCode.toString(),
        season: String(record.season),
      },
      signature: {
        digest: signature.digest.toString(),
        sigR8x: signature.sigR8x.toString(),
        sigR8y: signature.sigR8y.toString(),
        sigS: signature.sigS.toString(),
      },
      display: {
        farmer: record.farmer,
        parcel: record.parcel,
        cropLabel: record.cropLabel,
        region: record.region,
      },
    });
  }

  return json(res, 404, {
    error: "not found",
    routes: ["/issuer", "/enrolment", "POST /apply", "POST /my-membership", "POST /attest"],
  });
});

server.listen(PORT, () => {
  console.log(`
Cooperative attestation service
  ${LABEL}

  listening : http://localhost:${PORT}
  issuer Ax : 0x${fieldToHex(issuerPub.Ax).slice(0, 24)}...
  members   : ${Object.keys(REGISTRY).length}
  enrolled  : ${Object.keys(ENROLMENTS).length}

  GET  /issuer         the accredited signing key
  GET  /enrolment      the documents an application has to produce
  POST /apply          { farmerCommitment, applicant, documents }
                         looked up by CKS number -> signed membership credential
                         and the membership number the applicant just earned
  POST /my-membership  { farmerCommitment } -> that farmer's own record
  POST /attest         { membershipId, farmerCommitment } -> signed attestation
                         403 unless that commitment enrolled for that membership

There is no endpoint that lists the membership. One that did would publish every
grower expected yield, which is the figure the proofs exist to keep private.

Note: this service signs over Poseidon(farmerSecret) and never receives the
secret, so it cannot link a membership to the campaigns that secret opens.
Enrolment bindings live in ${ENROLMENTS_PATH}.
`);
});
