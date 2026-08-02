import { getShare } from "@/lib/share-store"
import { OG_SIZE, renderReportOgImage } from "@/components/repo-anti-rot/og-report-image"

/** Link preview for a token-authorised shared report. */
export const runtime = "nodejs"
export const alt = "Repository health grade"
export const size = OG_SIZE
export const contentType = "image/png"

export default async function Image({
  params,
}: {
  params: Promise<{ owner: string; name: string; token: string }>
}) {
  const { owner, name, token } = await params
  const share = await getShare(token)
  return renderReportOgImage(owner, name, share?.report ?? null)
}
