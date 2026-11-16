import { afterEach, describe, expect, it, vi } from "vitest"
import { GET, POST } from "@/app/api/local-rescan/route"
import { catalog, createRun, launchRun } from "@/benchmark/local-rescan-manager.mjs"

vi.mock("@/benchmark/local-rescan-manager.mjs", () => ({
  catalog: vi.fn(async () => ({ repos: [], scanners: [], baselineRecords: 0 })),
  createRun: vi.fn(async () => "created-id"), launchRun: vi.fn(), getRun: vi.fn(),
  listRuns: vi.fn(() => []), controlRun: vi.fn(), taskDetail: vi.fn(), taskReport: vi.fn(),
}))
const original = process.env.REPO_JANITOR_LOCAL_RESCAN
afterEach(() => {
  vi.clearAllMocks()
  if (original === undefined) delete process.env.REPO_JANITOR_LOCAL_RESCAN
  else process.env.REPO_JANITOR_LOCAL_RESCAN = original
})
describe("local rescan API boundary", () => {
  it("never lists local files or launches jobs on a public deployment", async () => {
    delete process.env.REPO_JANITOR_LOCAL_RESCAN
    const response = await GET(new Request("https://repo.test/api/local-rescan?catalog=1", { headers: { host: "repo.test" } }))
    expect(response.status).toBe(404)
    expect(catalog).not.toHaveBeenCalled()
    const post = await POST(new Request("https://repo.test/api/local-rescan", { method: "POST", headers: { host: "repo.test", "content-type": "application/json" }, body: '{"action":"create"}' }))
    expect(post.status).toBe(404)
    expect(createRun).not.toHaveBeenCalled()
  })
  it("rejects cross-origin mutation even when local mode is enabled", async () => {
    process.env.REPO_JANITOR_LOCAL_RESCAN = "1"
    const response = await POST(new Request("http://127.0.0.1:3100/api/local-rescan", {
      method: "POST", headers: { host: "127.0.0.1:3100", origin: "https://evil.test", "content-type": "application/json", "x-repo-janitor-local": "1" }, body: '{"action":"create"}',
    }))
    expect(response.status).toBe(404)
    expect(launchRun).not.toHaveBeenCalled()
  })
  it("creates an isolated run only for same-origin local JSON controls", async () => {
    process.env.REPO_JANITOR_LOCAL_RESCAN = "1"
    const response = await POST(new Request("http://127.0.0.1:3100/api/local-rescan", {
      method: "POST", headers: { host: "127.0.0.1:3100", origin: "http://127.0.0.1:3100", "content-type": "application/json", "x-repo-janitor-local": "1" }, body: '{"action":"create","config":{"jobs":4}}',
    }))
    expect(response.status).toBe(201)
    expect(createRun).toHaveBeenCalledWith(expect.any(String), { jobs: 4 })
    expect(launchRun).toHaveBeenCalledWith(expect.any(String), "created-id")
  })
})
