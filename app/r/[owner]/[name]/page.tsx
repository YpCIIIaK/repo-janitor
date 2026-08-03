import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { ingestedSharedReport } from "@/lib/ingested-report"
import { ReportView } from "@/components/repo-anti-rot/report-view"

/**
 * A repository's latest CI-reported scan, at a stable URL and with no token.
 *
 * This is where the README badge points. Until it existed the badge in our own
 * README linked to the dashboard root with a comment explaining that the obvious
 * destination was a 404 — the project could put a grade on your README and had
 * nowhere for a reader to click through to.
 *
 * Tokenless because the report is already public by the act of ingesting it: a
 * public repository, uploaded by its own CI, advertised by a badge that needs no
 * token either. The `/r/<owner>/<name>/<token>` route is a different thing — it
 * serves a report someone published from their browser, which may be about a
 * repository nobody else can see, and that one keeps its key.
 *
 * Unlike a share token, this URL is not a snapshot: it always shows the newest
 * report CI has uploaded, so it tracks the default branch instead of ageing into
 * a claim that stopped being true.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Params = { owner: string; name: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { owner, name } = await params
  const found = await ingestedSharedReport(owner, name)
  if (!found) return { title: "Repo Anti-Rot" }
  const report = found.report

  const title = `${owner}/${name} — grade ${report.grade} (${report.score}/100)`
  const description = `Repository health scan: ${report.totalIssues} findings across security, dependencies and code decay.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: `/r/${owner}/${name}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description },
  }
}

export default async function IngestedReportPage({ params }: { params: Promise<Params> }) {
  const { owner, name } = await params
  const found = await ingestedSharedReport(owner, name)
  // 404 rather than an "unknown" page: a URL anyone can guess must not imply
  // that a repository was scanned and found wanting when it was never scanned.
  if (!found) notFound()

  return <ReportView owner={owner} name={name} report={found.report} trend={found.trend} />
}
