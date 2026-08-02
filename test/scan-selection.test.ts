import { describe, it, expect } from "vitest"
import {
  ALL_SCAN_IDS,
  onlyForRequest,
  sanitizeScannerIds,
  TOTAL_CHECKS,
} from "@/lib/scan-selection"

describe("scan-selection", () => {
  it("matches the landing-page check count", () => {
    expect(ALL_SCAN_IDS.length).toBe(TOTAL_CHECKS)
  })

  it("drops unknown ids", () => {
    expect(sanitizeScannerIds(["secrets", "nope", "secrets"])).toEqual(["secrets"])
  })

  it("omits only when the full set is selected", () => {
    expect(onlyForRequest([...ALL_SCAN_IDS])).toBeNull()
    expect(onlyForRequest(["secrets"])).toEqual(["secrets"])
  })
})
