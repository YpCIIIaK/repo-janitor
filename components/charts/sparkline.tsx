"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { smoothPath, linePath } from "./utils"
import { useChartTooltip } from "./tooltip"

/**
 * From the personal UI kit (YpCIIIaK/personal-UI-kit, src/components/charts/sparkline.tsx).
 * Copied with the `cn` import path changed and one guard added, marked inline.
 * Keep in sync by hand: the kit is copy-paste, not a package.
 */
export function Sparkline({
  data,
  width = 120,
  height = 36,
  color = "var(--primary)",
  area = true,
  smooth = true,
  showDot = true,
  tooltip = false,
  className,
}: {
  data: number[]
  width?: number
  height?: number
  color?: string
  area?: boolean
  smooth?: boolean
  showDot?: boolean
  tooltip?: boolean
  className?: string
}) {
  const pad = 3
  const n = data.length
  const uid = React.useId().replace(/:/g, "")
  const tip = useChartTooltip()
  const svgRef = React.useRef<SVGSVGElement>(null)
  const [hi, setHi] = React.useState<number | null>(null)

  const min = Math.min(...data)
  const max = Math.max(...data)
  const span = max - min || 1
  const x = (i: number) => pad + (i / (n - 1)) * (width - pad * 2)
  const y = (v: number) => height - pad - ((v - min) / span) * (height - pad * 2)

  const onMove = (e: React.MouseEvent) => {
    if (!tooltip) return
    const rect = svgRef.current!.getBoundingClientRect()
    const px = ((e.clientX - rect.left) / rect.width) * width
    const idx = Math.max(
      0,
      Math.min(n - 1, Math.round(((px - pad) / (width - pad * 2)) * (n - 1))),
    )
    setHi(idx)
    tip.show(e, { rows: [{ label: "Value", value: data[idx], color }] })
  }

  // Added on top of the kit's version. A single point makes `x()` divide by
  // zero and emits `M NaN NaN`, which renders as an invisible path — the caller
  // sees an empty box with no clue why. A repo with one scan in its history is
  // the common case here, not an edge case.
  if (n < 2) return null

  const pts = data.map((v, i) => [x(i), y(v)] as [number, number])
  const path = smooth ? smoothPath(pts) : linePath(pts)

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={cn("overflow-visible", className)}
      onMouseMove={onMove}
      onMouseLeave={() => {
        setHi(null)
        tip.hide()
      }}
    >
      {area && (
        <>
          <defs>
            <linearGradient id={`spark-${uid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <path
            d={`${path} L ${x(n - 1)} ${height} L ${x(0)} ${height} Z`}
            fill={`url(#spark-${uid})`}
          />
        </>
      )}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDot && hi === null && <circle cx={x(n - 1)} cy={y(data[n - 1])} r={2.5} fill={color} />}
      {hi !== null && (
        <circle
          cx={x(hi)}
          cy={y(data[hi])}
          r={3}
          fill="var(--background)"
          stroke={color}
          strokeWidth={1.75}
        />
      )}
      {tip.node}
    </svg>
  )
}
