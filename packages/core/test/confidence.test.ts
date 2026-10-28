import { describe, it, expect } from "vitest"
import { computeScore, confidenceOf, runScan } from "../src/index"
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
