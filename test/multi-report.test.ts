import { describe, it, expect } from "vitest"
import { summariseBatch, batchToMarkdown } from "@/lib/multi-report"
import type { ScanReport } from "@/lib/reports-store"
import type { Issue } from "@/lib/mock-data"

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: "todo-1",
  category: "todo",
  severity: "info",
  title: "TODO older than a year",
  location: "src/a.ts:1",
  ageDays: 400,
  detail: "d",
  ...over,
})

const report = (
  owner: string,
  name: string,
  score: number,
  grade: string,
  issues: Issue[],
): ScanReport =>
  ({
    schemaVersion: 1,
    repo: { owner, name, defaultBranch: "main" },
    generatedAt: "2026-07-29T00:00:00.000Z",
    score,
    grade,
    issues,
  }) as ScanReport

const ok = (url: string, r: ScanReport) => ({ url, ok: true, report: r })

describe("summariseBatch", () => {
  it("orders repositories worst first", () => {
    // The order you would fix them in. A batch printed in submission order makes
    // the reader sort it themselves.
    const summary = summariseBatch([
      ok("a", report("acme", "good", 91, "A", [])),
      ok("b", report("acme", "bad", 34, "F", [issue({ severity: "critical" })])),
      ok("c", report("acme", "middling", 68, "C", [issue()])),
    ])
    expect(summary.repos.map((r) => r.name)).toEqual(["bad", "middling", "good"])
  })

  it("breaks a score tie on criticals, not on scan order", () => {
    const summary = summariseBatch([
      ok("a", report("acme", "quiet", 60, "D", [issue()])),
      ok("b", report("acme", "loud", 60, "D", [issue({ severity: "critical" })])),
    ])
    expect(summary.repos[0].name).toBe("loud")
  })

  it("finds what repeats across repositories", () => {
    // The whole point of scanning several at once: one repository missing CI is
    // a mistake, three is a missing rule somewhere upstream.
    const missing = issue({ id: "hygiene-ci", category: "hygiene", severity: "warning", title: "No CI configuration" })
    const summary = summariseBatch([
      ok("a", report("acme", "one", 70, "C", [missing, issue()])),
      ok("b", report("acme", "two", 60, "D", [{ ...missing, id: "hygiene-ci-2" }])),
      ok("c", report("acme", "three", 50, "F", [{ ...missing, location: "elsewhere" }])),
    ])
    expect(summary.shared).toHaveLength(1)
    expect(summary.shared[0]).toMatchObject({
      title: "No CI configuration",
      severity: "warning",
      repos: ["acme/one", "acme/three", "acme/two"],
    })
  })

  it("does not call a finding shared when only one repository has it twice", () => {
    // "3 of 4 repositories" has to mean repositories, not rows.
    const summary = summariseBatch([
      ok("a", report("acme", "one", 70, "C", [issue(), issue({ id: "todo-2", location: "src/b.ts:9" })])),
      ok("b", report("acme", "two", 80, "B", [])),
    ])
    expect(summary.shared).toEqual([])
  })

  it("ranks shared findings by how many repositories carry them", () => {
    const everywhere = issue({ category: "hygiene", title: "No CI configuration", severity: "warning" })
    const twice = issue({ category: "dependency", title: "lodash is outdated", severity: "warning" })
    const summary = summariseBatch([
      ok("a", report("acme", "one", 70, "C", [everywhere, twice])),
      ok("b", report("acme", "two", 70, "C", [everywhere, twice])),
      ok("c", report("acme", "three", 70, "C", [everywhere])),
    ])
    expect(summary.shared.map((s) => s.repos.length)).toEqual([3, 2])
  })

  it("reports a shared finding at its worst severity anywhere", () => {
    const base = issue({ category: "security", title: "Hard-coded credential" })
    const summary = summariseBatch([
      ok("a", report("acme", "one", 70, "C", [{ ...base, severity: "warning" }])),
      ok("b", report("acme", "two", 40, "F", [{ ...base, severity: "critical" }])),
    ])
    expect(summary.shared[0].severity).toBe("critical")
  })

  it("totals findings and averages the score", () => {
    const summary = summariseBatch([
      ok("a", report("acme", "one", 80, "B", [issue({ severity: "critical" }), issue()])),
      ok("b", report("acme", "two", 60, "D", [issue({ severity: "warning" })])),
    ])
    expect(summary.totalFindings).toBe(3)
    expect(summary.counts).toEqual({ critical: 1, warning: 1, info: 1 })
    expect(summary.averageScore).toBe(70)
  })

  it("keeps failures out of the numbers but not out of the report", () => {
    // A repository that would not clone must not quietly raise the average.
    const summary = summariseBatch([
      ok("a", report("acme", "one", 40, "F", [issue()])),
      { url: "https://example.test/gone.git", ok: false, error: "git clone failed" },
    ])
    expect(summary.repos).toHaveLength(1)
    expect(summary.averageScore).toBe(40)
    expect(summary.failures).toEqual([
      { url: "https://example.test/gone.git", error: "git clone failed" },
    ])
  })

  it("names the category behind each repository's findings", () => {
    const summary = summariseBatch([
      ok(
        "a",
        report("acme", "one", 50, "F", [
          issue({ category: "dependency" }),
          issue({ category: "dependency", id: "d2" }),
          issue({ category: "todo" }),
        ]),
      ),
    ])
    expect(summary.repos[0].topCategory).toBe("dependency")
  })

  it("lists grades worst first", () => {
    const summary = summariseBatch([
      ok("a", report("acme", "one", 91, "A", [])),
      ok("b", report("acme", "two", 40, "F", [])),
      ok("c", report("acme", "three", 45, "F", [])),
    ])
    expect(summary.gradeSpread).toEqual([
      { grade: "F", count: 2 },
      { grade: "A", count: 1 },
    ])
  })

  it("handles an empty batch", () => {
    const summary = summariseBatch([])
    expect(summary).toMatchObject({ repos: [], failures: [], totalFindings: 0, averageScore: 0 })
  })
})

describe("batchToMarkdown", () => {
  it("keeps the worst-first order and names the shared findings", () => {
    const shared = issue({ category: "hygiene", title: "No CI configuration", severity: "warning" })
    const md = batchToMarkdown(
      summariseBatch([
        ok("a", report("acme", "good", 90, "A", [shared])),
        ok("b", report("acme", "bad", 30, "F", [shared])),
      ]),
      new Date("2026-07-29T00:00:00.000Z"),
    )
    expect(md.indexOf("acme/bad")).toBeLessThan(md.indexOf("acme/good"))
    expect(md).toContain("No CI configuration")
    expect(md).toContain("2 repositories")
  })

  it("omits the shared section when nothing repeats", () => {
    const md = batchToMarkdown(summariseBatch([ok("a", report("acme", "one", 90, "A", [issue()]))]))
    expect(md).not.toContain("Present in more than one repository")
  })
})
