import { defaultScanners } from "./engine"
import type { Scanner } from "./scanner"

/** Every registered scanner id, in engine order. */
export const ALL_SCANNER_IDS: readonly string[] = defaultScanners.map((s) => s.id)

/**
 * Parse a CLI `--only` value: comma-separated scanner ids.
 * Empty / whitespace-only → `null` (meaning “run everything”).
 */
export function parseOnlyOption(raw: string | undefined | null): string[] | null {
  if (raw == null) return null
  const ids = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
  return ids.length === 0 ? null : ids
}

export interface SelectScannersResult {
  scanners: Scanner[]
  /** Ids the caller asked for that are not in the registry. */
  unknown: string[]
}

/**
 * Resolve a subset of `defaultScanners`.
 *
 * `null` / `undefined` / `[]` → full registry. Unknown ids are reported but
 * ignored so a typo does not silently run an empty scan — the caller should
 * treat `unknown.length > 0` or an empty `scanners` as an error.
 */
export function selectScanners(only?: string[] | null): SelectScannersResult {
  if (only == null || only.length === 0) {
    return { scanners: defaultScanners, unknown: [] }
  }
  const wanted = new Set(only)
  const known = new Set(ALL_SCANNER_IDS)
  const unknown = only.filter((id) => !known.has(id))
  const scanners = defaultScanners.filter((s) => wanted.has(s.id))
  return { scanners, unknown }
}
