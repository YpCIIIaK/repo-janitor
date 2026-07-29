import { describe, it, expect } from "vitest"
import { parseRepoRef } from "@/lib/github-repo"

/**
 * The selection list's one piece of logic worth pinning down: what a typed
 * string becomes before it enters the list.
 *
 * Mirrors `toCloneUrl` in components/repo-anti-rot/repo-picker.tsx. That module
 * is a client component and cannot be imported here (the test environment is
 * Node, with no JSX runtime), so the rule is restated and asserted — the point
 * being that the normalisation is what makes "already in the list" work at all.
 */
function toCloneUrl(raw: string): string | null {
  const text = raw.trim()
  const ref = parseRepoRef(text)
  if (ref) return `https://github.com/${ref.owner}/${ref.name}.git`
  return /^https?:\/\//i.test(text) ? text : null
}

describe("toCloneUrl", () => {
  it("collapses every way of writing one repository to a single URL", () => {
    // This is what stops the same repository being scanned three times because
    // it was typed three ways — each clone is minutes of work.
    const forms = [
      "https://github.com/acme/widget",
      "https://github.com/acme/widget.git",
      "https://www.github.com/acme/widget/",
      "git@github.com:acme/widget.git",
      "acme/widget",
      "  acme/widget  ",
    ]
    const urls = new Set(forms.map(toCloneUrl))
    expect(urls).toEqual(new Set(["https://github.com/acme/widget.git"]))
  })

  it("keeps a non-GitHub remote as typed", () => {
    // We cannot describe it, but it is still scannable, so it must survive.
    expect(toCloneUrl("https://gitlab.com/acme/widget.git")).toBe(
      "https://gitlab.com/acme/widget.git",
    )
  })

  it("refuses anything that is not an address", () => {
    // A search query must never become a list entry — that was the old bug,
    // where "repo rot scanner" counted as a URL and was handed to git.
    expect(toCloneUrl("repo rot scanner")).toBeNull()
    expect(toCloneUrl("")).toBeNull()
    expect(toCloneUrl("ftp://example.test/x.git")).toBeNull()
  })

  it("does not treat a deep GitHub link as a different repository", () => {
    expect(toCloneUrl("https://github.com/acme/widget/blob/main/README.md")).toBe(
      "https://github.com/acme/widget.git",
    )
  })
})
