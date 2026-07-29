import { describe, it, expect } from "vitest"
import {
  compactCount,
  isValidRepoRef,
  looksLikeQuery,
  parseRepoRef,
  projectRepo,
} from "@/lib/github-repo"

describe("parseRepoRef", () => {
  it.each([
    ["https://github.com/acme/widget", "acme", "widget"],
    ["https://github.com/acme/widget.git", "acme", "widget"],
    ["https://www.github.com/acme/widget/", "acme", "widget"],
    ["http://github.com/acme/widget/tree/main/src", "acme", "widget"],
    ["git@github.com:acme/widget.git", "acme", "widget"],
    ["acme/widget", "acme", "widget"],
    ["  acme/widget  ", "acme", "widget"],
  ])("reads %s", (input, owner, name) => {
    expect(parseRepoRef(input)).toEqual({ owner, name })
  })

  it("refuses other hosts", () => {
    // The card is filled from GitHub's API. A gitlab.com URL is a perfectly good
    // remote, but showing GitHub's acme/widget for it would describe a different
    // project entirely.
    expect(parseRepoRef("https://gitlab.com/acme/widget")).toBeNull()
    expect(parseRepoRef("https://github.com.evil.test/acme/widget")).toBeNull()
    expect(parseRepoRef("git@gitlab.com:acme/widget.git")).toBeNull()
  })

  it("refuses names GitHub could not have", () => {
    expect(parseRepoRef("https://github.com/acme")).toBeNull()
    expect(parseRepoRef("../../etc/passwd")).toBeNull()
    expect(parseRepoRef("https://github.com/-bad/widget")).toBeNull()
    expect(parseRepoRef("acme/wid get")).toBeNull()
    expect(parseRepoRef("")).toBeNull()
  })

  it("keeps dots inside a name but strips only the .git suffix", () => {
    expect(parseRepoRef("acme/widget.js")).toEqual({ owner: "acme", name: "widget.js" })
    expect(parseRepoRef("acme/widget.js.git")).toEqual({ owner: "acme", name: "widget.js" })
  })
})

describe("isValidRepoRef", () => {
  it("rejects an owner longer than GitHub allows", () => {
    expect(isValidRepoRef("a".repeat(40), "widget")).toBe(false)
    expect(isValidRepoRef("a".repeat(39), "widget")).toBe(true)
  })
})

describe("looksLikeQuery", () => {
  it("treats free text as a search", () => {
    expect(looksLikeQuery("anti rot scanner")).toBe(true)
  })

  it("does not search for something that is already an address", () => {
    expect(looksLikeQuery("acme/widget")).toBe(false)
    expect(looksLikeQuery("https://github.com/acme/widget")).toBe(false)
  })

  it("does not search for a URL it failed to parse", () => {
    // A half-typed or non-GitHub URL is a broken address, not a query. Searching
    // GitHub for "https://gitlab.com/..." returns noise.
    expect(looksLikeQuery("https://gitlab.com/acme/widget")).toBe(false)
  })

  it("ignores text too short to mean anything", () => {
    expect(looksLikeQuery("a")).toBe(false)
  })
})

const apiRepo = (over: Record<string, unknown> = {}) => ({
  name: "widget",
  full_name: "acme/widget",
  owner: { login: "acme", avatar_url: "https://avatars.example/acme.png", id: 42 },
  description: "A widget",
  html_url: "https://github.com/acme/widget",
  clone_url: "https://github.com/acme/widget.git",
  default_branch: "main",
  stargazers_count: 1234,
  forks_count: 56,
  open_issues_count: 7,
  language: "TypeScript",
  license: { spdx_id: "MIT" },
  topics: ["cli", "scanner"],
  pushed_at: "2026-07-01T00:00:00Z",
  created_at: "2020-01-01T00:00:00Z",
  archived: false,
  fork: false,
  private: false,
  size: 900,
  ...over,
})

describe("projectRepo", () => {
  it("keeps the fields the card shows", () => {
    const r = projectRepo(apiRepo())!
    expect(r).toMatchObject({
      owner: "acme",
      name: "widget",
      fullName: "acme/widget",
      stars: 1234,
      language: "TypeScript",
      license: "MIT",
      defaultBranch: "main",
    })
  })

  it("drops everything else GitHub sends", () => {
    // A pass-through would ship a hundred fields nobody renders, and would widen
    // silently every time GitHub adds one.
    const json = JSON.stringify(projectRepo(apiRepo({ node_id: "MDEwOlJl", ssh_url: "git@…" })))
    expect(json).not.toContain("node_id")
    expect(json).not.toContain("ssh_url")
    // Including the avatar URL: the card draws initials rather than making every
    // visitor's browser fetch an image from githubusercontent.com.
    expect(json).not.toContain("avatars.example")
  })

  it("treats NOASSERTION as no licence", () => {
    // GitHub says that when it cannot identify a LICENSE file. Rendering it as a
    // licence name would be worse than rendering nothing.
    expect(projectRepo(apiRepo({ license: { spdx_id: "NOASSERTION" } }))?.license).toBeNull()
    expect(projectRepo(apiRepo({ license: null }))?.license).toBeNull()
  })

  it("returns null for a payload that is not a repository", () => {
    expect(projectRepo({ message: "Not Found" })).toBeNull()
    expect(projectRepo(null)).toBeNull()
  })

  it("survives missing optional fields", () => {
    const r = projectRepo({ name: "w", full_name: "a/w", owner: { login: "a" } })!
    expect(r.stars).toBe(0)
    expect(r.language).toBeNull()
    expect(r.topics).toEqual([])
    expect(r.htmlUrl).toBe("https://github.com/a/w")
  })

  it("caps topics so one repository cannot fill the card", () => {
    const many = Array.from({ length: 30 }, (_, i) => `t${i}`)
    expect(projectRepo(apiRepo({ topics: many }))?.topics).toHaveLength(8)
  })
})

describe("compactCount", () => {
  it.each([
    [0, "0"],
    [999, "999"],
    [1000, "1k"],
    [1234, "1.2k"],
    [12_345, "12k"],
    [1_234_567, "1.2M"],
  ])("%i → %s", (n, expected) => {
    expect(compactCount(n)).toBe(expected)
  })
})
