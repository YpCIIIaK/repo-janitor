"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * From the personal UI kit (YpCIIIaK/personal-UI-kit, src/components/ui/virtual-list.tsx).
 * Copied with the `cn` import path changed. Keep in sync by hand — the kit is a
 * copy-paste library, not a package.
 *
 * Windowed list — only renders the visible rows (+overscan) for huge datasets.
 * Fixed row height for simplicity.
 */
export function VirtualList<T>({
  items,
  rowHeight,
  height,
  overscan = 6,
  renderItem,
  className,
}: {
  items: T[]
  rowHeight: number
  height: number
  overscan?: number
  renderItem: (item: T, index: number) => React.ReactNode
  className?: string
}) {
  const [scrollTop, setScrollTop] = React.useState(0)
  const total = items.length * rowHeight

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const visibleCount = Math.ceil(height / rowHeight) + overscan * 2
  const end = Math.min(items.length, start + visibleCount)

  const slice = items.slice(start, end)

  return (
    <div
      onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      style={{ height }}
      className={cn("relative overflow-auto rounded-xl border border-border bg-card", className)}
    >
      <div style={{ height: total, position: "relative" }}>
        <div style={{ position: "absolute", top: start * rowHeight, left: 0, right: 0 }}>
          {slice.map((item, i) => (
            <div key={start + i} style={{ height: rowHeight }}>
              {renderItem(item, start + i)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
