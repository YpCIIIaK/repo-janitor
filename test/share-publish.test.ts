import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { promises as fs } from "fs"
import { join } from "path"
import type { SharedReport } from "@/lib/share-report"

vi.mock("server-only", () => ({}))

const report = (owner = "acme", name = "widget", score = 72): SharedReport => ({
  repo: { owner, name },
  generatedAt: "2026-07-27T10:00:00.000Z",
  score,
  grade: score >= 80 ? "B" : "C",
  counts: { critical: 0, warning: 6, info: 20 },
  byCategory: [{ category: "dependency", count: 12 }],
  totalIssues: 26,
  topIssues: [{ title: "lodash is outdated", category: "dependency", severity: "warning" }],
})

describe("publishShare / revokeShare (filesystem)", () => {
  const dir = join(process.cwd(), ".repo-anti-rot", "shared")
  const saved = { ...process.env }

  beforeEach(() => {
    vi.resetModules()
    delete process.env.SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  })

  afterEach(async () => {
    process.env = { ...saved }
    // Best-effort cleanup of tokens we may have written in this suite.
    try {
      const names = await fs.readdir(dir)
      await Promise.all(
        names
          .filter((n) => n.endsWith(".json"))
          .map((n) => fs.rm(join(dir, n), { force: true })),
      )
      await fs.rm(join(dir, "by-repo"), { recursive: true, force: true })
    } catch {
      /* empty */
    }
  })

  it("creates a manageable share and keeps the token on update", async () => {
    const { publishShare, getShare } = await import("@/lib/share-store")

    const created = await publishShare(report("Acme", "StableOne"))
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const token = created.share.token
    const manageKey = created.manageKey
    expect(created.created).toBe(true)
    expect(manageKey.length).toBeGreaterThanOrEqual(16)

    const updated = await publishShare(report("Acme", "StableOne", 91), { manageKey })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.created).toBe(false)
    expect(updated.share.token).toBe(token)
    expect(updated.share.report.score).toBe(91)

    const loaded = await getShare(token)
    expect(loaded?.report.score).toBe(91)
  })

  it("refuses update without the manage key", async () => {
    const { publishShare } = await import("@/lib/share-store")
    const created = await publishShare(report("Acme", "NoKey"))
    expect(created.ok).toBe(true)

    const again = await publishShare(report("Acme", "NoKey", 10))
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.code).toBe("missing_key")
  })

  it("refuses a wrong manage key", async () => {
    const { publishShare, newShareToken } = await import("@/lib/share-store")
    const created = await publishShare(report("Acme", "WrongKey"))
    expect(created.ok).toBe(true)

    const again = await publishShare(report("Acme", "WrongKey", 10), {
      manageKey: newShareToken(),
    })
    expect(again.ok).toBe(false)
    if (again.ok) return
    expect(again.code).toBe("forbidden")
  })

  it("rotates the public token and keeps the manage key", async () => {
    const { publishShare, getShare } = await import("@/lib/share-store")
    const created = await publishShare(report("Acme", "RotateMe"))
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const oldToken = created.share.token
    const rotated = await publishShare(report("Acme", "RotateMe", 55), {
      manageKey: created.manageKey,
      rotate: true,
    })
    expect(rotated.ok).toBe(true)
    if (!rotated.ok) return
    expect(rotated.share.token).not.toBe(oldToken)
    expect(await getShare(oldToken)).toBeNull()
    expect(await getShare(rotated.share.token)).not.toBeNull()
  })

  it("revokes so the token no longer resolves", async () => {
    const { publishShare, revokeShare, getShare } = await import("@/lib/share-store")
    const created = await publishShare(report("Acme", "RevokeMe"))
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const revoked = await revokeShare({
      token: created.share.token,
      manageKey: created.manageKey,
    })
    expect(revoked).toEqual({ ok: true })
    expect(await getShare(created.share.token)).toBeNull()

    // A fresh publish can mint a new stable link after revoke.
    const again = await publishShare(report("Acme", "RevokeMe"))
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.share.token).not.toBe(created.share.token)
  })

  it("looks up the live share by repo key case-insensitively", async () => {
    const { publishShare, getShareByRepoKey } = await import("@/lib/share-store")
    const created = await publishShare(report("Acme", "ByKey"))
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const hit = await getShareByRepoKey("acme/bykey")
    expect(hit?.token).toBe(created.share.token)
    expect(hit?.report.score).toBe(72)
  })

  it("updates updatedAt when the snapshot is refreshed", async () => {
    const { publishShare } = await import("@/lib/share-store")
    const created = await publishShare(report("Acme", "Stamp"))
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const firstUpdated = created.share.updatedAt

    await new Promise((r) => setTimeout(r, 5))
    const updated = await publishShare(report("Acme", "Stamp", 80), {
      manageKey: created.manageKey,
    })
    expect(updated.ok).toBe(true)
    if (!updated.ok) return
    expect(updated.share.updatedAt >= firstUpdated).toBe(true)
    expect(updated.share.createdAt).toBe(created.share.createdAt)
  })
})
