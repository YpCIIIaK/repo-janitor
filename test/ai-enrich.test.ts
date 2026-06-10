import { describe, it, expect, afterEach, beforeEach, vi } from "vitest"

// Mock the transport so no real network/proxy is hit; assert on what we'd send.
const fetchCompletion = vi.fn()
vi.mock("@/lib/ai-client", () => ({ fetchCompletion: (...a: unknown[]) => fetchCompletion(...a) }))

import { enrichReport, aiTargetCount, analyzeOneIssue } from "@/lib/ai-enrich"
import { saveAiSettings, DEFAULT_SETTINGS } from "@/lib/ai-settings"
import { clearAiCache } from "@/lib/ai-cache"
import { issue, report, installWindow } from "./helpers"

beforeEach(() => {
  installWindow()
  fetchCompletion.mockReset()
})
afterEach(() => vi.unstubAllGlobals())

/** Configure AI on with the given enabled categories. */
function enableAi(categories: string[]) {
  saveAiSettings({
    ...DEFAULT_SETTINGS,
    apiKey: "sk-test",
    model: "m",
    categories: { ...DEFAULT_SETTINGS.categories, ...Object.fromEntries(categories.map((c) => [c, true])) } as never,
  })
  clearAiCache()
}

describe("enrichReport", () => {
  it("is a no-op without an API key", async () => {
    const r = report([issue({ category: "hygiene" })])
    expect(await enrichReport(r)).toBe(r)
    expect(fetchCompletion).not.toHaveBeenCalled()
  })

  it("is a no-op when no category is enabled", async () => {
    saveAiSettings({ ...DEFAULT_SETTINGS, apiKey: "sk-test" })
    const r = report([issue({ category: "hygiene" })])
    expect(await enrichReport(r)).toBe(r)
    expect(fetchCompletion).not.toHaveBeenCalled()
  })

  it("attaches a verdict per finding in enabled categories", async () => {
    enableAi(["hygiene"])
    fetchCompletion.mockResolvedValue("1: Add it\n2: Safe to ignore")
    const r = report([
      issue({ id: "a", category: "hygiene" }),
      issue({ id: "b", category: "hygiene" }),
    ])
    const out = await enrichReport(r)
    expect(out.issues.find((i) => i.id === "a")?.aiNote).toBe("Add it")
    expect(out.issues.find((i) => i.id === "b")?.aiNote).toBe("Safe to ignore")
    expect(fetchCompletion).toHaveBeenCalledOnce() // one batched request
  })

  it("leaves findings in disabled categories untouched", async () => {
    enableAi(["hygiene"])
    fetchCompletion.mockResolvedValue("1: Add it")
    const out = await enrichReport(
      report([issue({ id: "a", category: "hygiene" }), issue({ id: "b", category: "security" })]),
    )
    expect(out.issues.find((i) => i.id === "b")?.aiNote).toBeUndefined()
  })

  it("re-uses cached verdicts on a second run without re-asking", async () => {
    enableAi(["hygiene"])
    fetchCompletion.mockResolvedValue("1: Add it")
    const r = report([issue({ id: "a", category: "hygiene" })])
    await enrichReport(r)
    fetchCompletion.mockClear()
    const out = await enrichReport(r)
    expect(fetchCompletion).not.toHaveBeenCalled()
    expect(out.issues[0].aiNote).toBe("Add it")
  })

  it("reports progress for the new analyses", async () => {
    enableAi(["hygiene"])
    fetchCompletion.mockResolvedValue("1: Add it")
    const onProgress = vi.fn()
    await enrichReport(report([issue({ id: "a", category: "hygiene" })]), { onProgress })
    expect(onProgress).toHaveBeenCalledWith(0, 1)
    expect(onProgress).toHaveBeenLastCalledWith(1, 1)
  })
})

describe("aiTargetCount", () => {
  it("is 0 without a key or enabled category", () => {
    expect(aiTargetCount(report([issue()]))).toBe(0)
  })

  it("counts uncached findings in enabled categories", async () => {
    enableAi(["hygiene"])
    const r = report([issue({ id: "a", category: "hygiene" }), issue({ id: "b", category: "security" })])
    expect(aiTargetCount(r)).toBe(1) // only the hygiene one
    fetchCompletion.mockResolvedValue("1: Add it")
    await enrichReport(r)
    expect(aiTargetCount(r)).toBe(0) // now cached
  })
})

describe("analyzeOneIssue", () => {
  it("returns null without a key", async () => {
    const settings = { ...DEFAULT_SETTINGS, apiKey: "" }
    expect(await analyzeOneIssue(issue(), settings)).toBeNull()
  })

  it("returns the single verdict, ignoring category toggles", async () => {
    fetchCompletion.mockResolvedValue("Rotate now")
    const settings = { ...DEFAULT_SETTINGS, apiKey: "sk-test" }
    expect(await analyzeOneIssue(issue({ id: "x", category: "security" }), settings)).toBe("Rotate now")
  })
})
