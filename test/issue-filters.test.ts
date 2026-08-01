import { describe, it, expect } from "vitest"
import { filterIssues } from "@/lib/issue-filters"
import { issue } from "./helpers"

const list = [
  issue({
    id: "a",
    scanner: "ci-health",
    category: "hygiene",
    severity: "critical",
  }),
  issue({
    id: "b",
    scanner: "docs-drift",
    category: "hygiene",
    severity: "warning",
  }),
  issue({
    id: "c",
    scanner: "license-risk",
    category: "dependency",
    severity: "info",
  }),
  issue({
    id: "d",
    scanner: "ci-health",
    category: "hygiene",
    severity: "info",
  }),
]

describe("filterIssues", () => {
  it("returns everything with default filters", () => {
    expect(filterIssues(list, {}).map((i) => i.id)).toEqual(["a", "b", "c", "d"])
  })

  it("filters by scanner alone — the hygiene umbrella splits apart", () => {
    expect(filterIssues(list, { scanner: "ci-health" }).map((i) => i.id)).toEqual(["a", "d"])
    expect(filterIssues(list, { scanner: "docs-drift" }).map((i) => i.id)).toEqual(["b"])
    expect(filterIssues(list, { scanner: "license-risk" }).map((i) => i.id)).toEqual(["c"])
  })

  it("ANDs scanner with category and severity", () => {
    expect(
      filterIssues(list, {
        category: "hygiene",
        scanner: "ci-health",
        severity: "actionable",
      }).map((i) => i.id),
    ).toEqual(["a"])
  })

  it("keeps changesOnly findings when newIds is provided", () => {
    const newIds = new Set(["b", "c"])
    expect(filterIssues(list, { changesOnly: true, newIds }).map((i) => i.id)).toEqual([
      "b",
      "c",
    ])
  })

  it("matches legacy reports without a scanner stamp via id prefix", () => {
    const legacy = [
      issue({ id: "secret-old", category: "security", severity: "critical" }),
      issue({ id: "deadlink-1", category: "hygiene", severity: "warning" }),
    ]
    expect(filterIssues(legacy, { scanner: "secrets" }).map((i) => i.id)).toEqual(["secret-old"])
    expect(filterIssues(legacy, { scanner: "dead-links" }).map((i) => i.id)).toEqual([
      "deadlink-1",
    ])
  })
})
