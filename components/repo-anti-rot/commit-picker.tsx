"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronRight, GitMerge, Tag, Search, FileDiff } from "lucide-react"
import type { CommitWithStats } from "@/lib/commit-sampling"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Segmented } from "@/components/ui/segmented"
import { VirtualList } from "@/components/ui/virtual-list"
import { cn } from "@/lib/utils"

const ROW_HEIGHT = 56
const LIST_HEIGHT = 420

/** Compact date — the year only matters once it is not this one. */
function shortDate(ms: number): string {
  const d = new Date(ms)
  const thisYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(thisYear ? {} : { year: "numeric" }),
  })
}

type Filter = "all" | "tagged" | "merges" | "big"
/** Above this many touched files a commit is "big" — where regressions hide. */
const BIG_CHANGE = 10

const statusStyle: Record<string, string> = {
  added: "text-chart-1",
  modified: "text-chart-2",
  deleted: "text-destructive",
  renamed: "text-muted-foreground",
  copied: "text-muted-foreground",
  other: "text-muted-foreground",
}

const statusLetter: Record<string, string> = {
  added: "A",
  modified: "M",
  deleted: "D",
  renamed: "R",
  copied: "C",
  other: "?",
}

/**
 * Choose which commits to scan, with enough of each one visible to choose well.
 *
 * The alternative it replaces was a number box: "scan 18 commits" and hope the
 * sampler picked the interesting ones. On a repository with thousands of commits
 * that is a blind guess, and every wrong guess costs a full scan per commit.
 *
 * The list is virtualised because an old repository really does have thousands
 * of rows, and rendering them all makes the picker slower than the scan it is
 * supposed to make cheaper.
 *
 * Expanding a row shows which files the commit touched and how (added, modified,
 * deleted, renamed). Not line counts and not patch text: both need file
 * *contents*, and the clone behind this list fetches none. On this repository
 * asking for line counts took 67 seconds against 233 ms — see the note on
 * `CommitWithStats`.
 */
export function CommitPicker({
  commits,
  selected,
  onChange,
  disabled,
}: {
  commits: CommitWithStats[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<Filter>("all")
  const [expanded, setExpanded] = useState<string | null>(null)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return commits.filter((c) => {
      if (q && !c.subject.toLowerCase().includes(q) && !c.sha.startsWith(q)) return false
      if (filter === "tagged") return c.tagged
      if (filter === "merges") return c.parents.length >= 2
      if (filter === "big") return c.filesChanged >= BIG_CHANGE
      return true
    })
  }, [commits, query, filter])

  function toggle(sha: string) {
    const next = new Set(selected)
    if (next.has(sha)) next.delete(sha)
    else next.add(sha)
    onChange(next)
  }

  // Acts on what is on screen, not on everything — selecting 2000 commits
  // because a filter was applied is never what the click meant.
  const allVisibleSelected = visible.length > 0 && visible.every((c) => selected.has(c.sha))
  function toggleVisible() {
    const next = new Set(selected)
    for (const c of visible) {
      if (allVisibleSelected) next.delete(c.sha)
      else next.add(c.sha)
    }
    onChange(next)
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[12rem] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by message or sha…"
            className="h-8 pl-8 text-sm"
            disabled={disabled}
          />
        </div>
        <Segmented
          aria-label="Filter commits"
          size="sm"
          value={filter}
          onChange={(v) => setFilter(v as Filter)}
          items={[
            { value: "all", label: "All" },
            { value: "tagged", label: "Tagged" },
            { value: "merges", label: "Merges" },
            { value: "big", label: "Big" },
          ]}
        />
        <Button variant="outline" size="sm" onClick={toggleVisible} disabled={disabled || visible.length === 0}>
          {allVisibleSelected ? "Clear shown" : `Select shown (${visible.length})`}
        </Button>
      </div>

      {/* Above the list, not below it. The list is 420px of its own scroll, so
          a panel underneath is off-screen exactly when you expand a row near
          the top — which is most of the time. */}
      {expanded && (
        <FileList
          commit={commits.find((c) => c.sha === expanded)}
          onClose={() => setExpanded(null)}
        />
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No commits match this filter.
        </p>
      ) : (
        <VirtualList
          items={visible}
          rowHeight={ROW_HEIGHT}
          height={LIST_HEIGHT}
          renderItem={(c) => {
            const open = expanded === c.sha
            return (
              <div
                className={cn(
                  "flex h-full items-center gap-2 border-b border-border px-2 text-sm transition-colors",
                  selected.has(c.sha) ? "bg-primary/5" : "hover:bg-accent/40",
                )}
              >
                <input
                  type="checkbox"
                  checked={selected.has(c.sha)}
                  onChange={() => toggle(c.sha)}
                  disabled={disabled}
                  aria-label={`Scan commit ${c.sha.slice(0, 7)}: ${c.subject}`}
                  className="size-4 shrink-0 accent-primary"
                />
                <button
                  onClick={() => setExpanded(open ? null : c.sha)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                  aria-expanded={open}
                >
                  {open ? (
                    <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      {c.parents.length >= 2 && (
                        <GitMerge className="size-3 shrink-0 text-muted-foreground" />
                      )}
                      {c.tagged && <Tag className="size-3 shrink-0 text-chart-2" />}
                      <span className="truncate">
                        {c.subject || <span className="text-muted-foreground">(no message)</span>}
                      </span>
                    </span>
                    <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
                      <span>{c.sha.slice(0, 7)}</span>
                      <span>{shortDate(c.date)}</span>
                      <span>
                        {c.filesChanged} file{c.filesChanged === 1 ? "" : "s"}
                      </span>
                      {/* A glance at the shape of the change: mostly additions
                          reads differently from mostly deletions. */}
                      {c.files.slice(0, 6).map((f, i) => (
                        <span key={i} className={statusStyle[f.status]}>
                          {statusLetter[f.status]}
                        </span>
                      ))}
                    </span>
                  </span>
                </button>
              </div>
            )
          }}
        />
      )}

    </div>
  )
}

function FileList({ commit, onClose }: { commit?: CommitWithStats; onClose: () => void }) {
  if (!commit) return null
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex items-center gap-2">
        <FileDiff className="size-4 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{commit.subject}</span>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:text-foreground">
          Close
        </button>
      </div>
      {commit.files.length === 0 ? (
        <p className="text-xs text-muted-foreground">This commit changed no files.</p>
      ) : (
        <ul className="space-y-1">
          {commit.files.map((f) => (
            <li key={f.path} className="flex items-center gap-2 font-mono text-xs">
              <span className={cn("w-4 shrink-0 font-semibold", statusStyle[f.status])}>
                {statusLetter[f.status]}
              </span>
              <span className="min-w-0 flex-1 truncate text-foreground/80">{f.path}</span>
              <span className="shrink-0 text-muted-foreground">{f.status}</span>
            </li>
          ))}
        </ul>
      )}
      {commit.truncated && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Showing {commit.files.length} of {commit.filesChanged} files.
        </p>
      )}
    </div>
  )
}
