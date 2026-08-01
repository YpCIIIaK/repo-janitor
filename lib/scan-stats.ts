/**
 * The shape of a scan result, kept so a repository can be told where it stands.
 *
 * ## Why this is a second table and not a column on `usage_events`
 *
 * A usage row answers "how much is this service used, and on which
 * repositories" — it carries owner/name on purpose. A stats row answers "what do
 * scan results look like" and must never be attachable to a project, because
 * "acme/widget scored 31" is a fact about somebody's work that they did not
 * publish and we have no business holding.
 *
 * So the two are kept apart by construction rather than by care:
 *
 *  - `usage_events` has the repository and **no score** — enforced by
 *    `FORBIDDEN_USAGE_FIELDS` in `lib/usage.ts`, which throws.
 *  - `scan_stats` has the score and **no repository, no host, no visitor id** —
 *    enforced by `assertStatRecordable` below, which also throws.
 *
 * The remaining link is time. A row here is dated to the **day**, not the
 * second, precisely so that the two tables cannot be lined up by timestamp. That
 * is a real defence at any volume where more than one scan happens per day, and
 * an honest one to describe: on a quiet day, somebody holding both tables could
 * still guess. We say that plainly rather than promising anonymity we cannot
 * deliver.
 *
 * ## Why any of this exists
 *
 * A grade on its own is a number nobody can read. "67/100" means nothing until
 * it means "worse than 71% of comparable repositories", and that sentence cannot
 * be written without a distribution to compare against. This file is the
 * smallest thing that makes that sentence true.
 */

/** Size classes, by lines of code. Buckets rather than a number, so a row cannot fingerprint a repo by its exact size. */
export const SIZE_BUCKETS = ["xs", "s", "m", "l", "xl"] as const
export type SizeBucket = (typeof SIZE_BUCKETS)[number]

const SIZE_EDGES: { bucket: SizeBucket; upTo: number }[] = [
  { bucket: "xs", upTo: 1_000 },
  { bucket: "s", upTo: 10_000 },
  { bucket: "m", upTo: 100_000 },
  { bucket: "l", upTo: 1_000_000 },
]

/** Human labels for the size classes, for the sentence the user reads. */
export const SIZE_LABEL: Record<SizeBucket, string> = {
  xs: "under 1k lines",
  s: "1k–10k lines",
  m: "10k–100k lines",
  l: "100k–1M lines",
  xl: "over 1M lines",
}

export function sizeBucket(linesOfCode: number): SizeBucket {
  for (const { bucket, upTo } of SIZE_EDGES) if (linesOfCode < upTo) return bucket
  return "xl"
}

/**
 * One row of the distribution.
 *
 * Everything here is a property of the *result*, never of the project: no name,
 * no owner, no host, no URL, no file path. The two booleans are the only things
 * beyond the score that a reader might use to explain it, and both are already
 * visible to anyone who opens the repository.
 */
export interface ScanStat {
  /** ISO date (YYYY-MM-DD), deliberately not a timestamp. */
  day: string
  score: number
  grade: string
  /** Primary language by lines of code, or null when nothing was recognised. */
  language: string | null
  size: SizeBucket
  critical: number
  warning: number
  info: number
  /** Whether the project has CI configured at all. */
  ci: boolean
  /** Whether a test runner was detected. */
  tests: boolean
}

/**
 * Fields that must never reach the stats table.
 *
 * The mirror of `FORBIDDEN_USAGE_FIELDS`, pointing the other way. The realistic
 * regression is the same one: somebody passing a whole report through because it
 * was convenient, and a name check at the boundary catching it.
 */
export const FORBIDDEN_STAT_FIELDS = [
  "repo",
  "owner",
  "name",
  "host",
  "url",
  "visitor",
  "commit",
  "issues",
  "report",
  "location",
  "evidence",
  "at",
] as const

export function assertStatRecordable(row: Record<string, unknown>): void {
  for (const field of FORBIDDEN_STAT_FIELDS) {
    if (field in row) {
      throw new Error(`Refusing to record scan stats: payload contains "${field}"`)
    }
  }
}

/** Test runners, as `detectTools` names them. */
const TEST_TOOLS = new Set(["Vitest", "Jest"])
/** CI systems, as `detectTools` names them. */
const CI_TOOLS = new Set(["GitHub Actions"])

interface ReportLike {
  score?: unknown
  grade?: unknown
  generatedAt?: unknown
  issues?: { severity?: unknown }[]
  counts?: { critical?: unknown; warning?: unknown; info?: unknown }
  profile?: {
    languages?: { language?: unknown; loc?: unknown }[]
    tools?: unknown[]
  }
}

function int(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0
}

/** ISO day for a timestamp, defaulting to now. UTC so the bucket does not depend on the server's zone. */
export function isoDay(when?: unknown): string {
  const t = typeof when === "string" ? Date.parse(when) : NaN
  const d = new Date(Number.isNaN(t) ? Date.now() : t)
  return d.toISOString().slice(0, 10)
}

