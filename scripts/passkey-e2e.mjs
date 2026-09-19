/**
 * Passkey smart wallet, end to end on testnet, without a browser.
 *
 *   node scripts/passkey-e2e.mjs [campaignId] [amountTry]
 *
 * Runs the same path the frontend's "Passkey" sign-in takes
 * (packages/frontend/src/lib/chain/passkey.js), with a software P-256
 * authenticator standing in for Face ID / Windows Hello:
 *
 *   1  a fee account (friendbot) that pays for submissions
 *   2  a passkey and an OpenZeppelin smart account deployed for it
 *   3  lira in through the TR anchor to the fee account, which is also the
 *      ramp (SEP-10 cannot authenticate a contract account), then USDC moved
 *      into the smart wallet with a token transfer
 *   4  the smart wallet funds a campaign: the campaign's `require_auth` on a
 *      C-address is answered by the passkey signature via `__check_auth`
 */

import { createHash, generateKeyPairSync, randomBytes, sign as ecSign } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { register } from "node:module";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KIT_DIR = join(ROOT, "node_modules", "smart-account-kit");
// The kit pins its own stellar-sdk; XDR built with another copy is not
// recognised by it, so this script uses the kit's copy throughout -- and
// sends the kit's generated bindings (hoisted next to the repo's SDK 17)
// to that same copy. The frontend does the same with a webpack alias.
const KIT_SDK = pathToFileURL(join(KIT_DIR, "node_modules/@stellar/stellar-sdk/lib/esm/")).href;
register(
  "data:text/javascript," +
    encodeURIComponent(`
      const MAP = { "@stellar/stellar-sdk": "index.js", "@stellar/stellar-sdk/contract": "contract/index.js", "@stellar/stellar-sdk/rpc": "rpc/index.js" };
      export async function resolve(specifier, context, next) {
        if (MAP[specifier] && context.parentURL && context.parentURL.includes("smart-account-kit")) {
          return { url: ${JSON.stringify(KIT_SDK)} + MAP[specifier], shortCircuit: true };
        }
        return next(specifier, context);
      }`),
);
const sdk = await import(pathToFileURL(join(KIT_DIR, "node_modules/@stellar/stellar-sdk/lib/esm/index.js")).href);
const { SmartAccountKit, MemoryStorage } = await import(pathToFileURL(join(KIT_DIR, "dist/index.js")).href);
const { AnchorClient } = await import(pathToFileURL(join(ROOT, "packages/sdk/src/anchor.mjs")).href);

const { Address, Asset, BASE_FEE, Contract, Horizon, Keypair, Networks, Operation, TransactionBuilder, contract, nativeToScVal, rpc, scValToNative } = sdk;

const deployments = JSON.parse(readFileSync(join(ROOT, "deployments.json"), "utf8"));
const CAMPAIGN_ID = Number(process.argv[2] ?? 6);
const AMOUNT_TRY = Number(process.argv[3] ?? 100);
const RPC_URL = "https://soroban-testnet.stellar.org";
const ORIGIN = "http://localhost:3000";
const RP_ID = "localhost";
const USDC = new Asset("USDC", "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5");

const server = new rpc.Server(RPC_URL);
const horizon = new Horizon.Server("https://horizon-testnet.stellar.org");
const b64url = (buf) => Buffer.from(buf).toString("base64url");
const sha256 = (b) => createHash("sha256").update(b).digest();
const step = (n, m) => console.log(`\n[${n}] ${m}`);

// ------------------------------------------------ software authenticator --

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = publicKey.export({ format: "jwk" });
const rawPublicKey = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
const credentialId = randomBytes(32);
let counter = 0;

const authData = () => {
  counter += 1;
  const c = Buffer.alloc(4);
  c.writeUInt32BE(counter);
  // User Present + User Verified.
  return Buffer.concat([sha256(Buffer.from(RP_ID)), Buffer.from([0x05]), c]);
};

const softWebAuthn = {
  async startRegistration({ optionsJSON }) {
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: optionsJSON.challenge, origin: ORIGIN }));
    return {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientData),
        attestationObject: "",
        authenticatorData: b64url(authData()),
        publicKey: b64url(rawPublicKey),
        publicKeyAlgorithm: -7,
        transports: ["internal"],
      },
    };
  },
  async startAuthentication({ optionsJSON }) {
    const clientData = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: optionsJSON.challenge, origin: ORIGIN }));
    const data = authData();
    const signature = ecSign("sha256", Buffer.concat([data, sha256(clientData)]), privateKey);
    return {
      id: b64url(credentialId),
      rawId: b64url(credentialId),
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientData),
        authenticatorData: b64url(data),
        signature: b64url(signature),
        userHandle: undefined,
      },
    };
  },
};

// --------------------------------------------------------------- helpers --

