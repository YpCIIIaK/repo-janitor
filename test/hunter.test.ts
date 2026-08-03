import { describe, it, expect } from "vitest"
import {
  CONFIRMED_LABEL,
  HUNTER_REPO,
  hunterApiUrl,
  hunterBadgeMarkdown,
  hunterQuery,
  hunterSearchUrl,
  isGithubLogin,
} from "@/lib/hunter"

/**
 * The hunter badge counts a number under somebody's name, from a login that
 * arrives in a URL. Most of what matters here is the gate in front of that.
 */

describe("isGithubLogin", () => {
  it("accepts the shapes GitHub actually issues", () => {
    for (const ok of ["octocat", "YpCIIIaK", "a", "a-b", "user-123", "A".repeat(39)]) {
      expect(isGithubLogin(ok), ok).toBe(true)
    }
  })

  it("refuses anything that could widen the search", () => {
    // Each of these, if interpolated, changes which issues get counted — the
    // badge would render a real number belonging to someone else.
    for (const bad of [
      "octocat author:someone",
      "octocat+author:someone",
      'octo"cat',
      "repo:other/repo",
      "octocat ",
      "-octocat",
      "octocat-",
      "octo--cat",
      "octo/cat",
      "A".repeat(40),
      "",
      null,
      42,
    ]) {
      expect(isGithubLogin(bad), String(bad)).toBe(false)
    }
  })
})

describe("hunterQuery", () => {
  it("scopes to this repo, this label, and one author", () => {
    const q = hunterQuery("octocat")
    expect(q).toContain(`repo:${HUNTER_REPO}`)
    expect(q).toContain(`label:"${CONFIRMED_LABEL}"`)
    expect(q).toContain("author:octocat")
    expect(q).toContain("is:issue")
  })

  it("throws rather than building a query from a bad login", () => {
    // A caller that skipped the gate must fail loudly, not quietly search wider.
    expect(() => hunterQuery("octocat author:someone")).toThrow()
  })
})

describe("the published links", () => {
  it("sends the API at github.com and nowhere else", () => {
    expect(new URL(hunterApiUrl("octocat")).origin).toBe("https://api.github.com")
    expect(new URL(hunterSearchUrl("octocat")).origin).toBe("https://github.com")
  })

  it("asks for one result, since only the total is read", () => {
    expect(new URL(hunterApiUrl("octocat")).searchParams.get("per_page")).toBe("1")
  })

  it("carries the query through encoding intact", () => {
    const q = new URL(hunterSearchUrl("octocat")).searchParams.get("q")
    expect(q).toBe(hunterQuery("octocat"))
  })

  it("publishes the badge linked to the search that produced it", () => {
    // The link is the whole verifiability argument. A bare image is a picture
    // with a number on it.
    const md = hunterBadgeMarkdown("octocat", "https://anti-rot.example/")
    expect(md).toBe(
      `[![false positives found](https://anti-rot.example/api/badge/hunter/octocat)](${hunterSearchUrl("octocat")})`,
    )
  })
})
