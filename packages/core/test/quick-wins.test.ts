import { describe, it, expect } from "vitest"
import { formatQuickWinsTerminal, quickWins } from "../src/quick-wins"
import type { Issue } from "../src/schema"

const sample: Issue[] = [
  {
    id: "1",
    category: "hygiene",
    severity: "info",
    title: "noise",
    location: "a.ts:1",
    ageDays: 1,
    detail: "d",
  },
  {
    id: "2",
    category: "security",
    severity: "critical",
    title: "secret",
    location: "b.ts:2",
    ageDays: 10,
    detail: "d",
  },
  {
    id: "3",
    category: "dependency",
    severity: "warning",
    title: "dep",
    location: "c.ts:3",
    ageDays: 5,
    detail: "d",
  },
]

describe("quickWins", () => {
  it("ranks critical first and attaches estHours", () => {
    const wins = quickWins(sample, 2)
    expect(wins).toHaveLength(2)
    expect(wins[0].title).toBe("secret")
    expect(wins[0].estHours).toBe(4)
    expect(wins[1].title).toBe("dep")
  })

  it("formats a terminal block", () => {
    const text = formatQuickWinsTerminal(quickWins(sample, 3))
    expect(text).toContain("Quick wins")
    expect(text).toContain("secret")
  })
})
