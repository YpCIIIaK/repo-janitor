"use client"

import { useEffect, useState } from "react"
import { GitBranch, Trash2, ScanLine, LayoutGrid, PanelLeftClose, PanelLeftOpen } from "lucide-react"
import type { Grade } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { Sparkline } from "@/components/charts/sparkline"
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

export function RepoSidebar({
  repositories,
  activeId,
  onSelect,
  onRemove,
  onNewScan,
  onShowOverview,
}: {
  repositories: SidebarRepo[]
  activeId: string
  onSelect: (id: string) => void
  onRemove?: (id: string) => void
  onNewScan?: () => void
  onShowOverview?: () => void
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

  return (
    <aside
      className={cn(
        "sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 flex-col border-r border-border transition-[width] duration-200 lg:flex",
        collapsed ? "w-14" : "w-64",
      )}
    >
      <div className={cn("flex px-2 pt-3", collapsed ? "justify-center" : "justify-end")}>
        <button
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        </button>
      </div>
      {onShowOverview && (
        <div className="px-2 pt-1">
          <button
            onClick={onShowOverview}
            title={collapsed ? "All repositories" : undefined}
            className={cn(
              "flex w-full items-center gap-2 rounded-md py-2 text-sm transition-colors",
              collapsed ? "justify-center px-0" : "px-3",
              overviewActive ? "bg-accent text-foreground" : "text-foreground/90 hover:bg-accent/60",
            )}
          >
            <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
            {!collapsed && "All repositories"}
          </button>
        </div>
      )}
      {!collapsed && (
        <div className="px-4 py-3">
          <p className="px-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Repositories
            {repositories.length > 0 && (
              <span className="ml-1.5 font-mono normal-case text-muted-foreground/70">
                {repositories.length}
              </span>
            )}
          </p>
        </div>
      )}
      <nav className={cn("flex flex-1 flex-col gap-0.5 overflow-y-auto px-2", collapsed && "pt-2")}>
        {repositories.length === 0 && !collapsed && (
          <p className="px-2 py-2 text-xs text-muted-foreground">No repositories scanned yet.</p>
        )}
        {repositories.map((repo) => {
          const active = repo.id === activeId
          return (
            <div
              key={repo.id}
              className={cn(
                "group flex items-center gap-2 rounded-md pr-1 transition-colors",
                active ? "bg-accent" : "hover:bg-accent/60",
              )}
            >
              <button
                onClick={() => onSelect(repo.id)}
                // Collapsed the row is a grade badge only, so the title carries
                // the name and score the label no longer has room for.
                title={collapsed ? `${repo.name} · ${repo.score}` : undefined}
                className={cn(
                  "flex min-w-0 flex-1 items-center py-2 text-left text-sm",
                  collapsed ? "justify-center px-0" : "gap-3 px-2",
                )}
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold",
                    gradeColor[repo.grade],
                  )}
                >
                  {repo.grade}
                </span>
                {!collapsed && (
                  <span className="min-w-0 flex-1">
                    <span className={cn("block truncate", active ? "text-foreground" : "text-foreground/90")}>
                      {repo.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <GitBranch className="size-3 shrink-0" />
                      <span className="truncate">{repo.defaultBranch}</span>
                      <span className="text-muted-foreground/50">·</span>
                      <span className="font-mono tabular-nums">{repo.score}</span>
                    </span>
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
                          width={52}
                          height={16}
                          showDot={false}
                          color={`var(--${gradeChart[repo.grade]})`}
                          className="shrink-0 opacity-80"
                        />
                      )}
                    </span>
                  </span>
                )}
              </button>
              {onRemove && !collapsed && (
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

      {onNewScan && (
        <div className={cn("border-t border-border", collapsed ? "p-2" : "p-3")}>
          <Button
            onClick={onNewScan}
            variant="secondary"
            title={collapsed ? "New scan" : undefined}
            className={cn("w-full gap-2", collapsed ? "justify-center px-0" : "justify-start")}
          >
            <ScanLine className="size-4" />
            {!collapsed && "New scan"}
          </Button>
        </div>
      )}
    </aside>
  )
}
