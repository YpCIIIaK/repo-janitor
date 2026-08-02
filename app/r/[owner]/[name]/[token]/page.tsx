import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getShare } from "@/lib/share-store"
import { ReportView } from "@/components/repo-anti-rot/report-view"

/**
 * A shared scan result, opened with the token that authorises it.
 *
 * The token in the URL is the authorisation. owner/name are along for the ride
 * so the link reads as something rather than as an opaque string. What it looks
 * like lives in ReportView, shared with the tokenless CI route.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

type Params = { owner: string; name: string; token: string }

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>
}): Promise<Metadata> {
  const { owner, name, token } = await params
  const share = await getShare(token)
  if (!share) return { title: "Repo Anti-Rot" }

  const { grade, score, totalIssues } = share.report
  const title = `${owner}/${name} — grade ${grade} (${score}/100)`
  const description = `Repository health scan: ${totalIssues} findings across security, dependencies and code decay.`

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      images: [{ url: `/r/${owner}/${name}/${token}/opengraph-image`, width: 1200, height: 630 }],
    },
    twitter: { card: "summary_large_image", title, description },
  }
}

export default async function SharedReportPage({ params }: { params: Promise<Params> }) {
  const { owner, name, token } = await params
  const share = await getShare(token)
  if (!share) notFound()

  return <ReportView owner={owner} name={name} report={share.report} />
}
