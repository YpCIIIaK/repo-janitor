"use client"

import { GitBranch, Trash2, ScanLine, LayoutGrid } from "lucide-react"
import type { Grade } from "@/lib/mock-data"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface SidebarRepo {
  id: string
  name: string
  defaultBranch: string
  grade: Grade
  score: number
  lastScan: string
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
  return (
    <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-64 shrink-0 flex-col border-r border-border lg:flex">
      {onShowOverview && (
        <div className="px-2 pt-3">
          <button
            onClick={onShowOverview}
            className={cn(
              "flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
              overviewActive ? "bg-accent text-foreground" : "text-foreground/90 hover:bg-accent/60",
            )}
          >
            <LayoutGrid className="size-4 shrink-0 text-muted-foreground" />
            All repositories
          </button>
        </div>
      )}
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
      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2">
        {repositories.length === 0 && (
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
                className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left text-sm"
              >
                <span
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-md border font-mono text-xs font-semibold",
                    gradeColor[repo.grade],
                  )}
                >
                  {repo.grade}
                </span>
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
                  <span className="block truncate text-[11px] text-muted-foreground/70">
                    {repo.lastScan}
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

      {onNewScan && (
        <div className="border-t border-border p-3">
          <Button onClick={onNewScan} variant="secondary" className="w-full justify-start gap-2">
            <ScanLine className="size-4" />
            New scan
          </Button>
        </div>
      )}
    </aside>
  )
}
