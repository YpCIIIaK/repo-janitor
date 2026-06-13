import { describe, it, expect } from "vitest"
import { secretsScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("secretsScanner", () => {
  it("flags an AWS access key as critical and redacts the evidence", async () => {
    const key = "AKIA1234567890ABCDEF"
    const ctx = makeContext({ files: { "config.ts": `const k = "${key}"\n` } })
    const issues = await secretsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("critical")
    expect(issues[0].category).toBe("security")
    // The raw secret must NEVER appear in the evidence (redaction invariant).
    expect(issues[0].evidence).toBeDefined()
    expect(issues[0].evidence).not.toContain(key)
    expect(issues[0].evidence).toContain("AKIA") // 4-char prefix kept
    expect(issues[0].evidence).toContain("•")
  })

  it("does not flag canonical documentation example keys (AWS 'EXAMPLE' convention)", async () => {
    const ctx = makeContext({
      files: { "config.ts": `const k = "AKIAIOSFODNN7EXAMPLE"\n` },
    })
    expect(await secretsScanner.run(ctx)).toHaveLength(0)
  })

  it("redacts EVERY occurrence of a token repeated on the same line", async () => {
    const key = "AKIA1234567890ABCDEF"
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
    const key = "AKIA1234567890ABCDEF"
    const ctx = makeContext({ files: { "src/__tests__/auth.test.ts": `const k = "${key}"\n` } })
    const issues = await secretsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("info")
    expect(issues[0].evidence).not.toContain(key)
  })

  it("skips .env.example entirely", async () => {
    const ctx = makeContext({ files: { ".env.example": "AWS_KEY=AKIA1234567890ABCDEF\n" } })
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
        "pnpm-lock.yaml": `key: "AKIA1234567890ABCDEF"\n`,
        "logo.png": `AKIA1234567890ABCDEF`,
      },
    })
    expect(await secretsScanner.run(ctx)).toHaveLength(0)
  })

  it("propagates git blame age to the finding", async () => {
    const key = "AKIA1234567890ABCDEF"
    const ctx = makeContext({
      files: { "config.ts": `const k = "${key}"\n` },
      blameAges: { "config.ts:1": 42 },
    })
    const issues = await secretsScanner.run(ctx)
    expect(issues[0].ageDays).toBe(42)
  })

  // --- git history pass ------------------------------------------------------

  const daysAgoMs = (d: number) => Date.now() - d * 24 * 3600 * 1000

  it("flags a secret that exists only in git history (deleted from the tree)", async () => {
    const key = "AKIA1234567890ABCDEF"
    const ctx = makeContext({
      files: {}, // gone from the working tree
      historyAdditions: [
        { commit: "abc1234", date: daysAgoMs(30), file: "scripts/seed.ts", text: `const k = "${key}"` },
      ],
    })
    const issues = await secretsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("critical")
    expect(issues[0].id).toContain("secret-history-")
    expect(issues[0].location).toBe("scripts/seed.ts @ abc1234")
    expect(issues[0].ageDays).toBeGreaterThanOrEqual(29)
    expect(issues[0].ageDays).toBeLessThanOrEqual(31)
    expect(issues[0].evidence).not.toContain(key) // redaction invariant holds in history too
  })

  it("does NOT double-report a history secret that is still in the working tree", async () => {
    const key = "AKIA1234567890ABCDEF"
    const ctx = makeContext({
      files: { "config.ts": `const k = "${key}"\n` },
      historyAdditions: [
        { commit: "abc1234", date: daysAgoMs(30), file: "config.ts", text: `const k = "${key}"` },
      ],
    })
    const issues = await secretsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].id).not.toContain("history") // the surviving working-tree finding wins
  })

  it("reports a history secret only once even when many commits added it", async () => {
    const key = "AKIA1234567890ABCDEF"
    const ctx = makeContext({
      files: {},
      historyAdditions: [
        { commit: "ccc3333", date: daysAgoMs(5), file: "a.ts", text: `k="${key}"` },
        { commit: "bbb2222", date: daysAgoMs(20), file: "a.ts", text: `k="${key}"` },
        { commit: "aaa1111", date: daysAgoMs(40), file: "a.ts", text: `k="${key}"` },
      ],
    })
    const issues = await secretsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("a.ts @ ccc3333") // newest commit wins (additions newest-first)
  })

  it("downgrades a history secret in a test/example path to info", async () => {
    const key = "AKIA1234567890ABCDEF"
    const ctx = makeContext({
      files: {},
      historyAdditions: [
        { commit: "abc1234", date: daysAgoMs(10), file: "test/fixtures/auth.ts", text: `const k = "${key}"` },
      ],
    })
    const issues = await secretsScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("info")
  })

  it("skips history additions in lockfiles / .env.example", async () => {
    const key = "AKIA1234567890ABCDEF"
    const ctx = makeContext({
      files: {},
      historyAdditions: [
        { commit: "abc1234", date: daysAgoMs(10), file: "pnpm-lock.yaml", text: `key: "${key}"` },
        { commit: "abc1234", date: daysAgoMs(10), file: ".env.example", text: `AWS_KEY=${key}` },
      ],
    })
    expect(await secretsScanner.run(ctx)).toHaveLength(0)
  })

  it("is a no-op for history when no git adapter is wired", async () => {
    // makeContext omits git.historyAdditions unless provided → working-tree only.
    const ctx = makeContext({ files: {} })
    expect(await secretsScanner.run(ctx)).toHaveLength(0)
  })
})
