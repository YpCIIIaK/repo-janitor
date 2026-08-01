import type { Metadata } from "next"
import { getShare, isValidShareToken } from "@/lib/share-store"
import { EmbedUnknown, EmbedWidget } from "@/components/repo-anti-rot/embed-widget"

/**
 * Iframe-friendly mini dashboard for a shared scan.
 *
 * Same capability model as `/r/…` and `/api/card`: the token authorises the
 * read; owner/name in the path are for the plaque title and must match the
 * stored report or the widget renders `unknown`.
 *
 * Built for docs sites / status pages — not GitHub READMEs (those strip iframes;
 * use `/api/card` there instead).
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Repo Anti-Rot",
  robots: { index: false, follow: false },
}

type Params = { owner: string; name: string; token: string }

export default async function EmbedPage({ params }: { params: Promise<Params> }) {
  const { owner, name, token } = await params
  const pathOwner = decodeURIComponent(owner)
  const pathName = decodeURIComponent(name)

  if (!isValidShareToken(token)) {
    return (
      <main className="box-border h-screen p-1">
        <EmbedUnknown pathOwner={pathOwner} pathName={pathName} />
      </main>
    )
  }

  const share = await getShare(token)
  const match =
    share &&
    share.report.repo.owner === pathOwner &&
    share.report.repo.name === pathName

  if (!match || !share) {
    return (
      <main className="box-border h-screen p-1">
        <EmbedUnknown pathOwner={pathOwner} pathName={pathName} />
      </main>
    )
  }

  const reportHref = `/r/${encodeURIComponent(pathOwner)}/${encodeURIComponent(pathName)}/${token}`

  return (
    <main className="box-border h-screen p-1">
      <EmbedWidget
        report={share.report}
        reportHref={reportHref}
        pathOwner={pathOwner}
        pathName={pathName}
      />
    </main>
  )
}
