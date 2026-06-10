import { describe, it, expect } from "vitest"
import { reportToJson, reportToMarkdown, reportToCsv } from "@/lib/report-export"
import { issue, report } from "./helpers"

describe("reportToJson", () => {
  it("round-trips the full report", () => {
    const r = report([issue()])
    expect(JSON.parse(reportToJson(r))).toEqual(r)
  })
})

describe("reportToMarkdown", () => {
  it("includes a header, grade and severity breakdown", () => {
    const md = reportToMarkdown(report([issue({ severity: "critical" })], { grade: "C", score: 65 }))
    expect(md).toContain("acme/widget")
    expect(md).toContain("**Grade:** C (65/100)")
    expect(md).toContain("1 critical")
  })

  it("groups findings under category headings", () => {
    const md = reportToMarkdown(
      report([issue({ category: "security" }), issue({ category: "todo" })]),
    )
    // categoryLabels are used as section titles; both categories appear as "## "
    const headings = md.split("\n").filter((l) => l.startsWith("## "))
    expect(headings).toHaveLength(2)
  })

  it("shows a clean-repo message when empty", () => {
    expect(reportToMarkdown(report([]))).toContain("No issues found")
  })

  it("includes lines-of-code when present", () => {
    const md = reportToMarkdown(report([], { metrics: { linesOfCode: 12345 } }))
    expect(md).toContain("Lines of code")
    expect(md).toContain((12345).toLocaleString()) // locale-agnostic thousands separator
  })
})

describe("reportToCsv", () => {
  it("starts with a UTF-8 BOM and a header row", () => {
    const csv = reportToCsv(report([issue()]))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    const firstLine = csv.slice(1).split("\r\n")[0]
    expect(firstLine).toBe("severity,category,title,location,ageDays,detail,evidence,aiNote")
  })

  it("uses CRLF line endings", () => {
    const csv = reportToCsv(report([issue()]))
    expect(csv).toContain("\r\n")
  })

  it("escapes cells containing commas, quotes or newlines (RFC 4180)", () => {
    const csv = reportToCsv(report([issue({ title: 'a, "b"', detail: "line1\nline2" })]))
    expect(csv).toContain('"a, ""b"""')
    expect(csv).toContain('"line1\nline2"')
  })

  it("emits one data row per finding", () => {
    const csv = reportToCsv(report([issue({ id: "a" }), issue({ id: "b" })]))
    const rows = csv.slice(1).split("\r\n")
    expect(rows).toHaveLength(3) // header + 2 findings
  })
})
