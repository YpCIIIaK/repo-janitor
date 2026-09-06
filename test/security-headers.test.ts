import { describe, expect, it } from "vitest"
import nextConfig, { contentSecurityPolicy } from "../next.config.mjs"

describe("contentSecurityPolicy", () => {
  it("locks the page down instead of only forbidding frames", () => {
    const csp = contentSecurityPolicy("'self'")
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain("connect-src 'self'")
    expect(csp).toContain("form-action 'self'")
    expect(csp).toContain("object-src 'none'")
    expect(csp).toContain("frame-ancestors 'self'")
    expect(csp).not.toMatch(/script-src[^;]*https:/)
  })

  it("opens framing only for embed widgets, leaving the rest of the policy", () => {
    const embed = contentSecurityPolicy("*")
    expect(embed).toContain("frame-ancestors *")
    expect(embed).toContain("default-src 'self'")
    expect(embed).toContain("connect-src 'self'")
  })
})

describe("next.config headers", () => {
  it("does not advertise Next.js on every response", () => {
    expect(nextConfig.poweredByHeader).toBe(false)
  })

  it("applies the full policy site-wide and a framing exception under /embed", async () => {
    const rows = await nextConfig.headers()
    const site = rows.find((r) => r.source === "/:path*")
    const embed = rows.find((r) => r.source === "/embed/:path*")
    const siteCsp = site?.headers.find((h) => h.key === "Content-Security-Policy")?.value
    const embedCsp = embed?.headers.find((h) => h.key === "Content-Security-Policy")?.value
    expect(siteCsp).toBe(contentSecurityPolicy("'self'"))
    expect(embedCsp).toBe(contentSecurityPolicy("*"))
  })
})
