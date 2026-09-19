/**
 * Contract ids, straight from the repo's `deployments.json`, which the deploy
 * scripts write. Imported as a module rather than injected through an
 * environment variable: webpack then tracks the file, so a redeploy is picked
 * up on the next build instead of being masked by a cached bundle that still
 * carries the old addresses.
 */

import deploymentsJson from "../../../../../deployments.json";

export const deployments = deploymentsJson;

export const ISSUER_URL = process.env.NEXT_PUBLIC_ISSUER_URL ?? "http://localhost:8787";

export const explorerContract = (id) => `https://stellar.expert/explorer/testnet/contract/${id}`;
export const explorerAccount = (id) => `https://stellar.expert/explorer/testnet/account/${id}`;
export const explorerTx = (hash) => `https://stellar.expert/explorer/testnet/tx/${hash}`;
