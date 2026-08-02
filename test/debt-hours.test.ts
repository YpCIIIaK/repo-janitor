import { describe, it, expect } from "vitest"
import { estimateDebtHours, formatDebtHours } from "@/lib/debt-hours"

describe("debt hours", () => {
  it("sums severity hours", () => {
    expect(
      estimateDebtHours([
        { severity: "critical" },
        { severity: "warning" },
        { severity: "info" },
      ]),
    ).toBe(4 + 1.5 + 0.25)
  })

  it("formats for overview", () => {
    expect(formatDebtHours(0)).toBe("0h")
    expect(formatDebtHours(0.25)).toMatch(/m$/)
    expect(formatDebtHours(3)).toBe("3h")
    expect(formatDebtHours(20)).toMatch(/d$/)
  })
})
