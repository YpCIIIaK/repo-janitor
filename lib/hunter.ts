/**
 * Credit for confirmed false-positive reports.
 *
 * A check that fires on healthy code is a bug, so the people who find those are
 * doing the most valuable work anyone outside this repository can do. This is
 * the small piece of recognition for it.
 *
 * ## Why the count is of confirmations, not reports
 *
 * Rewarding the act of reporting rewards volume: it becomes worth filing a real
 * finding as a false positive, because the score goes up either way. So the
 * number here is issues carrying `false-positive: confirmed`, a label a
 * maintainer applies when the rule has actually been fixed. Reporting is free
 * and unscored, which is the honest arrangement.
 *
 * ## Why there is no table
 *
 * This project deliberately has no accounts: RLS with no policies, anonymous
 * usage rows, and a consent text that describes exactly what is stored. A badge
 * needs an identity, and inventing one here would mean rewriting all of that for
 * a decoration. The reports already land on GitHub, which has identities, so the
 * count is a query against a public search — no new table, no new personal data,
 * no change to what anyone consented to.
 *
 * The flip side is that anyone can mint this badge for any login. That is
 * tolerable only because the number is publicly reproducible: every badge is
 * documented alongside {@link hunterSearchUrl}, so a reader can run the same
 * search and get the same answer. A credential nobody can check is a credential
 * worth faking.
 */

/** The repository reports are filed against — this one. */
export const HUNTER_REPO = "YpCIIIaK/repo-janitor"

/** Applied by a maintainer once the rule is fixed. The only thing that counts. */
export const CONFIRMED_LABEL = "false-positive: confirmed"

/**
 * GitHub's own rules for a username: alphanumeric plus single inner hyphens, at
 * most 39 characters.
 *
 * This is a hard gate, not cosmetics. The login arrives from the URL and is
 * interpolated into a search query, so anything that is not a real username —
 * spaces, quotes, qualifiers like `repo:` — must be refused before it can widen
 * the search into counting somebody else's issues.
 */
const LOGIN_RE = /^[a-zA-Z0-9](?:[a-zA-Z0-9]|-(?=[a-zA-Z0-9])){0,38}$/

export function isGithubLogin(value: unknown): value is string {
  return typeof value === "string" && LOGIN_RE.test(value)
}

/** The search, as GitHub's query language spells it. */
export function hunterQuery(login: string): string {
  if (!isGithubLogin(login)) throw new Error(`not a GitHub login: ${login}`)
  return `repo:${HUNTER_REPO} is:issue label:"${CONFIRMED_LABEL}" author:${login}`
}

/**
 * The same search, as a page a human can open.
 *
 * Every badge should be published next to this link. It is what turns the number
 * from a claim into something checkable.
 */
export function hunterSearchUrl(login: string): string {
  return `https://github.com/search?q=${encodeURIComponent(hunterQuery(login))}&type=issues`
}

/** The API call the badge route makes. */
export function hunterApiUrl(login: string): string {
  return `https://api.github.com/search/issues?q=${encodeURIComponent(hunterQuery(login))}&per_page=1`
}

/**
 * Ready-to-paste markdown: the badge, linked to the search that produced it.
 *
 * Handing people the linked form rather than a bare image is the whole
 * verifiability argument in one snippet — if the badge travels without its
 * link, it is just a picture with a number on it.
 */
export function hunterBadgeMarkdown(login: string, origin: string): string {
  const badge = `${origin.replace(/\/+$/, "")}/api/badge/hunter/${login}`
  return `[![false positives found](${badge})](${hunterSearchUrl(login)})`
}
