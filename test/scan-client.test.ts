import { afterEach, expect, it, vi } from "vitest"
import { runScanStream } from "@/lib/scan-client"
import { report } from "./helpers"

vi.mock("@/lib/visitor", () => ({ usageHeaders: () => ({}) }))
afterEach(() => vi.unstubAllGlobals())
const a = "https://github.com/acme/a"
const b = "https://github.com/acme/b"
const result = { type: "repo-done", url: a, ok: true, report: report([]) }
function respond(text: string) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(text)))
}

it("parses a final result without a newline", async () => {
  respond(JSON.stringify(result))
  expect(await runScanStream([a])).toMatchObject([{ url: a, ok: true }])
})

it("does not call an empty or truncated stream a success", async () => {
  respond('{"type":"start","total":1}\n{"type":"repo-done"')
  expect(await runScanStream([a])).toMatchObject([{ url: a, ok: false, error: expect.stringContaining("ended") }])
})

it("preserves completed results when reading the next chunk fails", async () => {
  let reads = 0
  const stream = new ReadableStream({ pull(controller) {
    if (reads++ === 0) controller.enqueue(new TextEncoder().encode(JSON.stringify(result) + "\n"))
    else controller.error(new Error("disconnected"))
  } })
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream)))
  const onResult = vi.fn()
  expect(await runScanStream([a, b], { onResult })).toMatchObject([
    { url: a, ok: true }, { url: b, ok: false, error: expect.stringContaining("interrupted") },
  ])
  expect(onResult).toHaveBeenCalledTimes(1)
})

it("ignores duplicate and unsolicited results", async () => {
  respond([result, result, { ...result, url: b }].map((r) => JSON.stringify(r)).join("\n"))
  expect(await runScanStream([a])).toHaveLength(1)
})

it("shows queue and history phases without reporting premature completion", async () => {
  respond([ { type: "queued", url: a, position: 2 }, { type: "phase", url: a, phase: "activity" }, result ].map((r) => JSON.stringify(r)).join("\n"))
  const onProgress = vi.fn()
  await runScanStream([a], { onProgress })
  expect(onProgress.mock.calls[0][0].label).toContain("queue 2")
  expect(onProgress.mock.calls[1][0]).toMatchObject({ label: "Loading commit history…", fraction: 0.95 })
})

it("does not accept a successful result without a report", async () => {
  respond(JSON.stringify({ type: "repo-done", url: a, ok: true }))
  expect(await runScanStream([a])).toMatchObject([{ ok: false }])
})
