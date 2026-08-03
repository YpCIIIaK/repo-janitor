"use client"

import { useEffect, useState } from "react"
import { useLocale } from "@/components/i18n/locale-provider"
import type { ScanSummary } from "@/lib/scan-summary"
import { GRADE_CSS_VAR } from "@/lib/grade-style"
import type { Grade } from "@/lib/mock-data"
import { SectionLabel } from "./section-label"

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

const ORDER: Grade[] = ["A", "B", "C", "D", "F"]

/**
 * Exposed as a hook because the landing page numbers its sections and this one
 * is allowed to disappear. The parent has to know whether it rendered, or the
 * eyebrows would count 01, 02, 04.
 */
export function useScanSummary(): ScanSummary | null {
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

  return summary
}

export function ScanSummarySection({ summary, index }: { summary: ScanSummary; index: string }) {
  const { t } = useLocale()
  const total = ORDER.reduce((n, g) => n + (summary.grades[g] ?? 0), 0)
  const max = Math.max(...ORDER.map((g) => summary.grades[g] ?? 0), 1)

  return (
    <section className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <SectionLabel index={index}>{t("landing.label.corpus")}</SectionLabel>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {t("summary.title")}
          </h2>
          <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
            {t("summary.lead")}
          </p>
        </div>

        <div className="mt-10 grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
            <div className="rounded-xl border border-border bg-card/60 p-5">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                {t("summary.median")}
              </p>
              <p className="tabnum mt-2 font-mono text-5xl font-semibold leading-none text-primary">
                {summary.median}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("summary.medianHint")}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card/60 p-5">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                {t("summary.scans")}
              </p>
              <p className="tabnum mt-2 font-mono text-5xl font-semibold leading-none">
                {summary.count}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                {t("summary.scansHint")}
              </p>
            </div>
          </div>

          {/* Bars rather than a pie: the interesting thing is that F is not rare,
              and a row of lengths says that at a glance. */}
          <figure className="rounded-xl border border-border bg-card/60 p-5">
            <figcaption className="flex items-center justify-between font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
              {t("summary.spread")}
              <span className="tabnum">n = {total}</span>
            </figcaption>
            <ul className="mt-5 flex flex-col gap-3">
              {ORDER.map((grade) => {
                const n = summary.grades[grade] ?? 0
                return (
                  <li key={grade} className="flex items-center gap-3">
                    <span
                      className="flex size-6 shrink-0 items-center justify-center rounded font-mono text-xs font-bold"
                      style={{
                        color: GRADE_CSS_VAR[grade],
                        backgroundColor: `color-mix(in oklab, ${GRADE_CSS_VAR[grade]} 15%, transparent)`,
                      }}
                    >
                      {grade}
                    </span>
                    <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                      <span
                        className="block h-full rounded-full"
                        style={{
                          width: `${Math.round((n / max) * 100)}%`,
                          backgroundColor: GRADE_CSS_VAR[grade],
                        }}
                      />
                    </span>
                    <span className="tabnum w-8 shrink-0 text-right font-mono text-xs text-muted-foreground">
                      {n}
                    </span>
                    <span className="tabnum w-10 shrink-0 text-right font-mono text-xs text-muted-foreground/70">
                      {total > 0 ? Math.round((n / total) * 100) : 0}%
                    </span>
                  </li>
                )
              })}
            </ul>
          </figure>
        </div>
      </div>
    </section>
  )
}
