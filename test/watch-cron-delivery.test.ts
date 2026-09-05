import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn() }))
vi.mock("@/lib/watch-scan", () => ({ scanWatchedRepo: vi.fn() }))
vi.mock("@/lib/watch-store", () => ({ listDueWatches: vi.fn(), updateWatchCheckpoint: vi.fn() }))
vi.mock("@/lib/url-guard", () => ({ isPublicGitUrl: vi.fn().mockResolvedValue({ ok: true }) }))
import { POST } from "@/app/api/cron/watch/route"
import { sendMail } from "@/lib/mail"
import { scanWatchedRepo } from "@/lib/watch-scan"
import { listDueWatches, updateWatchCheckpoint, type WatchSubscription } from "@/lib/watch-store"
const sub = { id: "watch", email: "test@example.com", owner: "acme", name: "widget", repoUrl: "https://github.com/acme/widget", lastGrade: "A", lastScore: 95, lastSha: "old", lastIssueIds: ["before"], manageToken: "manage", unsubToken: "unsub" } as WatchSubscription
const request = () => new Request("http://localhost/api/cron/watch", { method: "POST", headers: { authorization: "Bearer cron-test" } })
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("CRON_SECRET", "cron-test")
  vi.mocked(listDueWatches).mockResolvedValue([sub])
  vi.mocked(scanWatchedRepo).mockResolvedValue({ ok: true, grade: "C", score: 60, sha: "new", critical: 1, warning: 0, commits: [], issues: [] })
  vi.mocked(updateWatchCheckpoint).mockResolvedValue()
})
afterEach(() => vi.unstubAllEnvs())
describe("cron mail reliability", () => {
  it("retains the drop baseline after failed mail, and advances it after retry succeeds", async () => {
    vi.mocked(sendMail).mockResolvedValueOnce({ ok: false, error: "temporary outage" }).mockResolvedValueOnce({ ok: true, via: "resend" })
    await POST(request())
    expect(updateWatchCheckpoint).toHaveBeenLastCalledWith("watch", expect.objectContaining({ lastGrade: "A", lastScore: 95, lastSha: "old", lastIssueIds: ["before"] }))
    await POST(request())
    expect(sendMail).toHaveBeenCalledTimes(2)
    expect(updateWatchCheckpoint).toHaveBeenLastCalledWith("watch", expect.objectContaining({ lastGrade: "C", lastScore: 60, lastSha: "new" }))
  })
  it("skips overlapping batches and releases the guard afterwards", async () => {
    let release!: (value: WatchSubscription[]) => void
    vi.mocked(listDueWatches).mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
    const first = POST(request())
    expect((await POST(request())).status).toBe(202)
    release([])
    await first
    vi.mocked(listDueWatches).mockResolvedValue([])
    expect((await POST(request())).status).toBe(200)
  })
})
