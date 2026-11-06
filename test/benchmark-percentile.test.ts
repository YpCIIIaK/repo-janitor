import { describe, expect, it } from "vitest"
import { benchmarkPercentile } from "@/lib/benchmark-percentile"

const range = (n: number) => Array.from({ length: n }, (_, i) => i)

describe("benchmarkPercentile", () => {
  const cuts = { all: range(100), "size:m": range(40), "lang:Go|size:m": range(10) }

  it("uses the narrowest cut with enough samples", () => {
    const hit = benchmarkPercentile(30, { language: "Go", size: "m" }, cuts)
    expect(hit).toMatchObject({ basis: "size", sample: 40, betterThan: 75, source: "benchmark" })
  })

  it("falls back to everything", () => {
    expect(benchmarkPercentile(50, { language: "Zig" }, cuts)).toMatchObject({ basis: "all", betterThan: 50 })
  })

  it("is silent without data", () => {
    expect(benchmarkPercentile(50, {}, {})).toBeNull()
  })

  it("ships a real distribution", () => {
    expect(benchmarkPercentile(70)?.sample).toBeGreaterThan(1000)
  })
})
