"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { r2 } from "./utils"

/**
 * From the personal UI kit (YpCIIIaK/personal-UI-kit, src/components/charts/gauge.tsx).
 *
 * Two changes from the original, both marked inline: the `cn` import path, and
 * an optional `children` slot for the centre. The kit's version always renders
 * the rounded value; this dashboard's headline reading is a letter grade, and
 * the score is the secondary fact — so the centre had to become substitutable
 * rather than the grade being bolted on beside a number it duplicates.
 *
 * Keep in sync by hand: the kit is copy-paste, not a package.
 */
export function Gauge({
  value,
  min = 0,
  max = 100,
  size = 200,
  thickness = 18,
  color = "var(--primary)",
  label,
  unit = "",
  className,
  children,
}: {
  value: number
  min?: number
  max?: number
  size?: number
  thickness?: number
  color?: string
  label?: string
  unit?: string
  className?: string
  /** Replaces the default numeric readout in the centre. */
  children?: React.ReactNode
}) {
  const pct = Math.min(1, Math.max(0, (value - min) / (max - min)))
  const r = (size - thickness) / 2
  const cx = size / 2
  const cy = size / 2
  // 270° arc from 135° to 405°
  const startA = (135 * Math.PI) / 180
  const sweep = (270 * Math.PI) / 180

  const polar = (a: number) => [r2(cx + r * Math.cos(a)), r2(cy + r * Math.sin(a))] as const
  const a0 = startA
  const a1 = startA + sweep
  const aVal = startA + sweep * pct

  const [bx0, by0] = polar(a0)
  const [bx1, by1] = polar(a1)
  const [vx, vy] = polar(aVal)

  const track = `M ${bx0} ${by0} A ${r} ${r} 0 1 1 ${bx1} ${by1}`
  const large = sweep * pct > Math.PI ? 1 : 0
  const fill = `M ${bx0} ${by0} A ${r} ${r} 0 ${large} 1 ${vx} ${vy}`

  return (
    <div
      className={cn("relative inline-flex flex-col items-center", className)}
      style={{ width: size }}
    >
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size * 0.82}>
        <path
          d={track}
          fill="none"
          stroke="var(--border)"
          strokeWidth={thickness}
          strokeLinecap="round"
        />
        <path
          d={fill}
          fill="none"
          stroke={color}
          strokeWidth={thickness}
          strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="-mt-12 flex flex-col items-center">
        {children ?? (
          <span className="text-3xl font-semibold tabular-nums">
            {Math.round(value)}
            <span className="text-base text-muted-foreground">{unit}</span>
          </span>
        )}
        {label && <span className="text-xs text-muted-foreground">{label}</span>}
      </div>
    </div>
  )
}
