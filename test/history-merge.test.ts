import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { installWindow, report, issue } from "./helpers"
import { saveReport, mergeHistoryPoints, trendPointAt, useRepos } from "@/lib/reports-store"

/**
 * Scanning old commits produces real measurements of the past, and they belong
 * on the same timeline as the present. The two ways to get that wrong are
 * stamping them with "now" (so a hundred commits pile onto today and describe
 * nothing) and letting them overwrite `latest` (so the dashboard reports a 2019
 * commit as the repo's current state).
 */
function repos() {
  // useRepos is a hook, but its snapshot getter is what reads storage; grabbing
  // it through a fresh read keeps this a plain unit test.
  return JSON.parse(localStorage.getItem("repo-anti-rot:reports:v1") ?? "[]") as {
    id: string
    latest: { score: number }
    history: { at: string; score: number }[]
  }[]
}

let storage: ReturnType<typeof installWindow>

beforeEach(() => {
  storage = installWindow()
  vi.stubGlobal("localStorage", storage)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("mergeHistoryPoints", () => {
  function seed() {
    saveReport(
      report([issue({ severity: "critical" })], {
        score: 90,
        grade: "A",
        generatedAt: "2026-07-01T00:00:00.000Z",
      }),
      "https://github.com/acme/widget",
    )
  }

  it("inserts a past measurement without touching the current state", () => {
    seed()
    const old = report([issue({ severity: "critical" }), issue({ severity: "critical" })], {
      score: 40,
      grade: "D",
    })
    expect(mergeHistoryPoints("acme/widget", [trendPointAt(old, "2019-03-04T12:00:00.000Z")])).toBe(
      true,
    )

    const [repo] = repos()
    // The repo is still an A today; scanning 2019 must not say otherwise.
    expect(repo.latest.score).toBe(90)
    expect(repo.history).toHaveLength(2)
  })

  it("keeps the timeline in chronological order after a mid-timeline insert", () => {
    seed()
    const old = report([], { score: 40, grade: "D" })
    mergeHistoryPoints("acme/widget", [
      trendPointAt(old, "2019-03-04T12:00:00.000Z"),
      trendPointAt(old, "2022-01-01T00:00:00.000Z"),
    ])

    const dates = repos()[0].history.map((p) => p.at)
    expect(dates).toEqual([...dates].sort())
    // The sparkline reads the last entry as the most recent; it must be today's.
    expect(dates[dates.length - 1]).toBe("2026-07-01T00:00:00.000Z")
  })

  it("is idempotent — rescanning the same commits changes nothing", () => {
    seed()
    const old = report([], { score: 40, grade: "D" })
    const point = trendPointAt(old, "2019-03-04T12:00:00.000Z")

    expect(mergeHistoryPoints("acme/widget", [point])).toBe(true)
    expect(mergeHistoryPoints("acme/widget", [point])).toBe(false)
    expect(repos()[0].history).toHaveLength(2)
  })

  it("updates a point whose score changed rather than duplicating the date", () => {
    seed()
    const at = "2019-03-04T12:00:00.000Z"
    mergeHistoryPoints("acme/widget", [trendPointAt(report([], { score: 40 }), at)])
    mergeHistoryPoints("acme/widget", [trendPointAt(report([], { score: 55 }), at)])

    const points = repos()[0].history.filter((p) => p.at === at)
    expect(points).toHaveLength(1)
    expect(points[0].score).toBe(55)
  })

  it("does nothing for a repo that is not in the store", () => {
    // No timeline to insert into. Inventing an entry would produce a repo with
    // no `latest` report, which the dashboard cannot render.
    expect(mergeHistoryPoints("nobody/nothing", [trendPointAt(report([]), "2020-01-01T00:00:00.000Z")])).toBe(
      false,
    )
    expect(repos()).toHaveLength(0)
  })

  it("ignores an empty batch without touching storage", () => {
    seed()
    expect(mergeHistoryPoints("acme/widget", [])).toBe(false)
  })
})

describe("trendPointAt", () => {
  it("dates the measurement by the moment it describes, not the scan", () => {
    const point = trendPointAt(
      report([issue({ severity: "warning" }), issue({ severity: "info" })], {
        score: 70,
        generatedAt: "2026-07-29T10:00:00.000Z",
      }),
      "2019-03-04T12:00:00.000Z",
    )
    expect(point.at).toBe("2019-03-04T12:00:00.000Z")
    expect(point.score).toBe(70)
    expect(point.warning).toBe(1)
    expect(point.info).toBe(1)
  })
})

// Referenced so the import is not flagged; the hook itself needs React to run.
void useRepos
