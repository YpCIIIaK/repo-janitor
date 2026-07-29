"use client"

import { useEffect, useState, type ReactNode } from "react"
import {
  Activity,
  Boxes,
  GitBranch,
  GitGraph,
  Info,
  LayoutGrid,
  LayoutDashboard,
  Link as LinkIcon,
  ListTree,
  PanelLeftClose,
  PanelLeftOpen,
  ScanLine,
  ShieldCheck,
  Trash2,
  Workflow,
} from "lucide-react"
import type { Grade } from "@/lib/mock-data"
import { Sparkline } from "@/components/charts/sparkline"
import { NavItem, NavSectionLabel } from "./sidebar-nav"
import { cn } from "@/lib/utils"

/** Persisted so the choice survives a reload — a layout preference you have to
 * re-make every visit is not a preference. */
const COLLAPSE_KEY = "repo-anti-rot:sidebar-collapsed:v1"

export interface SidebarRepo {
  id: string
  name: string
  defaultBranch: string
  grade: Grade
  score: number
  lastScan: string
  /** Score at each past scan, oldest first. Fewer than two points draws nothing. */
  scoreHistory?: number[]
}

/** Chart token per grade, so the sparkline matches the badge beside it. */
const gradeChart: Record<Grade, string> = {
  A: "chart-1",
  B: "chart-2",
  C: "chart-2",
  D: "chart-3",
  F: "chart-4",
}

const gradeColor: Record<Grade, string> = {
  A: "text-primary border-primary/30 bg-primary/10",
  B: "text-chart-2 border-chart-2/30 bg-chart-2/10",
  C: "text-chart-2 border-chart-2/30 bg-chart-2/10",
  D: "text-chart-3 border-chart-3/30 bg-chart-3/10",
  F: "text-destructive border-destructive/30 bg-destructive/10",
}

/** Section ids — mirrors PaletteTab so the palette and the sidebar agree. */
export type SidebarSection =
  | "overview"
  | "issues"
  | "security"
  | "links"
  | "tree"
  | "history"
  | "about"
  | "breakdown"

export interface SectionCounts {
  issues?: number
  security?: number
  links?: number
}

/** One button on the far-left application rail. */
function RailButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "flex size-9 items-center justify-center rounded-lg transition-colors [&_svg]:size-4",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      {icon}
    </button>
  )
}

/**
 * Two-tier sidebar, after sourcecraft.dev: a narrow rail of application-level
 * destinations, and a wider panel holding everything about the current repo.
 *
 * The sections used to be tabs above the content. Moving them here buys back the
 * full width of the page for the report, and — more to the point — a tab strip
 * stops working at eight tabs: they compete with the repo title for the same
 * horizontal band, and there is no room left to say how many findings each one
 * holds. In a vertical list the counts fit, so you can see where the problems
 * are before clicking anything.
 *
 * Collapsing hides the panel and leaves the rail, so the layout has two honest
 * states rather than a squeezed middle one.
 */
