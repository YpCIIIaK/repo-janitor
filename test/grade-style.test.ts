import { describe, expect, it } from "vitest"
import {
  GRADE_BADGE_CLASS,
  GRADE_CSS_VAR,
  GRADE_HEX,
  GRADE_LABEL,
  gradeBadgeClass,
  gradeCssVar,
  gradeHex,
} from "@/lib/grade-style"
import type { Grade } from "@/lib/mock-data"

const GRADES: Grade[] = ["A", "B", "C", "D", "F"]

describe("grade-style", () => {
  it("gives every grade its own hex, CSS var and badge class", () => {
    const hex = new Set(GRADES.map((g) => GRADE_HEX[g]))
    const vars = new Set(GRADES.map((g) => GRADE_CSS_VAR[g]))
    const badges = new Set(GRADES.map((g) => GRADE_BADGE_CLASS[g]))
    expect(hex.size).toBe(5)
    expect(vars.size).toBe(5)
    expect(badges.size).toBe(5)
  })

  it("keeps B distinct from C (the old dashboard collapse)", () => {
    expect(GRADE_HEX.B).not.toBe(GRADE_HEX.C)
    expect(GRADE_CSS_VAR.B).not.toBe(GRADE_CSS_VAR.C)
    expect(GRADE_BADGE_CLASS.B).not.toBe(GRADE_BADGE_CLASS.C)
  })

  it("labels the full scale", () => {
    expect(GRADE_LABEL.A).toBe("Pristine")
    expect(GRADE_LABEL.F).toMatch(/Critical/i)
  })

  it("falls back safely for unknown grades", () => {
    expect(gradeHex("Z")).toBe("#8b949e")
    expect(gradeCssVar(null)).toBe("var(--muted-foreground)")
    expect(gradeBadgeClass(undefined)).toBe(GRADE_BADGE_CLASS.F)
  })
})
