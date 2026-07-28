import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * From the personal UI kit (YpCIIIaK/personal-UI-kit, src/components/ui/timeline.tsx).
 * Copied verbatim apart from the `cn` import path. Keep in sync by hand — the
 * kit is a copy-paste library, not a package.
 */
export interface TimelineItem {
  title: React.ReactNode
  time?: React.ReactNode
  description?: React.ReactNode
  icon?: React.ReactNode
  color?: string
}

export function Timeline({ items, className }: { items: TimelineItem[]; className?: string }) {
  return (
    <ol className={cn("relative flex flex-col", className)}>
      {items.map((it, i) => {
        const last = i === items.length - 1
        return (
          <li key={i} className="flex gap-4 pb-6 last:pb-0">
            <div className="relative flex flex-col items-center">
              <span
                className="z-10 flex size-8 items-center justify-center rounded-full border border-border bg-card text-xs [&_svg]:size-4"
                style={it.color ? { color: it.color } : undefined}
              >
                {it.icon ?? (
                  <span
                    className="size-2.5 rounded-full bg-current"
                    style={{ color: it.color ?? "var(--primary)" }}
                  />
                )}
              </span>
              {!last && <span className="w-px flex-1 bg-border" />}
            </div>
            <div className="flex-1 pt-1">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-medium">{it.title}</div>
                {it.time && <time className="text-xs text-muted-foreground">{it.time}</time>}
              </div>
              {it.description && <p className="mt-1 text-sm text-muted-foreground">{it.description}</p>}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
