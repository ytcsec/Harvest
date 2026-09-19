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
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cropCodeOf,
  issuerPublicKey,
  parcelIdOf,
  signAttestationForCommitment,
} from "../sdk/src/attestation.mjs";
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
 * parcel. Keyed by the membership number a farmer would read off their card.
 */
const REGISTRY = {
  "GFK-2026-0142": {
    farmer: "Ahmet Y.",
    parcel: "Giresun/Bulancak ada 214 parsel 7",
    crop: "findik",
    cropLabel: { tr: "Giresun Tombul Fındık", en: "Giresun Round Hazelnut" },
    region: { tr: "Giresun / Bulancak", en: "Giresun / Bulancak" },
    expectedYieldKg: 48_500,
    season: 2026,
  },
  "GFK-2026-0207": {
    farmer: "Ayse D.",
    parcel: "Balikesir/Edremit ada 88 parsel 12",
    crop: "zeytinyagi",
    cropLabel: { tr: "Erken Hasat Sızma Zeytinyağı", en: "Early Harvest Olive Oil" },
    region: { tr: "Balıkesir / Edremit", en: "Balikesir / Edremit" },
    expectedYieldKg: 62_000,
    season: 2026,
  },
  "GFK-2026-0311": {
    farmer: "Mehmet K.",
    parcel: "Aydin/Soke ada 51 parsel 3",
    crop: "pamuk",
    cropLabel: { tr: "Ege Uzun Lifli Pamuk", en: "Aegean Long-Staple Cotton" },
    region: { tr: "Aydın / Söke", en: "Aydin / Soke" },
    expectedYieldKg: 91_500,
    season: 2026,
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

  // The member records this cooperative will attest to. The yields are
  // included because the farmer already knows their own figure -- it is the
  // *market* this is being kept from, not the grower.
  if (url.pathname === "/members") {
    return json(
      res,
      200,
      Object.entries(REGISTRY).map(([id, r]) => ({
        membershipId: id,
        farmer: r.farmer,
        crop: r.crop,
        cropLabel: r.cropLabel,
        region: r.region,
        season: r.season,
        expectedYieldKg: r.expectedYieldKg,
      })),
    );
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

  return json(res, 404, { error: "not found", routes: ["/issuer", "/members", "POST /attest"] });
});

server.listen(PORT, () => {
  console.log(`
Cooperative attestation service
  ${LABEL}

  listening : http://localhost:${PORT}
  issuer Ax : 0x${fieldToHex(issuerPub.Ax).slice(0, 24)}...
  members   : ${Object.keys(REGISTRY).length}

  GET  /issuer    the accredited signing key
  GET  /members   member records this cooperative will attest to
  POST /attest    { membershipId, farmerCommitment } -> signed attestation

Note: this service signs over Poseidon(farmerSecret) and never receives the
secret, so it cannot link a campaign back to a member.
`);
});
