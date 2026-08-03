/**
 * Regression story — one narrative from baseline → new scan.
 *
 * Pure and dependency-free so the dashboard, watch mail and GitHub Action can
 * share the same wording. Counts match by stable issue id; titles come only from
 * findings that are new in the current report.
 */

export type StorySeverity = "critical" | "warning" | "info"

export interface StoryIssue {
  id: string
  title: string
  severity: StorySeverity
  location: string
}

export interface StoryBaseline {
  score: number
  grade?: string
  issueIds: string[]
}

export interface StoryNext {
  score: number
  grade: string
  issues: StoryIssue[]
}

export interface RegressionStory {
  scoreDelta: number
  added: number
  fixed: number
  /** New findings, severity-sorted, capped. */
  newFindings: StoryIssue[]
  /** One-line summary for email / PR / UI. */
  headline: string
}

const SEV_RANK: Record<StorySeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
}

const DEFAULT_NEW_CAP = 5

function isSeverity(s: string): s is StorySeverity {
  return s === "critical" || s === "warning" || s === "info"
}

/** Normalise loose report issues into story rows (drops junk). */
export function toStoryIssues(
  issues: { id?: string; title?: string; severity?: string; location?: string }[],
): StoryIssue[] {
  const out: StoryIssue[] = []
  for (const i of issues) {
    if (!i || typeof i.id !== "string" || !i.id) continue
    if (typeof i.title !== "string" || !i.title) continue
    if (typeof i.severity !== "string" || !isSeverity(i.severity)) continue
    out.push({
      id: i.id,
      title: i.title,
      severity: i.severity,
      location: typeof i.location === "string" ? i.location : "",
    })
  }
  return out
}

export function buildRegressionStory(
  baseline: StoryBaseline,
  next: StoryNext,
  opts?: { newCap?: number },
): RegressionStory {
  const newCap = opts?.newCap ?? DEFAULT_NEW_CAP
  const prev = new Set(baseline.issueIds)
  const curIds = new Set(next.issues.map((i) => i.id))

  let added = 0
  for (const id of curIds) if (!prev.has(id)) added++
  let fixed = 0
  for (const id of prev) if (!curIds.has(id)) fixed++

  const scoreDelta = next.score - baseline.score

  const newFindings = next.issues
    .filter((i) => !prev.has(i.id))
    .sort((a, b) => {
      const sev = SEV_RANK[a.severity] - SEV_RANK[b.severity]
      if (sev !== 0) return sev
      return a.title.localeCompare(b.title)
    })
    .slice(0, newCap)

  const headline = formatStoryHeadline({
    prevGrade: baseline.grade,
    prevScore: baseline.score,
    nextGrade: next.grade,
    nextScore: next.score,
    scoreDelta,
    added,
    fixed,
  })

  return { scoreDelta, added, fixed, newFindings, headline }
}

export function formatStoryHeadline(input: {
  prevGrade?: string
  prevScore: number
  nextGrade: string
  nextScore: number
  scoreDelta: number
  added: number
  fixed: number
}): string {
  const left = input.prevGrade
    ? `${input.prevGrade} ${input.prevScore}`
    : String(input.prevScore)
  const right = `${input.nextGrade} ${input.nextScore}`
  const delta =
    input.scoreDelta > 0
      ? `+${input.scoreDelta}`
      : input.scoreDelta < 0
        ? String(input.scoreDelta)
        : "0"
  const parts = [`${left} → ${right} (${delta})`]
  if (input.added > 0) parts.push(`${input.added} new`)
  if (input.fixed > 0) parts.push(`${input.fixed} fixed`)
  if (input.added === 0 && input.fixed === 0 && input.scoreDelta === 0) {
    return `${left} → ${right} · no change`
  }
  return parts.join(" · ")
}
