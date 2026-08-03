import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { ANTI_ROT_REPO, falsePositiveUrl } from "@/lib/false-positive"

/**
 * The false-positive report link.
 *
 * Most of what is worth testing here is not the string-building — it is that the
 * link and the form on the other end still agree. GitHub drops prefill
 * parameters it does not recognise *silently*: rename a field id in the YAML and
 * the form still opens, just empty, and nobody finds out until reports start
 * arriving without a scanner id.
 */

const FORM = readFileSync(
  join(process.cwd(), ".github", "ISSUE_TEMPLATE", "false-positive.yml"),
  "utf8",
)

/** The keys the builder can send, in the order it sets them. */
const PREFILLED = ["scanner", "repo", "finding", "location"] as const

describe("falsePositiveUrl", () => {
  it("reports against this project, not the repository being scanned", () => {
    // The bug is ours. Filing it on the user's own repo would be worse than
    // useless — it would put our defect in a stranger's issue tracker.
    const url = new URL(falsePositiveUrl({ repo: "https://github.com/acme/widget" }))
    expect(`${url.origin}${url.pathname}`).toBe(`${ANTI_ROT_REPO}/issues/new`)
    expect(url.searchParams.get("repo")).toBe("https://github.com/acme/widget")
  })

  it("opens the empty form when there is no context", () => {
    // The landing page's link has nothing to prefill and must still work.
    const url = new URL(falsePositiveUrl())
    expect(url.searchParams.get("template")).toBe("false-positive.yml")
    for (const key of PREFILLED) expect(url.searchParams.has(key)).toBe(false)
  })

  it("carries every field it was given", () => {
    const url = new URL(
      falsePositiveUrl({
        scanner: "duplicate-code",
        repo: "https://github.com/acme/widget",
        finding: "11 lines duplicated between two files",
        location: "src/index.ts:42",
      }),
    )
    expect(url.searchParams.get("scanner")).toBe("duplicate-code")
    expect(url.searchParams.get("finding")).toBe("11 lines duplicated between two files")
    expect(url.searchParams.get("location")).toBe("src/index.ts:42")
  })

  it("omits blank and missing values rather than sending them empty", () => {
    // An empty parameter overrides the form's own placeholder, leaving a field
    // that looks filled in and is not.
    const url = new URL(falsePositiveUrl({ scanner: "  ", repo: null, finding: undefined }))
    for (const key of PREFILLED) expect(url.searchParams.has(key)).toBe(false)
  })

  it("truncates a long value instead of risking the whole link", () => {
    // GitHub drops prefills past a URL length it does not document. One long
    // finding title must not take the scanner id down with it.
    const url = new URL(
      falsePositiveUrl({ scanner: "dead-code", finding: "x".repeat(5000) }),
    )
    expect(url.searchParams.get("scanner")).toBe("dead-code")
    expect(url.searchParams.get("finding")!.length).toBeLessThanOrEqual(400)
    expect(url.searchParams.get("finding")!.endsWith("…")).toBe(true)
  })
})

describe("the issue form on the other end", () => {
  it("defines a field for every key the app prefills", () => {
    for (const key of PREFILLED) {
      expect(FORM, `no field with id: ${key}`).toMatch(new RegExp(`^\\s*id:\\s*${key}\\s*$`, "m"))
    }
  })

  it("applies the label the confirmed-report process keys off", () => {
    expect(FORM).toMatch(/labels:\s*\["false-positive"\]/)
    expect(new URL(falsePositiveUrl()).searchParams.get("labels")).toBe("false-positive")
  })

  it("requires the one field the reporter alone can answer", () => {
    // Scanner id and location come from the app; "why the code is fine" cannot,
    // and a report without it is not actionable.
    const why = FORM.slice(FORM.search(/^\s*id:\s*why\s*$/m))
    expect(why).toMatch(/required:\s*true/)
  })
})
