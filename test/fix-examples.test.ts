import { describe, expect, it } from "vitest"
import { FIX_EXAMPLES, fixExampleFor } from "@/lib/fix-examples"
import { ruleLabel } from "@/packages/core/src/rules"

describe("fix examples", () => {
  it("every key is a real rule", () => {
    for (const rule of Object.keys(FIX_EXAMPLES)) expect(ruleLabel(rule), rule).not.toBeNull()
  })
  it("every entry is bilingual and the snippets differ", () => {
    for (const [rule, f] of Object.entries(FIX_EXAMPLES)) {
      expect(f.how.en && f.how.ru, rule).toBeTruthy()
      if (f.before && f.after) expect(f.before, rule).not.toBe(f.after)
    }
  })
  it("returns null for unknown rules", () => {
    expect(fixExampleFor("nope")).toBeNull()
    expect(fixExampleFor(undefined)).toBeNull()
  })
})
