import type { NextConfig } from "next";

// PAPERTRAIL is a static, client-only build. There are no API routes, server
// actions or server-side data dependencies; `output: "export"` enforces that the
// build fails if a server-only feature is introduced. Documents never leave the browser.
const nextConfig: NextConfig = {
  output: "export",
  trailingSlash: true,
  reactStrictMode: true,
  images: { unoptimized: true },
  poweredByHeader: false,
};

export default nextConfig;
