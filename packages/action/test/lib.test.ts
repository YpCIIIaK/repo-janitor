import { describe, it, expect, beforeEach, afterEach } from "vitest"
import type { ScanReport, Issue } from "@repo-anti-rot/core"
import {
  getInput,
  ingestEndpoint,
  reportsEndpoint,
  shouldFail,
  renderPrComment,
  scanDelta,
  renderDeltaLine,
  COMMENT_MARKER,
} from "../src/lib"

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "id",
    category: "hygiene",
    severity: "warning",
    title: "Something",
    location: "src/a.ts:1",
    ageDays: 0,
    detail: "d",
    ...over,
  }
}

function report(over: Partial<ScanReport> = {}): ScanReport {
  return {
    schemaVersion: 1,
    repo: { owner: "acme", name: "widget", defaultBranch: "main" },
    generatedAt: "2026-01-01T00:00:00.000Z",
    score: 80,
    grade: "B",
    issues: [],
    ...over,
  }
}

describe("getInput", () => {
  const saved = { ...process.env }
  beforeEach(() => {
    for (const k of Object.keys(process.env)) if (k.startsWith("INPUT_")) delete process.env[k]
  })
  afterEach(() => {
    process.env = { ...saved }
  })

  it("reads INPUT_<NAME> and trims whitespace", () => {
    process.env.INPUT_DASHBOARD_URL = "  https://x.com  "
    expect(getInput("dashboard-url")).toBe("https://x.com")
  })

  it("upcases and converts dashes to underscores", () => {
    process.env.INPUT_FAIL_ON = "D"
    expect(getInput("fail-on")).toBe("D")
  })

  it("returns the fallback when unset", () => {
    expect(getInput("missing", "default")).toBe("default")
    expect(getInput("missing")).toBe("")
  })
})

describe("ingestEndpoint", () => {
  it("appends /api/ingest and trims trailing slashes", () => {
    expect(ingestEndpoint("https://x.com")).toBe("https://x.com/api/ingest")
    expect(ingestEndpoint("https://x.com///")).toBe("https://x.com/api/ingest")
  })
})

describe("shouldFail", () => {
  it("fails when grade is at or below the threshold", () => {
    expect(shouldFail(report({ grade: "D" }), "C")).toBe(true) // D ≤ C
    expect(shouldFail(report({ grade: "C" }), "C")).toBe(true) // equal
    expect(shouldFail(report({ grade: "F" }), "D")).toBe(true)
  })

  it("does not fail when grade is above the threshold", () => {
    expect(shouldFail(report({ grade: "A" }), "C")).toBe(false)
    expect(shouldFail(report({ grade: "B" }), "C")).toBe(false)
  })

  it("never fails on 'never' or an invalid threshold", () => {
    expect(shouldFail(report({ grade: "F" }), "never")).toBe(false)
    expect(shouldFail(report({ grade: "F" }), "")).toBe(false)
    expect(shouldFail(report({ grade: "F" }), "garbage")).toBe(false)
  })

  it("is case-insensitive on the threshold", () => {
    expect(shouldFail(report({ grade: "D" }), "d")).toBe(true)
  })
})

describe("renderPrComment", () => {
  it("carries the hidden upsert marker", () => {
    expect(renderPrComment(report(), "")).toContain(COMMENT_MARKER)
  })

  it("shows a clean-scan message when there are no issues", () => {
    expect(renderPrComment(report({ issues: [] }), "")).toContain("No rot detected")
  })

  it("renders a severity breakdown and a findings table", () => {
    const md = renderPrComment(
      report({
        issues: [issue({ severity: "critical" }), issue({ severity: "warning" }), issue({ severity: "info" })],
      }),
      "",
    )
    expect(md).toContain("1 critical · 1 warning · 1 info")
    expect(md).toContain("| Severity | Finding | Location |")
  })

  it("caps the table at 10 rows and notes the remainder", () => {
    const issues = Array.from({ length: 13 }, (_, i) => issue({ id: `i${i}` }))
    const md = renderPrComment(report({ issues }), "")
    expect(md).toContain("…and 3 more.")
  })

  it("escapes pipe characters in titles and locations", () => {
    const md = renderPrComment(report({ issues: [issue({ title: "a | b", location: "x|y" })] }), "")
    expect(md).toContain("a \\| b")
    expect(md).toContain("x\\|y")
  })

  it("adds dashboard links only when a URL is provided", () => {
    expect(renderPrComment(report(), "")).not.toContain("Full report")
    const md = renderPrComment(report(), "https://dash.example.com/")
    expect(md).toContain("[Full report](https://dash.example.com)")
    expect(md).toContain("/api/badge/acme/widget")
  })

  it("omits the delta line when no baseline is given", () => {
    const md = renderPrComment(report(), "")
    expect(md).not.toContain("vs base")
  })

  it("renders a score/finding delta when a baseline is given", () => {
    const md = renderPrComment(
      report({ score: 85, issues: [issue({ id: "keep" }), issue({ id: "new" })] }),
      "",
      { score: 80, issueIds: ["keep", "gone"] },
    )
    expect(md).toContain("score **+5**")
    expect(md).toContain("**1** new")
    expect(md).toContain("**1** fixed")
  })
})

describe("reportsEndpoint", () => {
  it("appends /api/reports and trims trailing slashes", () => {
    expect(reportsEndpoint("https://x.com")).toBe("https://x.com/api/reports")
    expect(reportsEndpoint("https://x.com///")).toBe("https://x.com/api/reports")
  })
})

describe("scanDelta", () => {
  it("computes score delta and added/fixed by stable id", () => {
    const r = report({ score: 90, issues: [issue({ id: "keep" }), issue({ id: "new" })] })
    expect(scanDelta(r, { score: 75, issueIds: ["keep", "gone"] })).toEqual({
      scoreDelta: 15,
      added: 1,
      fixed: 1,
    })
  })
})

describe("renderDeltaLine", () => {
  it("reports no change when nothing moved", () => {
    expect(renderDeltaLine({ scoreDelta: 0, added: 0, fixed: 0 })).toBe("No change vs the base scan.")
  })

  it("shows a negative score delta", () => {
    expect(renderDeltaLine({ scoreDelta: -4, added: 2, fixed: 0 })).toContain("score **-4**")
  })
})
