import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // circomlibjs uses legacy Node-style dynamic file/wasm loading that
  // confuses Turbopack's build-time asset tracer (NftJsonAsset errors). It
  // only runs server-side inside the /api/zk/commitment route handler
  // (Node.js runtime, used by the issuer to anchor an age commitment at
  // issuance time), so excluding it from bundling/tracing and letting Node
  // `require()` it directly at runtime is both correct and simpler.
  // snarkjs runs client-side only now (see app/zkProve.ts) — proof
  // generation for the holder's age proof was moved into the browser so the
  // birth year never leaves the device, so snarkjs no longer needs a
  // server-side exemption here.
  serverExternalPackages: ["circomlibjs"],
  // RainbowKit pulls in Coinbase's Base Account connector, which lazily
  // `import()`s optional `@x402/*` payment peer-deps we never install
  // (this app doesn't use x402 payments). The dynamic imports are already
  // wrapped in try/catch at runtime, but Turbopack still tries to resolve
  // them at build time and fails hard — alias them away instead.
  turbopack: {
    resolveAlias: {
      "@x402/core/client": "./app/stubs/empty-module.js",
      "@x402/evm": "./app/stubs/empty-module.js",
      "@x402/evm/exact/client": "./app/stubs/empty-module.js",
      "@x402/evm/upto/client": "./app/stubs/empty-module.js",
      "@x402/svm/exact/client": "./app/stubs/empty-module.js",
    },
  },
};

export default nextConfig;
