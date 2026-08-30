import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typescript: { ignoreBuildErrors: false },
  // Several lockfiles exist above this directory; pin the trace root to the app itself.
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
