import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("server-only", () => ({}))

const dbReadRepo = vi.fn()
const dbReadRepos = vi.fn()
const dbWriteRepo = vi.fn()
vi.mock("@/lib/server-store-db", () => ({
  dbReadRepo: (...a: unknown[]) => dbReadRepo(...a),
  dbReadRepos: (...a: unknown[]) => dbReadRepos(...a),
  dbWriteRepo: (...a: unknown[]) => dbWriteRepo(...a),
}))

import {
  mergeReport,
  readServerRepos,
  upsertServerReport,
  type ScanReport,
  type StoredRepo,
  type TrendPoint,
} from "@/lib/server-store"

/**
 * Reports ingested from CI.
 *
 * The merge rule is tested directly because both backends share it, and the
 * backend choice is tested because getting it wrong is invisible until a
 * redeploy: the filesystem path works perfectly right up to the moment the
 * container is replaced, which is how the README badge kept reverting to
 * "unknown".
 */

const report = (over: Partial<ScanReport> = {}): ScanReport =>
  ({
    schemaVersion: 1,
    repo: { owner: "acme", name: "widget", defaultBranch: "main" },
    generatedAt: "2026-08-02T10:00:00.000Z",
    score: 70,
    grade: "C",
    issues: [
      { severity: "critical" },
      { severity: "warning" },
      { severity: "warning" },
    ],
    ...over,
  }) as ScanReport

const pointOf = (r: ScanReport): TrendPoint => ({
  at: r.generatedAt,
  score: r.score,
  critical: r.issues.filter((i) => i.severity === "critical").length,
  warning: r.issues.filter((i) => i.severity === "warning").length,
  info: r.issues.filter((i) => i.severity === "info").length,
})

const savedEnv = { ...process.env }

beforeEach(() => {
  dbReadRepo.mockReset()
  dbReadRepos.mockReset()
  dbWriteRepo.mockReset()
  process.env = { ...savedEnv }
  delete process.env.SUPABASE_URL
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
})

afterEach(() => {
  process.env = { ...savedEnv }
})

function useSupabase() {
  process.env.SUPABASE_URL = "https://db.test"
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key"
}

describe("mergeReport", () => {
  it("creates a document on first ingest", () => {
    const r = report()
    const { repo, previous } = mergeReport(null, r, pointOf(r))
    expect(previous).toBeNull()
    expect(repo).toMatchObject({ id: "acme/widget", owner: "acme", name: "widget" })
    expect(repo.history).toHaveLength(1)
  })

  it("returns the report it replaced, so a score drop can be seen", () => {
    const first = report({ score: 80 })
    const { repo } = mergeReport(null, first, pointOf(first))
    const second = report({ score: 41, generatedAt: "2026-08-03T10:00:00.000Z" })

    const { previous, repo: updated } = mergeReport(repo, second, pointOf(second))
    expect(previous?.score).toBe(80)
    expect(updated.latest.score).toBe(41)
    expect(updated.history.map((p) => p.score)).toEqual([80, 41])
  })

  it("replaces a trend point with the same timestamp rather than duplicating it", () => {
    // A re-run of the same CI job ingests the same generatedAt. Two points on
    // one instant would draw a vertical line through the trend chart.
    const r = report()
    const { repo } = mergeReport(null, r, pointOf(r))
    const again = report({ score: 55 })
    const { repo: updated } = mergeReport(repo, again, pointOf(again))
    expect(updated.history).toHaveLength(1)
    expect(updated.history[0].score).toBe(55)
  })

  it("keeps the default branch current", () => {
    const r = report()
    const { repo } = mergeReport(null, r, pointOf(r))
    const renamed = report({
      repo: { owner: "acme", name: "widget", defaultBranch: "trunk" },
      generatedAt: "2026-08-04T10:00:00.000Z",
    })
    expect(mergeReport(repo, renamed, pointOf(renamed)).repo.defaultBranch).toBe("trunk")
  })

  it("counts severities into the trend point", () => {
    const r = report()
    expect(mergeReport(null, r, pointOf(r)).repo.history[0]).toMatchObject({
      critical: 1,
      warning: 2,
      info: 0,
    })
  })

  it("does not mutate the document it was given", () => {
    // The Supabase path writes the returned document; mutating the input would
    // make the row and the value the caller sees drift apart.
    const r = report()
    const { repo } = mergeReport(null, r, pointOf(r))
    const frozen = JSON.stringify(repo)
    const next = report({ score: 10, generatedAt: "2026-08-05T10:00:00.000Z" })
    mergeReport(repo, next, pointOf(next))
    expect(JSON.stringify(repo)).toBe(frozen)
  })
})

describe("backend selection", () => {
  it("reads from Supabase when it is configured", async () => {
    useSupabase()
    dbReadRepos.mockResolvedValue([{ id: "acme/widget" } as StoredRepo])
    expect(await readServerRepos()).toEqual([{ id: "acme/widget" }])
  })

  it("returns empty rather than throwing when the database is down", async () => {
    // A broken analytics table must not take the dashboard with it — the same
    // answer an unreadable file gave.
    useSupabase()
    dbReadRepos.mockRejectedValue(new Error("connection refused"))
    expect(await readServerRepos()).toEqual([])
  })

  it("writes one row, not the whole table", async () => {
    useSupabase()
    dbReadRepo.mockResolvedValue(null)
    dbWriteRepo.mockResolvedValue(undefined)

    const { repo } = await upsertServerReport(report())
    expect(dbReadRepo).toHaveBeenCalledWith(expect.anything(), "acme/widget")
    expect(dbWriteRepo).toHaveBeenCalledTimes(1)
    expect(dbWriteRepo.mock.calls[0][1]).toMatchObject({ id: "acme/widget" })
    expect(repo.id).toBe("acme/widget")
  })

  it("lets a failed write surface", async () => {
    // /api/ingest turns this into a 500. CI reporting a successful upload that
    // never landed is the quiet lie this project exists to find.
    useSupabase()
    dbReadRepo.mockResolvedValue(null)
    dbWriteRepo.mockRejectedValue(new Error("insert failed"))
    await expect(upsertServerReport(report())).rejects.toThrow(/insert failed/)
  })

  it("never touches the database when Supabase is not configured", async () => {
    await readServerRepos()
    expect(dbReadRepos).not.toHaveBeenCalled()
  })
})
