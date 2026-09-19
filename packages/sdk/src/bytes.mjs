/**
 * Byte and hash helpers that behave identically in Node and the browser.
 *
 * The farmer's proof is built in the browser and the same code runs in scripts
 * and tests, so anything that touches `node:crypto` would either break the app
 * or -- worse -- quietly diverge and produce a nullifier the contract rejects.
 * `@noble/hashes` gives one synchronous implementation for both, which keeps
 * these helpers sync; going through WebCrypto would make them async and push
 * that asynchrony through every caller for no benefit.
 */

import { sha256 as nobleSha256 } from "@noble/hashes/sha2";
import { randomBytes as nobleRandomBytes } from "@noble/hashes/utils";

/** @returns {Uint8Array} */
export const sha256 = (data) =>
  nobleSha256(typeof data === "string" ? new TextEncoder().encode(data) : data);

/** @returns {Uint8Array} */
export const randomBytes = (n) => nobleRandomBytes(n);

export function toHex(bytes) {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export function fromHex(hex) {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2) throw new Error(`odd-length hex: ${hex}`);
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Big-endian bytes -> BigInt. */
export const bytesToBigInt = (bytes) => (bytes.length ? BigInt("0x" + toHex(bytes)) : 0n);

/** BigInt -> big-endian bytes, left-padded to `length`. */
export function bigIntToBytes(value, length) {
  const hex = BigInt(value).toString(16).padStart(length * 2, "0");
  if (hex.length > length * 2) {
    throw new Error(`value does not fit in ${length} bytes: ${value}`);
  }
  return fromHex(hex);
}

export const concat = (...parts) => {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
