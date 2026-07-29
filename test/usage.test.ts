import { describe, it, expect, vi } from "vitest"

// `server-only` throws outside a React Server Component; the mock is hoisted
// above the imports, so the module under test loads normally.
vi.mock("server-only", () => ({}))

import {
  FORBIDDEN_USAGE_FIELDS,
  VISITOR_HEADER,
  VISITOR_OPT_OUT,
  assertRecordable,
  repoIdentity,
  visitorFrom,
} from "@/lib/usage"
import { aggregateUsage } from "@/lib/usage-stats"
import type { UsageRow } from "@/lib/usage-db"

const req = (visitor?: string) =>
  new Request("https://example.test/api/scan", {
    method: "POST",
    headers: visitor ? { [VISITOR_HEADER]: visitor } : {},
  })

const UUID = "3f2a1c9e-7b41-4d8a-9c2e-0a1b2c3d4e5f"

describe("visitorFrom", () => {
  it("accepts a UUID and lowercases it", () => {
    expect(visitorFrom(req(UUID.toUpperCase()))).toBe(UUID)
  })

  it("returns null for an explicit opt-out, so nothing is recorded", () => {
    expect(visitorFrom(req(VISITOR_OPT_OUT))).toBeNull()
  })

  it("buckets a missing header as anonymous rather than opting out", () => {
    // Absent could be curl, the CLI, or a blocked script — treating that as a
    // refusal would silently lose real usage.
    expect(visitorFrom(req())).toBe("anonymous")
  })

  it("refuses to store an id it did not recognise", () => {
    // The header is attacker-controlled. Without this, a text column reachable
    // from the internet is a place to write whatever you like.
    expect(visitorFrom(req("x".repeat(10_000)))).toBe("anonymous")
    expect(visitorFrom(req("../../etc/passwd"))).toBe("anonymous")
    expect(visitorFrom(req("<script>alert(1)</script>"))).toBe("anonymous")
  })
})

describe("repoIdentity", () => {
  it("reduces a URL to host and owner/name", () => {
    expect(repoIdentity("https://github.com/acme/widget.git")).toEqual({
      host: "github.com",
      repo: "acme/widget",
    })
  })

  it("drops credentials embedded in the URL", () => {
    // The realistic accident: someone pastes a tokenised clone URL. Storing it
    // would put a live secret in an analytics table.
    const id = repoIdentity("https://user:ghp_secrettoken@gitlab.com/acme/widget.git")
    expect(id).toEqual({ host: "gitlab.com", repo: "acme/widget" })
    expect(JSON.stringify(id)).not.toContain("ghp_secrettoken")
  })

  it("drops query strings and fragments", () => {
    expect(repoIdentity("https://github.com/acme/widget?token=abc#x")?.repo).toBe("acme/widget")
  })

  it("returns null for things that are not repository URLs", () => {
    expect(repoIdentity("not a url")).toBeNull()
    expect(repoIdentity("https://github.com/acme")).toBeNull()
    expect(repoIdentity("file:///etc/passwd")).toBeNull()
  })
})

describe("assertRecordable", () => {
  it.each(FORBIDDEN_USAGE_FIELDS)("refuses a row containing %s", (field) => {
    expect(() => assertRecordable({ visitor: UUID, [field]: "leak" })).toThrow(/Refusing to record/)
  })

  it("allows a plain usage row", () => {
    expect(() =>
      assertRecordable({ visitor: UUID, event: "scan", host: "github.com", repo: "a/b" }),
    ).not.toThrow()
  })
})

const row = (over: Partial<UsageRow> = {}): UsageRow => ({
  at: "2026-07-20T10:00:00.000Z",
  visitor: UUID,
  event: "scan",
  host: "github.com",
  repo: "acme/widget",
  amount: 1,
  ok: true,
  ...over,
})

describe("aggregateUsage", () => {
  const since = "2026-07-01T00:00:00.000Z"

  it("counts a person once across many scans", () => {
    const stats = aggregateUsage([row(), row(), row({ visitor: "0".repeat(8) })], since)
    expect(stats.uniqueVisitors).toBe(2)
    expect(stats.events.find((e) => e.event === "scan")?.count).toBe(3)
  })

  it("does not count the anonymous bucket as a person", () => {
    // Every unidentified caller shares one label; calling that "one user" would
    // be wrong in both directions, so it is reported separately.
    const stats = aggregateUsage([row({ visitor: "anonymous" }), row({ visitor: "anonymous" })], since)
    expect(stats.uniqueVisitors).toBe(0)
    expect(stats.anonymousEvents).toBe(2)
  })

  it("sums commits scanned rather than counting the requests", () => {
    const stats = aggregateUsage(
      [row({ event: "commit-scan", amount: 40 }), row({ event: "commit-scan", amount: 12 })],
      since,
    )
    expect(stats.commitsScanned).toBe(52)
    expect(stats.events.find((e) => e.event === "commit-scan")?.count).toBe(2)
  })

  it("ranks repositories by scans and counts distinct people per repo", () => {
    const stats = aggregateUsage(
      [
        row({ repo: "acme/widget" }),
        row({ repo: "acme/widget", visitor: "1".repeat(8) }),
        row({ repo: "other/thing" }),
      ],
      since,
    )
    expect(stats.topRepos[0]).toEqual({
      host: "github.com",
      repo: "acme/widget",
      scans: 2,
      visitors: 2,
    })
    expect(stats.topRepos[1].repo).toBe("other/thing")
  })

  it("separates failed scans from successful ones", () => {
    const stats = aggregateUsage([row({ ok: false }), row({ ok: true })], since)
    expect(stats.failedScans).toBe(1)
  })

  it("buckets by day, oldest first", () => {
    const stats = aggregateUsage(
      [row({ at: "2026-07-20T23:00:00.000Z" }), row({ at: "2026-07-19T01:00:00.000Z" })],
      since,
    )
    expect(stats.daily.map((d) => d.date)).toEqual(["2026-07-19", "2026-07-20"])
  })

  it("says so when the row limit truncated the answer", () => {
    // Otherwise a capped read looks like a quiet month.
    expect(aggregateUsage([row()], since, true).truncated).toBe(true)
  })

  it("handles no rows at all", () => {
    const stats = aggregateUsage([], since)
    expect(stats).toMatchObject({ uniqueVisitors: 0, commitsScanned: 0, topRepos: [], daily: [] })
  })
})
