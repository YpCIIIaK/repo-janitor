"use client"

import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react"
import type { StatCard } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

export function HealthOverview({ stats }: { stats: StatCard[] }) {
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border xl:grid-cols-4">
      {stats.map((stat) => {
        const Icon =
          stat.delta > 0 ? ArrowUpRight : stat.delta < 0 ? ArrowDownRight : Minus
        const deltaColor =
          stat.tone === "good"
            ? "text-primary"
            : stat.tone === "bad"
              ? "text-destructive"
              : "text-muted-foreground"
        return (
          <div key={stat.label} className="flex flex-col gap-3 bg-card p-4 md:p-5">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {stat.label}
            </span>
            <div className="flex items-end justify-between gap-2">
              <span className="font-mono text-3xl font-semibold tabular-nums">{stat.value}</span>
              <span className={cn("flex items-center gap-0.5 pb-1 text-xs font-medium", deltaColor)}>
                <Icon className="size-3.5" />
                {stat.delta !== 0 ? Math.abs(stat.delta) : ""}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">{stat.deltaLabel}</span>
          </div>
        )
      })}
    </div>
  )
}
