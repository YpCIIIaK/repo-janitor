import { describe, expect, it } from "vitest"
import { detectChecklist, summarizeActivity } from "../src/profile"

describe("detectChecklist", () => {
  it("finds community files and ignores nested lookalikes", () => {
    const c = detectChecklist([
      "README.md",
      "LICENSE",
      ".github/workflows/ci.yml",
      "src/a.test.ts",
      ".gitignore",
      "vendor/x/SECURITY.md",
    ])
    expect(c).toMatchObject({ readme: true, license: true, ci: true, tests: true, gitignore: true, security: false, contributing: false })
  })
})

describe("summarizeActivity", () => {
  it("buckets the last 12 months and counts core authors", () => {
    const now = Date.UTC(2026, 9, 15)
    const commits = [
      ...Array.from({ length: 8 }, () => ({ author: "a", at: Date.UTC(2026, 9, 1) })),
      { author: "b", at: Date.UTC(2026, 3, 1) },
      { author: "c", at: Date.UTC(2026, 3, 2) },
      { author: "d", at: Date.UTC(2024, 0, 1) },
    ]
    const s = summarizeActivity(commits, Date.UTC(2026, 9, 1), now)
    expect(s.months).toHaveLength(12)
    expect(s.months[11]).toEqual({ month: "2026-10", commits: 8 })
    expect(s.commitsLastYear).toBe(10)
    expect(s.authors).toBe(3)
    expect(s.coreAuthors).toBe(1)
  })
})
