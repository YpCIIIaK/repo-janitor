import { describe, it, expect } from "vitest"
import { loadConfig, defaultConfig, DEFAULT_WEIGHTS, CONFIG_FILENAME } from "../src/index"

/** A reader that returns the given content for CONFIG_FILENAME, null otherwise. */
function reader(content: string | null) {
  return async (path: string) => (path === CONFIG_FILENAME ? content : null)
}

describe("loadConfig", () => {
  it("returns defaults when no config file exists", async () => {
    const cfg = await loadConfig(reader(null))
    expect(cfg).toEqual(defaultConfig())
    expect(cfg.weights).toEqual(DEFAULT_WEIGHTS)
    expect(cfg.ignore).toEqual([])
  })

  it("merges weight overrides over the defaults", async () => {
    const cfg = await loadConfig(reader(JSON.stringify({ weights: { critical: 20 } })))
    expect(cfg.weights).toEqual({ critical: 20, warning: 3, info: 0.5 })
  })

  it("reads ignore globs", async () => {
    const cfg = await loadConfig(reader(JSON.stringify({ ignore: ["dist/**", "*.gen.ts"] })))
    expect(cfg.ignore).toEqual(["dist/**", "*.gen.ts"])
  })

  it("falls back to defaults and warns on invalid JSON", async () => {
    const warnings: string[] = []
    const cfg = await loadConfig(reader("{ not json "), (m) => warnings.push(m))
    expect(cfg).toEqual(defaultConfig())
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain("not valid JSON")
  })

  it("falls back to defaults and warns on invalid fields", async () => {
    const warnings: string[] = []
    const cfg = await loadConfig(reader(JSON.stringify({ weights: { critical: -5 } })), (m) =>
      warnings.push(m),
    )
    expect(cfg).toEqual(defaultConfig())
    expect(warnings[0]).toContain("invalid fields")
  })

  it("tolerates unknown forward-compat keys", async () => {
    const cfg = await loadConfig(reader(JSON.stringify({ futureOption: true, ignore: ["x"] })))
    expect(cfg.ignore).toEqual(["x"])
  })
})
