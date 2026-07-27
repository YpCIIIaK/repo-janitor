import { describe, it, expect, afterEach } from "vitest"
import { LEGACY_ENV_ALIASES, readEnv } from "@/lib/env"

/**
 * The project shipped two prefixes for one thing: `REPO_ANTI_ROT_*` and `RAR_*`.
 * Unifying them is only safe if the old spellings keep resolving — renaming an
 * environment variable breaks nothing loudly. The deploy still succeeds and the
 * feature just stops, which for a score-drop webhook is indistinguishable from
 * "no score ever dropped".
 */
describe("readEnv", () => {
  const saved = { ...process.env }
  afterEach(() => {
    process.env = { ...saved }
  })

  it("reads the current name", () => {
    process.env.REPO_ANTI_ROT_WEBHOOK_URL = "https://new.example/hook"
    expect(readEnv("REPO_ANTI_ROT_WEBHOOK_URL")).toBe("https://new.example/hook")
  })

  it("falls back to the deprecated RAR_ spelling", () => {
    delete process.env.REPO_ANTI_ROT_WEBHOOK_URL
    process.env.RAR_WEBHOOK_URL = "https://old.example/hook"
    expect(readEnv("REPO_ANTI_ROT_WEBHOOK_URL")).toBe("https://old.example/hook")
  })

  it("prefers the current name when both are set", () => {
    process.env.REPO_ANTI_ROT_WEBHOOK_URL = "https://new.example/hook"
    process.env.RAR_WEBHOOK_URL = "https://old.example/hook"
    expect(readEnv("REPO_ANTI_ROT_WEBHOOK_URL")).toBe("https://new.example/hook")
  })

  it("treats an explicitly empty current value as set, not as absent", () => {
    // Otherwise clearing a token in the new variable would silently resurrect a
    // stale one from the old — the opposite of what the operator asked for.
    process.env.REPO_ANTI_ROT_AI_PROXY_TOKEN = ""
    process.env.RAR_AI_PROXY_TOKEN = "stale-token"
    expect(readEnv("REPO_ANTI_ROT_AI_PROXY_TOKEN")).toBe("")
  })

  it("returns undefined when neither is set", () => {
    delete process.env.REPO_ANTI_ROT_WEBHOOK_URL
    delete process.env.RAR_WEBHOOK_URL
    expect(readEnv("REPO_ANTI_ROT_WEBHOOK_URL")).toBeUndefined()
  })

  it("has no fallback for names that never had one", () => {
    delete process.env.REPO_ANTI_ROT_READ_TOKEN
    expect(readEnv("REPO_ANTI_ROT_READ_TOKEN")).toBeUndefined()
  })

  it("covers every variable that was renamed", () => {
    expect(Object.keys(LEGACY_ENV_ALIASES).sort()).toEqual([
      "REPO_ANTI_ROT_AI_PROXY_TOKEN",
      "REPO_ANTI_ROT_DASHBOARD_URL",
      "REPO_ANTI_ROT_WEBHOOK_MIN_DROP",
      "REPO_ANTI_ROT_WEBHOOK_URL",
    ])
    // Every alias must actually be the old RAR_ spelling of its key.
    for (const [current, legacy] of Object.entries(LEGACY_ENV_ALIASES)) {
      expect(legacy.startsWith("RAR_")).toBe(true)
      expect(current.startsWith("REPO_ANTI_ROT_")).toBe(true)
    }
  })
})
