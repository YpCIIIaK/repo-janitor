import type { Metadata } from "next"
import Link from "next/link"
import { cookies, headers } from "next/headers"
import { WatchMagicForm } from "@/components/repo-anti-rot/watch-manage"
import { LOCALE_COOKIE, resolveLocale, t } from "@/lib/i18n"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export const metadata: Metadata = {
  title: "Watches — Repo Anti-Rot",
  robots: { index: false, follow: false },
}

/** Recover a manage link by email — no password. */
export default async function WatchIndexPage() {
  const jar = await cookies()
  const hdrs = await headers()
  const locale = resolveLocale(jar.get(LOCALE_COOKIE)?.value, hdrs.get("accept-language"))

  return (
    <main className="mx-auto max-w-lg space-y-6 px-4 py-12">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{t(locale, "watch.magicTitle")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t(locale, "watch.pageLead")}</p>
      </div>
      <WatchMagicForm />
      <Link href="/" className="inline-block text-sm text-primary underline-offset-4 hover:underline">
        Repo Anti-Rot
      </Link>
    </main>
  )
}
