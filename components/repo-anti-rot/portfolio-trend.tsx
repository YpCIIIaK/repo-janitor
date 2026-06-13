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
import type { PortfolioPoint } from "@/lib/reports-store"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ChartTooltipProps } from "@/lib/chart-tooltip"

function ChartTooltip({ active, payload, label }: ChartTooltipProps<PortfolioPoint>) {
  if (!active || !payload?.length) return null
  const p = payload[0]?.payload
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium">{label}</p>
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">avg score</span>
          <span className="font-mono tabular-nums">{p?.avgScore}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">open issues</span>
          <span className="font-mono tabular-nums">{p?.issues}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-muted-foreground">repos</span>
          <span className="font-mono tabular-nums">{p?.repos}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * Portfolio-wide average health score over time. Hidden until there are at least
 * two distinct scan moments to connect into a line.
 */
export function PortfolioTrend({ data }: { data: PortfolioPoint[] }) {
  if (data.length < 2) return null

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-base">Portfolio trend</CardTitle>
        <CardDescription>
          Average health score across all repos over {data.length} scan points
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <defs>
                <linearGradient id="fill-portfolio" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
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
                domain={[0, 100]}
                stroke="var(--muted-foreground)"
                fontSize={12}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
              />
              <Tooltip content={<ChartTooltip />} cursor={{ stroke: "var(--border)" }} />
              <Area
                type="monotone"
                dataKey="avgScore"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#fill-portfolio)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </CardContent>
    </Card>
  )
}
