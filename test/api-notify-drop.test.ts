import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
const notify = vi.fn().mockResolvedValue(undefined)
vi.mock("@/lib/webhook", () => ({
  notifyScoreDropFromSummary: (...args: unknown[]) => notify(...args),
}))

import { POST } from "@/app/api/notify-drop/route"
import { resetWatchRate } from "@/lib/watch-rate"

const OWNER = "owner-key-0123456789abcdef0123456789abcdef"
const drop = {
  owner: "acme",
  name: "widget",
  previous: { grade: "A", score: 95, critical: 0 },
  current: { grade: "F", score: 10, critical: 4 },
}

function request(body: unknown = drop, cookie?: string) {
  return new Request("https://service.example/api/notify-drop", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  notify.mockClear()
  resetWatchRate()
  vi.stubEnv("REPO_ANTI_ROT_WEBHOOK_URL", "https://hooks.example/abc")
  vi.stubEnv("REPO_ANTI_ROT_OWNER_TOKEN", OWNER)
})
afterEach(() => vi.unstubAllEnvs())

describe("POST /api/notify-drop", () => {
  it("forwards a drop on a private dashboard without any cookie", async () => {
    vi.stubEnv("REPO_ANTI_ROT_PUBLIC", "false")
    const res = await POST(request())
    expect(res.status).toBe(200)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it("ignores anonymous callers on a public instance — the webhook is the operator's", async () => {
    vi.stubEnv("REPO_ANTI_ROT_PUBLIC", "true")
    const res = await POST(request())
    expect(res.status).toBe(204)
    expect(notify).not.toHaveBeenCalled()
  })

  it("still lets the owner cookie through on a public instance", async () => {
    vi.stubEnv("REPO_ANTI_ROT_PUBLIC", "true")
    const res = await POST(request(drop, `rar_owner=${OWNER}`))
    expect(res.status).toBe(200)
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it("does not accept a forged owner cookie", async () => {
    vi.stubEnv("REPO_ANTI_ROT_PUBLIC", "true")
    const res = await POST(request(drop, "rar_owner=guess"))
    expect(res.status).toBe(204)
    expect(notify).not.toHaveBeenCalled()
  })

  it("answers 204 without reading the body when no webhook is configured", async () => {
    vi.stubEnv("REPO_ANTI_ROT_WEBHOOK_URL", "")
    vi.stubEnv("REPO_ANTI_ROT_PUBLIC", "false")
    const res = await POST(request("not even json"))
    expect(res.status).toBe(204)
    expect(notify).not.toHaveBeenCalled()
  })

  it("rejects an oversized body instead of parsing it", async () => {
    vi.stubEnv("REPO_ANTI_ROT_PUBLIC", "false")
    const res = await POST(request({ ...drop, pad: "x".repeat(20_000) }))
    expect(res.status).toBe(400)
    expect(notify).not.toHaveBeenCalled()
  })

  it("keeps validating the summary shape for allowed callers", async () => {
    vi.stubEnv("REPO_ANTI_ROT_PUBLIC", "false")
    const res = await POST(request({ ...drop, current: { grade: "Z", score: 1 } }))
    expect(res.status).toBe(400)
    expect(notify).not.toHaveBeenCalled()
  })
})
