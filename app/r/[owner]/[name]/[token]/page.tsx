import type { Metadata } from "next"
import Link from "next/link"
import { cookies, headers } from "next/headers"
import { notFound } from "next/navigation"
import { getShare } from "@/lib/share-store"
import { LOCALE_COOKIE, resolveLocale, t } from "@/lib/i18n"
import type { SharedReport } from "@/lib/share-report"
import { FreshScanCta } from "@/components/repo-anti-rot/fresh-scan-cta"
import { ViewBeacon } from "@/components/repo-anti-rot/view-beacon"
import { verdictOf, isBoastworthy, scopeLine } from "@/lib/verdict"
import { percentileFor } from "@/lib/percentile"
import { percentileCopy } from "@/lib/percentile-copy"
import { sizeBucket } from "@/lib/scan-stats"

/**
 * A shared scan result.
 *
 * Server-rendered on purpose: this is the page a link lands on, so it has to be
 * readable with no JavaScript, no localStorage and no prior visit. Everything it
 * shows comes from the stored projection — there is nothing here that could leak
 * a path or a snippet, because none was ever written.
 *
 * The token in the URL is the authorisation. owner/name are along for the ride
 * so the link reads as something rather than as an opaque string.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const GRADE_TONE: Record<string, string> = {
  A: "text-emerald-500 border-emerald-500/30 bg-emerald-500/10",
  B: "text-lime-500 border-lime-500/30 bg-lime-500/10",
  C: "text-amber-500 border-amber-500/30 bg-amber-500/10",
  D: "text-orange-500 border-orange-500/30 bg-orange-500/10",
  F: "text-red-500 border-red-500/30 bg-red-500/10",
}

const SEVERITY_TONE: Record<string, string> = {
  critical: "text-red-500",
  warning: "text-amber-500",
  info: "text-muted-foreground",
}

/**
 * Age at which the snapshot gets called out explicitly. A week is roughly the
 * point where "this is current" stops being a safe assumption for a repository
 * anyone is actively working on.
 */
const STALE_AFTER_DAYS = 7

/**
 * Whole days between a scan and now, or null for an unparseable date.
 *
 * Outside the component on purpose: this page is `force-dynamic`, so reading the
 * clock per request is the intent, but doing it inline makes the component
 * impure — and an impure render is exactly the thing that bites later when
 * someone tries to cache this page.
 */
