"use client"

import { type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Sidebar navigation primitives: a flat item and a section heading.
 *
 * Built rather than taken from the UI kit, which has a `TreeView` for data but
 * nothing for navigation.
 *
 * This started as collapsible groups, after sourcecraft.dev, with children on a
 * connector line. Used, it was worse than the list it replaced: seven sections
 * is not enough length to need folding, so every group bought nothing and cost a
 * click plus a guess at which heading a section was filed under. The headings
 * survive as plain labels — they still group, they just no longer hide.
 */

/** A top-level destination: icon, label, optional count. */
export function NavItem({
  icon,
  label,
  active,
  count,
  onClick,
  collapsed,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  count?: number
  onClick?: () => void
  /** Icon-only rail mode: the label moves into the tooltip. */
  collapsed?: boolean
}) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md py-1.5 text-sm transition-colors",
        collapsed ? "justify-center px-0" : "px-2.5",
        active
          ? "bg-accent font-medium text-foreground"
          : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <span className={cn("shrink-0 [&_svg]:size-4", active ? "text-primary" : "text-muted-foreground")}>
        {icon}
      </span>
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate text-left">{label}</span>
          {count !== undefined && count > 0 && (
            <span className="shrink-0 rounded-full bg-muted px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
              {count}
            </span>
          )}
        </>
      )}
    </button>
  )
}

/** Muted uppercase heading between blocks of the sidebar. */
export function NavSectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-2.5 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
      {children}
    </p>
  )
}
