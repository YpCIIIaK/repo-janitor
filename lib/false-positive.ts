/**
 * Links into this project's own "false positive" issue form, prefilled.
 *
 * A check that fires on healthy code is a bug, and the landing page says so out
 * loud — but the report that arrives as three sentences of prose usually cannot
 * be acted on. What makes one actionable is the scanner id, a public repository
 * the rule can be re-run against, and the finding text as it was actually shown.
 * All three are on screen when somebody decides to complain, so the app fills
 * them in and the reporter is left with the one field only they can answer: why
 * the code is fine.
 *
 * Like `lib/github-issue.ts`, this touches no API and no token — it builds the
 * public `…/issues/new?template=…` URL that opens GitHub's own form. Nothing is
 * posted on anyone's behalf.
 */

/** This project's repository. The report goes here, not to the scanned repo. */
export const ANTI_ROT_REPO = "https://github.com/YpCIIIaK/repo-janitor"

/** Filename of the issue form in `.github/ISSUE_TEMPLATE/`. */
const TEMPLATE = "false-positive.yml"

/**
 * Prefill values, keyed the way the form's field ids are. A key with no value is
 * left out entirely rather than sent empty, so GitHub shows its own placeholder
 * instead of a blank the reporter has to notice and delete.
 */
export interface FalsePositiveContext {
  /** Scanner id as the engine stamps it, e.g. `duplicate-code`. */
  scanner?: string | null
  /** Public URL of the repository the check fired on. */
  repo?: string | null
  /** The finding's title, as the reader saw it. */
  finding?: string | null
  /** `path:line`, as the report gave it. */
  location?: string | null
}

/**
 * GitHub drops prefill parameters past a certain URL length, and it drops them
 * silently — the form opens looking fine with fields missing. Finding titles are
 * the only field here that can run long, so each value is capped well short of
 * that rather than risking the whole link.
 */
const MAX_FIELD = 400

function trim(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null
  const clean = value.trim()
  if (!clean) return null
  return clean.length > MAX_FIELD ? `${clean.slice(0, MAX_FIELD - 1)}…` : clean
}

/**
 * URL of the false-positive form, with whatever context we have filled in.
 *
 * Always returns a link: with no context at all it is simply the empty form,
 * which is what the landing page's "report a false positive" needs.
 */
export function falsePositiveUrl(context: FalsePositiveContext = {}): string {
  const params = new URLSearchParams({ template: TEMPLATE, labels: "false-positive" })

  for (const key of ["scanner", "repo", "finding", "location"] as const) {
    const value = trim(context[key])
    if (value) params.set(key, value)
  }

  return `${ANTI_ROT_REPO}/issues/new?${params.toString()}`
}