async function waitFor(hash) {
  for (let i = 0; i < 60; i += 1) {
    const got = await server.getTransaction(hash);
    if (got.status === "SUCCESS") return got;
    if (got.status === "FAILED") throw new Error(`transaction ${hash} failed`);
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`transaction ${hash} did not confirm`);
}

const read = async (contractId, method, args) => {
  const tx = await contract.AssembledTransaction.build({
    contractId, method, args, networkPassphrase: Networks.TESTNET, rpcUrl: RPC_URL, parseResultXdr: (v) => scValToNative(v),
  });
  return tx.result;
};

// ------------------------------------------------------------------- run --

step(1, "fee account (also the anchor ramp)");
const fee = Keypair.random();
await fetch(`https://friendbot.stellar.org?addr=${fee.publicKey()}`);
console.log(`    ${fee.publicKey()}`);

step(2, "passkey + smart account");
const kit = new SmartAccountKit({
  rpcUrl: RPC_URL,
  networkPassphrase: Networks.TESTNET,
  accountWasmHash: "1b5f4534a76322da2ad7c745f6900857a6802b0ca79850c35a03561df997785a",
  webauthnVerifierAddress: "CC7EKIHQP3TN4CARQDND6CEOY2UXLWWC2X5GHTD5NLAT7BG5GPZIOM3F",
  deployerSecret: fee.secret(),
  storage: new MemoryStorage(),
  webAuthn: softWebAuthn,
  rpId: RP_ID,
  rpName: "HARVEST",
  allowedOrigins: [ORIGIN],
});
const created = await kit.createWallet("HARVEST", "e2e", { autoSubmit: true, forceMethod: "rpc" });
if (created.submitResult && !created.submitResult.success) throw created.submitResult.error;
const wallet = created.contractId;
console.log(`    smart account ${wallet}`);
console.log(`    deployed in ${created.submitResult?.hash}`);

step(3, `${AMOUNT_TRY} TRY in through the anchor, USDC into the smart account`);
const feeAccount = await horizon.loadAccount(fee.publicKey());
const trust = new TransactionBuilder(feeAccount, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(Operation.changeTrust({ asset: USDC }))
  .setTimeout(60)
  .build();
trust.sign(fee);
await horizon.submitTransaction(trust);

const anchor = new AnchorClient();
await anchor.authenticate(fee.publicKey(), (xdr, passphrase) => {
  const challenge = TransactionBuilder.fromXDR(xdr, passphrase);
  challenge.sign(fee);
  return challenge.toXDR();
});
const deposit = await anchor.startDeposit({ account: fee.publicKey(), amount: AMOUNT_TRY });
await anchor.simulateBankTransfer(deposit.id, AMOUNT_TRY);
const settled = await anchor.waitForCompletion(deposit.id, {});
console.log(`    anchor paid ${settled.amount_out} USDC to the ramp`);

const units = BigInt(Math.round(Number(settled.amount_out) * 1e7));
const sweep = new TransactionBuilder(await server.getAccount(fee.publicKey()), { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
  .addOperation(
    new Contract(deployments.usdc).call(
      "transfer",
      new Address(fee.publicKey()).toScVal(),
      new Address(wallet).toScVal(),
      nativeToScVal(units, { type: "i128" }),
    ),
  )
  .setTimeout(60)
  .build();
const prepared = await server.prepareTransaction(sweep);
prepared.sign(fee);
const swept = await server.sendTransaction(prepared);
await waitFor(swept.hash);
console.log(`    moved into the smart account: ${swept.hash}`);
console.log(`    smart account USDC: ${Number(await read(deployments.usdc, "balance", [new Address(wallet).toScVal()])) / 1e7}`);

step(4, `smart account funds campaign #${CAMPAIGN_ID} with 1 USDC (passkey-signed)`);
const fund = await contract.AssembledTransaction.build({
  contractId: deployments.campaign,
  method: "fund",
  args: [new Address(wallet).toScVal(), nativeToScVal(CAMPAIGN_ID, { type: "u32" }), nativeToScVal(10_000_000n, { type: "i128" })],
  networkPassphrase: Networks.TESTNET,
  rpcUrl: RPC_URL,
  parseResultXdr: (v) => v,
});
const result = await kit.signAndSubmit(fund, { forceMethod: "rpc" });
if (!result.success) throw result.error;
await waitFor(result.hash);
console.log(`    fund tx: https://stellar.expert/explorer/testnet/tx/${result.hash}`);
const invested = await read(deployments.campaign, "investment_of", [nativeToScVal(CAMPAIGN_ID, { type: "u32" }), new Address(wallet).toScVal()]).catch((e) => `(read failed: ${e.message})`);
console.log(`    campaign records for the smart account: ${typeof invested === "bigint" ? Number(invested) / 1e7 : invested} USDC`);
console.log("\npasskey wallet end to end: OK");
