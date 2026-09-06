import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { GET } from "@/app/api/unlock/route"

const KEY = "owner-key-0123456789abcdef0123456789abcdef"

beforeEach(() => {
  vi.stubEnv("REPO_ANTI_ROT_OWNER_TOKEN", KEY)
})
afterEach(() => vi.unstubAllEnvs())

describe("GET /api/unlock", () => {
  it("says whether this browser is the owner, not whether a key exists", async () => {
    const anon = await (await GET(new Request("https://x.test/api/unlock"))).json() as { owner: boolean; configured?: boolean }
    expect(anon.owner).toBe(false)
    expect(anon).not.toHaveProperty("configured")

    const owner = await (await GET(new Request("https://x.test/api/unlock", {
      headers: { cookie: `rar_owner=${KEY}` },
    }))).json() as { owner: boolean; configured?: boolean }
    expect(owner.owner).toBe(true)
    expect(owner).not.toHaveProperty("configured")
  })

  it("still hides `configured` when no owner token is set at all", async () => {
    vi.stubEnv("REPO_ANTI_ROT_OWNER_TOKEN", "")
    const body = await (await GET(new Request("https://x.test/api/unlock"))).json() as Record<string, unknown>
    expect(body.owner).toBe(false)
    expect(body).not.toHaveProperty("configured")
  })
})
