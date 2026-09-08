import { describe, it, expect } from "vitest"
import { computeScore as clientScore, DEFAULT_WEIGHTS as CLIENT_WEIGHTS } from "@/lib/score"
import {
  computeScore as engineScore,
  SEVERITY_CURVE,
  tierPenalty,
} from "../packages/core/src/engine"
import { DEFAULT_WEIGHTS as ENGINE_WEIGHTS } from "../packages/core/src/config"
import { SEVERITY_CURVE as CLIENT_CURVE, tierPenalty as clientTier } from "@/lib/score"
import type { Issue, Severity } from "@/lib/mock-data"

/**
 * The two scoring implementations must agree.
 *
 * `lib/score.ts` is a client-side mirror of `packages/core/src/engine.ts`: the
 * browser recomputes the score when findings are snoozed, so it needs the same
 * arithmetic the scanner used. Until this file existed the two were kept in step
 * by a comment asking the next person to remember, and nothing failed if they
 * did not — the grade in the badge and the grade on the page would simply have
 * disagreed, quietly, for whoever hit the case that differed.
 */

let n = 0
const issue = (severity: Severity): Issue =>
  ({ id: `i${n++}`, severity, category: "hygiene", title: "t", location: "a.ts:1", ageDays: 1, detail: "d" }) as Issue

const make = (c: { critical?: number; warning?: number; info?: number }): Issue[] => [
  ...Array.from({ length: c.critical ?? 0 }, () => issue("critical")),
  ...Array.from({ length: c.warning ?? 0 }, () => issue("warning")),
  ...Array.from({ length: c.info ?? 0 }, () => issue("info")),
]

describe("client mirror agrees with the engine", () => {
  it("uses the same weights and the same curve", () => {
    expect(CLIENT_WEIGHTS).toEqual(ENGINE_WEIGHTS)
    expect(CLIENT_CURVE).toEqual(SEVERITY_CURVE)
  })

  it("produces the same tier penalty across the whole range", () => {
    for (const sev of ["critical", "warning", "info"] as const) {
      for (const count of [0, 1, 2, 7, 8, 9, 20, 21, 50, 200, 1000]) {
        expect(clientTier(count, ENGINE_WEIGHTS[sev], CLIENT_CURVE[sev])).toBeCloseTo(
          tierPenalty(count, ENGINE_WEIGHTS[sev], SEVERITY_CURVE[sev]),
          10,
        )
      }
    }
  })

  it("produces the same score for mixed reports", () => {
    const shapes = [
      {},
      { info: 3 },
      { info: 100_000 },
      { critical: 1, warning: 1, info: 100_000 },
      { warning: 2, info: 12 },
      { critical: 1, warning: 4, info: 20 },
      { critical: 7, warning: 17, info: 25 }, // psf/requests
      { critical: 6, warning: 62, info: 37 }, // clap-rs/clap
      { critical: 40, warning: 300, info: 800 },
    ]
    for (const shape of shapes) {
      const issues = make(shape)
      expect(clientScore(issues)).toBe(engineScore(issues))
    }
  })
})

describe("the curve behaves as claimed", () => {
  it("keeps uncapped warning and critical penalties increasing", () => {
    // Significant findings continue to increase their tier penalty.
    for (const sev of ["critical", "warning"] as const) {
      const w = ENGINE_WEIGHTS[sev]
      const curve = SEVERITY_CURVE[sev]
      for (const k of [50, 200, 1000, 10_000]) {
        const marginal = tierPenalty(k, w, curve) - tierPenalty(k - 1, w, curve)
        expect(marginal).toBeGreaterThan(0)
      }
    }
  })

  it("charges each additional finding less than the one before it", () => {
    for (const sev of ["critical", "warning", "info"] as const) {
      const w = ENGINE_WEIGHTS[sev]
      const curve = SEVERITY_CURVE[sev]
      const step = (k: number) => tierPenalty(k, w, curve) - tierPenalty(k - 1, w, curve)
      for (const k of [curve.full + 2, curve.full + 10, 100, 500]) {
        expect(step(k)).toBeLessThan(step(k - 1))
      }
    }
  })

  it("charges full weight up to the threshold, so ordinary repos are unaffected", () => {
    for (const sev of ["critical", "warning", "info"] as const) {
      const w = ENGINE_WEIGHTS[sev]
      const curve = SEVERITY_CURVE[sev]
      for (let k = 1; k <= curve.full; k++) {
        expect(tierPenalty(k, w, curve)).toBeCloseTo(k * w, 10)
      }
    }
  })

  it("still lets critical findings lower a score substantially", () => {
    // Severity is scanner evidence, not proof of an exploitable vulnerability.
    expect(engineScore(make({ critical: 12 }))).toBeLessThan(40)
  })
})


describe("informational budget", () => {
  it("is monotone and bounded at 10 regardless of volume", () => {
    let previous = 0
    for (const count of [0, 1, 20, 1000, 2000, 10_000, 100_000]) {
      const penalty = 100 - engineScore(make({ info: count }))
      expect(penalty).toBeGreaterThanOrEqual(previous)
      expect(penalty).toBeLessThanOrEqual(10)
      previous = penalty
    }
    expect(previous).toBe(10)
  })

  it("keeps browser and core aligned for custom weights at the ceiling", () => {
    const findings = make({ critical: 1, warning: 2, info: 20 })
    const weights = { critical: 12, warning: 5, info: 30, infoCap: 10 }
    expect(clientScore(findings, weights)).toBe(68)
    expect(clientScore(findings, weights)).toBe(engineScore(findings, weights))
  })
})


it("preserves uncapped historical scores when the persisted infoCap is absent", () => {
  const findings = make({ info: 100_000 })
  const legacy = { critical: 10, warning: 3, info: 0.25 }
  expect(clientScore(findings, legacy)).toBe(70)
  expect(engineScore(findings, legacy)).toBe(70)
  expect(clientScore(findings)).toBe(90)
  expect(engineScore(findings)).toBe(90)
})
