import { describe, it, expect } from "vitest"
import { githubBase, githubFileUrl } from "@/lib/github-link"

describe("githubBase", () => {
  it("normalizes an https URL (with and without .git)", () => {
    expect(githubBase("https://github.com/acme/widget.git")).toBe("https://github.com/acme/widget")
    expect(githubBase("https://github.com/acme/widget")).toBe("https://github.com/acme/widget")
    expect(githubBase("https://www.github.com/acme/widget")).toBe("https://github.com/acme/widget")
  })

  it("normalizes an SSH (git@) URL", () => {
    expect(githubBase("git@github.com:acme/widget.git")).toBe("https://github.com/acme/widget")
  })

  it("returns null for undefined or non-GitHub URLs", () => {
    expect(githubBase(undefined)).toBeNull()
    expect(githubBase("https://gitlab.com/a/b")).toBeNull()
  })
})

describe("githubFileUrl", () => {
  const url = "https://github.com/acme/widget"

  it("builds a frozen permalink at the commit SHA with a line anchor", () => {
    expect(githubFileUrl(url, "abc123", "main", "src/a.ts:42")).toBe(
      "https://github.com/acme/widget/blob/abc123/src/a.ts#L42",
    )
  })

  it("falls back to the default branch when there is no commit", () => {
    expect(githubFileUrl(url, undefined, "develop", "src/a.ts")).toBe(
      "https://github.com/acme/widget/blob/develop/src/a.ts",
    )
  })

  it("falls back to HEAD when neither commit nor branch is given", () => {
    expect(githubFileUrl(url, undefined, undefined, "a.ts")).toBe(
      "https://github.com/acme/widget/blob/HEAD/a.ts",
    )
  })

  it("strips a trailing ' @ <sha>' suffix from the location", () => {
    expect(githubFileUrl(url, "abc", "main", "src/a.ts:10 @ deadbeef")).toBe(
      "https://github.com/acme/widget/blob/abc/src/a.ts#L10",
    )
  })

  it("returns null for branch refs, globs, or unlinkable repos", () => {
    expect(githubFileUrl(url, "abc", "main", "origin/feature")).toBeNull()
    expect(githubFileUrl(url, "abc", "main", "src/**")).toBeNull()
    expect(githubFileUrl("https://gitlab.com/a/b", "abc", "main", "a.ts:1")).toBeNull()
  })
})
