import type { Metadata } from "next"
import Link from "next/link"
import { cookies, headers } from "next/headers"
import { listWatchesByManageToken } from "@/lib/watch-store"
import { isValidWatchToken } from "@/lib/watch-tokens"
import { WatchManageList, type WatchRow } from "@/components/repo-anti-rot/watch-manage"
import { LOCALE_COOKIE, resolveLocale, t } from "@/lib/i18n"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Your watches — Repo Anti-Rot",
  robots: { index: false, follow: false },
}

type Params = { token: string }

export default async function WatchManagePage({ params }: { params: Promise<Params> }) {
  const { token } = await params
  const jar = await cookies()
  const hdrs = await headers()
  const locale = resolveLocale(jar.get(LOCALE_COOKIE)?.value, hdrs.get("accept-language"))

  if (!isValidWatchToken(token)) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16">
        <p className="text-sm text-muted-foreground">{t(locale, "watch.pageEmpty")}</p>
        <Link href="/" className="mt-4 inline-block text-sm text-primary underline-offset-4 hover:underline">
          Repo Anti-Rot
        </Link>
      </main>
    )
  }

  const watches = await listWatchesByManageToken(token)
  const rows: WatchRow[] = watches.map((w) => ({
    id: w.id,
    owner: w.owner,
    name: w.name,
    repoUrl: w.repoUrl,
    lastGrade: w.lastGrade,
    lastScore: w.lastScore,
    lastCheckedAt: w.lastCheckedAt,
    unsubToken: w.unsubToken,
  }))

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t(locale, "watch.pageTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(locale, "watch.pageLead")}</p>
      </div>
      <WatchManageList initial={rows} />
      <Link href="/" className="inline-block text-sm text-primary underline-offset-4 hover:underline">
        Repo Anti-Rot
      </Link>
    </main>
  )
}
