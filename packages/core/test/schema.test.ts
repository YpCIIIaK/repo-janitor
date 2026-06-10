import { describe, it, expect } from "vitest"
import { issueSchema, categorySchema } from "../src/index"

const baseIssue = {
  id: "x",
  severity: "critical" as const,
  title: "t",
  location: "a.ts:1",
  ageDays: 0,
  detail: "d",
}

describe("issueSchema category back-compat", () => {
  it("migrates the legacy `secret` category to `security` on parse", () => {
    const parsed = issueSchema.parse({ ...baseIssue, category: "secret" })
    expect(parsed.category).toBe("security")
  })

  it("passes through `security` unchanged", () => {
    expect(issueSchema.parse({ ...baseIssue, category: "security" }).category).toBe("security")
  })

  it("still rejects an unknown category", () => {
    expect(() => issueSchema.parse({ ...baseIssue, category: "bogus" })).toThrow()
  })

  it("no longer lists `secret` as a valid raw category value", () => {
    expect(categorySchema.options).not.toContain("secret")
    expect(categorySchema.options).toContain("security")
  })
})
