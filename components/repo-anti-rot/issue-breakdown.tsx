"use client"

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { categoryLabels, type Issue, type IssueCategory } from "@/lib/mock-data"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const series = [
  { key: "critical", label: "Critical", color: "var(--chart-4)" },
  { key: "warning", label: "Warning", color: "var(--chart-2)" },
  { key: "info", label: "Info", color: "var(--chart-5)" },
] as const

const ORDER: IssueCategory[] = ["secret", "env", "dependency", "branch", "todo", "dead-code"]

function BreakdownTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium">{label}</p>
      <div className="flex flex-col gap-1">
        {payload
          .filter((p: any) => p.value > 0)
          .map((p: any) => (
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

export function IssueBreakdown({ issues }: { issues: Issue[] }) {
  const data = ORDER.map((cat) => {
    const list = issues.filter((i) => i.category === cat)
    return {
      category: categoryLabels[cat],
      critical: list.filter((i) => i.severity === "critical").length,
      warning: list.filter((i) => i.severity === "warning").length,
      info: list.filter((i) => i.severity === "info").length,
      total: list.length,
    }
  }).filter((d) => d.total > 0)

  const chartHeight = Math.max(160, data.length * 52 + 24)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-4">
        <div className="space-y-1">
          <CardTitle className="text-base">Issues by category</CardTitle>
          <CardDescription>
            {issues.length === 0
              ? "No issues in the latest scan"
              : `${issues.length} issue${issues.length === 1 ? "" : "s"} grouped by type and severity`}
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
        {data.length === 0 ? (
          <div className="flex h-40 items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
            Clean scan — nothing to break down. 🎉
          </div>
        ) : (
          <div style={{ height: chartHeight }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={data}
                margin={{ top: 4, right: 12, left: 8, bottom: 0 }}
                barCategoryGap={12}
              >
                <CartesianGrid stroke="var(--border)" horizontal={false} />
                <XAxis
                  type="number"
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <YAxis
                  type="category"
                  dataKey="category"
                  stroke="var(--muted-foreground)"
                  fontSize={12}
                  tickLine={false}
                  axisLine={false}
                  width={120}
                />
                <Tooltip content={<BreakdownTooltip />} cursor={{ fill: "var(--accent)", opacity: 0.4 }} />
                {series.map((s) => (
                  <Bar
                    key={s.key}
                    dataKey={s.key}
                    stackId="1"
                    fill={s.color}
                    radius={s.key === "info" ? [0, 4, 4, 0] : 0}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
