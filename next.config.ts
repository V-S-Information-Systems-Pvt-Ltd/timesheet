import type { NextConfig } from "next";

// `output: "standalone"` lets the container image (OpenShift/Rancher) self-host
// via `node .next/standalone/server.js`. Vercel runs its own builder/runtime
// and breaks when standalone output tracing is enabled (missing
// .next/next-server.js.nft.json), so disable it there — Vercel sets `VERCEL=1`
// during its builds.
const nextConfig: NextConfig = {
  // Shared workspace packages ship TypeScript sources and must be compiled
  // by the Next.js toolchain.
  transpilePackages: ['@vsis/core', '@vsis/contracts', '@vsis/client'],
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  async headers() {
    // React dev mode requires eval() for its debugging/DevTools features, so
    // allow 'unsafe-eval' in development only. Production never uses eval, so
    // keep the strict CSP there.
    const scriptSrc = process.env.NODE_ENV === 'production'
      ? "'self' 'unsafe-inline'"
      : "'self' 'unsafe-inline' 'unsafe-eval'"

    // Everything is same-origin, so 'self' is enough; Next dev adds ws/wss for HMR.
    let connectSrc = "'self'"
    if (process.env.NODE_ENV !== 'production') {
      connectSrc += " ws://localhost:* wss://localhost:*"
    }

    return [
      {
        source: "/forgot-password",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
      {
        source: "/reset-password",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
      {
        source: "/verify-email",
        headers: [{ key: "Cache-Control", value: "no-store, private" }],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Defense-in-depth CSP. 'unsafe-inline' for script/style is required by
          // Next.js hydration. connect-src is scoped to same-origin plus dev
          // websockets; frame-ancestors
          // 'none' blocks clickjacking.
          {
            key: "Content-Security-Policy",
            value:
              `default-src 'self'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; ` +
              `img-src 'self' data: blob:; font-src 'self' data:; connect-src ${connectSrc}; ` +
              "frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ]
  },
};

export default nextConfig;