/**
 * Turn a report into the row we keep, or null when it is not a report.
 *
 * Accepts both the full engine report (which carries `issues`) and the shared
 * projection (which carries `counts`), because both are places a scan result
 * turns up. Anything it cannot read becomes a zero or a null rather than a
 * guess — an over-counted distribution would quietly lie to every user of it.
 */
export function projectScanStat(input: unknown): ScanStat | null {
  if (!input || typeof input !== "object") return null
  const r = input as ReportLike

  if (typeof r.score !== "number" || !Number.isFinite(r.score)) return null
  if (typeof r.grade !== "string" || !/^[A-F]$/.test(r.grade)) return null

  const langs = Array.isArray(r.profile?.languages) ? r.profile.languages : []
  let language: string | null = null
  let loc = 0
  let best = -1
  for (const l of langs) {
    const n = int(l?.loc)
    loc += n
    if (n > best && typeof l?.language === "string") {
      best = n
      language = l.language
    }
  }

  let critical = 0
  let warning = 0
  let info = 0
  if (Array.isArray(r.issues)) {
    for (const i of r.issues) {
      if (i?.severity === "critical") critical++
      else if (i?.severity === "warning") warning++
      else if (i?.severity === "info") info++
    }
  } else if (r.counts) {
    critical = int(r.counts.critical)
    warning = int(r.counts.warning)
    info = int(r.counts.info)
  }

  const tools = Array.isArray(r.profile?.tools) ? r.profile.tools.filter((t) => typeof t === "string") : []

  return {
    day: isoDay(r.generatedAt),
    score: Math.min(100, Math.max(0, Math.round(r.score))),
    grade: r.grade,
    language,
    size: sizeBucket(loc),
    critical,
    warning,
    info,
    ci: tools.some((t) => CI_TOOLS.has(t as string)),
    tests: tools.some((t) => TEST_TOOLS.has(t as string)),
  }
}

/**
 * Below this many comparable scans, no percentile is shown at all.
 *
 * "Worse than 71% of repositories" computed from nine of them is not a
 * statistic, it is a coincidence with a percent sign — and the first person to
 * work that out stops believing the rest of the report. Silence is the correct
 * output of a sample this small.
 */
export const MIN_SAMPLE = 30

export interface Percentile {
  /** Share of the sample this score beats, 0–100, rounded. */
  betterThan: number
  /** Share of the sample that beats this score, 0–100, rounded. */
  worseThan: number
  /** How many scans the comparison is drawn from. */
  sample: number
  /** Which cut was used, so the sentence can say so. */
  basis: "language-size" | "language" | "size" | "all"
}

/**
 * Share strictly below and strictly above `score`, as percentages.
 *
 * Both are counted, and neither is derived from the other by subtraction,
 * because ties belong to neither. A repository on the exact median of a
 * distribution where half the rows share its score is not "better than 50%" and
 * not "worse than 50%" — it is better than some and worse than some, and the two
 * do not add to a hundred. Deriving one from the other would silently hand the
 * ties to whichever sentence we happened to print.
 *
 * Strictly, in both directions, so each phrasing under-states rather than over-
 * states. That is the safe direction for a number somebody may quote at a
 * colleague.
 */
export function shares(scores: number[], score: number): { below: number; above: number } {
  if (scores.length === 0) return { below: 0, above: 0 }
  let below = 0
  let above = 0
  for (const s of scores) {
    if (s < score) below++
    else if (s > score) above++
  }
  return {
    below: Math.round((below / scores.length) * 100),
    above: Math.round((above / scores.length) * 100),
  }
}

/**
 * Which way round to say it, and with which number.
 *
 * Both readings are true of the same distribution, and picking one is an
 * editorial decision rather than a statistical one. The rule: say the side the
 * reader is on. A repository in the bottom half hears "worse than 71%", which is
 * the sentence that makes somebody act; one in the top half hears "better than
 * 82%", which is the sentence worth sharing. Printing "better than 12%" at
 * someone would be technically fine and read as a sneer.
 *
 * The number always comes from the matching strict count, never from
 * `100 - other`, so neither phrasing quietly claims the ties.
 */
export function phrasePercentile(p: Percentile): { direction: "worse" | "better"; percent: number } {
  return p.betterThan < 50
    ? { direction: "worse", percent: p.worseThan }
    : { direction: "better", percent: p.betterThan }
}

export interface Cut {
  basis: Percentile["basis"]
  scores: number[]
}

/**
 * Pick the most specific cut that has enough data behind it.
 *
 * "Worse than 71% of TypeScript repositories of this size" is a far stronger
 * sentence than the same number about everything ever scanned, so the narrow
 * cuts are tried first — but only while they are still honest. Falling back is
 * not a failure; claiming a narrow comparison from twelve rows would be.
 */
export function choosePercentile(cuts: Cut[], score: number): Percentile | null {
  for (const cut of cuts) {
    if (cut.scores.length >= MIN_SAMPLE) {
      const { below, above } = shares(cut.scores, score)
      return { betterThan: below, worseThan: above, sample: cut.scores.length, basis: cut.basis }
    }
  }
  return null
}
