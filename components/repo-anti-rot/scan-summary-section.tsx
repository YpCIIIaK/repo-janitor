"use client"

import { useEffect, useState } from "react"
import { useLocale } from "@/components/i18n/locale-provider"
import type { ScanSummary } from "@/lib/scan-summary"
import type { Grade } from "@/lib/mock-data"

/**
 * What everything scanned so far looks like, on the landing page.
 *
 * A stranger has no idea whether 74 is good. "The median repository scores 70"
 * answers that before they scan anything, and it comes from the same table as
 * the percentile on the report page — so the two cannot tell different stories.
 *
 * Fetched after paint and rendered only when there is something to say. Below
 * the sample threshold it draws nothing at all: a median of nine repositories is
 * a coincidence, and putting it on a front page would dress it as a finding.
 * A placeholder saying "not enough data yet" would be worse than the silence,
 * since the absence is not something a reader can use.
 *
 * Deliberately not the npm download count. That number is larger and would be a
 * lie: three published versions with near-identical totals, spiking on publish
 * days rather than weekdays, which is what mirrors and security scanners look
 * like. Printing it as social proof on a tool built to find quiet
 * misrepresentation would be the tool's own first finding — and anyone can
 * disprove it in ten seconds from a public API.
 */

/** Colour per band, matching the grade section directly above it. */
const BAND_TONE: Record<Grade, string> = {
  A: "bg-emerald-500",
  B: "bg-lime-500",
  C: "bg-amber-500",
  D: "bg-orange-500",
  F: "bg-red-500",
}

const ORDER: Grade[] = ["A", "B", "C", "D", "F"]

export function ScanSummarySection() {
  const { t } = useLocale()
  const [summary, setSummary] = useState<ScanSummary | null>(null)

  useEffect(() => {
    let live = true
    fetch("/api/scan-summary", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: (ScanSummary & { count: number }) | null) => {
        if (!live || !data || !data.count || data.median === undefined) return
        setSummary(data)
      })
      .catch(() => {
        /* statistics must never be load-bearing on a landing page */
      })
    return () => {
      live = false
    }
  }, [])

  if (!summary) return null

  const max = Math.max(...ORDER.map((g) => summary.grades[g] ?? 0), 1)

  return (
    <section className="mt-20">
      <h2 className="text-balance text-2xl font-semibold tracking-tight">{t("summary.title")}</h2>
      <p className="mt-2 max-w-2xl text-pretty text-sm leading-relaxed text-muted-foreground">
        {t("summary.lead")}
      </p>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
          <p className="text-3xl font-semibold tabular-nums">{summary.median}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("summary.median")}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{t("summary.medianHint")}</p>
        </div>
        <div className="rounded-lg border border-border bg-card/40 px-4 py-3">
          <p className="text-3xl font-semibold tabular-nums">{summary.count}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("summary.scans")}</p>
          <p className="mt-1 text-xs text-muted-foreground/70">{t("summary.scansHint")}</p>
        </div>
      </div>

      {/* Bars rather than a pie: the interesting thing is that F is not rare,
          and a row of lengths says that at a glance. */}
      <p className="mt-6 text-sm font-medium">{t("summary.spread")}</p>
      <div className="mt-3 space-y-1.5">
        {ORDER.map((grade) => {
          const n = summary.grades[grade] ?? 0
          return (
            <div key={grade} className="flex items-center gap-3 text-xs">
              <span className="w-4 font-mono font-semibold">{grade}</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                <span
                  className={`block h-full rounded-full ${BAND_TONE[grade]}`}
                  style={{ width: `${Math.round((n / max) * 100)}%` }}
                />
              </span>
              <span className="w-8 text-right tabular-nums text-muted-foreground">{n}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
