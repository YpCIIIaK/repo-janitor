/**
 * How a result should be presented — as an achievement, or as work to do.
 *
 * The product only ever spoke in findings. A repository that came out well got
 * an empty list and the sentence "No open issues", which states an absence: the
 * scanner has nothing to say, so neither does the page. That is fine for the
 * person fixing things and useless for the person who wanted to show somebody.
 *
 * ## The honesty constraint, which is the whole difficulty
 *
 * A good grade means THIS SCANNER FOUND LITTLE. It does not mean the code is
 * good, that the tests pass, or that the architecture is sound — none of which
 * is measured here. So the celebratory copy has to be built out of things
 * actually established: how much was read, and what was not found in it. "No
 * critical findings across 1,240 files" is a claim this tool can back. "This is
 * a well-built project" is not, and printing it would make every other number on
 * the page worth less.
 */

export type Verdict = "clean" | "strong" | "fair" | "poor"

export interface VerdictCounts {
  critical: number
  warning: number
  info: number
}

/**
 * Classify a result.
 *
 * Deliberately not a restatement of the grade. The grade is a number bucket;
 * this is about what the reader should feel, and the two come apart at the
 * edges — a repository with one critical finding and nothing else can score in
 * the eighties, and that is not a result to put in a README.
 */
export function verdictOf(counts: VerdictCounts, totalIssues: number, score: number): Verdict {
  // A single critical finding disqualifies any amount of otherwise-clean.
  // Averaging it away is how a scanner ends up congratulating someone over a
  // leaked key.
  if (counts.critical > 0) return "poor"
  if (totalIssues === 0) return "clean"
  if (score >= 75 && counts.warning === 0) return "strong"
  if (score >= 60) return "fair"
  return "poor"
}

/** Is this a result the owner would want to show someone? */
export function isBoastworthy(v: Verdict): boolean {
  return v === "clean" || v === "strong"
}

export interface ScanScope {
  totalFiles?: number
  languages?: { language: string; loc: number }[]
}

/**
 * What was actually read, as a short factual line: "1,240 files · 182,431 lines".
 *
 * This is what makes a clean result mean anything. "Nothing found" is equally
 * true of an empty repository and of a large one, and only this line tells them
 * apart — which is exactly why the good news is allowed to lean on it.
 *
 * Null when there is nothing to report, so a caller renders no line rather than
 * an empty one.
 */
export function scopeLine(scope: ScanScope | undefined, locale = "en-US"): string | null {
  if (!scope) return null
  const files = scope.totalFiles ?? 0
  const loc = (scope.languages ?? []).reduce((sum, l) => sum + (l.loc || 0), 0)
  const parts: string[] = []
  if (files > 0) parts.push(`${files.toLocaleString(locale)} files`)
  if (loc > 0) parts.push(`${loc.toLocaleString(locale)} lines`)
  return parts.length > 0 ? parts.join(" · ") : null
}
