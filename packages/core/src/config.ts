import { z } from "zod"
import { categorySchema, type Issue } from "./schema"

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

/**
 * A mute rule suppresses already-produced findings (post-scan) — unlike `ignore`,
 * which drops whole files from the scanned set before scanners run. Use it to
 * accept a specific finding you've reviewed without hiding the rest of its file.
 *
 * A rule matches a finding when EVERY field it specifies matches:
 *  - `id`       : exact match against the finding's stable id (the surgical option)
 *  - `category` : the finding's category (env, dead-code, todo, security, …)
 *  - `path`     : glob against the finding's file path (`*`, `**`, `?`)
 * A rule with none of the above matches nothing (a stray `reason`-only entry is inert).
 */
const muteRuleSchema = z
  .object({
    id: z.string().optional(),
    category: categorySchema.optional(),
    path: z.string().optional(),
    reason: z.string().optional(),
  })
  .refine((r) => r.id != null || r.category != null || r.path != null, {
    message: "a mute rule needs at least one of id, category, or path",
  })

// Lenient on unknown keys (forward-compat) but strict on the shapes we know.
const configSchema = z.object({
  ignore: z.array(z.string()).optional(),
  mute: z.array(muteRuleSchema).optional(),
  weights: weightsSchema.optional(),
})

export type MuteRule = z.infer<typeof muteRuleSchema>

export type RawConfig = z.infer<typeof configSchema>

export interface ResolvedConfig {
  /** extra glob patterns excluded from the scanned file set */
  ignore: string[]
  /** rules that suppress individual findings post-scan (reviewed/accepted) */
  mute: MuteRule[]
  /** effective severity weights (defaults merged with any overrides) */
  weights: { critical: number; warning: number; info: number }
}

export function defaultConfig(): ResolvedConfig {
  return { ignore: [], mute: [], weights: { ...DEFAULT_WEIGHTS } }
}

/** Strip a trailing `:line` suffix and normalize separators to a forward-slash path. */
function issueFilePath(issue: Issue): string {
  const loc = (issue.location ?? "").trim()
  const m = loc.match(/^(.+):(\d+)$/)
  return (m ? m[1] : loc).replace(/\\/g, "/").replace(/^\.\//, "")
}

/** Compile a glob (`*`, `**`, `?`) to an anchored RegExp. `**` spans path separators. */
function globToRegExp(glob: string): RegExp {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"
        i++
        if (glob[i + 1] === "/") i++ // `**/` also matches zero leading segments
      } else {
        re += "[^/]*"
      }
    } else if (c === "?") {
      re += "[^/]"
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`^${re}$`)
}

/** True when a finding matches any mute rule (every field a rule sets must match). */
export function isMuted(issue: Issue, rules: MuteRule[]): boolean {
  if (rules.length === 0) return false
  const path = issueFilePath(issue)
  return rules.some((rule) => {
    if (rule.id != null && rule.id !== issue.id) return false
    if (rule.category != null && rule.category !== issue.category) return false
    if (rule.path != null && !globToRegExp(rule.path).test(path)) return false
    return true
  })
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
    mute: cfg.mute ?? [],
    weights: { ...DEFAULT_WEIGHTS, ...(cfg.weights ?? {}) },
  }
}
