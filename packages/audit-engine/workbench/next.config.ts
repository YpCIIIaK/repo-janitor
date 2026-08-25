import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  async redirects() {
    return [
      { source: "/web/market", destination: "/web", permanent: false },
      { source: "/web/sites", destination: "/web", permanent: false },
      { source: "/web/surface", destination: "/web/scan", permanent: false },
      { source: "/web/check", destination: "/web/scan", permanent: false },
      { source: "/web/practices", destination: "/web", permanent: false },
      { source: "/web/method", destination: "/web", permanent: false },
    ];
  },
};

export default nextConfig;
