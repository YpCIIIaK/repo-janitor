import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const readServerRepos = vi.fn()
vi.mock("@/lib/server-store", () => ({
  readServerRepos: () => readServerRepos(),
}))

import { ingestedSharedReport } from "@/lib/ingested-report"
import { FORBIDDEN_SHARED_FIELDS } from "@/lib/share-report"

/**
 * The tokenless report page's data source.
 *
 * The point of the tests is not that it finds a row — it is that what comes back
 * has been through the same projection the share links use. A CI-ingested report
 * is a full ScanReport: it carries file paths, source lines and, for secrets, a
 * masked credential. This page is public and its URL is guessable, so anything
 * that reached it unprojected would be published to anyone who typed the name.
 */

const repo = (over: Record<string, unknown> = {}) => ({
  id: "acme/widget",
  owner: "acme",
  name: "widget",
  defaultBranch: "main",
  scannedAt: "2026-08-02T10:00:00.000Z",
  history: [],
  latest: {
    schemaVersion: 1,
    repo: { owner: "acme", name: "widget", defaultBranch: "main" },
    generatedAt: "2026-08-02T10:00:00.000Z",
    score: 75,
    grade: "B",
    issues: [
      {
        id: "sec-1",
        category: "security",
        severity: "critical",
        title: "High-entropy secret assigned",
        location: "src/config.ts:12",
        ageDays: 40,
        detail: "A long, high-entropy value is assigned to API_KEY.",
        evidence: 'const API_KEY = "sk-live-abcd…"',
      },
    ],
    ...over,
  },
})

beforeEach(() => readServerRepos.mockReset())

describe("ingestedSharedReport", () => {
  it("returns null for a repository nobody has ingested", async () => {
    readServerRepos.mockResolvedValue([])
    expect(await ingestedSharedReport("acme", "widget")).toBeNull()
  })

  it("matches owner/name case-insensitively", async () => {
    // GitHub paths and pasted casing disagree constantly, and this URL is one a
    // human types.
    readServerRepos.mockResolvedValue([repo()])
    expect(await ingestedSharedReport("ACME", "Widget")).not.toBeNull()
  })

  it("never returns a path, a snippet or a detail string", async () => {
    readServerRepos.mockResolvedValue([repo()])
    const shared = (await ingestedSharedReport("acme", "widget"))?.report
    const json = JSON.stringify(shared)

    for (const field of FORBIDDEN_SHARED_FIELDS) {
      expect(json).not.toContain(`"${field}"`)
    }
    expect(json).not.toContain("src/config.ts")
    expect(json).not.toContain("sk-live")
    // The title survives — that is the whole finding a reader gets.
    expect(json).toContain("High-entropy secret assigned")
  })

  it("carries a repo URL so the page can offer watch and rescan", async () => {
    readServerRepos.mockResolvedValue([repo()])
    const shared = (await ingestedSharedReport("acme", "widget"))?.report
    expect(shared?.repoUrl).toBe("https://github.com/acme/widget")
  })

  it("survives a report with no issues array", async () => {
    readServerRepos.mockResolvedValue([repo({ issues: undefined })])
    const shared = (await ingestedSharedReport("acme", "widget"))?.report
    expect(shared?.totalIssues).toBe(0)
    expect(shared?.topIssues).toEqual([])
  })
})

describe("the trend that comes with it", () => {
  /**
   * The grade cannot say which way a repository is going: 62 falling and 62
   * climbing are the same letter and not the same project. This is the only
   * route that can tell them apart — a share token carries a projection with no
   * score history in it, by design.
   */
  const withHistory = (history: { at: string; score: number }[]) => ({
    ...repo(),
    history,
  })
  const ago = (days: number) =>
    new Date(Date.now() - days * 86_400_000).toISOString()

  it("reports a slide, counted from where it began", async () => {
    readServerRepos.mockResolvedValue([
      withHistory([
        { at: ago(40), score: 80 },
        { at: ago(12), score: 71 },
        { at: ago(1), score: 68 },
      ]),
    ])
    expect((await ingestedSharedReport("acme", "widget"))?.trend).toEqual({
      kind: "rotting",
      days: 12,
    })
  })

  it("is null for a repository with a single scan", async () => {
    readServerRepos.mockResolvedValue([withHistory([{ at: ago(2), score: 75 }])])
    expect((await ingestedSharedReport("acme", "widget"))?.trend).toBeNull()
  })

  it("is null when history is missing entirely", async () => {
    // Reports ingested before trends existed have no history array at all.
    const { history: _dropped, ...noHistory } = withHistory([])
    readServerRepos.mockResolvedValue([noHistory])
    expect((await ingestedSharedReport("acme", "widget"))?.trend).toBeNull()
  })
})
