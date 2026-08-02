import type { Metadata } from "next"
import { getShare, isValidShareToken } from "@/lib/share-store"
import { EmbedUnknown, EmbedWidget } from "@/components/repo-anti-rot/embed-widget"
import { cn } from "@/lib/utils"
import { parseWidgetOptions } from "@/lib/widget-options"

/** Map widget dark/light onto real theme tokens so CSS variables apply. */
function embedChrome(theme: "dark" | "light") {
  return {
    themeId: theme === "light" ? "paper" : "moss",
    className: cn("box-border h-screen p-0.5", theme === "dark" && "dark"),
  }
}

/**
 * Iframe-friendly mini dashboard for a shared scan.
 *
 * Same capability model as `/r/…` and `/api/card`: the token authorises the
 * read; owner/name in the path are for the plaque title and must match the
 * stored report or the widget renders `unknown`.
 *
 * Built for docs sites / status pages — not GitHub READMEs (those strip iframes;
 * use `/api/card` there instead). Appearance: `?theme=light`.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Repo Anti-Rot",
  robots: { index: false, follow: false },
}

type Params = { owner: string; name: string; token: string }

export default async function EmbedPage({
  params,
  searchParams,
}: {
  params: Promise<Params>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { owner, name, token } = await params
  const sp = await searchParams
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") qs.set(k, v)
    else if (Array.isArray(v) && v[0]) qs.set(k, v[0])
  }
  const options = parseWidgetOptions(qs)
  const pathOwner = decodeURIComponent(owner)
  const pathName = decodeURIComponent(name)

  const chrome = embedChrome(options.theme)

  if (!isValidShareToken(token)) {
    return (
      <main className={chrome.className} data-theme={chrome.themeId}>
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
      <main className={chrome.className} data-theme={chrome.themeId}>
        <EmbedUnknown pathOwner={pathOwner} pathName={pathName} />
      </main>
    )
  }

  const reportHref = `/r/${encodeURIComponent(pathOwner)}/${encodeURIComponent(pathName)}/${token}`

  return (
    <main className={chrome.className} data-theme={chrome.themeId}>
      <EmbedWidget
        report={share.report}
        reportHref={reportHref}
        pathOwner={pathOwner}
        pathName={pathName}
      />
    </main>
  )
}
