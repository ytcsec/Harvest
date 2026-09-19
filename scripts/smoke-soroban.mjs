console.log("starting...");
import * as snarkjs from "snarkjs";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { addressBinding, buildCircuitInput, cropCodeOf, issuerPublicKey, parcelIdOf, randomFarmerSecret, signAttestation } from "../packages/sdk/src/attestation.mjs";
import { encodeClaim, encodeProof } from "../packages/sdk/src/encoding.mjs";
import { SorobanClient, claimToScVal, proofToScVal, addressToScVal } from "../packages/sdk/src/soroban.mjs";

const ROOT = process.cwd();
const STELLAR = join(homedir(), ".harvest-bin", "stellar.exe");
const d = JSON.parse(readFileSync("deployments.json", "utf8"));
const me = execFileSync(STELLAR, ["keys", "address", "harvest-deployer"], { encoding: "utf8" }).trim();

const issuerKey = Buffer.from(JSON.parse(readFileSync(".harvest/issuer-key.json","utf8")).secret,"hex");
const issuerPub = await issuerPublicKey(issuerKey);
const farmerSecret = randomFarmerSecret();
const binding = addressBinding(me);
const sig = await signAttestation(issuerKey, { yieldKg: 48500n, parcelId: parcelIdOf("p"), cropCode: cropCodeOf("findik"), seasonId: 2026n, farmerSecret });
const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  await buildCircuitInput({ issuerPub, threshold: 40000n, seasonId: 2026n, farmerSecret, yieldKg: 48500n, parcelId: parcelIdOf("p"), cropCode: cropCodeOf("findik"), signature: sig, binding }),
  join(ROOT,"circuits/build/harvest_capacity_js/harvest_capacity.wasm"),
  join(ROOT,"circuits/build/harvest_capacity_final.zkey"));

const claim = encodeClaim(publicSignals), enc = encodeProof(proof);
console.log("proof generated, calling contract...");
const client = new SorobanClient();

const good = await client.read({ contractId: d.verifier, method: "check_capacity",
  args: [addressToScVal(me), claimToScVal(claim), proofToScVal(enc)], source: me });
console.log("valid proof via JS ScVal encoding   ->", good);

const bad = await client.read({ contractId: d.verifier, method: "check_capacity",
  args: [addressToScVal(me), claimToScVal({...claim, threshold_kg: 90000}), proofToScVal(enc)], source: me });
console.log("inflated threshold                  ->", bad);

const count = await client.read({ contractId: d.campaign, method: "campaign_count", args: [], source: me });
console.log("campaign_count on live contract     ->", count);
