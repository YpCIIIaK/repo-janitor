import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createScanJob, executeScanJob, getScanJob, type ScanJob } from "@/lib/scan-jobs"
import { readJob, writeJob, packResults } from "@/lib/scan-job-storage"
vi.mock("server-only", () => ({}))
vi.mock("@/lib/scan-job-storage", () => ({ readJob: vi.fn(), writeJob: vi.fn(), packResults: vi.fn() }))
const makeJob = (): ScanJob => ({ id: "b".repeat(64), worker: "worker", urls: ["https://github.com/a/b"], createdAt: Date.now(), expiresAt: Date.now() + 86400000, status: "queued", results: [], progress: { fraction: 0, label: "Queued", reposDone: 0, reposTotal: 1 } })
beforeEach(() => {
  vi.mocked(readJob).mockResolvedValue(null)
  vi.mocked(writeJob).mockResolvedValue(true)
  vi.mocked(packResults).mockResolvedValue({ archive: "gzip", compressedBytes: 4, originalBytes: 100 })
})
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks() })
it("creates a job with 24-hour retention", async () => {
  const { job, created } = await createScanJob("b".repeat(64), ["https://github.com/a/b"])
  expect(created).toBe(true)
  expect(job.expiresAt - job.createdAt).toBe(86400000)
})
it("reuses an existing capability without starting a second job", async () => {
  vi.mocked(readJob).mockResolvedValue(makeJob())
  expect((await createScanJob("b".repeat(64), ["x"])).created).toBe(false)
  expect(writeJob).not.toHaveBeenCalled()
})
it("rejects path traversal IDs without touching storage", async () => {
  expect(await getScanJob("../../secret")).toBeNull()
  expect(readJob).not.toHaveBeenCalled()
})
it("bounds orphaned work after restart", async () => {
  vi.mocked(readJob).mockResolvedValue({ ...makeJob(), createdAt: Date.now() - 721000 })
  expect(await getScanJob("b".repeat(64))).toMatchObject({ status: "failed", error: expect.stringContaining("deadline") })
})
it("throttles progress and writes one complete archive", async () => {
  const job = makeJob()
  await executeScanJob(job, async (emit) => {
    for (let n = 0; n < 100; n++) emit({ type: "scanner", completed: n, total: 100 })
    emit({ type: "repo-done", url: job.urls[0], ok: true, report: { all: "data" } })
  })
  expect(job.status).toBe("completed")
  expect(writeJob).toHaveBeenCalledTimes(3) // initial, saving, final
  expect(vi.mocked(writeJob).mock.calls.filter(([, options]) => options?.archive)).toHaveLength(1)
  expect(packResults).toHaveBeenCalledWith([{ url: job.urls[0], ok: true, report: { all: "data" }, error: undefined }])
})
it("archives partial results on task failure", async () => {
  const job = { ...makeJob(), urls: ["a", "b"] }
  await executeScanJob(job, async (emit) => { emit({ type: "repo-done", url: "a", ok: true, report: {} }); throw new Error("interrupted") })
  expect(job.status).toBe("failed")
  expect(packResults).toHaveBeenCalledWith([expect.objectContaining({ url: "a" })])
})
it("reports archive overflow explicitly, never stores truncated reports", async () => {
  vi.mocked(packResults).mockRejectedValue(new Error("Compressed limit exceeded; nothing was truncated"))
  const job = makeJob()
  await executeScanJob(job, async (emit) => { emit({ type: "repo-done", url: job.urls[0], ok: true, report: {} }) })
  expect(job).toMatchObject({ status: "failed", error: expect.stringContaining("nothing was truncated") })
  expect(vi.mocked(writeJob).mock.calls.some(([, options]) => options?.archive)).toBe(false)
})
