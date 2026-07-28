"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { useChartTooltip } from "./tooltip"

/**
 * From the personal UI kit (YpCIIIaK/personal-UI-kit, src/components/charts/calendar-heatmap.tsx).
 * Copied with the `cn` import path changed. Keep in sync by hand — the kit is a
 * copy-paste library, not a package.
 *
 * GitHub-style contribution calendar. Renders the `weeks` columns ending today.
 */
export interface HeatDay {
  date: string // YYYY-MM-DD
  value: number
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10)
}

export function CalendarHeatmap({
  data,
  weeks = 53,
  endDate,
  className,
}: {
  data: HeatDay[]
  weeks?: number
  endDate?: Date
  className?: string
}) {
  const map = React.useMemo(() => {
    const m = new Map<string, number>()
    for (const d of data) m.set(d.date, d.value)
    return m
  }, [data])

  const cell = 13
  const gap = 3
  const max = Math.max(1, ...data.map((d) => d.value))
  const tip = useChartTooltip()

  const end = endDate ?? new Date()
  // align end to Saturday
  const endAligned = new Date(end)
  endAligned.setDate(endAligned.getDate() + (6 - endAligned.getDay()))
  const start = new Date(endAligned)
  start.setDate(start.getDate() - (weeks * 7 - 1))

  const cols: { date: Date; iso: string; value: number }[][] = []
  const cursor = new Date(start)
  for (let w = 0; w < weeks; w++) {
    const col: { date: Date; iso: string; value: number }[] = []
    for (let d = 0; d < 7; d++) {
      const iso = isoDate(cursor)
      col.push({ date: new Date(cursor), iso, value: map.get(iso) ?? 0 })
      cursor.setDate(cursor.getDate() + 1)
    }
    cols.push(col)
  }

  const level = (v: number) => {
    if (v <= 0) return 0
    const f = v / max
    if (f < 0.25) return 1
    if (f < 0.5) return 2
    if (f < 0.75) return 3
    return 4
  }
  const colors = [
    "var(--muted)",
    "color-mix(in oklab, var(--primary) 25%, var(--muted))",
    "color-mix(in oklab, var(--primary) 50%, var(--muted))",
    "color-mix(in oklab, var(--primary) 75%, var(--muted))",
    "var(--primary)",
  ]

  const w = weeks * (cell + gap) + 30
  const h = 7 * (cell + gap) + 20

  return (
    <div className={cn("w-full overflow-x-auto", className)}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`}>
        {cols.map((col, ci) => {
          const firstOfMonth = col.find((d) => d.date.getDate() <= 7)
          const x = 30 + ci * (cell + gap)
          return (
            <g key={ci}>
              {firstOfMonth && (
                <text x={x} y={10} className="fill-[var(--muted-foreground)] text-[9px]">
                  {MONTH_LABELS[firstOfMonth.date.getMonth()]}
                </text>
              )}
              {col.map((d, ri) => (
                <rect
                  key={ri}
                  x={x}
                  y={16 + ri * (cell + gap)}
                  width={cell}
                  height={cell}
                  rx={2.5}
                  fill={colors[level(d.value)]}
                  onMouseEnter={(e) =>
                    tip.show(e, {
                      title: d.iso,
                      rows: [{ label: "Commits", value: d.value }],
                    })
                  }
                  onMouseMove={tip.move}
                  onMouseLeave={tip.hide}
                />
              ))}
            </g>
          )
        })}
        {["Mon", "Wed", "Fri"].map((lbl, i) => (
          <text
            key={lbl}
            x={0}
            y={16 + (i * 2 + 1) * (cell + gap) + 9}
            className="fill-[var(--muted-foreground)] text-[9px]"
          >
            {lbl}
          </text>
        ))}
      </svg>
      {tip.node}
    </div>
  )
}
