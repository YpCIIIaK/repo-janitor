"use client"

import { Clock } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { Grade } from "@/lib/mock-data"

const gradeMeta: Record<Grade, { color: string; label: string }> = {
  A: { color: "var(--chart-1)", label: "Pristine" },
  B: { color: "var(--chart-2)", label: "Healthy" },
  C: { color: "var(--chart-2)", label: "Aging" },
  D: { color: "var(--chart-3)", label: "Rotting" },
  F: { color: "var(--chart-4)", label: "Critical decay" },
}

export function GradeCard({
  grade,
  score,
  lastScan,
}: {
  grade: Grade
  score: number
  lastScan: string
}) {
  const meta = gradeMeta[grade]
  const circumference = 2 * Math.PI * 52
  const offset = circumference - (score / 100) * circumference

  return (
    <Card>
      <CardContent className="flex flex-col items-center gap-4 p-6">
        <div className="relative size-32">
          <svg viewBox="0 0 120 120" className="size-full -rotate-90">
            <circle cx="60" cy="60" r="52" fill="none" stroke="var(--border)" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="52"
              fill="none"
              stroke={meta.color}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-4xl font-bold" style={{ color: meta.color }}>
              {grade}
            </span>
            <span className="font-mono text-xs tabular-nums text-muted-foreground">{score}/100</span>
          </div>
        </div>

        <div className="text-center">
          <p className="text-sm font-medium">{meta.label}</p>
          <p className="mt-1 flex items-center justify-center gap-1 text-xs text-muted-foreground">
            <Clock className="size-3" />
            Scanned {lastScan}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}
