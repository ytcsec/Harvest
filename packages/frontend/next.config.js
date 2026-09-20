const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    unoptimized: true,
  },
  // The SDK is plain ESM source shared with the issuer and the scripts.
  transpilePackages: ["@harvest/sdk"],
  // Proxy the cooperative (issuer) service through this same origin, so the
  // browser never has to reach it directly. When the app is served from a
  // public host (e.g. behind a Cloudflare tunnel), "localhost:8787" would
  // resolve to the visitor's own machine; here Next.js forwards the request
  // server-side to the issuer running next to it. Set NEXT_PUBLIC_ISSUER_URL
  // to "/api/issuer" so client fetches hit this rewrite. Override the upstream
  // with ISSUER_ORIGIN if the issuer runs elsewhere.
  async rewrites() {
    const issuerOrigin = process.env.ISSUER_ORIGIN ?? "http://localhost:8787";
    return [
      {
        source: "/api/issuer/:path*",
        destination: `${issuerOrigin}/:path*`,
      },
    ];
  },
  experimental: {
    // src/lib/chain/deployments.js imports the repo-root deployments.json.
    externalDir: true,
  },
  webpack(config, { isServer, webpack }) {
    // One stellar-sdk for the whole bundle. The passkey kit, its generated
    // bindings and @harvest/sdk would otherwise each pull their own copy, and
    // XDR objects built by one copy are not recognised by another.
    const sdk = path.join(__dirname, "node_modules/@stellar/stellar-sdk/lib/esm");
    config.resolve.alias = {
      ...config.resolve.alias,
      "@stellar/stellar-sdk$": path.join(sdk, "index.js"),
      "@stellar/stellar-sdk/contract$": path.join(sdk, "contract/index.js"),
      "@stellar/stellar-sdk/rpc$": path.join(sdk, "rpc/index.js"),
      // Optional peer of smart-account-kit, only for its external-wallet
      // adapter, which this app does not use (it has its own Wallets Kit).
      "@creit-tech/stellar-wallets-kit": false,
    };
    if (!isServer) {
      // snarkjs, circomlibjs and stellar-sdk probe Node built-ins they never
      // actually need in a browser.
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        os: false,
        path: false,
        crypto: false,
        readline: false,
        constants: false,
        worker_threads: false,
      };
      config.plugins.push(new webpack.ProvidePlugin({ Buffer: ["buffer", "Buffer"] }));
    }
    return config;
  },
};

module.exports = nextConfig;
