"use client"

import { useMemo, useState } from "react"
import {
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  GitCompare,
  Info,
  LayoutList,
  Layers,
  MoreHorizontal,
} from "lucide-react"
import {
  categoryLabels,
  severityLabels,
  type Issue,
  type IssueCategory,
  type Severity,
} from "@/lib/mock-data"
import { searchIssues } from "@/lib/issue-search"
import { githubFileUrl } from "@/lib/github-link"
import { githubNewIssueUrl } from "@/lib/github-issue"
import { useSnoozed, setSnoozed, snoozeKey, partitionSnoozed } from "@/lib/snooze-store"
import { formatAge, issueAsMarkdown, severityStyle } from "@/lib/issue-format"
import { IssueDrawer } from "@/components/repo-anti-rot/issue-drawer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"

/** Repo context needed to build GitHub links and key snooze state. */
export interface TableRepo {
  id: string
  url?: string
  commit?: string
  defaultBranch?: string
}

const severityWeight: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/** A single issue row — clicking it opens the detail drawer. */
function IssueRow({
  issue,
  selected,
  onSelect,
  snoozed,
  isNew = false,
}: {
  issue: Issue
  selected: boolean
  onSelect: () => void
  snoozed: boolean
  isNew?: boolean
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50",
        selected && "bg-accent/60",
        snoozed && "opacity-60",
      )}
    >
      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      <span
        className={cn(
          "hidden w-20 shrink-0 rounded-full border px-2 py-0.5 text-center text-xs font-medium sm:inline-block",
          severityStyle[issue.severity],
        )}
      >
        {severityLabels[issue.severity]}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate text-sm">{issue.title}</span>
          {isNew && (
            <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
              New
            </span>
          )}
          {snoozed && (
            <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              Snoozed
            </span>
          )}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {issue.location}
        </span>
      </span>
      <span className="hidden shrink-0 text-xs text-muted-foreground md:block">
        {categoryLabels[issue.category]}
      </span>
      <span className="w-12 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
        {formatAge(issue.ageDays)}
      </span>
    </button>
  )
}


