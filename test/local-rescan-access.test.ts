import { afterEach, describe, expect, it } from "vitest"
import { localRescanEnabled, localRescanRequest } from "@/lib/local-rescan-access"

const original = process.env.REPO_JANITOR_LOCAL_RESCAN
afterEach(() => {
  if (original === undefined) delete process.env.REPO_JANITOR_LOCAL_RESCAN
  else process.env.REPO_JANITOR_LOCAL_RESCAN = original
})
const request = (host: string, origin = `http://${host}`) => new Request(`http://${host}/api/local-rescan`, {
  method: "POST", headers: { host, origin, "content-type": "application/json", "x-repo-janitor-local": "1" },
})

describe("local rescan access", () => {
  it("is disabled even on loopback without explicit local mode", () => {
    delete process.env.REPO_JANITOR_LOCAL_RESCAN
    expect(localRescanRequest(request("127.0.0.1:3100"), true)).toBe(false)
  })
  it("accepts local IPv4, IPv6 and localhost with same-origin JSON controls", () => {
    process.env.REPO_JANITOR_LOCAL_RESCAN = "1"
    for (const host of ["localhost:3100", "127.0.0.1:3100", "[::1]:3100"]) {
      expect(localRescanRequest(request(host), true)).toBe(true)
    }
  })
  it("handles Next's internal localhost URL while retaining the browser Host boundary", () => {
    process.env.REPO_JANITOR_LOCAL_RESCAN = "1"
    const req = new Request("http://localhost:3100/api/local-rescan", { method: "POST", headers: {
      host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100", "content-type": "application/json", "x-repo-janitor-local": "1",
    } })
    expect(localRescanRequest(req, true)).toBe(true)
    req.headers.set("origin", "http://localhost:3100")
    expect(localRescanRequest(req, true)).toBe(false)
  })
  it("rejects public hosts, rebinding names and cross-origin controls", () => {
    process.env.REPO_JANITOR_LOCAL_RESCAN = "1"
    for (const host of ["example.com", "localhost.evil.test", "127.0.0.1.evil.test", "0.0.0.0:3100"]) {
      expect(localRescanEnabled(new Headers({ host }))).toBe(false)
    }
    expect(localRescanRequest(request("localhost:3100", "https://evil.test"), true)).toBe(false)
    expect(localRescanRequest(new Request("http://localhost:3100/api/local-rescan", { headers: { host: "localhost:3100" } }), true)).toBe(false)
    const form = request("localhost:3100")
    form.headers.set("content-type", "text/plain")
    expect(localRescanRequest(form, true)).toBe(false)
  })
})
