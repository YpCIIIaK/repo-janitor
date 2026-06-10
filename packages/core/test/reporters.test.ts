import { describe, it, expect } from "vitest"
import {
  renderSarif,
  renderMarkdown,
  renderJson,
  renderReport,
  normalizeFormat,
  type ScanReport,
  type Issue,
} from "../src/index"

function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "id-1",
    category: "hygiene",
    severity: "warning",
    title: "Something",
    location: "src/a.ts:10",
    ageDays: 3,
    detail: "Because reasons.",
    ...over,
  }
}

function report(issues: Issue[]): ScanReport {
  return {
    schemaVersion: 1,
    repo: { owner: "acme", name: "widget", defaultBranch: "main" },
    generatedAt: "2026-01-01T00:00:00.000Z",
    score: 80,
    grade: "B",
    issues,
  }
}

describe("normalizeFormat", () => {
  it.each([
    ["json", "json"],
    ["markdown", "md"],
    ["md", "md"],
    ["text", "terminal"],
    ["sarif", "sarif"],
    ["nonsense", "terminal"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeFormat(input)).toBe(expected)
  })
})

describe("renderJson", () => {
  it("round-trips the report unchanged", () => {
    const r = report([issue()])
    expect(JSON.parse(renderJson(r))).toEqual(r)
  })
})

describe("renderMarkdown", () => {
  it("includes score, grade and a severity breakdown", () => {
    const md = renderMarkdown(report([issue({ severity: "critical" })]))
    expect(md).toContain("acme/widget")
    expect(md).toContain("80/100")
    expect(md).toContain("1 critical")
  })

  it("escapes pipe characters in cells so the table is not broken", () => {
    const md = renderMarkdown(report([issue({ title: "a | b" })]))
    expect(md).toContain("a \\| b")
  })

  it("shows a clean-repo message when there are no issues", () => {
    expect(renderMarkdown(report([]))).toContain("No issues found")
  })
})

describe("renderSarif", () => {
  it("emits SARIF 2.1.0 with the correct schema and version", () => {
    const sarif = JSON.parse(renderSarif(report([issue()])))
    expect(sarif.version).toBe("2.1.0")
    expect(sarif.$schema).toContain("sarif-2.1.0")
    expect(sarif.runs[0].tool.driver.name).toBe("repo-anti-rot")
  })

  it("maps severities to SARIF levels", () => {
    const sarif = JSON.parse(
      renderSarif(
        report([
          issue({ id: "c", category: "security", severity: "critical", location: "a.ts:1" }),
          issue({ id: "w", category: "hygiene", severity: "warning", location: "b.ts:2" }),
          issue({ id: "i", category: "todo", severity: "info", location: "c.ts:3" }),
        ]),
      ),
    )
    const byRule: Record<string, string> = {}
    for (const res of sarif.runs[0].results) byRule[res.ruleId] = res.level
    expect(byRule.security).toBe("error")
    expect(byRule.hygiene).toBe("warning")
    expect(byRule.todo).toBe("note")
  })

  it("creates one rule per distinct category", () => {
    const sarif = JSON.parse(
      renderSarif(
        report([
          issue({ id: "a", category: "security", location: "a.ts:1" }),
          issue({ id: "b", category: "security", location: "b.ts:1" }),
          issue({ id: "c", category: "todo", location: "c.ts:1" }),
        ]),
      ),
    )
    const ruleIds = sarif.runs[0].tool.driver.rules.map((r: { id: string }) => r.id)
    expect(ruleIds).toEqual(["security", "todo"])
  })

  it("attaches a physicalLocation with startLine for file-anchored findings", () => {
    const sarif = JSON.parse(renderSarif(report([issue({ location: "src/a.ts:42" })])))
    const loc = sarif.runs[0].results[0].locations[0].physicalLocation
    expect(loc.artifactLocation.uri).toBe("src/a.ts")
    expect(loc.region.startLine).toBe(42)
  })

  it("omits the location for branch findings (origin/<branch> is not a file)", () => {
    const sarif = JSON.parse(
      renderSarif(report([issue({ category: "branch", location: "origin/old-feature" })])),
    )
    expect(sarif.runs[0].results[0].locations).toBeUndefined()
  })

  it("normalizes backslash paths to forward slashes", () => {
    const sarif = JSON.parse(renderSarif(report([issue({ location: "src\\win\\a.ts:5" })])))
    expect(sarif.runs[0].results[0].locations[0].physicalLocation.artifactLocation.uri).toBe(
      "src/win/a.ts",
    )
  })

  it("includes a stable partialFingerprint per finding for cross-run tracking", () => {
    const sarif = JSON.parse(renderSarif(report([issue({ id: "stable-123" })])))
    expect(sarif.runs[0].results[0].partialFingerprints.antiRotId).toBe("stable-123")
  })

  it("keeps redacted evidence in the message", () => {
    const sarif = JSON.parse(
      renderSarif(report([issue({ category: "security", evidence: "key = AKIA••••" })])),
    )
    expect(sarif.runs[0].results[0].message.text).toContain("AKIA••••")
  })
})

describe("renderReport dispatch", () => {
  it("routes to the right reporter and falls back to terminal", () => {
    const r = report([issue()])
    expect(renderReport(r, "json")).toBe(renderJson(r))
    expect(renderReport(r, "md")).toBe(renderMarkdown(r))
    expect(renderReport(r, "sarif")).toBe(renderSarif(r))
    // unknown → terminal (just assert it returns a non-empty string)
    expect(renderReport(r, "???").length).toBeGreaterThan(0)
  })
})
