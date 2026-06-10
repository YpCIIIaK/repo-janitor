import { describe, it, expect } from "vitest"
import { searchIssues } from "@/lib/issue-search"
import { issue } from "./helpers"

// Explicit multi-char locations: the default "src/a.ts:10" tokenizes to a bare
// "a", which a short query like "aws" would match by prefix and skew the tests.
const issues = [
  issue({ id: "s1", category: "security", title: "AWS access key committed", detail: "rotate it", location: "config.ts:3" }),
  issue({ id: "d1", category: "dependency", title: "lodash is outdated", detail: "upgrade", location: "deps.ts:1" }),
  issue({ id: "t1", category: "todo", title: "TODO: refactor", detail: "tech debt", location: "core.ts:9" }),
  issue({ id: "h1", category: "hygiene", title: "No README", detail: "add docs", location: "readme.ts:1" }),
]

describe("searchIssues", () => {
  it("returns the list unchanged for an empty query", () => {
    expect(searchIssues(issues, "")).toEqual(issues)
    expect(searchIssues(issues, "   ")).toEqual(issues)
  })

  it("matches direct substrings in any field", () => {
    const r = searchIssues(issues, "lodash")
    expect(r.map((i) => i.id)).toEqual(["d1"])
  })

  it("expands synonyms (credential → secret)", () => {
    const r = searchIssues(issues, "credential")
    expect(r.some((i) => i.id === "s1")).toBe(true)
  })

  it("expands synonyms (package → dependency)", () => {
    const r = searchIssues(issues, "package")
    expect(r.some((i) => i.id === "d1")).toBe(true)
  })

  it("tolerates a small typo (single-edit distance)", () => {
    const r = searchIssues(issues, "lodish") // one substitution: a→i
    expect(r.some((i) => i.id === "d1")).toBe(true)
  })

  it("uses AND semantics across terms", () => {
    expect(searchIssues(issues, "aws key").map((i) => i.id)).toEqual(["s1"])
    expect(searchIssues(issues, "aws lodash")).toEqual([]) // no single issue has both
  })

  it("returns nothing when no issue matches", () => {
    expect(searchIssues(issues, "kubernetes")).toEqual([])
  })
})
