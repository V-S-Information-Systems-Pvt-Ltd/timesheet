import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Self-host in a Docker container (OpenShift/Rancher) via `node server.js`
  // from .next/standalone.
  output: "standalone",
};

export default nextConfig;
