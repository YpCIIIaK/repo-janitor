import { describe, it, expect } from "vitest"
import { countSeverity, issueDensity, repoDiff, repoDiffDetail, newIssueIds, repoStats } from "@/lib/reports-store"
import { issue, report, storedRepo } from "./helpers"

describe("countSeverity", () => {
  it("counts issues of a given severity", () => {
    const issues = [issue({ severity: "critical" }), issue({ severity: "warning" }), issue({ severity: "critical" })]
    expect(countSeverity(issues, "critical")).toBe(2)
    expect(countSeverity(issues, "info")).toBe(0)
  })
})

describe("issueDensity", () => {
  it("computes findings per 1000 lines of code", () => {
    const repo = storedRepo({ latest: report([], { metrics: { linesOfCode: 5000 } }) })
    expect(issueDensity(repo, 10)).toEqual({ perKloc: 2, loc: 5000 })
  })

  it("returns null without a usable LOC count", () => {
    expect(issueDensity(storedRepo(), 10)).toBeNull()
    expect(issueDensity(storedRepo({ latest: report([], { metrics: { linesOfCode: 0 } }) }), 10)).toBeNull()
  })
})

describe("repoDiff", () => {
  it("reports no comparison when there is no previous scan", () => {
    expect(repoDiff(storedRepo({ prevIssueIds: undefined }))).toEqual({ added: 0, fixed: 0, hasPrev: false })
  })

  it("counts added and fixed findings by stable id", () => {
    const repo = storedRepo({
      latest: report([issue({ id: "keep" }), issue({ id: "new" })]),
      prevIssueIds: ["keep", "gone"],
    })
    expect(repoDiff(repo)).toEqual({ added: 1, fixed: 1, hasPrev: true })
  })

  it("prefers full prevIssues over the legacy prevIssueIds", () => {
    const repo = storedRepo({
      latest: report([issue({ id: "keep" })]),
      prevIssues: [issue({ id: "keep" }), issue({ id: "gone" })],
      prevIssueIds: ["stale"], // would give a wrong diff if used
    })
    expect(repoDiff(repo)).toEqual({ added: 0, fixed: 1, hasPrev: true })
  })
})

describe("repoDiffDetail", () => {
  it("treats every finding as unchanged when there is no previous scan", () => {
    const latest = report([issue({ id: "a" }), issue({ id: "b" })])
    const detail = repoDiffDetail(storedRepo({ latest, prevIssueIds: undefined }))
    expect(detail.hasPrev).toBe(false)
    expect(detail.added).toEqual([])
    expect(detail.fixed).toEqual([])
    expect(detail.unchanged.map((i) => i.id)).toEqual(["a", "b"])
  })

  it("splits findings into added, unchanged, and fixed", () => {
    const repo = storedRepo({
      latest: report([issue({ id: "keep" }), issue({ id: "new" })]),
      prevIssues: [issue({ id: "keep" }), issue({ id: "gone" })],
    })
    const detail = repoDiffDetail(repo)
    expect(detail.added.map((i) => i.id)).toEqual(["new"])
    expect(detail.unchanged.map((i) => i.id)).toEqual(["keep"])
    expect(detail.fixed.map((i) => i.id)).toEqual(["gone"])
  })

  it("cannot list fixed findings from id-only history", () => {
    const repo = storedRepo({
      latest: report([issue({ id: "keep" })]),
      prevIssueIds: ["keep", "gone"],
    })
    // No prevIssues snapshot → the fixed finding's details are unrecoverable.
    expect(repoDiffDetail(repo).fixed).toEqual([])
  })
})

describe("newIssueIds", () => {
  it("is empty on a first scan", () => {
    expect(newIssueIds(storedRepo({ prevIssueIds: undefined })).size).toBe(0)
  })

  it("returns only findings absent from the previous scan", () => {
    const repo = storedRepo({
      latest: report([issue({ id: "keep" }), issue({ id: "new" })]),
      prevIssueIds: ["keep"],
    })
    expect([...newIssueIds(repo)]).toEqual(["new"])
  })
})

describe("repoStats", () => {
  it("derives the four stat cards from the live issues", () => {
    const repo = storedRepo({
      latest: report([issue({ severity: "critical" }), issue({ category: "branch" })], { score: 70 }),
    })
    const cards = repoStats(repo)
    expect(cards.map((c) => c.label)).toEqual([
      "Health Score",
      "Critical Issues",
      "Open Issues",
      "Stale Branches",
    ])
    expect(cards[0].value).toBe("70")
    expect(cards[1].value).toBe("1") // one critical
    expect(cards[2].value).toBe("2") // two open
    expect(cards[3].value).toBe("1") // one branch finding
  })

  it("computes score delta from history", () => {
    const repo = storedRepo({
      latest: report([], { score: 80 }),
      history: [
        { at: "2026-01-01T00:00:00Z", score: 70, critical: 0, warning: 0, info: 0 },
        { at: "2026-02-01T00:00:00Z", score: 80, critical: 0, warning: 0, info: 0 },
      ],
    })
    const score = repoStats(repo)[0]
    expect(score.delta).toBe(10)
    expect(score.tone).toBe("good")
    expect(score.deltaLabel).toBe("vs last scan")
  })
})
