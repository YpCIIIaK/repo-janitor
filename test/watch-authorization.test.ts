import { beforeEach, afterEach, describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/watch-store", () => ({ subscribeWatch: vi.fn(), unsubscribeByToken: vi.fn() }))
vi.mock("@/lib/mail", () => ({ sendMail: vi.fn().mockResolvedValue({ ok: true }) }))
vi.mock("@/lib/url-guard", () => ({ isPublicGitUrl: vi.fn().mockResolvedValue({ ok: true }) }))
import { POST, DELETE } from "@/app/api/watch/route"
import { subscribeWatch, unsubscribeByToken } from "@/lib/watch-store"
import { createSession } from "@/lib/session"
import { resetWatchRate } from "@/lib/watch-rate"

const secret = "watch-test-session-secret"
const input = { email: "victim@example.com", owner: "acme", name: "widget", repoUrl: "https://github.com/acme/widget", grade: "A", score: 95 }
function request(email?: string) {
  return new Request("http://localhost/api/watch", { method: "POST", headers: { "content-type": "application/json", ...(email ? { cookie: `rar_session=${createSession("attacker", secret, Date.now(), email)}` } : {}) }, body: JSON.stringify(input) })
}
beforeEach(() => { vi.stubEnv("REPO_ANTI_ROT_SESSION_SECRET", secret); vi.clearAllMocks(); resetWatchRate() })
afterEach(() => vi.unstubAllEnvs())
describe("watch ownership", () => {
  it("rejects anonymous token harvesting before reading the store", async () => {
    expect((await POST(request())).status).toBe(401)
    expect(subscribeWatch).not.toHaveBeenCalled()
  })
  it("rejects a different verified email without changing the victim baseline", async () => {
    const response = await POST(request("attacker@example.com"))
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain("manage")
    expect(subscribeWatch).not.toHaveBeenCalled()
  })
  it("allows the verified owner to create or refresh their watch", async () => {
    vi.mocked(subscribeWatch).mockResolvedValue({ created: false, managePath: "/watch/owner-token", subscription: { unsubToken: "owner-unsub" } } as Awaited<ReturnType<typeof subscribeWatch>>)
    expect((await POST(request("victim@example.com"))).status).toBe(200)
    expect(subscribeWatch).toHaveBeenCalledWith(expect.objectContaining({ email: input.email }))
  })
  it("preserves existing secret-token unsubscribe without a login", async () => {
    vi.mocked(unsubscribeByToken).mockResolvedValue(true)
    const token = "a".repeat(43)
    expect((await DELETE(new Request(`http://localhost/api/watch?token=${token}`, { method: "DELETE" }))).status).toBe(200)
  })
})
