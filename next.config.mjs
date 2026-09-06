/**
 * Browser-facing headers. The previous CSP only blocked framing and plugins;
 * everything else (scripts, connections, forms) was left to the browser default
 * of "allow". XSS in the dashboard would then become a full-origin script.
 *
 * `'unsafe-inline'` stays on script/style because the theme-init snippet and
 * Next's own hydration still emit inline tags. A nonce pipeline would drop both;
 * that is the next tightening, not this one.
 */
export function contentSecurityPolicy(frameAncestors = "'self'") {
  return [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    `frame-ancestors ${frameAncestors}`,
    "frame-src 'none'",
    "worker-src 'self'",
  ].join("; ")
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Content-Security-Policy", value: contentSecurityPolicy("'self'") },
        ],
      },
      {
        // Embed widgets are meant to be framed on other sites (docs, status
        // pages). Default browser / host CSP often blocks that; open framing
        // only for /embed/*, nowhere else. The rest of the policy stays.
        source: "/embed/:path*",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy("*") },
        ],
      },
    ]
  },
}

export default nextConfig
