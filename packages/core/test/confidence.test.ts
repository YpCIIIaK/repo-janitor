import { describe, it, expect } from "vitest"
import { computeScore, confidenceOf, runScan, sizeFactor, DEFAULT_WEIGHTS } from "../src/index"
import type { Scanner } from "../src/scanner"
import { makeContext } from "./helpers"

describe("confidence", () => {
  it("is medium for rules the benchmark has not measured", () => {
    expect(confidenceOf("no-such-rule")).toBe("medium")
  })

  it("keeps low-confidence findings out of issues and the score", async () => {
    const scanner: Scanner = {
      id: "fake",
      category: "hygiene",
      run: async () => [
        { id: "a", category: "hygiene", severity: "warning", title: "a", location: "x", ageDays: 0, detail: "", rule: "r-low", confidence: "low" },
        { id: "b", category: "hygiene", severity: "warning", title: "b", location: "x", ageDays: 0, detail: "", rule: "r-high", confidence: "high" },
      ],
    }
    const report = await runScan(makeContext({ files: {} }), [scanner])
    expect(report.issues.map((i) => i.id)).toEqual(["b"])
    expect(report.lowConfidence?.map((i) => i.id)).toEqual(["a"])
    expect(report.score).toBe(computeScore(report.issues))
  })
})

describe("size-adjusted score", () => {
  const warn = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `w${i}`, category: "hygiene" as const, severity: "warning" as const, title: "", location: "x", ageDays: 0, detail: "" }))

  it("leaves repos up to 20k lines untouched", () => {
    expect(sizeFactor(5_000)).toBe(1)
    expect(sizeFactor(20_000)).toBe(1)
    expect(sizeFactor(undefined)).toBe(1)
  })

  it("discounts warnings by sqrt(20k / LOC) for big codebases", () => {
    expect(sizeFactor(80_000)).toBe(0.5)
    expect(computeScore(warn(20), { ...DEFAULT_WEIGHTS, sizeFactor: 0.5 })).toBeGreaterThan(computeScore(warn(20)))
  })

  it("never discounts critical findings", () => {
    const crit = [{ ...warn(1)[0], severity: "critical" as const }]
    expect(computeScore(crit, { ...DEFAULT_WEIGHTS, sizeFactor: 0.2 })).toBe(computeScore(crit))
  })
})
