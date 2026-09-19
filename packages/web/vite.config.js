import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Contract ids come from the deploy script rather than a hand-kept .env, so the
// app can never drift from what is actually on testnet.
const deployments = JSON.parse(readFileSync(resolve(__dirname, "../../deployments.json"), "utf8"));

export default defineConfig({
  plugins: [react()],
  define: {
    __DEPLOYMENTS__: JSON.stringify(deployments),
    // stellar-sdk and snarkjs both reach for globals that only exist in Node.
    global: "globalThis",
  },
  resolve: {
    alias: { buffer: "buffer/" },
  },
  optimizeDeps: {
    // snarkjs ships CommonJS with a Node flavour; let esbuild pre-bundle it
    // rather than letting it break at runtime on a missing `require`.
    include: ["snarkjs", "buffer"],
  },
  server: { port: 5173, host: true },
});