function ageInDays(iso: string, now: number = Date.now()): number | null {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return Math.max(0, Math.floor((now - t) / 86_400_000))
}

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

  const [cookieStore, headerList] = await Promise.all([cookies(), headers()])
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerList.get("accept-language"),
  )
  const tr = (key: Parameters<typeof t>[1], vars?: Record<string, string | number>) =>
    t(locale, key, vars)

  const report: SharedReport = share.report
  const verdict = verdictOf(report.counts, report.totalIssues, report.score)

  // Where this score stands. A grade on its own is a number nobody can read;
  // "67/100" starts meaning something at "worse than 71% of comparable
  // repositories". Null — too few comparable scans — renders nothing at all
  // rather than a hedged sentence, because a percentile drawn from nine repos is
  // a coincidence with a percent sign.
  const primaryLanguage = report.profile?.languages?.[0]?.language ?? null
  const totalLoc = (report.profile?.languages ?? []).reduce((n, l) => n + (l.loc || 0), 0)
  const percentile = await percentileFor(report.score, {
    language: primaryLanguage,
    size: totalLoc > 0 ? sizeBucket(totalLoc) : undefined,
  })
  const pct = percentile ? percentileCopy(percentile) : null
  const scope = scopeLine(report.profile, locale === "ru" ? "ru-RU" : "en-GB")
  const scanned = new Date(report.generatedAt)
  const ageDays = ageInDays(report.generatedAt)
  // Fixed locale formatting so the server and the client agree — a date rendered
  // from the machine's locale hydrates differently and React complains.
  const scannedLabel = scanned.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-12 md:px-6">
      <ViewBeacon owner={owner} name={name} />
      <p className="text-sm text-muted-foreground">{tr("share.heading")}</p>
      <h1 className="mt-1 text-balance text-2xl font-semibold tracking-tight break-words">
        {owner}/{name}
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        {tr("share.scannedAt", { date: scannedLabel })}
        {ageDays !== null && ` · ${tr("share.ageDays", { days: ageDays })}`}
      </p>
      {/* Said plainly and near the numbers, because everything below is a claim
          about a repository as it was, not as it is. */}
      {ageDays !== null && ageDays >= STALE_AFTER_DAYS && (
        <p className="mt-3 rounded-lg border border-chart-3/30 bg-chart-3/10 px-3 py-2 text-xs text-foreground/90">
          {tr("share.snapshot", { date: scannedLabel })}
        </p>
      )}

      <section className="mt-8 flex flex-wrap items-center gap-6">
        <div
          className={`flex size-24 items-center justify-center rounded-2xl border text-5xl font-semibold ${
            GRADE_TONE[report.grade] ?? GRADE_TONE.F
          }`}
        >
          {report.grade}
        </div>
        <div>
          <p className="text-3xl font-semibold tabular-nums">
            {tr("grade.score", { score: report.score })}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {report.totalIssues === 1 && locale === "en"
              ? tr("issues.countOne")
              : tr("issues.count", { count: report.totalIssues })}
          </p>
          {/* The comparison sits with the score, not in a box of its own: it is
              a reading of that number, and away from it it becomes trivia. */}
          {pct && (
            <p className="mt-2 text-sm">
              <span
                className={pct.direction === "worse" ? "text-amber-500" : "text-emerald-500"}
              >
                {tr(pct.key, { percent: pct.percent, language: primaryLanguage ?? "" })}
              </span>{" "}
              <span className="text-xs text-muted-foreground">
                {tr("pct.sample", { count: percentile?.sample ?? 0 })}
              </span>
            </p>
          )}
          <p className="mt-2 flex flex-wrap gap-3 text-xs">
            {(["critical", "warning", "info"] as const).map((sev) => (
              // A zero is good news and must not be painted like bad news. Red
              // "0 critical" next to "Came back clean" reads as an alarm the eye
              // catches before the words, which is the whole message undone by a
              // colour token.
              <span
                key={sev}
                className={report.counts[sev] > 0 ? SEVERITY_TONE[sev] : "text-muted-foreground/50"}
              >
                {report.counts[sev]} {tr(`issues.${sev}` as Parameters<typeof t>[1])}
              </span>
            ))}
          </p>
        </div>
      </section>

      {/* The good news, said as news.
          Everything below this point is a list of what is wrong, which reads as
          an accusation even when the list is empty — an empty list states an
          absence, and an absence is not something anyone shows a colleague. The
          wording here is built only out of what the scan established: how much
          was read, and what was not found in it. */}
      {isBoastworthy(verdict) && (
        <section className="mt-8 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3.5">
          <p className="text-sm font-semibold">
            {tr(verdict === "clean" ? "verdict.clean.title" : "verdict.strong.title")}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-foreground/80">
            {scope
              ? tr(
                  verdict === "clean"
                    ? "verdict.clean.body"
                    : report.totalIssues === 1
                      ? "verdict.strong.bodyOne"
                      : "verdict.strong.body",
                  { scope, count: report.totalIssues },
                )
              : tr(verdict === "clean" ? "verdict.noScope.clean" : "verdict.noScope.strong", {
                  count: report.totalIssues,
                })}
          </p>
        </section>
      )}

      {report.byCategory.length > 0 && (
        <section className="mt-10">
          <ul className="grid gap-2 sm:grid-cols-2">
            {report.byCategory.map(({ category, count }) => (
              <li
                key={category}
                className="flex items-center justify-between rounded-lg border border-border bg-card/40 px-3 py-2 text-sm"
              >
                <span className="capitalize">{category.replace(/-/g, " ")}</span>
                <span className="tabular-nums text-muted-foreground">{count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.topIssues.length > 0 && (
        <section className="mt-10">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {report.topIssues.map((issue, i) => (
              <li key={`${issue.title}-${i}`} className="flex gap-3 px-3 py-2.5 text-sm">
                <span className={`mt-0.5 text-xs ${SEVERITY_TONE[issue.severity]}`}>●</span>
                <span className="break-words">{issue.title}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{tr("share.redactedNote")}</p>
        </section>
      )}

      {report.profile && report.profile.languages.length > 0 && (
        <section className="mt-8 text-xs text-muted-foreground">
          {report.profile.languages
            .slice(0, 5)
            .map((l) => `${l.language} ${l.loc.toLocaleString("en-US")}`)
            .join(" · ")}
        </section>
      )}

      {report.repoUrl && (
        <FreshScanCta repoUrl={report.repoUrl} repoLabel={`${owner}/${name}`} />
      )}

      <div className="mt-12 border-t border-border pt-6">
        <Link href="/" className="text-sm text-primary underline-offset-4 hover:underline">
          {tr("share.rescan")}
        </Link>
      </div>
    </main>
  )
}
