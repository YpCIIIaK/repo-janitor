"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Sidebar navigation primitives: flat items, and collapsible groups whose
 * children hang off a connector line.
 *
 * Built rather than taken from the UI kit, which has a `TreeView` for data but
 * nothing for navigation. The shape follows sourcecraft.dev's sidebar: a few
 * top-level destinations, then named groups that can be folded away, with the
 * children tied to their parent by an L-shaped rule.
 *
 * The connector is not decoration. Once a sidebar carries three levels of
 * meaning — app, repository, section — indentation alone stops being legible,
 * and a line makes "these four belong to that heading" readable without
 * counting pixels.
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

/**
 * A collapsible section. Open state is local and starts from `defaultOpen`:
 * these are cheap to reopen, and persisting every group would mean a storage
 * key per group for a preference nobody forms deliberately.
 */
export function NavGroup({
  icon,
  label,
  defaultOpen = true,
  collapsed,
  children,
}: {
  icon: ReactNode
  label: string
  defaultOpen?: boolean
  collapsed?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  // In the rail there is no room for a heading, so groups flatten to their
  // children — hiding them behind an unlabelled chevron would lose them.
  if (collapsed) return <>{children}</>

  return (
    <div>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-foreground/80 transition-colors hover:bg-accent/50 hover:text-foreground"
      >
        <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>
      {open && (
        // The vertical rule sits under the parent icon; each child draws its own
        // horizontal stub to meet it.
        <div className="relative ml-[1.05rem] border-l border-border pl-3">{children}</div>
      )}
    </div>
  )
}

/** A child of a NavGroup: same affordances, plus the connector stub. */
export function NavChild({
  icon,
  label,
  active,
  count,
  badge,
  onClick,
}: {
  icon?: ReactNode
  label: string
  active?: boolean
  count?: number
  /** Small inline pill, e.g. "NEW". */
  badge?: string
  onClick?: () => void
}) {
  return (
    <div className="relative">
      <span
        aria-hidden
        className={cn(
          "absolute -left-3 top-[1.05rem] h-px w-3",
          active ? "bg-primary/50" : "bg-border",
        )}
      />
      <button
        onClick={onClick}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
          active
            ? "bg-accent font-medium text-foreground"
            : "text-foreground/75 hover:bg-accent/50 hover:text-foreground",
        )}
      >
        {icon && (
          <span
            className={cn(
              "shrink-0 [&_svg]:size-4",
              active ? "text-primary" : "text-muted-foreground",
            )}
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-left">{label}</span>
        {badge && (
          <span className="shrink-0 rounded border border-primary/40 px-1 text-[9px] font-medium uppercase tracking-wide text-primary">
            {badge}
          </span>
        )}
        {count !== undefined && count > 0 && (
          <span className="shrink-0 rounded-full bg-muted px-1.5 font-mono text-[10px] tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </button>
    </div>
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
