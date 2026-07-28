import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { dbGetShare, dbPutShare, supabaseConfig } from "@/lib/share-db"
import type { SharedReport } from "@/lib/share-report"

// `server-only` throws outside a React Server Component; the mock is hoisted
// above the imports, so the module under test loads normally.
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
    // A URL without a key must not half-enable the backend.
    expect(supabaseConfig()).toBeNull()
  })

  it("trims a trailing slash so URLs do not double up", () => {
    process.env.SUPABASE_URL = "https://proj.supabase.co/"
    process.env.SUPABASE_SERVICE_ROLE_KEY = "k"
    expect(supabaseConfig()?.url).toBe("https://proj.supabase.co")
  })
})

describe("dbPutShare", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("posts the row with auth headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    vi.stubGlobal("fetch", fetchMock)

    await dbPutShare(cfg, "tok1234567890abcd", report)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://proj.supabase.co/rest/v1/shared_reports")
    expect(init.method).toBe("POST")
    expect(init.headers.apikey).toBe("service-key")
    expect(init.headers.Authorization).toBe("Bearer service-key")
    expect(JSON.parse(init.body)).toEqual({ token: "tok1234567890abcd", report })
  })

  it("throws with the database's own message, not a generic failure", async () => {
    // "relation does not exist" is the difference between a misconfigured deploy
    // and a broken feature; swallowing it turns a five-minute fix into an
    // afternoon.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('relation "public.shared_reports" does not exist', { status: 404 }),
      ),
    )
    await expect(dbPutShare(cfg, "tok1234567890abcd", report)).rejects.toThrow(
      /does not exist/,
    )
  })
})

describe("dbGetShare", () => {
  beforeEach(() => vi.restoreAllMocks())

  it("selects by token and maps the row", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      okResponse([{ token: "tok1234567890abcd", created_at: "2026-07-27T10:00:00Z", report }]),
    )
    vi.stubGlobal("fetch", fetchMock)

    const got = await dbGetShare(cfg, "tok1234567890abcd")
    expect(got).toEqual({
      token: "tok1234567890abcd",
      createdAt: "2026-07-27T10:00:00Z",
      report,
    })

    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain("token=eq.tok1234567890abcd")
    expect(url).toContain("limit=1")
  })

  it("returns null for an empty result", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(okResponse([])))
    expect(await dbGetShare(cfg, "tok1234567890abcd")).toBeNull()
  })

  it("returns null on an error response rather than throwing at the page", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })))
    expect(await dbGetShare(cfg, "tok1234567890abcd")).toBeNull()
  })

  it("returns null when the row has no report", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(okResponse([{ token: "t", created_at: "x" }])),
    )
    expect(await dbGetShare(cfg, "tok1234567890abcd")).toBeNull()
  })
})
