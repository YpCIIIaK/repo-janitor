import { describe, it, expect, afterEach, vi } from "vitest"
import { getCachedNotes, putCachedNotes, clearAiCache } from "@/lib/ai-cache"
import { installWindow } from "./helpers"

afterEach(() => vi.unstubAllGlobals())

describe("getCachedNotes / putCachedNotes", () => {
  it("returns nothing without a window", () => {
    expect(getCachedNotes("m", ["a"]).size).toBe(0)
  })

  it("stores and retrieves notes by model + issue id", () => {
    installWindow()
    putCachedNotes("m", [["a", "Keep"], ["b", "Remove"]])
    const got = getCachedNotes("m", ["a", "b", "c"])
    expect(got.get("a")).toBe("Keep")
    expect(got.get("b")).toBe("Remove")
    expect(got.has("c")).toBe(false)
  })

  it("scopes the cache by model", () => {
    installWindow()
    putCachedNotes("m1", [["a", "v1"]])
    expect(getCachedNotes("m2", ["a"]).has("a")).toBe(false)
    expect(getCachedNotes("m1", ["a"]).get("a")).toBe("v1")
  })

  it("ignores an empty write", () => {
    const storage = installWindow()
    putCachedNotes("m", [])
    expect(storage.getItem("repo-anti-rot:ai-cache:v1")).toBeNull()
  })

  it("evicts the oldest entries past the cap", () => {
    installWindow()
    const ids = Array.from({ length: 2005 }, (_, i) => `id${i}`)
    putCachedNotes("m", ids.map((id) => [id, "v"] as [string, string]))
    // The first 5 inserted should have been trimmed; the last ones survive.
    expect(getCachedNotes("m", ["id0", "id4"]).size).toBe(0)
    expect(getCachedNotes("m", ["id2004"]).get("id2004")).toBe("v")
  })
})

describe("clearAiCache", () => {
  it("wipes every cached verdict", () => {
    const storage = installWindow()
    putCachedNotes("m", [["a", "v"]])
    clearAiCache()
    expect(storage.getItem("repo-anti-rot:ai-cache:v1")).toBeNull()
    expect(getCachedNotes("m", ["a"]).size).toBe(0)
  })
})
