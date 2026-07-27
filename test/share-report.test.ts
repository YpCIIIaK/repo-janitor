import { describe, it, expect } from "vitest"
import {
  FORBIDDEN_SHARED_FIELDS,
  SHARED_ISSUE_LIMIT,
  assertShareable,
  toSharedReport,
} from "@/lib/share-report"
import type { ScanReport } from "@/lib/server-store"
import type { Issue } from "@/lib/mock-data"

const SECRET = "AKIAIOSFODNN7EXAMPLE"
const PATH = "src/server/internal/billing-secrets.ts"

const issue = (over: Partial<Issue> = {}): Issue => ({
  id: "secret-aws-key",
  category: "security",
  severity: "critical",
  title: "AWS access key committed",
  location: `${PATH}:42`,
  ageDays: 51,
  detail: `Key ${SECRET} found in ${PATH}`,
  evidence: `const key = "${SECRET}"`,
  ...over,
})

const report = (issues: Issue[]): ScanReport => ({
  schemaVersion: 1,
  repo: { owner: "acme", name: "widget", defaultBranch: "main" },
  generatedAt: "2026-07-27T10:00:00.000Z",
  score: 41,
  grade: "D",
  issues,
})

describe("toSharedReport", () => {
  /**
   * The one that matters. The consent checkbox promises that code snippets,
   * secret values, paths and line contents are never written; this asserts it
   * against the serialized bytes rather than trusting the shape of the object.
   */
  it("leaks no evidence, detail, path or secret value into the payload", () => {
    const json = JSON.stringify(toSharedReport(report([issue()])))

    expect(json).not.toContain(SECRET)
    expect(json).not.toContain(PATH)
    expect(json).not.toContain("const key =")
    expect(json).not.toContain("billing-secrets")
    // The title is stored, and the consent text says so.
    expect(json).toContain("AWS access key committed")
  })

  it("drops an AI note, which is free-form text over the same source", () => {
    const json = JSON.stringify(
      toSharedReport(report([issue({ aiNote: `rotate the key in ${PATH}` })])),
    )
    expect(json).not.toContain("rotate the key")
  })

  it("carries the grade, score and repo identity", () => {
    const shared = toSharedReport(report([issue()]))
    expect(shared.repo).toEqual({ owner: "acme", name: "widget" })
    expect(shared.score).toBe(41)
    expect(shared.grade).toBe("D")
    expect(shared.generatedAt).toBe("2026-07-27T10:00:00.000Z")
  })

  it("counts by severity and by category", () => {
    const shared = toSharedReport(
      report([
        issue({ id: "a", severity: "critical", category: "security" }),
        issue({ id: "b", severity: "warning", category: "dependency" }),
        issue({ id: "c", severity: "warning", category: "dependency" }),
        issue({ id: "d", severity: "info", category: "dead-code" }),
      ]),
    )
    expect(shared.counts).toEqual({ critical: 1, warning: 2, info: 1 })
    expect(shared.totalIssues).toBe(4)
    expect(shared.byCategory[0]).toEqual({ category: "dependency", count: 2 })
  })

  it("lists the worst findings first and caps the list", () => {
    const many = [
      ...Array.from({ length: 20 }, (_, i) =>
        issue({ id: `info-${i}`, severity: "info", title: `info ${i}` }),
      ),
      issue({ id: "crit", severity: "critical", title: "the critical one" }),
    ]
    const shared = toSharedReport(report(many))

    expect(shared.topIssues).toHaveLength(SHARED_ISSUE_LIMIT)
    expect(shared.topIssues[0].title).toBe("the critical one")
    // Everything else is still counted, just not named.
    expect(shared.totalIssues).toBe(21)
  })

  it("keeps aggregate profile stats but no file paths", () => {
    const withProfile = {
      ...report([issue()]),
      profile: {
        totalFiles: 120,
        languages: [{ language: "TypeScript", files: 90, loc: 8000 }],
        tools: ["Node.js", "Docker"],
      },
    } as ScanReport
    const shared = toSharedReport(withProfile)

    expect(shared.profile?.totalFiles).toBe(120)
    expect(shared.profile?.languages).toEqual([{ language: "TypeScript", loc: 8000 }])
    expect(shared.profile?.tools).toEqual(["Node.js", "Docker"])
  })

  it("handles a clean report", () => {
    const shared = toSharedReport(report([]))
    expect(shared.totalIssues).toBe(0)
    expect(shared.topIssues).toEqual([])
    expect(shared.counts).toEqual({ critical: 0, warning: 0, info: 0 })
  })

  it("produces a payload that passes the storage guard", () => {
    expect(() => assertShareable(toSharedReport(report([issue()])))).not.toThrow()
  })
})

describe("assertShareable", () => {
  it.each(FORBIDDEN_SHARED_FIELDS)("refuses a payload containing %s", (field) => {
    expect(() => assertShareable({ ok: true, [field]: "leak" })).toThrow(/Refusing to share/)
  })

  it("finds a forbidden field nested inside arrays", () => {
    // The realistic regression: someone widens the issue projection and the field
    // reappears one level down, where a shallow check would miss it.
    expect(() =>
      assertShareable({ topIssues: [{ title: "ok" }, { title: "ok", evidence: "leak" }] }),
    ).toThrow(/"evidence" at topIssues\[1\]/)
  })

  it("allows a clean payload", () => {
    expect(() => assertShareable({ score: 72, topIssues: [{ title: "ok" }] })).not.toThrow()
  })
})
