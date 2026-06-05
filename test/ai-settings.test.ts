import { describe, it, expect, afterEach, vi } from "vitest"
import {
  DEFAULT_SETTINGS,
  ALL_CATEGORIES,
  isAiEnabled,
  enabledCategories,
  readAiSettings,
  saveAiSettings,
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
    expect(isAiEnabled(settings({ apiKey: "", categories: { secret: true } }))).toBe(false)
  })

  it("is false with a key but no enabled category", () => {
    expect(isAiEnabled(settings({ apiKey: "k" }))).toBe(false)
  })

  it("is true with a key and at least one category", () => {
    expect(isAiEnabled(settings({ apiKey: "k", categories: { secret: true } }))).toBe(true)
  })

  it("treats a whitespace-only key as unset", () => {
    expect(isAiEnabled(settings({ apiKey: "   ", categories: { secret: true } }))).toBe(false)
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
    saveAiSettings(settings({ apiKey: "sk-test", model: "m", categories: { secret: true } }))
    const read = readAiSettings()
    expect(read.apiKey).toBe("sk-test")
    expect(read.model).toBe("m")
    expect(read.categories.secret).toBe(true)
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

  it("recovers from corrupt JSON", () => {
    const storage = installWindow()
    storage.setItem("repo-anti-rot:ai-settings:v1", "{not json")
    expect(readAiSettings()).toEqual(DEFAULT_SETTINGS)
  })
})

describe("DEFAULT_SETTINGS", () => {
  it("has a known category for every enrichable category", () => {
    expect(Object.keys(DEFAULT_SETTINGS.categories).sort()).toEqual([...ALL_CATEGORIES].sort())
    expect(ALL_CATEGORIES.every((c) => DEFAULT_SETTINGS.categories[c] === false)).toBe(true)
  })
})
