import { describe, it, expect } from "vitest"
import { isPrivateIp, isBlockedHost, isPublicGitUrl } from "@/lib/url-guard"

describe("isPrivateIp (IPv4)", () => {
  it("flags loopback / private / link-local / CGNAT / reserved ranges", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "192.168.0.10",
      "172.16.0.1",
      "172.31.255.255",
      "169.254.169.254", // cloud metadata
      "100.64.0.1", // CGNAT
      "0.0.0.0",
      "224.0.0.1", // multicast
      "255.255.255.255",
    ]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it("treats real public addresses as public", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "140.82.121.3", "172.15.0.1", "172.32.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})

describe("isPrivateIp (IPv6)", () => {
  it("flags loopback / link-local / unique-local / multicast / mapped-private", () => {
    for (const ip of ["::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1", "::ffff:127.0.0.1"]) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })

  it("treats public IPv6 (incl. mapped-public) as public", () => {
    for (const ip of ["2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
})

describe("isBlockedHost", () => {
  it("blocks localhost, internal TLDs, bare single-label names and private IP literals", () => {
    for (const h of ["localhost", "foo.local", "svc.internal", "db.lan", "intranet", "127.0.0.1", "192.168.1.1", "[::1]"]) {
      expect(isBlockedHost(h), h).toBe(true)
    }
  })

  it("allows public FQDNs and public IP literals", () => {
    for (const h of ["github.com", "gitlab.com", "example.co.uk", "8.8.8.8"]) {
      expect(isBlockedHost(h), h).toBe(false)
    }
  })
})

describe("isPublicGitUrl", () => {
  const resolvesTo = (ips: string[]) => async () => ips

  it("accepts an https URL that resolves to a public address", async () => {
    expect(await isPublicGitUrl("https://github.com/a/b.git", resolvesTo(["140.82.121.3"]))).toEqual({ ok: true })
  })

  it("rejects non-http(s) schemes", async () => {
    const r = await isPublicGitUrl("ftp://github.com/a/b", resolvesTo(["140.82.121.3"]))
    expect(r.ok).toBe(false)
  })

  it("rejects an SSH-style spec that isn't a valid URL", async () => {
    const r = await isPublicGitUrl("git@github.com:a/b.git", resolvesTo(["1.2.3.4"]))
    expect(r.ok).toBe(false)
  })

  it("rejects loopback / metadata IP literals without resolving", async () => {
    let called = false
    const spy = async () => {
      called = true
      return ["8.8.8.8"]
    }
    expect((await isPublicGitUrl("http://169.254.169.254/latest/meta-data/", spy)).ok).toBe(false)
    expect((await isPublicGitUrl("http://127.0.0.1:6379/", spy)).ok).toBe(false)
    expect(called).toBe(false)
  })

  it("rejects localhost and internal hostnames", async () => {
    expect((await isPublicGitUrl("http://localhost/x", resolvesTo(["1.2.3.4"]))).ok).toBe(false)
    expect((await isPublicGitUrl("http://gitserver.internal/x", resolvesTo(["1.2.3.4"]))).ok).toBe(false)
  })

  it("rejects a public-looking name that resolves into private space (rebinding)", async () => {
    const r = await isPublicGitUrl("https://evil.example.com/a", resolvesTo(["10.0.0.5"]))
    expect(r.ok).toBe(false)
    expect(r.reason).toMatch(/private/)
  })

  it("rejects when ANY resolved address is private", async () => {
    expect((await isPublicGitUrl("https://x.example.com/a", resolvesTo(["1.2.3.4", "192.168.0.1"]))).ok).toBe(false)
  })

  it("rejects when the host does not resolve", async () => {
    const throwing = async () => {
      throw new Error("ENOTFOUND")
    }
    expect((await isPublicGitUrl("https://nope.example.com/a", throwing)).ok).toBe(false)
    expect((await isPublicGitUrl("https://empty.example.com/a", resolvesTo([]))).ok).toBe(false)
  })
})
