"use client"

import * as React from "react"
import { cn } from "@/lib/utils"

/**
 * From the personal UI kit (YpCIIIaK/personal-UI-kit, src/components/ui/segmented.tsx).
 * Copied with two changes, both noted inline: the `cn` import path, and keyboard
 * support. Keep in sync by hand — the kit is copy-paste, not a package.
 */
export interface SegmentedItem {
  value: string
  label: React.ReactNode
  icon?: React.ReactNode
}

export function Segmented({
  items,
  value,
  defaultValue,
  onChange,
  size = "md",
  className,
  "aria-label": ariaLabel,
}: {
  items: SegmentedItem[]
  value?: string
  defaultValue?: string
  onChange?: (v: string) => void
  size?: "sm" | "md"
  className?: string
  "aria-label"?: string
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? items[0]?.value)
  const current = value ?? internal

  function select(v: string) {
    setInternal(v)
    onChange?.(v)
  }

  // Added on top of the kit's version: a segmented control is a radio group, and
  // arrow keys are how one is operated. Without this it is reachable by tab but
  // each option needs its own stop, which is worse than the Select it replaces.
  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const delta = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0
    if (!delta) return
    e.preventDefault()
    const next = items[(index + delta + items.length) % items.length]
    select(next.value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={cn("inline-flex items-center gap-1 rounded-lg bg-muted p-1", className)}
    >
      {items.map((it, i) => {
        const active = it.value === current
        return (
          <button
            key={it.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onKeyDown={(e) => onKeyDown(e, i)}
            onClick={() => select(it.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
              size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {it.icon}
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
