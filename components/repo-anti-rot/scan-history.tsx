"use client"

import { useMemo } from "react"
import { TrendingDown, TrendingUp, Minus, ScanLine } from "lucide-react"
import type { TrendPoint } from "@/lib/reports-store"
import { scoreToGrade } from "@/lib/score"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Timeline, type TimelineItem } from "@/components/ui/timeline"

import { gradeCssVar } from "@/lib/grade-style"

function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
}

/**
 * Scan history as a timeline: what the score was each time this repo was
 * scanned, and which way it moved.
 *
 * The trend chart already plots the same numbers, but a chart answers "what
 * shape" and this answers "what happened, when" — which is the question you have
 * when a grade dropped and you want to know between which two scans.
 */
export function ScanHistory({ history }: { history: TrendPoint[] }) {
  const items = useMemo<TimelineItem[]>(() => {
    // Newest first: the most recent scan is the one being asked about.
    const ordered = [...history].sort((a, b) => b.at.localeCompare(a.at))

    return ordered.map((p, i) => {
      // `ordered` is newest-first, so the NEXT element is the earlier scan.
      const prev = ordered[i + 1]
      const delta = prev ? p.score - prev.score : null
      const grade = scoreToGrade(p.score)

      const Icon = delta === null ? ScanLine : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus

      return {
        title: (
          <span className="flex items-center gap-2">
            <span className="font-mono font-semibold" style={{ color: gradeCssVar(grade) }}>
              {grade}
            </span>
            <span className="font-mono tabular-nums">{p.score}/100</span>
            {delta !== null && delta !== 0 && (
              <span
                className="font-mono text-xs tabular-nums"
                style={{ color: delta > 0 ? "var(--grade-a)" : "var(--grade-f)" }}
              >
                {delta > 0 ? "+" : ""}
                {delta}
              </span>
            )}
          </span>
        ),
        time: formatWhen(p.at),
        description: `${p.critical} critical · ${p.warning} warning · ${p.info} info`,
        icon: <Icon />,
        color: gradeCssVar(grade),
      }
    })
  }, [history])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Scan history</CardTitle>
        <CardDescription>Every scan of this repository, newest first.</CardDescription>
      </CardHeader>
      <CardContent>
        {/* One point is not a history: it shows nothing the grade card above
            does not, and no movement, which is the whole point of this view. */}
        {items.length < 2 ? (
          <EmptyState
            icon={<ScanLine />}
            title="Only one scan so far"
            description="Scan this repository again to see whether it is getting better or worse. Decay shows up between scans, not within one."
            className="border-0 py-8"
          />
        ) : (
          <Timeline items={items} />
        )}
      </CardContent>
    </Card>
  )
}
