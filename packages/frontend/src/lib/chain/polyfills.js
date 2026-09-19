/**
 * Node globals the Stellar and circom libraries reach for.
 *
 * Imported first by the WalletProvider, before anything touches stellar-sdk or
 * circomlibjs, so the globals exist by the time those modules evaluate.
 */

import { Buffer } from "buffer";

if (typeof globalThis !== "undefined") {
  globalThis.Buffer ??= Buffer;
  globalThis.global ??= globalThis;
}
