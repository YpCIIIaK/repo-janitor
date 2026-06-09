import { describe, it, expect } from "vitest"
import { secretsScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("secretsScanner", () => {
  it("flags an AWS access key as critical and redacts the evidence", async () => {
    const key = "AKIAIOSFODNN7EXAMPLE"
    const ctx = makeContext({ files: { "config.ts": `const k = "${key}"\n` } })
    const issues = await secretsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("critical")
    expect(issues[0].category).toBe("secret")
    // The raw secret must NEVER appear in the evidence (redaction invariant).
    expect(issues[0].evidence).toBeDefined()
    expect(issues[0].evidence).not.toContain(key)
    expect(issues[0].evidence).toContain("AKIA") // 4-char prefix kept
    expect(issues[0].evidence).toContain("•")
  })

  it("redacts EVERY occurrence of a token repeated on the same line", async () => {
    const key = "AKIAIOSFODNN7EXAMPLE"
    const ctx = makeContext({ files: { "config.ts": `const a = "${key}", b = "${key}"\n` } })
    const issues = await secretsScanner.run(ctx)
    expect(issues.length).toBeGreaterThanOrEqual(1)
    // Neither copy of the raw key may survive in the evidence line.
    expect(issues[0].evidence).not.toContain(key)
  })

  it("flags a Stripe live key and a private key header", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": `const s = "sk_live_${"a".repeat(30)}"\n`,
        "key.pem": "-----BEGIN RSA PRIVATE KEY-----\n",
      },
    })
    const issues = await secretsScanner.run(ctx)
    const ids = issues.map((i) => i.id)
    expect(ids.some((id) => id.includes("stripe-secret"))).toBe(true)
    expect(ids.some((id) => id.includes("private-key"))).toBe(true)
  })

  it("downgrades secrets in test/example files to info", async () => {
    const key = "AKIAIOSFODNN7EXAMPLE"
    const ctx = makeContext({ files: { "src/__tests__/auth.test.ts": `const k = "${key}"\n` } })
    const issues = await secretsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("info")
    expect(issues[0].evidence).not.toContain(key)
  })

  it("skips .env.example entirely", async () => {
    const ctx = makeContext({ files: { ".env.example": "AWS_KEY=AKIAIOSFODNN7EXAMPLE\n" } })
    expect(await secretsScanner.run(ctx)).toHaveLength(0)
  })

  it("flags a high-entropy assignment but not a low-entropy placeholder", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": 'const apiKey = "8f3kд".repeat\n', // not a clean match; rely on real one below
        "b.ts": 'const api_key = "Zx9Qw7Vt3Lp1Mn6Bc4Df8Gh2Kj5Yr0"\n', // high entropy
        "c.ts": 'const password = "your-password-here-placeholder"\n', // placeholder
      },
    })
    const issues = await secretsScanner.run(ctx)
    const locations = issues.map((i) => i.location)
    expect(locations.some((l) => l.startsWith("b.ts"))).toBe(true)
    expect(locations.some((l) => l.startsWith("c.ts"))).toBe(false)
  })

  it("does not flag a low-entropy English-word assignment", async () => {
    const ctx = makeContext({
      files: { "a.ts": 'const secret = "aaaaaaaaaaaaaaaaaaaaaaaa"\n' }, // long but zero entropy
    })
    expect(await secretsScanner.run(ctx)).toHaveLength(0)
  })

  it("skips lockfiles and binary assets", async () => {
    const ctx = makeContext({
      files: {
        "pnpm-lock.yaml": `key: "AKIAIOSFODNN7EXAMPLE"\n`,
        "logo.png": `AKIAIOSFODNN7EXAMPLE`,
      },
    })
    expect(await secretsScanner.run(ctx)).toHaveLength(0)
  })

  it("propagates git blame age to the finding", async () => {
    const key = "AKIAIOSFODNN7EXAMPLE"
    const ctx = makeContext({
      files: { "config.ts": `const k = "${key}"\n` },
      blameAges: { "config.ts:1": 42 },
    })
    const issues = await secretsScanner.run(ctx)
    expect(issues[0].ageDays).toBe(42)
  })
})
