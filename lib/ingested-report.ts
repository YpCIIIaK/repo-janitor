import "server-only"
import { readServerRepos } from "@/lib/server-store"
import { toSharedReport, type SharedReport } from "@/lib/share-report"
import { rotTrend, type Trend } from "@/lib/rot-hint"

/**
 * The latest CI-ingested report for a repository, as a shareable projection.
 *
 * This is what `/r/<owner>/<name>` renders — the tokenless report page. Until it
 * existed the badge in our own README linked to the dashboard root, because the
 * obvious destination was a 404: the project could put a grade on your README
 * and had nowhere for a reader to click through to.
 *
 * Two things it deliberately is not:
 *
 *  - **Not a second projection.** It runs the report through `toSharedReport`,
 *    the same function the share links use. That function is the one place that
 *    decides what may leave the server, and it builds a new object rather than
 *    filtering an existing one. A parallel path here would be a second, quieter
 *    definition of "publishable", and the quiet one is the one that leaks.
 *
 *  - **Not authorisation.** A CI-ingested report is already public by the act of
 *    ingesting it: it is a public repository, uploaded by its own CI, and the
 *    badge that advertises it needs no token either. The token on `/r/…/<token>`
 *    guards a report someone pasted from their browser, which may be about a
 *    repository nobody else can see. These are different things and only one of
 *    them needs a key.
 */
export interface IngestedReport {
  report: SharedReport
  /**
   * Direction of travel, which the grade cannot express: a repository at 62 on
   * the way down and one at 62 on the way up are the same letter and not the
   * same project. Null until there are two scans to compare.
   *
   * Only available here. A share token carries a `SharedReport`, and that
   * projection has no score history in it by design — so the token route shows a
   * date and cannot show this.
   */
  trend: Trend | null
}

export async function ingestedSharedReport(
  owner: string,
  name: string,
): Promise<IngestedReport | null> {
  const id = `${owner}/${name}`.toLowerCase()
  const repo = (await readServerRepos()).find((r) => r.id.toLowerCase() === id)
  if (!repo?.latest) return null

  // The URL is reconstructed rather than stored: the ingest payload carries
  // owner and name, and every repository that can reach /api/ingest is a public
  // GitHub one. Without it the page cannot offer "watch" or "rescan".
  return {
    report: toSharedReport(repo.latest, `https://github.com/${repo.owner}/${repo.name}`),
    trend: rotTrend(repo.history ?? []),
  }
}
