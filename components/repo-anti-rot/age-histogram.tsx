"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import type { Issue } from "@/lib/mock-data"
import { ageHistogram, medianAgeDays } from "@/lib/age"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const series = [
  { key: "critical", label: "Critical", color: "var(--chart-4)" },
  { key: "warning", label: "Warning", color: "var(--chart-2)" },
  { key: "info", label: "Info", color: "var(--chart-5)" },
] as const

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0)
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium">{label} old</p>
      <div className="flex flex-col gap-1">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: p.color }} />
              {p.dataKey}
            </span>
            <span className="font-mono tabular-nums">{p.value}</span>
          </div>
        ))}
        <div className="mt-0.5 flex items-center justify-between gap-4 border-t border-border pt-1">
          <span className="text-muted-foreground">total</span>
          <span className="font-mono tabular-nums">{total}</span>
        </div>
      </div>
    </div>
  )
}

function fmtMedian(days: number): string {
  if (days >= 365) return `${(days / 365).toFixed(1)}y`
  if (days >= 30) return `${Math.round(days / 30)}mo`
  return `${days}d`
}

/**
 * Distribution of finding ages, stacked by severity — surfaces entrenched debt
 * (old criticals) versus fresh issues. Hidden when there are no findings.
 */
export function AgeHistogram({ issues }: { issues: Issue[] }) {
  if (issues.length === 0) return null
  const data = ageHistogram(issues)
  const median = medianAgeDays(issues)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Finding age</CardTitle>
          <CardDescription>
            How long the rot has been sitting · median {fmtMedian(median)}
          </CardDescription>
        </div>
        <div className="flex items-center gap-3">
          {series.map((s) => (
            <span key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--accent)", opacity: 0.3 }} />
              {series.map((s) => (
                <Bar key={s.key} dataKey={s.key} stackId="1" fill={s.color} radius={[0, 0, 0, 0]} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
