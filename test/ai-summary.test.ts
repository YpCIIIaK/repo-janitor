import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

const fetchCompletion = vi.fn()
vi.mock("@/lib/ai-client", () => ({ fetchCompletion: (...a: unknown[]) => fetchCompletion(...a) }))

import { generateSummary, getCachedSummary, type SummaryInput } from "@/lib/ai-summary"
import { saveAiSettings, DEFAULT_SETTINGS } from "@/lib/ai-settings"
import { issue, installWindow } from "./helpers"

beforeEach(() => {
  installWindow()
  fetchCompletion.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

const input = (over: Partial<SummaryInput> = {}): SummaryInput => ({
  repoId: "acme/widget",
  owner: "acme",
  name: "widget",
  issues: [issue({ id: "a" }), issue({ id: "b" })],
  ...over,
})

describe("generateSummary", () => {
  it("returns null when no API key is configured", async () => {
    expect(await generateSummary(input())).toBeNull()
    expect(fetchCompletion).not.toHaveBeenCalled()
  })

  it("generates, trims and caches a summary", async () => {
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m" })
    fetchCompletion.mockResolvedValue("  Grade B: solid but watch the deps.  ")
    const first = await generateSummary(input())
    expect(first).toEqual({ summary: "Grade B: solid but watch the deps.", cached: false })

    // Second call for the same finding set is served from cache (no new request).
    fetchCompletion.mockClear()
    const second = await generateSummary(input())
    expect(second).toEqual({ summary: "Grade B: solid but watch the deps.", cached: true })
    expect(fetchCompletion).not.toHaveBeenCalled()
  })

  it("force-regenerates past the cache", async () => {
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m" })
    fetchCompletion.mockResolvedValue("v1")
    await generateSummary(input())
    fetchCompletion.mockResolvedValue("v2")
    const forced = await generateSummary(input(), { force: true })
    expect(forced).toEqual({ summary: "v2", cached: false })
  })

  it("returns null and caches nothing when the model gives nothing", async () => {
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m" })
    fetchCompletion.mockResolvedValue(null)
    expect(await generateSummary(input())).toBeNull()
    expect(getCachedSummary("m", "acme/widget", ["a", "b"])).toBeNull()
  })
})

describe("web search", () => {
  it("requests web search when enabled AND an advisory-bearing finding is present", async () => {
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m", webSearch: true })
    fetchCompletion.mockResolvedValue("summary")
    await generateSummary(input({ issues: [issue({ id: "a", category: "security" })] }))
    expect(fetchCompletion.mock.calls[0][0]).toMatchObject({ web: true })
  })

  it("does NOT request web search when no security/dependency finding is present", async () => {
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m", webSearch: true })
    fetchCompletion.mockResolvedValue("summary")
    await generateSummary(input({ issues: [issue({ id: "a", category: "hygiene" })] }))
    expect(fetchCompletion.mock.calls[0][0]).toMatchObject({ web: false })
  })

  it("does NOT request web search when the toggle is off", async () => {
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m", webSearch: false })
    fetchCompletion.mockResolvedValue("summary")
    await generateSummary(input({ issues: [issue({ id: "a", category: "security" })] }))
    expect(fetchCompletion.mock.calls[0][0]).toMatchObject({ web: false })
  })

  it("caches web summaries apart from non-web (toggling re-asks)", async () => {
    const sec = [issue({ id: "a", category: "security" })]
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m", webSearch: false })
    fetchCompletion.mockResolvedValue("non-web summary")
    await generateSummary(input({ issues: sec }))
    // Flip web on: the non-web summary lives under a different namespace.
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m", webSearch: true })
    fetchCompletion.mockClear()
    fetchCompletion.mockResolvedValue("web summary")
    const res = await generateSummary(input({ issues: sec }))
    expect(fetchCompletion).toHaveBeenCalledOnce()
    expect(res).toEqual({ summary: "web summary", cached: false })
  })
})

describe("getCachedSummary fingerprint", () => {
  it("is order-independent over the finding set", async () => {
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m" })
    fetchCompletion.mockResolvedValue("summary")
    await generateSummary(input({ issues: [issue({ id: "a" }), issue({ id: "b" })] }))
    // Same ids, reversed order → same cache key.
    expect(getCachedSummary("m", "acme/widget", ["b", "a"])).toBe("summary")
  })

  it("misses when the finding set changes", async () => {
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test", model: "m" })
    fetchCompletion.mockResolvedValue("summary")
    await generateSummary(input({ issues: [issue({ id: "a" })] }))
    expect(getCachedSummary("m", "acme/widget", ["a", "c"])).toBeNull()
  })
})
