import { describe, it, expect } from "vitest"
import { inMode, filterMode, modeScanners } from "@/lib/issue-modes"
import { issue } from "./helpers"

describe("issue modes", () => {
  it("routes a finding by the scanner the engine stamped on it", () => {
    expect(inMode(issue({ scanner: "insecure-code" }), "security")).toBe(true)
    expect(inMode(issue({ scanner: "dead-links" }), "links")).toBe(true)
    expect(inMode(issue({ scanner: "dead-links" }), "security")).toBe(false)
  })

  it("collects every scanner that belongs to a mode", () => {
    const issues = [
      issue({ id: "a", scanner: "secrets" }),
      issue({ id: "b", scanner: "vulnerable-deps" }),
      issue({ id: "c", scanner: "insecure-code" }),
      issue({ id: "d", scanner: "todo-debt" }),
    ]
    expect(filterMode(issues, "security").map((i) => i.id)).toEqual(["a", "b", "c"])
  })

  it("groups internal and external link rot together", () => {
    const issues = [
      issue({ id: "a", scanner: "dead-links" }),
      issue({ id: "b", scanner: "broken-doc-links" }),
      issue({ id: "c", scanner: "repo-bloat" }),
    ]
    expect(filterMode(issues, "links").map((i) => i.id)).toEqual(["a", "b"])
  })

  /**
   * Reports stored in a browser before the `scanner` field shipped must still
   * populate these views, or upgrading the app silently empties them.
   */
  it("falls back to the id prefix for reports with no scanner field", () => {
    expect(inMode(issue({ id: "insecure-eval-dynamic-src/a.ts:1" }), "security")).toBe(true)
    expect(inMode(issue({ id: "vuln-lodash-GHSA-x" }), "security")).toBe(true)
    expect(inMode(issue({ id: "deadlink-404-https://x" }), "links")).toBe(true)
    expect(inMode(issue({ id: "doclink-README.md:1:x" }), "links")).toBe(true)
    expect(inMode(issue({ id: "todo-src/a.ts:4" }), "security")).toBe(false)
  })

  it("prefers the stamped scanner over the id when both are present", () => {
    // An id that looks like one mode but was produced by another scanner must
    // follow the scanner: the field is authoritative, the prefix is a guess.
    const odd = issue({ id: "deadlink-whatever", scanner: "insecure-code" })
    expect(inMode(odd, "security")).toBe(true)
    expect(inMode(odd, "links")).toBe(false)
  })

  it("names the scanners behind each mode", () => {
    expect(modeScanners("links")).toEqual(["dead-links", "broken-doc-links"])
  })
})
