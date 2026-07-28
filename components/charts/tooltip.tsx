"use client"

import * as React from "react"
import { createPortal } from "react-dom"

/**
 * From the personal UI kit (YpCIIIaK/personal-UI-kit, src/components/charts/tooltip.tsx).
 * Copied verbatim apart from the `animate-enter` class, which the kit defines in
 * its own globals and this project does not — leaving it in would be a class
 * that silently does nothing. Keep in sync by hand.
 *
 * Shared chart tooltip — a small, theme-aware card that follows the cursor.
 * It is rendered in a body portal with `pointer-events:none`, so it never
 * intercepts hover and never gets clipped by chart containers.
 */
export interface TooltipRow {
  label: string
  value: React.ReactNode
  color?: string
}

interface TipState {
  x: number
  y: number
  title?: string
  rows: TooltipRow[]
}

type Pointer = { clientX: number; clientY: number }

export function useChartTooltip() {
  const [tip, setTip] = React.useState<TipState | null>(null)
  const [mounted, setMounted] = React.useState(false)
  // Deliberate: `createPortal` needs `document`, which does not exist during
  // SSR, so the portal must not be created until after mount. This project's
  // lint config is stricter than the kit's and flags the pattern by default.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  React.useEffect(() => setMounted(true), [])

  const show = (e: Pointer, data: { title?: string; rows: TooltipRow[] }) =>
    setTip({ x: e.clientX, y: e.clientY, ...data })

  const move = (e: Pointer) => setTip((t) => (t ? { ...t, x: e.clientX, y: e.clientY } : t))

  const hide = () => setTip(null)

  const node = mounted && tip ? createPortal(<ChartTooltipView tip={tip} />, document.body) : null

  return { show, move, hide, node }
}

function ChartTooltipView({ tip }: { tip: TipState }) {
  const flipX = tip.x > window.innerWidth * 0.66
  const flipY = tip.y > window.innerHeight * 0.66
  const tx = flipX ? "calc(-100% - 14px)" : "14px"
  const ty = flipY ? "calc(-100% - 14px)" : "14px"

  return (
    <div
      style={{
        position: "fixed",
        left: tip.x,
        top: tip.y,
        transform: `translate(${tx}, ${ty})`,
        pointerEvents: "none",
      }}
      className="z-[200] min-w-[120px] max-w-[240px] rounded-lg border border-border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md"
    >
      {tip.title && <div className="mb-1 font-medium">{tip.title}</div>}
      <div className="flex flex-col gap-1">
        {tip.rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            {r.color && (
              <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} />
            )}
            <span className="text-muted-foreground">{r.label}</span>
            <span className="ml-auto font-medium tabular-nums">{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
