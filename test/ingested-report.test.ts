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
    const shared = await ingestedSharedReport("acme", "widget")
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
    const shared = await ingestedSharedReport("acme", "widget")
    expect(shared?.repoUrl).toBe("https://github.com/acme/widget")
  })

  it("survives a report with no issues array", async () => {
    readServerRepos.mockResolvedValue([repo({ issues: undefined })])
    const shared = await ingestedSharedReport("acme", "widget")
    expect(shared?.totalIssues).toBe(0)
    expect(shared?.topIssues).toEqual([])
  })
})
