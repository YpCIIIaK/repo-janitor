import { describe, it, expect, afterEach, vi } from "vitest"
import { fetchCompletion, MAX_RETRIES, type CompletionBody } from "@/lib/ai-client"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

const body: CompletionBody = { apiKey: "k", model: "m", system: "s", prompt: "p", maxTokens: 100 }

/** Minimal fetch Response stand-in (only the fields fetchCompletion reads). */
function res(opts: { ok?: boolean; status?: number; text?: string; retryAfter?: string }) {
  return {
    ok: opts.ok ?? false,
    status: opts.status ?? 200,
    headers: { get: (h: string) => (h === "retry-after" ? opts.retryAfter ?? null : null) },
    json: async () => ({ text: opts.text }),
  }
}

describe("fetchCompletion", () => {
  it("returns the text on a 200", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ ok: true, status: 200, text: "hello" }))
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchCompletion(body)).toBe("hello")
    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe("/api/ai/complete")
  })

  it("returns null on a network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")))
    expect(await fetchCompletion(body)).toBeNull()
  })

  it("returns null for a non-retryable 4xx without retrying", async () => {
    const fetchMock = vi.fn().mockResolvedValue(res({ status: 400 }))
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchCompletion(body)).toBeNull()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it("backs off then succeeds after a 429", async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({ status: 429 }))
      .mockResolvedValueOnce(res({ ok: true, status: 200, text: "ok" }))
    vi.stubGlobal("fetch", fetchMock)
    const p = fetchCompletion(body)
    await vi.runAllTimersAsync()
    expect(await p).toBe("ok")
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("gives up after MAX_RETRIES on persistent 5xx", async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(res({ status: 503 }))
    vi.stubGlobal("fetch", fetchMock)
    const p = fetchCompletion(body)
    await vi.runAllTimersAsync()
    expect(await p).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(MAX_RETRIES + 1)
  })

  it("honors a numeric retry-after header", async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(res({ status: 429, retryAfter: "2" }))
      .mockResolvedValueOnce(res({ ok: true, status: 200, text: "done" }))
    vi.stubGlobal("fetch", fetchMock)
    const p = fetchCompletion(body)
    await vi.runAllTimersAsync()
    expect(await p).toBe("done")
  })
})
