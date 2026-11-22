import { CHECK_FAMILIES, TOTAL_CHECKS } from "@/lib/landing-facts"

/**
 * Client-side helpers for choosing which scanners to run.
 *
 * Ids mirror `packages/core` (`CHECK_FAMILIES` is kept in sync by
 * `test/landing-facts.test.ts`). The API re-validates before shelling out.
 */

const STORAGE_KEY = "repo-anti-rot:scan-only:v1"

export const ALL_SCAN_IDS: readonly string[] = CHECK_FAMILIES.flatMap((f) => f.scanners)

export { TOTAL_CHECKS }

/**
 * Deep engines: slower whole-program analysis, off unless ticked. Not counted in
 * TOTAL_CHECKS and not part of "all" — their precision is still being measured.
 */
export const DEEP_SCAN_IDS: readonly string[] = ["php-taint", "js-taint", "py-taint"]

const KNOWN = new Set([...ALL_SCAN_IDS, ...DEEP_SCAN_IDS])

/** Sanitize a list from the wire or localStorage — drop unknowns, dedupe. */
export function sanitizeScannerIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [...ALL_SCAN_IDS]
  const out: string[] = []
  const seen = new Set<string>()
  for (const raw of ids) {
    const id = String(raw)
    if (!KNOWN.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out.length > 0 ? out : [...ALL_SCAN_IDS]
}

/** `null` means “full scan” — omit `--only` on the wire. A deep engine always needs an explicit list. */
export function onlyForRequest(selected: string[]): string[] | null {
  const clean = sanitizeScannerIds(selected)
  const base = clean.filter((id) => !DEEP_SCAN_IDS.includes(id))
  if (base.length === clean.length && base.length >= ALL_SCAN_IDS.length) return null
  return clean
}

export function loadScannerSelection(): string[] {
  if (typeof window === "undefined") return [...ALL_SCAN_IDS]
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return [...ALL_SCAN_IDS]
    return sanitizeScannerIds(JSON.parse(raw) as unknown)
  } catch {
    return [...ALL_SCAN_IDS]
  }
}

export function saveScannerSelection(ids: string[]): void {
  if (typeof window === "undefined") return
  try {
    const clean = sanitizeScannerIds(ids)
    if (clean.length === ALL_SCAN_IDS.length && !clean.some((id) => DEEP_SCAN_IDS.includes(id))) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(clean))
  } catch {
    /* ignore */
  }
}

/** Quick presets for the picker. */
export const SCAN_PRESETS: { id: string; labelKey: "scan.presetAll" | "scan.presetSecurity" | "scan.presetFast"; ids: () => string[] }[] = [
  {
    id: "all",
    labelKey: "scan.presetAll",
    ids: () => [...ALL_SCAN_IDS],
  },
  {
    id: "security",
    labelKey: "scan.presetSecurity",
    ids: () => [...(CHECK_FAMILIES.find((f) => f.id === "security")?.scanners ?? [])],
  },
  {
    id: "fast",
    labelKey: "scan.presetFast",
    ids: () => [
      ...(CHECK_FAMILIES.find((f) => f.id === "security")?.scanners ?? []),
      ...(CHECK_FAMILIES.find((f) => f.id === "ci")?.scanners ?? []),
      "project-hygiene",
      "todo-debt",
    ],
  },
]
