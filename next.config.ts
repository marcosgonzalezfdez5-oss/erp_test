import type { NextConfig } from "next";

// Baseline hardening headers applied to every response. No Content-Security-
// Policy yet — a Clerk/Turnstile-compatible CSP needs its own dedicated pass.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // @react-pdf/renderer (used for the invoice / credit-note / delivery-note PDFs)
  // ships CJS with subpath requires its bundler-unfriendly exports map breaks —
  // let Node resolve it at runtime instead of bundling it.
  serverExternalPackages: ["@react-pdf/renderer"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
