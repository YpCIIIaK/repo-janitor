import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { CHECK_FAMILIES, TOTAL_CHECKS, GRADE_BANDS, PENALTIES } from "@/lib/landing-facts"

/**
 * The landing page claims a number of checks, a set of scanner names, five grade
 * bands and three penalties. All four are duplicated from `packages/core`,
 * because the dashboard does not depend on that package — it shells out to the
 * built CLI.
 *
 * So the guard is here. A landing page still advertising twenty-six checks after
 * someone added the twenty-seventh is precisely the decay this project reports on
 * for a living, and the failure would be both silent and embarrassing.
 *
 * The engine's source is read rather than imported, for the same reason: no
 * dependency edge to lean on. That makes this a text check, which is worth
 * saying plainly — it verifies the registry as written, not as executed.
 */

const CORE = join(process.cwd(), "packages", "core", "src")

/** Scanner ids as the engine defines them, read from the exported Scanner objects. */
function registryIds(): string[] {
  const dir = join(CORE, "scanners")
  const ids: string[] = []

  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".ts")) continue
    const src = readFileSync(join(dir, file), "utf8")
    // Anchored to the exported Scanner object. Taking the first `id:` in a file
    // instead finds a rule id or a secret-pattern id — a mistake made once here
    // already, which reported `aws-access-key` as a scanner.
    const at = src.search(/export const \w+Scanner\s*:\s*Scanner\s*=\s*\{/)
    if (at === -1) continue
    const m = src.slice(at).match(/\bid\s*:\s*"([^"]+)"/)
    if (m) ids.push(m[1])
  }

  return ids
}

/** The registry array in engine.ts, by const name. */
function registeredConsts(): string[] {
  const src = readFileSync(join(CORE, "engine.ts"), "utf8")
  const block = src.match(/export const defaultScanners: Scanner\[\] = \[([\s\S]*?)\]/)
  if (!block) throw new Error("could not find defaultScanners in engine.ts")
  return block[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

describe("landing page facts", () => {
  const listed = CHECK_FAMILIES.flatMap((f) => f.scanners)

  it("names every scanner the engine registers", () => {
    const ids = registryIds().sort()
    // Both directions: a new scanner must reach the page, and the page must not
    // advertise one that was removed.
    expect(listed.slice().sort()).toEqual(ids)
  })

  it("counts the checks the way the registry does", () => {
    expect(TOTAL_CHECKS).toBe(registeredConsts().length)
  })

  it("lists each scanner exactly once", () => {
    expect(new Set(listed).size).toBe(listed.length)
  })

  it("matches the engine's grade thresholds", () => {
    const src = readFileSync(join(CORE, "engine.ts"), "utf8")
    for (const { grade, min } of GRADE_BANDS) {
      expect(src).toMatch(new RegExp(`score >= ${min}\\)\\s*return "${grade}"`))
    }
  })

  it("matches the engine's severity penalties", () => {
    const src = readFileSync(join(CORE, "config.ts"), "utf8")
    const m = src.match(/DEFAULT_WEIGHTS = \{([^}]+)\}/)
    expect(m).not.toBeNull()
    for (const [sev, points] of Object.entries(PENALTIES)) {
      expect(m?.[1]).toMatch(new RegExp(`${sev}:\\s*${points}\\b`))
    }
  })
})
