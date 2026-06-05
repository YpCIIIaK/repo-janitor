import { describe, it, expect } from "vitest"
import {
  isRepoDue,
  dueRepos,
  describeSchedule,
  DEFAULT_SCHEDULE,
  type ScheduleSettings,
} from "@/lib/schedule-store"
import { storedRepo } from "./helpers"

const settings = (over: Partial<ScheduleSettings> = {}): ScheduleSettings => ({
  ...DEFAULT_SCHEDULE,
  enabled: true,
  ...over,
})

describe("isRepoDue (interval mode)", () => {
  const now = Date.parse("2026-06-05T12:00:00.000Z")

  it("is due when more than intervalHours have passed since the last scan", () => {
    const repo = storedRepo({ scannedAt: "2026-06-04T00:00:00.000Z" }) // 36h ago
    expect(isRepoDue(settings({ mode: "interval", intervalHours: 24 }), repo, now)).toBe(true)
  })

  it("is not due when within the interval", () => {
    const repo = storedRepo({ scannedAt: "2026-06-05T06:00:00.000Z" }) // 6h ago
    expect(isRepoDue(settings({ mode: "interval", intervalHours: 24 }), repo, now)).toBe(false)
  })

  it("is never due when scheduling is disabled", () => {
    const repo = storedRepo({ scannedAt: "2020-01-01T00:00:00.000Z" })
    expect(isRepoDue(settings({ enabled: false }), repo, now)).toBe(false)
  })

  it("is never due for a repo without a source URL (CI-ingested)", () => {
    const repo = storedRepo({ url: undefined, scannedAt: "2020-01-01T00:00:00.000Z" })
    expect(isRepoDue(settings(), repo, now)).toBe(false)
  })
})

describe("isRepoDue (daily mode)", () => {
  it("is due once today's target time has passed and we haven't scanned since", () => {
    const now = Date.parse("2026-06-05T04:00:00.000Z")
    const repo = storedRepo({ scannedAt: "2026-06-04T23:00:00.000Z" })
    // target 03:00 LOCAL — compute via the same Date math the impl uses
    const target = new Date(now)
    target.setHours(3, 0, 0, 0)
    const expected = now >= target.getTime() && Date.parse(repo.scannedAt) < target.getTime()
    expect(isRepoDue(settings({ mode: "daily", dailyTime: "03:00" }), repo, now)).toBe(expected)
  })
})

describe("dueRepos", () => {
  it("returns due repos sorted oldest-scan first", () => {
    const now = Date.parse("2026-06-05T12:00:00.000Z")
    const old = storedRepo({ id: "a", scannedAt: "2026-06-01T00:00:00.000Z" })
    const older = storedRepo({ id: "b", scannedAt: "2026-05-01T00:00:00.000Z" })
    const fresh = storedRepo({ id: "c", scannedAt: "2026-06-05T11:00:00.000Z" })
    const result = dueRepos(settings({ mode: "interval", intervalHours: 24 }), [old, older, fresh], now)
    expect(result.map((r) => r.id)).toEqual(["b", "a"]) // fresh excluded, oldest first
  })
})

describe("describeSchedule", () => {
  it("describes the disabled, interval and daily states", () => {
    expect(describeSchedule(settings({ enabled: false }))).toBe("Off")
    expect(describeSchedule(settings({ mode: "interval", intervalHours: 24 }))).toBe("Every 24 hours, per repo")
    expect(describeSchedule(settings({ mode: "interval", intervalHours: 1 }))).toBe("Every hour, per repo")
    expect(describeSchedule(settings({ mode: "interval", intervalHours: 0.5 }))).toBe("Every 30 min, per repo")
    expect(describeSchedule(settings({ mode: "daily", dailyTime: "09:30" }))).toBe("Daily at 09:30")
  })
})