export function IssuesTable({
  issues,
  repo,
  query = "",
  newIds,
  fixed = [],
}: {
  issues: Issue[]
  repo?: TableRepo
  query?: string
  /** Ids of findings new since the previous scan — rendered with a "New" badge. */
  newIds?: Set<string>
  /** Findings resolved since the previous scan — listed in a collapsed section. */
  fixed?: Issue[]
}) {
  const [severity, setSeverity] = useState<string>("all")
  const [category, setCategory] = useState<string>("all")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [grouped, setGrouped] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showSnoozed, setShowSnoozed] = useState(false)
  const [changesOnly, setChangesOnly] = useState(false)
  const [showFixed, setShowFixed] = useState(false)

  const isNew = (id: string) => !!newIds?.has(id)
  const hasChanges = (newIds?.size ?? 0) > 0 || fixed.length > 0

  const snoozed = useSnoozed()
  const repoId = repo?.id ?? ""
  const { live, muted } = useMemo(
    () => partitionSnoozed(repoId, issues, snoozed),
    [repoId, issues, snoozed],
  )
  // Hide snoozed findings by default; the toggle reveals them inline (greyed out).
  const base = showSnoozed ? issues : live

  const isSnoozed = (id: string) => snoozed.has(snoozeKey(repoId, id))
  const toggleSnooze = (id: string) => setSnoozed(repoId, id, !isSnoozed(id))

  const filtered = useMemo(() => {
    // Semantic search ranks by relevance; preserve that order when a query is set,
    // otherwise fall back to oldest-first by age.
    const ranked = searchIssues(base, query)
    const result = ranked
      // "actionable" is a pseudo-severity: everything that isn't a low-signal
      // note. Info findings barely move the score, so the common need is to read
      // the list without them — without hiding them by default, which would make
      // findings vanish with no visible reason.
      .filter((i) =>
        severity === "all"
          ? true
          : severity === "actionable"
            ? i.severity !== "info"
            : i.severity === severity,
      )
      .filter((i) => (category === "all" ? true : i.category === category))
      .filter((i) => (changesOnly ? newIds?.has(i.id) : true))
    return query.trim() ? result : result.sort((a, b) => b.ageDays - a.ageDays)
  }, [base, query, severity, category, changesOnly, newIds])

  // Group the filtered issues by scanner category, ordered by worst severity
  // present then by count — so the most alarming scanners surface first.
  const groups = useMemo(() => {
    const map = new Map<IssueCategory, Issue[]>()
    for (const issue of filtered) {
      const list = map.get(issue.category)
      if (list) list.push(issue)
      else map.set(issue.category, [issue])
    }
    return [...map.entries()]
      .map(([cat, list]) => ({
        cat,
        list,
        worst: Math.min(...list.map((i) => severityWeight[i.severity])),
      }))
      .sort((a, b) => a.worst - b.worst || b.list.length - a.list.length)
  }, [filtered])

  /**
   * Info findings are worth reading but not worth acting on — they barely move
   * the score by design. Interleaved with criticals they pad the list and bury
   * the things that matter, so they get their own collapsed section at the foot,
   * the same treatment "Fixed since last scan" gets.
   *
   * Only when no severity filter is set: asking for "info" and getting a
   * collapsed box would be the filter arguing with you. Grouped mode already
   * organises by category, so it is left alone too.
   */
  const splitNotes = severity === "all" && !grouped
  const mainList = splitNotes ? filtered.filter((i) => i.severity !== "info") : filtered
  const notes = splitNotes ? filtered.filter((i) => i.severity === "info") : []
  const [showNotes, setShowNotes] = useState(false)
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle")

  const toggleSection = (cat: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  const linkFor = (issue: Issue) =>
    githubFileUrl(repo?.url, repo?.commit, repo?.defaultBranch, issue.location)

  const newIssueFor = (issue: Issue) => githubNewIssueUrl(repo?.url, issue, linkFor(issue))

  const selectedIssue = useMemo(
    () => issues.find((i) => i.id === selectedId) ?? null,
    [issues, selectedId],
  )

  const openIssue = (issue: Issue) => {
    setSelectedId(issue.id)
    setDrawerOpen(true)
  }

  const renderRow = (issue: Issue) => (
    <IssueRow
      key={issue.id}
      issue={issue}
      selected={selectedId === issue.id && drawerOpen}
      onSelect={() => openIssue(issue)}
      snoozed={isSnoozed(issue.id)}
      isNew={isNew(issue.id)}
    />
  )

  return (
    <Card>
      <CardHeader className="flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
        <CardTitle className="text-base">
          Detected issues
          <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
            {filtered.length}
          </span>
        </CardTitle>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <Button
              size="sm"
              variant={changesOnly ? "secondary" : "ghost"}
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => setChangesOnly((c) => !c)}
              title={changesOnly ? "Show all findings" : "Show only findings new since the last scan"}
            >
              <GitCompare className="size-4" />
              {changesOnly ? "All" : `Changes (${newIds?.size ?? 0})`}
            </Button>
          )}
          {/* Grouping, snoozed visibility and bulk copy are occasional actions.
              In a row of seven controls they competed with the two filters people
              reach for constantly, so they moved behind one button. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
                aria-label="More list options"
                title="More options"
              >
                <MoreHorizontal className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem onSelect={() => setGrouped((g) => !g)}>
                {grouped ? <LayoutList className="size-4" /> : <Layers className="size-4" />}
                {grouped ? "Show as a flat list" : "Group by scanner"}
              </DropdownMenuItem>
              {muted.length > 0 && (
                <DropdownMenuItem onSelect={() => setShowSnoozed((s) => !s)}>
                  {showSnoozed ? <BellOff className="size-4" /> : <Bell className="size-4" />}
                  {showSnoozed ? "Hide snoozed" : `Show snoozed (${muted.length})`}
                </DropdownMenuItem>
              )}
              {filtered.length > 0 && (
                <DropdownMenuItem
                  // preventDefault keeps the menu open, so the outcome is visible:
                  // the clipboard write is async and can be denied by permissions,
                  // and a copy that silently did nothing is the worst version.
                  onSelect={async (e) => {
                    e.preventDefault()
                    try {
                      await navigator.clipboard.writeText(filtered.map(issueAsMarkdown).join("\n"))
                      setCopyState("copied")
                    } catch {
                      setCopyState("failed")
                    }
                    setTimeout(() => setCopyState("idle"), 1500)
                  }}
                >
                  {copyState === "copied" ? (
                    <Check className="size-4 text-primary" />
                  ) : (
                    <Clipboard className="size-4" />
                  )}
                  {copyState === "copied"
                    ? "Copied"
                    : copyState === "failed"
                      ? "Clipboard blocked"
                      : "Copy all as Markdown"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="h-8 w-[130px] bg-secondary text-sm">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severity</SelectItem>
              <SelectItem value="actionable">Actionable only</SelectItem>
              {(Object.keys(severityLabels) as Severity[]).map((s) => (
                <SelectItem key={s} value={s}>
                  {severityLabels[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger className="h-8 w-[150px] bg-secondary text-sm">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(Object.keys(categoryLabels) as IssueCategory[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {categoryLabels[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <p className="border-t border-border px-4 py-10 text-center text-sm text-muted-foreground">
            No issues match these filters.
          </p>
        ) : grouped ? (
          <div className="border-t border-border">
            {groups.map(({ cat, list }) => {
              const isCollapsed = collapsed.has(cat)
              const counts = {
                critical: list.filter((i) => i.severity === "critical").length,
                warning: list.filter((i) => i.severity === "warning").length,
                info: list.filter((i) => i.severity === "info").length,
              }
              return (
                <section key={cat} className="border-b border-border last:border-b-0">
                  <button
                    onClick={() => toggleSection(cat)}
                    className="flex w-full items-center gap-2 bg-muted/30 px-4 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">{categoryLabels[cat]}</span>
                    <span className="font-mono text-xs text-muted-foreground">{list.length}</span>
                    <span className="ml-auto flex gap-1 text-[10px]">
                      {(["critical", "warning", "info"] as const)
                        .filter((s) => counts[s] > 0)
                        .map((s) => (
                          <span
                            key={s}
                            className={cn(
                              "rounded-full border px-1.5 py-0.5 font-medium tabular-nums",
                              severityStyle[s],
                            )}
                          >
                            {counts[s]}
                          </span>
                        ))}
                    </span>
                  </button>
                  {!isCollapsed && (
                    <div className="divide-y divide-border">{list.map(renderRow)}</div>
                  )}
                </section>
              )
            })}
          </div>
        ) : mainList.length === 0 ? (
          // Notes exist but nothing actionable does — say so, rather than showing
          // an empty list above a collapsed box.
          <p className="border-t border-border px-4 py-10 text-center text-sm text-muted-foreground">
            Nothing actionable — only low-signal notes below.
          </p>
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {mainList.map(renderRow)}
          </div>
        )}

        {notes.length > 0 && (
          <section className="border-t border-border">
            <button
              onClick={() => setShowNotes((s) => !s)}
              className="flex w-full items-center gap-2 bg-muted/30 px-4 py-2 text-left transition-colors hover:bg-muted/50"
            >
              {showNotes ? (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              )}
              <Info className="size-4 shrink-0 text-muted-foreground" />
              <span className="text-sm font-medium">Notes</span>
              <span className="font-mono text-xs text-muted-foreground">{notes.length}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                low signal · barely affects the score
              </span>
            </button>
            {showNotes && <div className="divide-y divide-border">{notes.map(renderRow)}</div>}
          </section>
        )}

        {fixed.length > 0 && (
          <section className="border-t border-border">
            <button
              onClick={() => setShowFixed((s) => !s)}
              className="flex w-full items-center gap-2 bg-muted/30 px-4 py-2 text-left transition-colors hover:bg-muted/50"
            >
              {showFixed ? (
                <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
              ) : (
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
              )}
              <Check className="size-4 shrink-0 text-emerald-500" />
              <span className="text-sm font-medium">Fixed since last scan</span>
              <span className="font-mono text-xs text-muted-foreground">{fixed.length}</span>
            </button>
            {showFixed && (
              <ul className="divide-y divide-border">
                {fixed.map((issue) => (
                  <li
                    key={issue.id}
                    className="flex items-center gap-3 px-4 py-3 text-muted-foreground"
                  >
                    <Check className="size-4 shrink-0 text-emerald-500" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm line-through">{issue.title}</span>
                      <span className="block truncate font-mono text-xs">{issue.location}</span>
                    </span>
                    <span className="hidden shrink-0 text-xs md:block">
                      {categoryLabels[issue.category]}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </CardContent>

      <IssueDrawer
        issue={selectedIssue}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        githubUrl={selectedIssue ? linkFor(selectedIssue) : null}
        newIssueUrl={selectedIssue ? newIssueFor(selectedIssue) : null}
        snoozed={selectedIssue ? isSnoozed(selectedIssue.id) : false}
        onToggleSnooze={() => selectedIssue && toggleSnooze(selectedIssue.id)}
      />
    </Card>
  )
}
