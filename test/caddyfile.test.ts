import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const caddy = readFileSync(new URL("../deploy/Caddyfile", import.meta.url), "utf8")

describe("deploy/Caddyfile", () => {
  it("pins HSTS to subdomains as well as the apex", () => {
    expect(caddy).toMatch(/Strict-Transport-Security "max-age=31536000; includeSubDomains"/)
  })

  it("does not advertise the reverse-proxy or the app framework", () => {
    expect(caddy).toContain("-Server")
    expect(caddy).toContain("-X-Powered-By")
  })
})
