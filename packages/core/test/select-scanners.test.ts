import { describe, it, expect } from "vitest"
import {
  ALL_SCANNER_IDS,
  parseOnlyOption,
  selectScanners,
} from "../src/select-scanners"
import { defaultScanners } from "../src/engine"

describe("parseOnlyOption", () => {
  it("returns null for empty input", () => {
    expect(parseOnlyOption(undefined)).toBeNull()
    expect(parseOnlyOption("")).toBeNull()
    expect(parseOnlyOption("  ,  ")).toBeNull()
  })

  it("splits and trims ids", () => {
    expect(parseOnlyOption("secrets, vulnerable-deps")).toEqual([
      "secrets",
      "vulnerable-deps",
    ])
  })
})

describe("selectScanners", () => {
  it("returns the full registry when only is omitted", () => {
    expect(selectScanners(null).scanners).toBe(defaultScanners)
    expect(selectScanners([]).scanners).toEqual(defaultScanners)
  })

  it("filters to known ids and reports unknowns", () => {
    const { scanners, unknown } = selectScanners(["secrets", "nope", "ci-health"])
    expect(scanners.map((s) => s.id)).toEqual(["secrets", "ci-health"])
    expect(unknown).toEqual(["nope"])
  })

  it("lists every default scanner id", () => {
    expect(ALL_SCANNER_IDS.length).toBe(defaultScanners.length)
    expect(new Set(ALL_SCANNER_IDS).size).toBe(ALL_SCANNER_IDS.length)
  })
})
