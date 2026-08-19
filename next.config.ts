import type { NextConfig } from "next";

// `output: "standalone"` lets the container image (OpenShift/Rancher) self-host
// via `node .next/standalone/server.js`. Vercel runs its own builder/runtime
// and breaks when standalone output tracing is enabled (missing
// .next/next-server.js.nft.json), so disable it there — Vercel sets `VERCEL=1`
// during its builds.
const nextConfig: NextConfig = {
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ]
  },
};

export default nextConfig;
