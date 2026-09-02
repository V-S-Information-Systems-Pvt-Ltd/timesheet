import type { NextConfig } from "next";

// `output: "standalone"` lets the container image (OpenShift/Rancher) self-host
// via `node .next/standalone/server.js`. Vercel runs its own builder/runtime
// and breaks when standalone output tracing is enabled (missing
// .next/next-server.js.nft.json), so disable it there — Vercel sets `VERCEL=1`
// during its builds.
const nextConfig: NextConfig = {
  ...(process.env.VERCEL ? {} : { output: "standalone" }),
  async headers() {
    // React dev mode requires eval() for its debugging/DevTools features, so
    // allow 'unsafe-eval' in development only. Production never uses eval, so
    // keep the strict CSP there.
    const scriptSrc = process.env.NODE_ENV === 'production'
      ? "'self' 'unsafe-inline'"
      : "'self' 'unsafe-inline' 'unsafe-eval'"

    // connect-src must allow the Supabase host: in supabase mode the browser
    // client fetches data + auth from NEXT_PUBLIC_SUPABASE_URL (and uses a
    // websocket for realtime), and Next dev uses ws/wss for HMR. In native
    // mode everything is same-origin, so 'self' alone is enough.
    let connectSrc = "'self'"
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    if (supabaseUrl) {
      try {
        const host = new URL(supabaseUrl).host
        connectSrc += ` https://${host} wss://${host}`
      } catch { /* ignore malformed URL */ }
    }
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
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Defense-in-depth CSP. 'unsafe-inline' for script/style is required by
          // Next.js hydration. connect-src is scoped to same-origin plus the
          // Supabase host (when configured) and dev websockets; frame-ancestors
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
