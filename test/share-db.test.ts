import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import {
  dbDeleteShare,
  dbGetShare,
  dbGetShareByRepoKey,
  dbPutShare,
  dbUpdateShare,
  packDbReport,
  supabaseConfig,
  unpackDbReport,
} from "@/lib/share-db"
import type { SharedReport } from "@/lib/share-report"

vi.mock("server-only", () => ({}))

const cfg = { url: "https://proj.supabase.co", serviceKey: "service-key" }

const report: SharedReport = {
  repo: { owner: "acme", name: "widget" },
  generatedAt: "2026-07-27T10:00:00.000Z",
  score: 72,
  grade: "C",
  counts: { critical: 0, warning: 6, info: 20 },
  byCategory: [{ category: "dependency", count: 12 }],
  totalIssues: 26,
  topIssues: [{ title: "lodash is outdated", category: "dependency", severity: "warning" }],
}

const okResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

describe("supabaseConfig", () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it("is null unless both variables are set", () => {
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    expect(supabaseConfig()).toBeNull()

    process.env.SUPABASE_URL = "https://proj.supabase.co"
    expect(supabaseConfig()).toBeNull()
  })

  it("trims a trailing slash so URLs do not double up", () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co/"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k"
    expect(supabaseConfig()?.url).toBe("https://proj.supabase.co")
  })
})

describe("pack / unpack envelope", () => {
  it("round-trips a v2 share", () => {
    const packed = packDbReport({
      manageKeyHash: "abc",
      repoKey: "acme/widget",
      updatedAt: "2026-08-01T12:00:00.000Z",
      report,
    })
    const got = unpackDbReport("tok1234567890abcd", "2026-07-27T10:00:00Z", packed)
    expect(got).toEqual({
      token: "tok1234567890abcd",
      createdAt: "2026-07-27T10:00:00Z",
      updatedAt: "2026-08-01T12:00:00.000Z",
      repoKey: "acme/widget",
      manageKeyHash: "abc",
      report,
    })
  })

  it("reads legacy bare SharedReport rows", () => {
    const got = unpackDbReport("tok1234567890abcd", "2026-07-27T10:00:00Z", report)
    expect(got?.manageKeyHash).toBe("")
    expect(got?.repoKey).toBe("acme/widget")
    expect(got?.report).toEqual(report)
  })
})

describe("dbPutShare", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("posts a v2 envelope with auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)

    await dbPutShare(cfg, {
      token: "tok1234567890abcd",
      manageKeyHash: "hash",
      repoKey: "acme/widget",
      updatedAt: "2026-08-01T12:00:00.000Z",
      report,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://proj.supabase.co/rest/v1/shared_reports")
    expect(init.method).toBe("POST")
    expect(init.headers.apikey).toBe("service-key")
    const body = JSON.parse(init.body)
    expect(body.token).toBe("tok1234567890abcd")
    expect(body.report.v).toBe(2)
    expect(body.report.body).toEqual(report)
    expect(body.report.repoKey).toBe("acme/widget")
  })

  it("throws with the database's own message, not a generic failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('relation "public.shared_reports" does not exist', { status: 404 }),
      ),
    )
    await expect(
      dbPutShare(cfg, {
        token: "tok1234567890abcd",
        manageKeyHash: "hash",
        repoKey: "acme/widget",
        updatedAt: "2026-08-01T12:00:00.000Z",
        report,
      }),
    ).rejects.toThrow(/does not exist/)
  })
})

describe("dbUpdateShare / dbDeleteShare", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("patches by token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    await dbUpdateShare(cfg, {
      token: "tok1234567890abcd",
      manageKeyHash: "hash",
      repoKey: "acme/widget",
      updatedAt: "2026-08-01T12:00:00.000Z",
      report,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("token=eq.tok1234567890abcd")
    expect(init.method).toBe("PATCH")
  })

  it("deletes by token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }))
    vi.stubGlobal("fetch", fetchMock)

    await dbDeleteShare(cfg, "tok1234567890abcd")
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("token=eq.tok1234567890abcd")
    expect(init.method).toBe("DELETE")
  })
})

describe("dbGetShare", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("selects by token and unpacks a v2 row", async () => {
    const envelope = packDbReport({
      manageKeyHash: "hash",
      repoKey: "acme/widget",
      updatedAt: "2026-08-01T12:00:00.000Z",
      report,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse([{ token: "tok1234567890abcd", created_at: "2026-07-27T10:00:00Z", report: envelope }]),
    )
    vi.stubGlobal("fetch", fetchMock)

    const got = await dbGetShare(cfg, "tok1234567890abcd")
    expect(got?.token).toBe("tok1234567890abcd")
    expect(got?.manageKeyHash).toBe("hash")
    expect(got?.report).toEqual(report)

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain("token=eq.tok1234567890abcd")
  })

  it("returns null for an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([])))
    expect(await dbGetShare(cfg, "tok1234567890abcd")).toBeNull()
  })

  it("returns null on an error response rather than throwing at the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })))
    expect(await dbGetShare(cfg, "tok1234567890abcd")).toBeNull()
  })
})

describe("dbGetShareByRepoKey", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("filters on the envelope repoKey field", async () => {
    const envelope = packDbReport({
      manageKeyHash: "hash",
      repoKey: "acme/widget",
      updatedAt: "2026-08-01T12:00:00.000Z",
      report,
    })
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse([{ token: "tok1234567890abcd", created_at: "2026-07-27T10:00:00Z", report: envelope }]),
    )
    vi.stubGlobal("fetch", fetchMock)

    const got = await dbGetShareByRepoKey(cfg, "acme/widget")
    expect(got?.token).toBe("tok1234567890abcd")

    const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]))
    expect(url).toContain("report->>repoKey=eq.acme/widget")
  })
})
