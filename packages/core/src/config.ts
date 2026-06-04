import { z } from "zod"

/**
 * Per-project configuration: an optional `.repo-anti-rot.json` at the repo root.
 *
 * Everything is optional and merges OVER the defaults, so a repo with no config
 * (or a partial one) behaves exactly as before. The file is committed with the
 * repo, so its rules travel to CI and teammates — unlike the browser-local Snooze.
 */

export const CONFIG_FILENAME = ".repo-anti-rot.json"

/** Default severity penalties — must mirror the client (lib/score.ts). */
export const DEFAULT_WEIGHTS = { critical: 10, warning: 3, info: 0.5 } as const

/**
 * Inline ignore markers (eslint-style, no overlap):
 *  - trailing/same-line `// repo-anti-rot-ignore` suppresses a finding on THAT line
 *  - `// repo-anti-rot-ignore-next-line` on its own line suppresses the NEXT line
 */
export const INLINE_IGNORE_MARKER = "repo-anti-rot-ignore"
export const INLINE_IGNORE_NEXT_LINE_MARKER = "repo-anti-rot-ignore-next-line"

const weightsSchema = z
  .object({
    critical: z.number().nonnegative(),
    warning: z.number().nonnegative(),
    info: z.number().nonnegative(),
  })
  .partial()

// Lenient on unknown keys (forward-compat) but strict on the shapes we know.
const configSchema = z.object({
  ignore: z.array(z.string()).optional(),
  weights: weightsSchema.optional(),
})

export type RawConfig = z.infer<typeof configSchema>

export interface ResolvedConfig {
  /** extra glob patterns excluded from the scanned file set */
  ignore: string[]
  /** effective severity weights (defaults merged with any overrides) */
  weights: { critical: number; warning: number; info: number }
}

export function defaultConfig(): ResolvedConfig {
  return { ignore: [], weights: { ...DEFAULT_WEIGHTS } }
}

/**
 * Load and resolve `.repo-anti-rot.json` via the provided reader. Missing,
 * malformed, or invalid config falls back to defaults (never throws) so a typo
 * can't break a scan; `onWarn` is called with a human-readable reason instead.
 */
export async function loadConfig(
  readFile: (relPath: string) => Promise<string | null>,
  onWarn?: (msg: string) => void,
): Promise<ResolvedConfig> {
  const raw = await readFile(CONFIG_FILENAME)
  if (!raw) return defaultConfig()

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    onWarn?.(`${CONFIG_FILENAME} is not valid JSON — ignoring it and using defaults.`)
    return defaultConfig()
  }

  const result = configSchema.safeParse(parsed)
  if (!result.success) {
    onWarn?.(`${CONFIG_FILENAME} has invalid fields — ignoring it and using defaults.`)
    return defaultConfig()
  }

  const cfg = result.data
  return {
    ignore: cfg.ignore ?? [],
    weights: { ...DEFAULT_WEIGHTS, ...(cfg.weights ?? {}) },
  }
}
