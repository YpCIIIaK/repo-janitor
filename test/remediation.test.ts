import { describe, expect, it } from "vitest"
import { remediationPlan } from "@/lib/remediation"
import type { Issue } from "@/lib/mock-data"
const issue = (id: string, severity: Issue["severity"], extra: Partial<Issue> = {}): Issue => ({ id, severity, category: "security", title: id, location: "a.ts:1", detail: "", ageDays: 0, ...extra })

describe("remediation plan", () => {
  it("prioritizes critical findings and gives credential rotation advice", () => {
    const plan = remediationPlan([issue("old-note", "info", { ageDays: 100 }), issue("key", "critical", { scanner: "secrets" })])
    expect(plan[0].issue.id).toBe("key")
    expect(plan[0].action).toContain("Revoke or rotate")
    expect(plan[0].verify).toContain("old credential")
  })
  it("uses the report's weights for projected score gains", () => {
    expect(remediationPlan([issue("key", "critical")], { critical: 5, warning: 1, info: 0 })[0].scoreGain).toBe(5)
  })
  it("returns no invented work for a clean report", () => {
    expect(remediationPlan([])).toEqual([])
  })
})
