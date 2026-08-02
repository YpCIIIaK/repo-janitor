import Link from "next/link"
import type { SharedReport } from "@/lib/share-report"
import { cardHeadline, compactScope, formatScannedAt } from "@/lib/health-card"
import { gradeHex } from "@/lib/grade-style"
import { scopeLine } from "@/lib/verdict"
import { cn } from "@/lib/utils"
import type { WidgetOptions } from "@/lib/widget-options"

/**
 * Compact health widget for the `/embed/...` iframe.
 *
 * Intentionally small: grade, score, severity chips, one-line verdict. No
 * findings list — that stays on the full shared page the plaque links to.
 * Bands and theme come from the embed URL query (`theme`, `hide=…`, `size=`).
 */

const shell =
  "box-border flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-3 text-card-foreground"

export function EmbedWidget({
  report,
  reportHref,
  pathOwner,
  pathName,
  options,
}: {
  report: SharedReport
  reportHref: string
  /** Path wins over report.repo so a mismatched token cannot rename the plaque. */
  pathOwner: string
  pathName: string
  options: WidgetOptions
}) {
  const color = gradeHex(report.grade)
  const headline = cardHeadline(report)
  const scope = compactScope(scopeLine(report.profile))
  const scanned = formatScannedAt(report.generatedAt)
  const roomy = options.size === "roomy"

  return (
    <Link
      href={reportHref}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        shell,
        roomy ? "p-4" : "p-3",
        "no-underline outline-none transition-opacity hover:opacity-95 focus-visible:ring-2 focus-visible:ring-primary",
      )}
      style={{ borderLeftWidth: 4, borderLeftColor: color }}
    >
      <div className="min-w-0 shrink-0">
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">REPO ANTI-ROT</p>
        <p className={cn("mt-0.5 truncate font-semibold tracking-tight", roomy ? "text-base" : "text-sm")}>
          {pathOwner}/{pathName}
        </p>
      </div>

      <div className={cn("flex min-h-0 flex-1 items-end justify-between gap-2", roomy ? "mt-3" : "mt-2")}>
        <div className="min-w-0">
          <p
            className={cn(
              "font-mono font-bold leading-none tabular-nums",
              roomy ? "text-3xl" : "text-2xl",
            )}
          >
            {report.score}
            <span className="text-sm font-semibold text-muted-foreground">/100</span>
          </p>
          {options.headline ? (
            <p className="mt-1 truncate text-xs font-medium" style={{ color }}>
              {headline}
            </p>
          ) : null}
        </div>
        <div
          className={cn(
            "flex shrink-0 items-center justify-center rounded-xl border-[3px] bg-background font-extrabold",
            roomy ? "size-14 text-3xl" : "size-12 text-2xl",
          )}
          style={{ borderColor: color, color }}
        >
          {report.grade}
        </div>
      </div>

      {options.chips ? (
        <div className={cn("flex shrink-0 flex-wrap gap-1", roomy ? "mt-3" : "mt-2")}>
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
                "rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
                n > 0 ? "text-background" : "bg-muted text-muted-foreground",
              )}
              style={n > 0 ? { backgroundColor: fill } : undefined}
            >
              {n} {label}
            </span>
          ))}
        </div>
      ) : null}

      {options.meta ? (
        <div
          className={cn(
            "min-w-0 shrink-0 space-y-0.5 text-[11px] leading-tight text-muted-foreground",
            roomy ? "mt-3" : "mt-2",
          )}
        >
          {scope ? <p className="truncate">{scope}</p> : null}
          {scanned ? <p className="truncate">Scanned {scanned}</p> : null}
          {!scope && !scanned ? <p className="truncate">Snapshot of a published scan</p> : null}
        </div>
      ) : null}
    </Link>
  )
}

export function EmbedUnknown({ pathOwner, pathName }: { pathOwner: string; pathName: string }) {
  return (
    <div className={shell}>
      <div>
        <p className="text-[11px] font-semibold tracking-wider text-muted-foreground">REPO ANTI-ROT</p>
        <p className="mt-0.5 truncate text-sm font-semibold tracking-tight">
          {pathOwner}/{pathName}
        </p>
      </div>
      <p className="text-2xl font-bold text-muted-foreground">unknown</p>
      <p className="text-[11px] text-muted-foreground">No published scan for this repository</p>
    </div>
  )
}
