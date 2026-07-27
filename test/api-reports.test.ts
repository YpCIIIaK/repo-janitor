import { describe, it, expect, vi, beforeEach } from "vitest"
import { GET } from "@/app/api/reports/route"
import type { StoredRepo } from "@/lib/server-store"

/**
 * Route test for `GET /api/reports` — the read path the dashboard
 * (`components/repo-anti-rot/server-sync.tsx`) and the GitHub Action
 * (`reportsEndpoint()`) both call.
 *
 * The store is mocked so the test stays pure: what's under test is the auth gate
 * and the response envelope, not the filesystem. `server-only` is stubbed too — it
 * throws outside a React Server Component. `vi.mock` is hoisted above the imports,
 * so the route is imported statically rather than with a top-level `await import`.
 */
const readServerRepos = vi.fn<() => Promise<StoredRepo[]>>()
vi.mock("server-only", () => ({}))
vi.mock("@/lib/server-store", () => ({ readServerRepos: () => readServerRepos() }))

const req = (auth?: string) =>
  new Request("https://dash.example/api/reports", auth ? { headers: { authorization: auth } } : undefined)

const repo = (owner: string, name: string): StoredRepo => ({
  id: `${owner}/${name}`,
  owner,
  name,
  defaultBranch: "main",
  latest: {
    schemaVersion: 1,
    repo: { owner, name, defaultBranch: "main" },
    generatedAt: "2026-07-01T00:00:00.000Z",
    score: 72,
    grade: "B",
    issues: [],
  },
  history: [],
  scannedAt: "2026-07-01T00:00:00.000Z",
})

describe("GET /api/reports", () => {
  beforeEach(() => {
    readServerRepos.mockReset()
    readServerRepos.mockResolvedValue([])
    delete process.env.REPO_ANTI_ROT_READ_TOKEN
  })

  it("returns an empty store as 200 with `repos: []` when no token is configured", async () => {
    const res = await GET(req())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ repos: [] })
  })

  it("returns the stored repos", async () => {
    readServerRepos.mockResolvedValue([repo("acme", "api"), repo("acme", "web")])
    const res = await GET(req())
    expect(res.status).toBe(200)
    const body = (await res.json()) as { repos: StoredRepo[] }
    expect(body.repos.map((r) => r.id)).toEqual(["acme/api", "acme/web"])
  })

  it("401s without a bearer once REPO_ANTI_ROT_READ_TOKEN is set", async () => {
    process.env.REPO_ANTI_ROT_READ_TOKEN = "s3cret"
    const res = await GET(req())
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ error: "Unauthorized" })
    // and the store is never touched on a rejected read
    expect(readServerRepos).not.toHaveBeenCalled()
  })

  it("401s on a wrong bearer, 200s on the right one", async () => {
    process.env.REPO_ANTI_ROT_READ_TOKEN = "s3cret"
    expect((await GET(req("Bearer nope"))).status).toBe(401)
    expect((await GET(req("Bearer s3cret"))).status).toBe(200)
  })
})