export function RepoSidebar({
  repositories,
  activeId,
  onSelect,
  onRemove,
  onNewScan,
  onShowOverview,
  section,
  onSelectSection,
  counts,
  onHome,
  railExtras,
}: {
  repositories: SidebarRepo[]
  activeId: string
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
  onNewScan?: () => void
  onShowOverview?: () => void
  /** Current section; omitted on the cross-repo overview, where none applies. */
  section?: SidebarSection
  onSelectSection?: (s: SidebarSection) => void
  counts?: SectionCounts
  /** Back to the landing page. */
  onHome?: () => void
  /** Rendered at the foot of the rail — settings, help, and the like. */
  railExtras?: ReactNode
}) {
  const overviewActive = activeId === "__overview__"
  const [collapsed, setCollapsed] = useState(false)

  // Read after mount: localStorage does not exist during SSR, and reading it in
  // render would hydrate to a different width than the server drew.
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1")
    } catch {
      /* ignore unavailable storage */
    }
  }, [])

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0")
      } catch {
        /* ignore unavailable storage */
      }
      return next
    })
  }

  const current = repositories.find((r) => r.id === activeId)
  const go = (s: SidebarSection) => () => onSelectSection?.(s)

  return (
    <div className="sticky top-0 hidden h-screen shrink-0 lg:flex">
      {/* Application rail — constant, independent of which repo is open. */}
      <div className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-border py-3">
        <button
          onClick={onHome}
          title="Repo Anti-Rot — back to the start"
          aria-label="Back to the start"
          className="mb-2 flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary transition-colors hover:bg-primary/25"
        >
          <Activity className="size-4" />
        </button>
        {onShowOverview && (
          <RailButton
            icon={<LayoutGrid />}
            label="All repositories"
            active={overviewActive}
            onClick={onShowOverview}
          />
        )}
        {onNewScan && <RailButton icon={<ScanLine />} label="New scan" onClick={onNewScan} />}
        <div className="mt-auto flex flex-col items-center gap-1">{railExtras}</div>
      </div>

      {/* Contextual panel. */}
      <aside
        className={cn(
          "flex flex-col overflow-hidden border-r border-border transition-[width] duration-200",
          collapsed ? "w-0" : "w-64",
        )}
      >
        <div className="flex items-center gap-2 px-3 pb-2 pt-3">
          {current ? (
            <>
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold",
                  gradeColor[current.grade],
                )}
              >
                {current.grade}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{current.name}</span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  <GitBranch className="size-3 shrink-0" />
                  <span className="truncate">{current.defaultBranch}</span>
                </span>
              </span>
            </>
          ) : (
            <span className="text-sm font-semibold">Repositories</span>
          )}
          <button
            onClick={toggleCollapsed}
            aria-expanded
            aria-label="Collapse sidebar"
            title="Collapse sidebar"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
          >
            <PanelLeftClose className="size-4" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-2">
          {current && onSelectSection && !overviewActive && (
            <>
              <NavItem
                icon={<LayoutDashboard />}
                label="Overview"
                active={section === "overview"}
                onClick={go("overview")}
              />
              <NavItem
                icon={<ListTree />}
                label="Issues"
                count={counts?.issues}
                active={section === "issues"}
                onClick={go("issues")}
              />

              {/* Flat, not collapsible groups. A group is worth its cost when a
                  list is too long to scan; seven destinations are not, and the
                  group turned every one of them into two clicks — plus a guess
                  about which heading it was filed under. The headings stay as
                  labels, doing the grouping without hiding anything. */}
              <NavSectionLabel>Findings</NavSectionLabel>
              <NavItem
                icon={<ShieldCheck />}
                label="Security"
                count={counts?.security}
                active={section === "security"}
                onClick={go("security")}
              />
              <NavItem
                icon={<LinkIcon />}
                label="Links"
                count={counts?.links}
                active={section === "links"}
                onClick={go("links")}
              />
              <NavItem
                icon={<Boxes />}
                label="Breakdown"
                active={section === "breakdown"}
                onClick={go("breakdown")}
              />

              <NavSectionLabel>Repository</NavSectionLabel>
              <NavItem
                icon={<Workflow />}
                label="Tree"
                active={section === "tree"}
                onClick={go("tree")}
              />
              <NavItem
                icon={<GitGraph />}
                label="History"
                active={section === "history"}
                onClick={go("history")}
              />
              <NavItem
                icon={<Info />}
                label="About"
                active={section === "about"}
                onClick={go("about")}
              />
            </>
          )}

          <NavSectionLabel>
            Repositories
            {repositories.length > 0 && (
              <span className="ml-1.5 font-mono normal-case text-muted-foreground/70">
                {repositories.length}
              </span>
            )}
          </NavSectionLabel>

          {repositories.length === 0 && (
            <p className="px-2.5 py-2 text-xs text-muted-foreground">No repositories scanned yet.</p>
          )}

          {repositories.map((repo) => {
            const active = repo.id === activeId && !overviewActive
            return (
              <div
                key={repo.id}
                className={cn(
                  "group flex items-center gap-1 rounded-md pr-1 transition-colors",
                  active ? "bg-accent" : "hover:bg-accent/50",
                )}
              >
                <button
                  onClick={() => onSelect(repo.id)}
                  className="flex min-w-0 flex-1 items-center gap-2.5 px-2.5 py-1.5 text-left text-sm"
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded border font-mono text-[10px] font-semibold",
                      gradeColor[repo.grade],
                    )}
                  >
                    {repo.grade}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{repo.name}</span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[11px] text-muted-foreground/70">
                        {repo.lastScan}
                      </span>
                      {/* Direction of travel, which the grade alone never shows:
                          a C that was an F is a different situation from a C
                          that was an A. */}
                      {repo.scoreHistory && repo.scoreHistory.length > 1 && (
                        <Sparkline
                          data={repo.scoreHistory}
                          width={44}
                          height={14}
                          showDot={false}
                          color={`var(--${gradeChart[repo.grade]})`}
                          className="shrink-0 opacity-80"
                        />
                      )}
                    </span>
                  </span>
                </button>
                {onRemove && (
                  <button
                    onClick={() => onRemove(repo.id)}
                    aria-label={`Remove ${repo.name}`}
                    title="Remove from list"
                    className="shrink-0 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                )}
              </div>
            )
          })}
        </nav>
      </aside>

      {/* Reopening has to live outside the panel, which is zero-width when shut. */}
      {collapsed && (
        <button
          onClick={toggleCollapsed}
          aria-expanded={false}
          aria-label="Expand sidebar"
          title="Expand sidebar"
          className="absolute left-14 top-3 ml-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <PanelLeftOpen className="size-4" />
        </button>
      )}
    </div>
  )
}
