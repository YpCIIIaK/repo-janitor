import { describe, it, expect } from "vitest"
import { deadLinksScanner, isCheckable, extractUrls, commentUrls } from "../../src/index"
import { makeContext } from "../helpers"

/**
 * Every case here comes from running the scanner on this repository, where each
 * one produced a confident, wrong finding.
 */
describe("false positives found by dogfooding", () => {
  it("does not treat a URL template as an address", () => {
    // `https://api.github.com/repos/${owner}` was read as ending in "${owner".
    expect(isCheckable("https://api.github.com/repos/${owner}/${name}")).toBe(false)
    expect(isCheckable("https://registry.npmjs.org/%s")).toBe(false)
  })

  it("strips markdown emphasis glued to a link", () => {
    expect(extractUrls("**https://acme.dev/x**")).toEqual(["https://acme.dev/x"])
  })

  it("reads URLs from comments but not from code", async () => {
    // An API base in a string literal 404s on a bare GET while nothing is broken;
    // a link in a comment is a pointer a human is meant to follow.
    const src = 'const API = "https://api.osv.dev/v1/vulns/"\n// background: https://osv.dev/faq\n'
    expect(commentUrls(src)).toEqual([{ url: "https://osv.dev/faq", line: 2 }])
  })

  it("does not mistake the // in https:// for a comment", () => {
    expect(commentUrls('fetch("https://acme.dev/a")\n')).toEqual([])
    expect(commentUrls('fetch("https://acme.dev/a") // see https://acme.dev/docs\n')).toEqual([
      { url: "https://acme.dev/docs", line: 1 },
    ])
  })

  it("skips test files, whose URLs are fixtures by construction", async () => {
    const ctx = makeContext({
      files: { "test/api.test.ts": "// https://gone.dev/x\n" },
      headUrl: { "https://gone.dev/x": { status: 404 } },
    })
    expect(await deadLinksScanner.run(ctx)).toHaveLength(0)
  })
})

describe("isCheckable", () => {
  it("accepts an ordinary public URL", () => {
    expect(isCheckable("https://nodejs.org/api/fs.html")).toBe(true)
  })

  /**
   * This is the security-relevant case, not a tidiness one. The scanner runs on
   * a server and takes URLs from a repository somebody else wrote; if it followed
   * them blindly it would be a request-forgery gadget aimed at whatever the
   * server can reach that the internet cannot.
   */
  it.each([
    "http://localhost:3000/admin",
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/", // cloud metadata endpoint
    "http://10.0.0.5/internal",
    "http://192.168.1.1/",
    "http://172.16.0.1/",
    "http://db.internal/health",
    "http://box.local/",
  ])("refuses to request %s", (url) => {
    expect(isCheckable(url)).toBe(false)
  })

  it("skips reserved documentation domains and placeholders", () => {
    expect(isCheckable("https://example.com/thing")).toBe(false)
    expect(isCheckable("https://api.example.org/v1")).toBe(false)
    expect(isCheckable("https://github.com/owner/repo")).toBe(false)
    expect(isCheckable("https://github.com/YOUR_ORG/proj")).toBe(false)
    expect(isCheckable("https://{{host}}/api")).toBe(false)
  })

  it("rejects non-http schemes and unparseable input", () => {
    expect(isCheckable("ftp://files.example.net/x")).toBe(false)
    expect(isCheckable("not a url")).toBe(false)
  })
})

describe("extractUrls", () => {
  it("strips punctuation that prose glues to the end", () => {
    expect(extractUrls("See https://nodejs.org/api.html.")).toEqual(["https://nodejs.org/api.html"])
    expect(extractUrls("(https://a.dev/x), next")).toEqual(["https://a.dev/x"])
  })
})

describe("deadLinksScanner", () => {
  it("does nothing at all without a network adapter", async () => {
    // Reporting a link as dead because we could not check it would be worse
    // than saying nothing.
    const ctx = makeContext({ files: { "README.md": "[x](https://gone.dev/page)\n" } })
    expect(await deadLinksScanner.run(ctx)).toHaveLength(0)
  })

  it("flags a 404 and leaves a working link alone", async () => {
    const ctx = makeContext({
      files: { "README.md": "[gone](https://acme.dev/old)\n[ok](https://acme.dev/new)\n" },
      headUrl: { "https://acme.dev/old": { status: 404 } },
    })
    const issues = await deadLinksScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("404")
    expect(issues[0].location).toBe("README.md:1")
  })

  it("distinguishes an unreachable host from a missing page", async () => {
    const ctx = makeContext({
      files: { "README.md": "[x](https://vanished.dev/a)\n" },
      headUrl: { "https://vanished.dev/a": null },
    })
    const issues = await deadLinksScanner.run(ctx)
    expect(issues[0].title).toContain("Unreachable")
    expect(issues[0].detail).toContain("gone rather than moved")
  })

  /**
   * A 403 means the page exists and wants credentials; a 500 means the server is
   * having a bad day. Neither is the repository's bug, and reporting them would
   * make the category untrustworthy.
   */
  it.each([401, 403, 429, 500, 503])("does not report HTTP %i", async (status) => {
    const ctx = makeContext({
      files: { "README.md": "[x](https://acme.dev/a)\n" },
      headUrl: { "https://acme.dev/a": { status } },
    })
    expect(await deadLinksScanner.run(ctx)).toHaveLength(0)
  })

  it("finds links in code comments and package.json, not just markdown", async () => {
    const ctx = makeContext({
      files: {
        "src/a.ts": "// see https://acme.dev/rfc for why\n",
        "package.json": JSON.stringify({ homepage: "https://acme.dev/home" }),
      },
      headUrl: {
        "https://acme.dev/rfc": { status: 404 },
        "https://acme.dev/home": { status: 404 },
      },
    })
    const issues = await deadLinksScanner.run(ctx)
    expect(issues).toHaveLength(2)
    expect(issues.map((i) => i.location).sort()).toEqual(["package.json:1", "src/a.ts:1"])
  })

  it("checks a repeated URL once and reports it once", async () => {
    const requested: string[] = []
    const ctx = makeContext({
      files: {
        "README.md": "[a](https://acme.dev/x)\n",
        "docs/a.md": "[a](https://acme.dev/x)\n",
        "docs/b.md": "[a](https://acme.dev/x)\n",
      },
      headUrl: { "https://acme.dev/x": { status: 404 } },
    })
    const wrapped = { ...ctx, headUrl: async (u: string) => (requested.push(u), ctx.headUrl!(u)) }
    const issues = await deadLinksScanner.run(wrapped)
    expect(requested).toEqual(["https://acme.dev/x"])
    expect(issues).toHaveLength(1)
  })

  it("never requests a private address even when a repo links to one", async () => {
    const requested: string[] = []
    const ctx = makeContext({
      files: { "README.md": "[metadata](http://169.254.169.254/latest/meta-data/)\n" },
      headUrl: {},
    })
    const wrapped = { ...ctx, headUrl: async (u: string) => (requested.push(u), ctx.headUrl!(u)) }
    await deadLinksScanner.run(wrapped)
    expect(requested).toHaveLength(0)
  })

  it("skips vendored directories", async () => {
    const ctx = makeContext({
      files: { "node_modules/x/README.md": "[a](https://acme.dev/x)\n" },
      headUrl: { "https://acme.dev/x": { status: 404 } },
    })
    expect(await deadLinksScanner.run(ctx)).toHaveLength(0)
  })
})
