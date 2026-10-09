import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { runBackgroundScan, pendingScan } from "@/lib/scan-job-client"
import { report } from "./helpers"
vi.mock("@/lib/visitor", () => ({ usageHeaders: () => ({}) }))
const id = "c".repeat(64)
const url = "https://github.com/a/b"
const stored = { id, urls: [url] }
const completed = { status: "completed", progress: { fraction: 1, label: "Saved", reposDone: 1, reposTotal: 1 }, results: [{ url, ok: true, report: report([]) }], expiresAt: Date.now() + 86400000, archiveInfo: { originalBytes: 1000, compressedBytes: 100 } }
beforeEach(() => {
  const data = new Map<string, string>()
  vi.stubGlobal("localStorage", { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) })
  vi.stubGlobal("window", { dispatchEvent: vi.fn() })
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })
it("stores the recovery key before POST and keeps it after completion", async () => {
  const fetcher = vi.fn().mockImplementation(async (_url, init) => {
    if (init.method === "POST") { expect(pendingScan()).not.toBeNull(); return Response.json({ id: pendingScan()?.id }, { status: 202 }) }
    return Response.json(completed)
  })
  vi.stubGlobal("fetch", fetcher)
  const onArchive = vi.fn()
  expect(await runBackgroundScan([url], { onArchive })).toEqual(completed.results)
  expect(pendingScan()).not.toBeNull()
  expect(onArchive).toHaveBeenCalledWith({ expiresAt: completed.expiresAt, ...completed.archiveInfo })
})
it("reconnects without launching another scan", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(completed))
  vi.stubGlobal("fetch", fetcher)
  expect(await runBackgroundScan([url], {}, stored)).toEqual(completed.results)
  expect(fetcher).toHaveBeenCalledTimes(1)
  expect(fetcher.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${id}`)
})
it("retains recovery after a lost submission response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
  await expect(runBackgroundScan([url])).rejects.toThrow("offline")
  expect(pendingScan()).not.toBeNull()
})
it("explains expired jobs rather than endlessly polling", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 404 })))
  await expect(runBackgroundScan([url], {}, stored)).rejects.toThrow("expired")
})
it("surfaces archive failure for every missing repository", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...completed, status: "failed", results: [], error: "Archive too large; nothing truncated", archiveInfo: undefined })))
  expect(await runBackgroundScan([url], {}, stored)).toEqual([{ url, ok: false, error: "Archive too large; nothing truncated" }])
})
it("stops polling on abort without cancelling server work", async () => {
  const controller = new AbortController()
  controller.abort()
  const fetcher = vi.fn()
  vi.stubGlobal("fetch", fetcher)
  await expect(runBackgroundScan([url], { signal: controller.signal }, stored)).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
