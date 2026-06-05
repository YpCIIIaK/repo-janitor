import { describe, it, expect } from "vitest"
import { formatAge, fullAge, issueAsMarkdown, severityStyle } from "@/lib/issue-format"
import { issue } from "./helpers"

describe("formatAge", () => {
  it("uses days under a month", () => {
    expect(formatAge(0)).toBe("0d")
    expect(formatAge(29)).toBe("29d")
  })

  it("uses months from 30 days, years from 365", () => {
    expect(formatAge(30)).toBe("1mo")
    expect(formatAge(89)).toBe("2mo")
    expect(formatAge(365)).toBe("1y")
    expect(formatAge(900)).toBe("2y")
  })
})

describe("fullAge", () => {
  it("pluralizes each unit correctly", () => {
    expect(fullAge(1)).toBe("1 day old")
    expect(fullAge(2)).toBe("2 days old")
    expect(fullAge(30)).toBe("1 month old")
    expect(fullAge(60)).toBe("2 months old")
    expect(fullAge(365)).toBe("1 year old")
    expect(fullAge(730)).toBe("2 years old")
  })
})

describe("severityStyle", () => {
  it("has a chip style for every severity", () => {
    expect(Object.keys(severityStyle).sort()).toEqual(["critical", "info", "warning"])
  })
})

describe("issueAsMarkdown", () => {
  it("renders the core fields as a bullet block", () => {
    const md = issueAsMarkdown(
      issue({ severity: "critical", title: "Leaked key", location: "src/x.ts:4", ageDays: 400, detail: "rotate" }),
    )
    expect(md).toContain("**[Critical] Leaked key**")
    expect(md).toContain("Location: `src/x.ts:4`")
    expect(md).toContain("Age: 1 year old")
    expect(md).toContain("rotate")
  })

  it("inlines short evidence but fences multi-line evidence", () => {
    expect(issueAsMarkdown(issue({ evidence: "API_KEY=***" }))).toContain("`API_KEY=***`")
    const fenced = issueAsMarkdown(issue({ evidence: "line1\nline2" }))
    expect(fenced).toContain("```\nline1\nline2\n```")
  })

  it("omits evidence and AI note when absent", () => {
    const md = issueAsMarkdown(issue())
    expect(md).not.toContain("```")
    expect(md).not.toContain("🤖")
  })

  it("appends the AI note when present", () => {
    expect(issueAsMarkdown(issue({ aiNote: "Rotate now." }))).toContain("🤖 AI: Rotate now.")
  })
})
