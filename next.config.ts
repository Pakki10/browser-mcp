import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Playwright + its browser binaries are massive and Node-native; must NOT
  // be traced/bundled into the Next.js server chunks.
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
