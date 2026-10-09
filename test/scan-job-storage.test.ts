import { afterEach, expect, it, vi } from "vitest"
import { packResults, unpackResults, readJob, writeJob } from "@/lib/scan-job-storage"
import type { ScanJob } from "@/lib/scan-jobs"
import { report } from "./helpers"
import { randomBytes } from "node:crypto"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/share-db", () => ({
  supabaseConfig: () => ({ url: "https://example.supabase.co", serviceKey: "test" }),
  restHeaders: () => ({ Authorization: "Bearer test" }),
  withTimeout: (_ms: number, fn: (signal: AbortSignal) => unknown) => fn(new AbortController().signal),
}))
afterEach(() => vi.unstubAllGlobals())
const job: ScanJob = { id: "a".repeat(64), worker: "worker", urls: ["https://github.com/a/b"], createdAt: Date.now(), expiresAt: Date.now() + 86400000, status: "running", results: [], progress: { fraction: 0, label: "Scanning", reposDone: 0, reposTotal: 1 } }

it("round trips the full report including unicode and long repeated data", async () => {
  const results = [{ url: job.urls[0], ok: true, report: { ...report([]), extra: "Полный отчёт 🚀".repeat(10000) } }]
  const packed = await packResults(results)
  expect(packed.compressedBytes).toBeLessThan(packed.originalBytes / 10)
  expect(await unpackResults(packed.archive)).toEqual(results)
})
it("rejects corrupt archives", async () => {
  await expect(unpackResults("not-gzip")).rejects.toThrow()
})
it("refuses incompressible reports above the gzip limit without truncation", async () => {
  const results = [{ url: job.urls[0], ok: false, error: randomBytes(2300000).toString("base64") }]
  await expect(packResults(results)).rejects.toThrow("Nothing was truncated")
  expect(results[0].error.length).toBeGreaterThan(3000000)
})
it("rejects oversized encoded archives before decompression", async () => {
  await expect(unpackResults("a".repeat(3 * 1024 * 1024))).rejects.toThrow("size")
})
it("polls metadata without requesting archive payloads", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json([{ metadata: job }]))
  vi.stubGlobal("fetch", fetcher)
  expect((await readJob(job.id))?.results).toEqual([])
  const url = new URL(fetcher.mock.calls[0][0])
  expect(url.searchParams.get("select")).toBe("metadata")
})
it("decodes archive only when explicitly requested", async () => {
  const results = [{ url: job.urls[0], ok: true, report: report([]) }]
  const packed = await packResults(results)
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([{ metadata: job, archive: packed.archive }])))
  expect((await readJob(job.id, true))?.results).toEqual(results)
})
it("does not disguise database errors as missing jobs or fall back to disk", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 503 })))
  await expect(readJob(job.id)).rejects.toThrow("503")
})
it("progress writes exclude full report results", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json([{ id: job.id }]))
  vi.stubGlobal("fetch", fetcher)
  await writeJob({ ...job, results: [{ url: "a", ok: true, report: report([]) }] })
  const body = JSON.parse(fetcher.mock.calls[0][1].body)
  expect(body.metadata.results).toBeUndefined()
  expect(body.archive).toBeUndefined()
})
it("detects idempotent insert conflict", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])))
  expect(await writeJob(job, { insert: true })).toBe(false)
})
it("does not claim a write succeeded when the row vanished", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json([])))
  await expect(writeJob(job)).rejects.toThrow("disappeared")
})
