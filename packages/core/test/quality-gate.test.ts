import { describe, expect, it } from "vitest"
import { evaluateQualityGate } from "../src/quality-gate"
import type { ScanReport, Issue } from "../src/schema"

const finding = (id: string, severity: Issue["severity"]): Issue => ({ id, severity, category: "security", title: id, location: "x.ts:1", ageDays: 0, detail: "test" })
const report = (issues: Issue[], score = 80): ScanReport => ({ schemaVersion: 1, repo: { owner: "a", name: "b", defaultBranch: "main" }, generatedAt: new Date().toISOString(), score, grade: "B", issues })

describe("new-debt quality gate", () => {
  it("never passes an incomplete scan as a successful gate", () => {
    const incomplete = report([])
    incomplete.diagnostics = { completedScanners: [], failedScanners: ["secrets"], history: "available" }
    expect(evaluateQualityGate(incomplete, {}).passed).toBe(false)
  })
  it("accepts existing debt but blocks newly introduced findings at the threshold", () => {
    const old = finding("existing", "critical")
    const baseline = report([old])
    expect(evaluateQualityGate(report([old, finding("new", "info")]), { baseline, failOnNew: "warning" }).passed).toBe(true)
    expect(evaluateQualityGate(report([old, finding("new", "warning")]), { baseline, failOnNew: "warning" }).blocking.map((i) => i.id)).toEqual(["new"])
  })
  it("enforces an independent minimum score", () => {
    expect(evaluateQualityGate(report([], 60), { minScore: 75 }).passed).toBe(false)
  })
  it("refuses a baseline from a different repository", () => {
    const baseline = report([])
    baseline.repo.name = "other"
    expect(() => evaluateQualityGate(report([]), { baseline })).toThrow("different repository")
  })
  it("does not block by default and treats findings as new without a baseline", () => {
    expect(evaluateQualityGate(report([finding("x", "critical")]), {}).passed).toBe(true)
    expect(evaluateQualityGate(report([finding("x", "critical")]), { failOnNew: "critical" }).passed).toBe(false)
  })
})
