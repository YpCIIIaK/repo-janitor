import { describe, expect, it } from "vitest"
import { PROOF_REPOS } from "@/lib/proof-repos"
import snapshot from "@/lib/proof-snapshot.json"
import { computeScore, issuesFromCounts, scoreToGrade } from "@/lib/score"

/** Snapshot older than this is treated as silently-wrong marketing copy. */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000

describe("proof snapshot", () => {
  it("covers every proof repo", () => {
    const ids = new Set(snapshot.repos.map((r) => `${r.owner}/${r.name}`.toLowerCase()))
    for (const p of PROOF_REPOS) {
      expect(ids.has(`${p.owner}/${p.name}`.toLowerCase())).toBe(true)
    }
    expect(snapshot.repos).toHaveLength(PROOF_REPOS.length)
  })

  it("has valid grades and scores", () => {
    for (const r of snapshot.repos) {
      expect(["A", "B", "C", "D", "F"]).toContain(r.grade)
      expect(r.score).toBeGreaterThanOrEqual(0)
      expect(r.score).toBeLessThanOrEqual(100)
      expect(scoreToGrade(r.score)).toBe(r.grade)
    }
  })

  it("is not older than 30 days", () => {
    const at = Date.parse(snapshot.updatedAt)
    expect(Number.isFinite(at)).toBe(true)
    const age = Date.now() - at
    expect(age).toBeGreaterThanOrEqual(0)
    expect(
      age,
      `proof-snapshot.json is ${Math.floor(age / 86_400_000)}d old — run pnpm proof:refresh`,
    ).toBeLessThanOrEqual(MAX_AGE_MS)
  })
})

describe("issuesFromCounts", () => {
  it("matches the landing grade example arithmetic", () => {
    const issues = issuesFromCounts({ critical: 3, warning: 5 })
    expect(issues).toHaveLength(8)
    const score = computeScore(issues)
    expect(score).toBeLessThan(100)
    expect(scoreToGrade(score)).toMatch(/^[A-F]$/)
  })
})
