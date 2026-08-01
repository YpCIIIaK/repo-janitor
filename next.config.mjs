/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        // Embed widgets are meant to be framed on other sites (docs, status
        // pages). Default browser / host CSP often blocks that; open framing
        // only for /embed/*, nowhere else.
        source: "/embed/:path*",
        headers: [
          // Prefer CSP; omit X-Frame-Options (legacy DENY/SAMEORIGIN only).
          { key: "Content-Security-Policy", value: "frame-ancestors *" },
        ],
      },
    ]
  },
}

export default nextConfig
