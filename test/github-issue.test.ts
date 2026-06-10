import { describe, it, expect } from "vitest"
import { buildIssueDraft, githubNewIssueUrl } from "@/lib/github-issue"
import type { Issue } from "@/lib/mock-data"

const baseIssue: Issue = {
  id: "i1",
  category: "security",
  severity: "critical",
  title: "Stripe key committed in history",
  location: "scripts/seed.ts @ 7b2c1a9",
  ageDays: 1,
  detail: "Matched a live restricted key.",
}

describe("buildIssueDraft", () => {
  it("uses the finding title and a labelled severity/category header", () => {
    const draft = buildIssueDraft(baseIssue)
    expect(draft.title).toBe("Stripe key committed in history")
    expect(draft.body).toContain("**Severity:** Critical · **Category:** Security")
    expect(draft.body).toContain("Matched a live restricted key.")
    expect(draft.body).toContain("**Location:** `scripts/seed.ts @ 7b2c1a9`")
    expect(draft.body).toContain("**Age:** 1 day")
    expect(draft.body).toContain("_Filed from Repo Anti-Rot._")
  })

  it("includes evidence as a fenced block when present", () => {
    const draft = buildIssueDraft({ ...baseIssue, evidence: "rk_live_REDACTED" })
    expect(draft.body).toContain("```\nrk_live_REDACTED\n```")
  })

  it("omits the evidence block when there is none", () => {
    const draft = buildIssueDraft(baseIssue)
    expect(draft.body).not.toContain("```")
  })

  it("embeds the permalink when given", () => {
    const draft = buildIssueDraft(baseIssue, "https://github.com/acme/widget/blob/abc/scripts/seed.ts")
    expect(draft.body).toContain("[View on GitHub](https://github.com/acme/widget/blob/abc/scripts/seed.ts)")
  })

  it("pluralizes age correctly", () => {
    expect(buildIssueDraft({ ...baseIssue, ageDays: 5 }).body).toContain("**Age:** 5 days")
  })

  it("carries repo-anti-rot and severity labels", () => {
    expect(buildIssueDraft(baseIssue).labels).toEqual(["repo-anti-rot", "critical"])
  })

  it("truncates an oversized body", () => {
    const draft = buildIssueDraft({ ...baseIssue, detail: "x".repeat(10000) })
    expect(draft.body.length).toBeLessThanOrEqual(6000)
    expect(draft.body.endsWith("…")).toBe(true)
  })
})

describe("githubNewIssueUrl", () => {
  it("builds a prefilled new-issue URL with encoded title, body and labels", () => {
    const url = githubNewIssueUrl("https://github.com/acme/widget", baseIssue)
    expect(url).not.toBeNull()
    const parsed = new URL(url!)
    expect(parsed.origin + parsed.pathname).toBe("https://github.com/acme/widget/issues/new")
    expect(parsed.searchParams.get("title")).toBe("Stripe key committed in history")
    expect(parsed.searchParams.get("labels")).toBe("repo-anti-rot,critical")
    expect(parsed.searchParams.get("body")).toContain("Matched a live restricted key.")
  })

  it("normalizes SSH and .git remotes", () => {
    const url = githubNewIssueUrl("git@github.com:acme/widget.git", baseIssue)
    expect(url?.startsWith("https://github.com/acme/widget/issues/new?")).toBe(true)
  })

  it("returns null for non-GitHub or missing URLs", () => {
    expect(githubNewIssueUrl(undefined, baseIssue)).toBeNull()
    expect(githubNewIssueUrl("https://gitlab.com/a/b", baseIssue)).toBeNull()
  })
})
