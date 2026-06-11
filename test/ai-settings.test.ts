import { describe, it, expect, afterEach, vi } from "vitest"
import {
  DEFAULT_SETTINGS,
  ALL_CATEGORIES,
  isAiEnabled,
  enabledCategories,
  readAiSettings,
  saveAiSettings,
  aiCacheModel,
  aiBudget,
  isLargeContextModel,
  modelContextTokens,
  type AiSettings,
} from "@/lib/ai-settings"
import type { IssueCategory } from "@/lib/mock-data"
import { installWindow } from "./helpers"

afterEach(() => vi.unstubAllGlobals())

const settings = (
  over: Partial<Omit<AiSettings, "categories">> & { categories?: Partial<Record<IssueCategory, boolean>> } = {},
): AiSettings => ({
  ...DEFAULT_SETTINGS,
  ...over,
  categories: { ...DEFAULT_SETTINGS.categories, ...over.categories },
})

describe("isAiEnabled", () => {
  it("is false without a key", () => {
    expect(isAiEnabled(settings({ apiKey: "", categories: { security: true } }))).toBe(false)
  })

  it("is false with a key but no enabled category", () => {
    expect(isAiEnabled(settings({ apiKey: "k" }))).toBe(false)
  })

  it("is true with a key and at least one category", () => {
    expect(isAiEnabled(settings({ apiKey: "k", categories: { security: true } }))).toBe(true)
  })

  it("treats a whitespace-only key as unset", () => {
    expect(isAiEnabled(settings({ apiKey: "   ", categories: { security: true } }))).toBe(false)
  })
})

describe("enabledCategories", () => {
  it("returns the on categories in ALL_CATEGORIES order", () => {
    const s = settings({ categories: { todo: true, "dead-code": true } })
    expect(enabledCategories(s)).toEqual(["dead-code", "todo"])
  })

  it("returns [] when none are enabled", () => {
    expect(enabledCategories(DEFAULT_SETTINGS)).toEqual([])
  })
})

describe("readAiSettings / saveAiSettings", () => {
  it("falls back to defaults without a window", () => {
    expect(readAiSettings()).toEqual(DEFAULT_SETTINGS)
  })

  it("round-trips through localStorage", () => {
    installWindow()
    saveAiSettings(settings({ apiKey: "sk-test", model: "m", categories: { security: true } }))
    const read = readAiSettings()
    expect(read.apiKey).toBe("sk-test")
    expect(read.model).toBe("m")
    expect(read.categories.security).toBe(true)
  })

  it("normalizes an empty model back to the default", () => {
    installWindow()
    saveAiSettings(settings({ apiKey: "k", model: "   " }))
    expect(readAiSettings().model).toBe(DEFAULT_SETTINGS.model)
  })

  it("migrates the legacy deadCodeEnabled toggle", () => {
    const storage = installWindow()
    storage.setItem("repo-anti-rot:ai-settings:v1", JSON.stringify({ apiKey: "k", deadCodeEnabled: true }))
    expect(readAiSettings().categories["dead-code"]).toBe(true)
  })

  it("migrates the legacy `secret` category toggle into `security`", () => {
    const storage = installWindow()
    storage.setItem(
      "repo-anti-rot:ai-settings:v1",
      JSON.stringify({ apiKey: "k", categories: { secret: true } }),
    )
    expect(readAiSettings().categories.security).toBe(true)
  })

  it("recovers from corrupt JSON", () => {
    const storage = installWindow()
    storage.setItem("repo-anti-rot:ai-settings:v1", "{not json")
    expect(readAiSettings()).toEqual(DEFAULT_SETTINGS)
  })
})

describe("web search", () => {
  it("defaults to off", () => {
    expect(DEFAULT_SETTINGS.webSearch).toBe(false)
  })

  it("round-trips the webSearch toggle through localStorage", () => {
    installWindow()
    saveAiSettings(settings({ apiKey: "k", webSearch: true }))
    expect(readAiSettings().webSearch).toBe(true)
  })

  it("defaults webSearch to false for legacy settings that lack it", () => {
    const storage = installWindow()
    storage.setItem("repo-anti-rot:ai-settings:v1", JSON.stringify({ apiKey: "k", model: "m" }))
    expect(readAiSettings().webSearch).toBe(false)
  })

  it("aiCacheModel namespaces web verdicts apart from non-web", () => {
    expect(aiCacheModel(settings({ model: "m", webSearch: false }))).toBe("m")
    expect(aiCacheModel(settings({ model: "m", webSearch: true }))).toBe("m::web")
  })
})

describe("context budget", () => {
  it("reports the exact window for a known preset", () => {
    expect(modelContextTokens("nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(1_000_000)
    expect(modelContextTokens("qwen/qwen-2.5-coder-32b-instruct")).toBe(32_768)
  })

  it("infers a window from size hints in a custom id", () => {
    expect(modelContextTokens("vendor/some-1m-model")).toBe(1_000_000)
    expect(modelContextTokens("vendor/model-200k")).toBe(200_000)
  })

  it("assumes a conservative window for an unknown id", () => {
    expect(modelContextTokens("vendor/mystery")).toBe(128_000)
  })

  it("flags large-context models and not small ones", () => {
    expect(isLargeContextModel("nvidia/nemotron-3-ultra-550b-a55b:free")).toBe(true)
    expect(isLargeContextModel("google/gemini-2.0-flash-exp:free")).toBe(true)
    expect(isLargeContextModel("openai/gpt-oss-120b:free")).toBe(false)
    expect(isLargeContextModel("qwen/qwen-2.5-coder-32b-instruct")).toBe(false)
  })

  it("gives a large model a bigger budget than a small one", () => {
    const big = aiBudget(settings({ model: "nvidia/nemotron-3-ultra-550b-a55b:free" }))
    const small = aiBudget(settings({ model: "openai/gpt-oss-120b:free" }))
    expect(big.maxIssues).toBeGreaterThan(small.maxIssues)
    expect(big.batchSize).toBeGreaterThan(small.batchSize)
    expect(big.summaryTopFindings).toBeGreaterThan(small.summaryTopFindings)
  })
})

describe("DEFAULT_SETTINGS", () => {
  it("has a known category for every enrichable category", () => {
    expect(Object.keys(DEFAULT_SETTINGS.categories).sort()).toEqual([...ALL_CATEGORIES].sort())
    expect(ALL_CATEGORIES.every((c) => DEFAULT_SETTINGS.categories[c] === false)).toBe(true)
  })
})
