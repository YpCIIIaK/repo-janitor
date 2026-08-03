import { ingestedSharedReport } from "@/lib/ingested-report"
import { OG_SIZE, renderReportOgImage } from "@/components/repo-anti-rot/og-report-image"

/** Link preview for a repository's latest CI-reported scan. */
export const runtime = "nodejs"
export const alt = "Repository health grade"
export const size = OG_SIZE
export const contentType = "image/png"

export default async function Image({
  params,
}: {
  params: Promise<{ owner: string; name: string }>
}) {
  const { owner, name } = await params
  const found = await ingestedSharedReport(owner, name)
  return renderReportOgImage(owner, name, found?.report ?? null)
}
