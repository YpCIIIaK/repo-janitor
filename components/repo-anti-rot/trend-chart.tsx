"use client"

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts"
import type { ChartPoint } from "@/lib/reports-store"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import type { ChartTooltipProps } from "@/lib/chart-tooltip"

const series = [
  { key: "critical", label: "Critical", color: "var(--chart-4)" },
  { key: "warning", label: "Warning", color: "var(--chart-2)" },
  { key: "info", label: "Info", color: "var(--chart-5)" },
] as const

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium">{label}</p>
      <div className="flex flex-col gap-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 capitalize text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: p.color }} />
              {p.dataKey}
            </span>
            <span className="font-mono tabular-nums">{p.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TrendChart({ data }: { data: ChartPoint[] }) {
  const trend = data
  const sparse = trend.length < 2
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Issue trend</CardTitle>
          <CardDescription>
            {sparse
              ? "Severity by scan — rescan over time to build a trend"
              : `Detected problems by severity across ${trend.length} scans`}
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
        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={trend} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                {series.map((s) => (
                  <linearGradient key={s.key} id={`fill-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="date"
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
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
              {series.map((s) => (
                <Area
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stackId="1"
                  stroke={s.color}
                  strokeWidth={2}
                  fill={`url(#fill-${s.key})`}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
