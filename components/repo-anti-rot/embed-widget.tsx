import Link from "next/link"
import type { SharedReport } from "@/lib/share-report"
import { cardHeadline, GRADE_COLOR } from "@/lib/health-card"
import { scopeLine } from "@/lib/verdict"
import { cn } from "@/lib/utils"

/**
 * Compact health widget for the `/embed/...` iframe.
 *
 * Intentionally small: grade, score, severity chips, one-line verdict. No
 * findings list — that stays on the full shared page the plaque links to.
 */

function formatScannedAt(iso: string): string | null {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  return new Date(t).toLocaleDateString("en-GB", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  })
}

const shell =
  "flex h-full min-h-0 flex-col justify-between rounded-xl border border-border bg-card p-4 text-card-foreground"

export function EmbedWidget({
  report,
  reportHref,
  pathOwner,
  pathName,
}: {
  report: SharedReport
  reportHref: string
  /** Path wins over report.repo so a mismatched token cannot rename the plaque. */
  pathOwner: string
  pathName: string
}) {
  const color = GRADE_COLOR[report.grade] ?? "#8b949e"
  const headline = cardHeadline(report)
  const scope = scopeLine(report.profile)
  const scanned = formatScannedAt(report.generatedAt)
  const foot = [scope, scanned ? `Scanned ${scanned}` : null].filter(Boolean).join(" · ")

  return (
    <Link
      href={reportHref}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(shell, "no-underline outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-primary")}
      style={{ borderLeftWidth: 4, borderLeftColor: color }}
    >
      <div>
        <p className="text-xs font-semibold tracking-wider text-muted-foreground">REPO ANTI-ROT</p>
        <p className="mt-1 truncate text-base font-semibold tracking-tight">
          {pathOwner}/{pathName}
        </p>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="font-mono text-2xl font-bold tabular-nums">
            {report.score}
            <span className="text-sm font-semibold text-muted-foreground">/100</span>
          </p>
          <p className="mt-0.5 truncate text-xs font-medium" style={{ color }}>
            {headline}
          </p>
        </div>
        <div
          className="flex size-14 shrink-0 items-center justify-center rounded-xl border-4 bg-background text-3xl font-extrabold"
          style={{ borderColor: color, color }}
        >
          {report.grade}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(
          [
            ["critical", report.counts.critical, "#f85149"],
            ["warning", report.counts.warning, "#d29922"],
            ["info", report.counts.info, "#8b949e"],
          ] as const
        ).map(([label, n, fill]) => (
          <span
            key={label}
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums",
              n > 0 ? "text-background" : "bg-muted text-muted-foreground",
            )}
            style={n > 0 ? { backgroundColor: fill } : undefined}
          >
            {n} {label}
          </span>
        ))}
      </div>

      {foot ? <p className="mt-2 truncate text-xs text-muted-foreground">{foot}</p> : null}
    </Link>
  )
}

export function EmbedUnknown({ pathOwner, pathName }: { pathOwner: string; pathName: string }) {
  return (
    <div className={shell}>
      <div>
        <p className="text-xs font-semibold tracking-wider text-muted-foreground">REPO ANTI-ROT</p>
        <p className="mt-1 truncate text-base font-semibold tracking-tight">
          {pathOwner}/{pathName}
        </p>
      </div>
      <p className="text-2xl font-bold text-muted-foreground">unknown</p>
      <p className="text-xs text-muted-foreground">No published scan for this repository</p>
    </div>
  )
}
