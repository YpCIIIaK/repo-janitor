import { describe, it, expect } from "vitest"
import { loadConfig, defaultConfig, DEFAULT_WEIGHTS, CONFIG_FILENAME, isMuted } from "../src/index"
import type { Issue } from "../src/index"

/** Minimal Issue for mute-matching tests. */
function issue(partial: Partial<Issue>): Issue {
  return {
    id: "x",
    category: "todo",
    severity: "info",
    title: "t",
    location: "src/a.ts:1",
    detail: "d",
    ...partial,
  } as Issue
}

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

  it("reads mute rules", async () => {
    const cfg = await loadConfig(
      reader(JSON.stringify({ mute: [{ category: "todo", path: "legacy/**", reason: "ok" }] })),
    )
    expect(cfg.mute).toEqual([{ category: "todo", path: "legacy/**", reason: "ok" }])
  })

  it("rejects a mute rule with no id/category/path", async () => {
    const warnings: string[] = []
    const cfg = await loadConfig(reader(JSON.stringify({ mute: [{ reason: "x" }] })), (m) =>
      warnings.push(m),
    )
    expect(cfg).toEqual(defaultConfig())
    expect(warnings[0]).toContain("invalid fields")
  })
})

describe("isMuted", () => {
  it("matches by exact id", () => {
    expect(isMuted(issue({ id: "todo-a.ts:5" }), [{ id: "todo-a.ts:5" }])).toBe(true)
    expect(isMuted(issue({ id: "todo-a.ts:6" }), [{ id: "todo-a.ts:5" }])).toBe(false)
  })

  it("matches by category", () => {
    expect(isMuted(issue({ category: "dead-code" }), [{ category: "dead-code" }])).toBe(true)
    expect(isMuted(issue({ category: "todo" }), [{ category: "dead-code" }])).toBe(false)
  })

  it("matches a path glob, ignoring the :line suffix", () => {
    expect(isMuted(issue({ location: "legacy/old.ts:42" }), [{ path: "legacy/**" }])).toBe(true)
    expect(isMuted(issue({ location: "src/new.ts:1" }), [{ path: "legacy/**" }])).toBe(false)
  })

  it("requires every field of a rule to match (AND)", () => {
    const rule = [{ category: "todo" as const, path: "legacy/**" }]
    expect(isMuted(issue({ category: "todo", location: "legacy/x.ts:1" }), rule)).toBe(true)
    // right category, wrong path → not muted
    expect(isMuted(issue({ category: "todo", location: "src/x.ts:1" }), rule)).toBe(false)
  })

  it("normalizes backslash paths before globbing", () => {
    expect(isMuted(issue({ location: "legacy\\win.ts:3" }), [{ path: "legacy/*.ts" }])).toBe(true)
  })

  it("matches a branch finding (no :line) against a plain path", () => {
    expect(isMuted(issue({ category: "branch", location: "origin/old" }), [{ path: "origin/old" }])).toBe(true)
  })

  it("is a no-op for an empty rule set", () => {
    expect(isMuted(issue({}), [])).toBe(false)
  })
})
