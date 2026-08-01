import { describe, it, expect } from "vitest"
import {
  matchesScanner,
  presentScanners,
  presentScannersInCategory,
  resolveScanner,
  scannerLabel,
} from "@/lib/scanners"
import { issue } from "./helpers"

describe("scannerLabel", () => {
  it("uses friendly names for known scanners", () => {
    expect(scannerLabel("ci-health")).toBe("CI Health")
    expect(scannerLabel("license-risk")).toBe("License Risk")
    expect(scannerLabel("docs-drift")).toBe("Docs Drift")
    expect(scannerLabel("eol-runtime")).toBe("EOL Runtime")
  })

  it("title-cases an unknown hyphenated id", () => {
    expect(scannerLabel("new-check")).toBe("New Check")
  })
})

describe("resolveScanner", () => {
  it("prefers the stamped field", () => {
    expect(
      resolveScanner(issue({ id: "secret-1", scanner: "ci-health", category: "hygiene" })),
    ).toBe("ci-health")
  })

  it("falls back to a legacy id prefix", () => {
    expect(resolveScanner(issue({ id: "secret-abc", category: "security" }))).toBe("secrets")
    expect(resolveScanner(issue({ id: "deadlink-1", category: "hygiene" }))).toBe("dead-links")
    expect(resolveScanner(issue({ id: "ci-health-workflow", category: "hygiene" }))).toBe(
      "ci-health",
    )
  })

  it("returns null when nothing can be inferred", () => {
    expect(resolveScanner(issue({ id: "mystery-1", category: "hygiene" }))).toBeNull()
  })
})

describe("matchesScanner / presentScanners", () => {
  const list = [
    issue({ id: "a", scanner: "ci-health", category: "hygiene" }),
    issue({ id: "b", scanner: "ci-health", category: "hygiene" }),
    issue({ id: "c", scanner: "license-risk", category: "dependency" }),
    issue({ id: "d", scanner: "docs-drift", category: "hygiene" }),
    issue({ id: "mystery-x", category: "hygiene" }),
  ]

  it("matches by resolved scanner", () => {
    expect(matchesScanner(list[0], "ci-health")).toBe(true)
    expect(matchesScanner(list[0], "docs-drift")).toBe(false)
  })

  it("lists present scanners with counts, sorted by label", () => {
    const present = presentScanners(list)
    expect(present.map((p) => p.id)).toEqual(["ci-health", "docs-drift", "license-risk"])
    expect(present.find((p) => p.id === "ci-health")?.count).toBe(2)
  })

  it("narrows the Select options to a category", () => {
    const hygiene = presentScannersInCategory(list, "hygiene")
    expect(hygiene.map((p) => p.id).sort()).toEqual(["ci-health", "docs-drift"])
    expect(presentScannersInCategory(list, "dependency").map((p) => p.id)).toEqual([
      "license-risk",
    ])
  })
})
