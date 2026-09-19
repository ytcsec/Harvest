/**
 * Node globals the Stellar and circom libraries reach for.
 *
 * This has to be its own module imported before anything else: ES module
 * imports are evaluated before the importing module's body, so assigning
 * `globalThis.Buffer` inside main.jsx runs *after* stellar-sdk has already
 * tried to use it, and the app dies with `ReferenceError: Buffer is not
 * defined` before React ever mounts.
 */

import { Buffer } from "buffer";

globalThis.Buffer ??= Buffer;
globalThis.global ??= globalThis;
// Some CommonJS builds probe process.env; give them something inert.
globalThis.process ??= { env: {}, browser: true, version: "" };
