"use client"

import { useEffect, useMemo, useState } from "react"
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
  SearchX,
} from "lucide-react"
import {
  categoryLabels,
  severityLabels,
  type Issue,
  type IssueCategory,
  type Severity,
} from "@/lib/mock-data"
import { searchIssues } from "@/lib/issue-search"
import {
  filterIssues,
  type CategoryFilter,
  type SeverityFilter,
} from "@/lib/issue-filters"
import {
  presentScannersInCategory,
  resolveScanner,
  scannerLabel,
} from "@/lib/scanners"
import { issueCosts, type SeverityWeights } from "@/lib/score"
import { githubFileUrl } from "@/lib/github-link"
import { githubNewIssueUrl } from "@/lib/github-issue"
import { useSnoozed, setSnoozed, snoozeKey, partitionSnoozed } from "@/lib/snooze-store"
import { formatAge, issueAsMarkdown, severityStyle } from "@/lib/issue-format"
import { IssueDrawer } from "@/components/repo-anti-rot/issue-drawer"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/empty-state"
import { Segmented } from "@/components/ui/segmented"
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
import { useLocale } from "@/components/i18n/locale-provider"

/** Repo context needed to build GitHub links and key snooze state. */
export interface TableRepo {
  id: string
  url?: string
  commit?: string
  defaultBranch?: string
}

const severityWeight: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/** Round for display without printing "0" for something that does cost points. */
function formatCost(cost: number): string {
  if (cost === 0) return "0"
  const rounded = Math.round(cost * 100) / 100
  return rounded === 0 ? "0.01" : String(rounded)
}

/** A single issue row — clicking it opens the detail drawer. */
function IssueRow({
  issue,
  selected,
  onSelect,
  snoozed,
  isNew = false,
  cost,
}: {
  issue: Issue
  selected: boolean
  onSelect: () => void
  snoozed: boolean
  isNew?: boolean
  /** Points this finding takes off the score; omitted when unknown. */
  cost?: number
}) {
  const { t } = useLocale()
  const scannerId = resolveScanner(issue)
  const kindLabel = scannerId ? scannerLabel(scannerId) : categoryLabels[issue.category]
  const kindTitle = scannerId
    ? `${kindLabel} · ${categoryLabels[issue.category]}`
    : categoryLabels[issue.category]

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
              {t("table.new")}
            </span>
          )}
          {snoozed && (
            <span className="shrink-0 rounded-full border border-border bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {t("table.snoozed")}
            </span>
          )}
        </span>
        <span className="block truncate font-mono text-xs text-muted-foreground">
          {issue.location}
        </span>
      </span>
      <span
        className="hidden max-w-[9rem] shrink-0 truncate text-xs text-muted-foreground lg:block"
        title={kindTitle}
      >
        {kindLabel}
      </span>
      {/* What this one finding costs. Snoozed findings cost nothing — they are
          already out of the score — so showing a number there would be a lie. */}
      <span
        className={cn(
          "hidden w-12 shrink-0 text-right font-mono text-xs tabular-nums sm:block",
          snoozed ? "text-muted-foreground/40" : "text-destructive/70",
        )}
        title={snoozed ? t("table.snoozedCost") : t("table.cost")}
      >
        {snoozed ? "—" : cost === undefined ? "" : `−${formatCost(cost)}`}
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
  weights,
}: {
  issues: Issue[]
  repo?: TableRepo
  query?: string
  /** Ids of findings new since the previous scan — rendered with a "New" badge. */
  newIds?: Set<string>
  /** Findings resolved since the previous scan — listed in a collapsed section. */
  fixed?: Issue[]
  /** Effective scan weights, so per-finding costs match the score exactly. */
  weights?: SeverityWeights
}) {
  const { t } = useLocale()
  const [severity, setSeverity] = useState<SeverityFilter>("all")
  const [category, setCategory] = useState<CategoryFilter>("all")
  const [scanner, setScanner] = useState<string>("all")
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

  // Scanners that appear under the current category lens — keeps the Select
  // short and stops "ci-health" showing up while Category = Dependency.
  const scannerOptions = useMemo(
    () => presentScannersInCategory(base, category),
    [base, category],
  )

  // After a rescan (or a category change that already cleared it), a selected
  // scanner that is no longer present must not stick as a ghost empty filter.
  useEffect(() => {
    if (scanner !== "all" && !scannerOptions.some((s) => s.id === scanner)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync derived filter validity
      setScanner("all")
    }
  }, [scanner, scannerOptions])

  const filtered = useMemo(() => {
    // Semantic search ranks by relevance; preserve that order when a query is set,
    // otherwise fall back to oldest-first by age.
    const ranked = searchIssues(base, query)
    const result = filterIssues(ranked, {
      severity,
      category,
      scanner,
      changesOnly,
      newIds,
    })
    return query.trim() ? result : result.sort((a, b) => b.ageDays - a.ageDays)
  }, [base, query, severity, category, scanner, changesOnly, newIds])

  // Group by the real scanner id (not the 7 umbrella categories). The menu used
  // to say "Group by scanner" while grouping by category — that hid ci-health /
  // docs-drift / license-risk inside one Hygiene bucket.
  const groups = useMemo(() => {
    const map = new Map<string, Issue[]>()
    for (const issue of filtered) {
      const key = resolveScanner(issue) ?? "unknown"
      const list = map.get(key)
      if (list) list.push(issue)
      else map.set(key, [issue])
    }
    return [...map.entries()]
      .map(([id, list]) => ({
        id,
        label: id === "unknown" ? "Unknown scanner" : scannerLabel(id),
        list,
        worst: Math.min(...list.map((i) => severityWeight[i.severity])),
      }))
      .sort(
        (a, b) =>
          a.worst - b.worst || b.list.length - a.list.length || a.label.localeCompare(b.label),
      )
  }, [filtered])

  function onCategoryChange(next: string) {
    const cat = next as CategoryFilter
    setCategory(cat)
    // Drop a scanner that cannot appear under the new category, so the table
    // does not go empty with no obvious reason.
    if (scanner !== "all") {
      const stillThere = presentScannersInCategory(base, cat).some((s) => s.id === scanner)
      if (!stillThere) setScanner("all")
    }
  }

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

  // Costs are computed over the LIVE set, because that is the set the score was
  // computed from. Including snoozed findings would dilute a capped tier with
  // findings that are not being charged for.
  const costs = useMemo(() => issueCosts(live, weights), [live, weights])

  const renderRow = (issue: Issue) => (
    <IssueRow
      key={issue.id}
      issue={issue}
      cost={costs.get(issue.id)}
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
          {t("table.title")}
          <span className="ml-2 font-mono text-sm font-normal text-muted-foreground">
            {filtered.length}
          </span>
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {hasChanges && (
            <Button
              size="sm"
              variant={changesOnly ? "secondary" : "ghost"}
              className="h-8 gap-1.5 px-2 text-xs"
              onClick={() => setChangesOnly((c) => !c)}
              title={changesOnly ? t("table.showAll") : t("table.showNewOnly")}
            >
              <GitCompare className="size-4" />
              {changesOnly ? "All" : `Changes (${newIds?.size ?? 0})`}
            </Button>
          )}
          {/* Grouping, snoozed visibility and bulk copy are occasional actions.
              In a row of controls they competed with the filters people reach for
              constantly, so they moved behind one button. */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2 text-muted-foreground hover:text-foreground"
                aria-label={t("table.moreListOptions")}
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
          {/* Severity is a segmented control (few options, frequent). Category and
              Scanner stay Selects — too many options to lay out flat, and Scanner
              is what splits Hygiene into ci-health / docs-drift / …. */}
          <Segmented
            aria-label={t("table.filterSeverity")}
            size="sm"
            value={severity}
            onChange={(v) => setSeverity(v as SeverityFilter)}
            items={[
              { value: "all", label: "All" },
              { value: "actionable", label: "Actionable" },
              ...(Object.keys(severityLabels) as Severity[]).map((s) => ({
                value: s,
                label: severityLabels[s],
              })),
            ]}
          />
          <Select value={category} onValueChange={onCategoryChange}>
            <SelectTrigger className="h-8 w-[150px] bg-secondary text-sm" aria-label={t("table.filterCategory")}>
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("table.allCategories")}</SelectItem>
              {(Object.keys(categoryLabels) as IssueCategory[]).map((c) => (
                <SelectItem key={c} value={c}>
                  {categoryLabels[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={scanner}
            onValueChange={setScanner}
            disabled={scannerOptions.length === 0}
          >
            <SelectTrigger className="h-8 w-[170px] bg-secondary text-sm" aria-label={t("table.filterScanner")}>
              <SelectValue placeholder="Scanner" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("table.allScanners")}</SelectItem>
              {scannerOptions.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.label}
                  <span className="ml-1.5 font-mono text-muted-foreground">{s.count}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {filtered.length === 0 ? (
          <div className="border-t border-border p-4">
            <EmptyState
              icon={<SearchX />}
              title={t("table.noMatches")}
              description={
                base.length === 0
                  ? "This scan found nothing at all — which is the good outcome."
                  : "Nothing matches the current filters. Widen severity, category or scanner, or clear the search."
              }
              className="border-0 py-8"
            />
          </div>
        ) : grouped ? (
          <div className="border-t border-border">
            {groups.map(({ id, label, list }) => {
              const isCollapsed = collapsed.has(id)
              const counts = {
                critical: list.filter((i) => i.severity === "critical").length,
                warning: list.filter((i) => i.severity === "warning").length,
                info: list.filter((i) => i.severity === "info").length,
              }
              return (
                <section key={id} className="border-b border-border last:border-b-0">
                  <button
                    onClick={() => toggleSection(id)}
                    className="flex w-full items-center gap-2 bg-muted/30 px-4 py-2 text-left transition-colors hover:bg-muted/50"
                  >
                    {isCollapsed ? (
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                    )}
                    <span className="text-sm font-medium">{label}</span>
                    {id !== "unknown" && (
                      <span className="hidden font-mono text-[10px] text-muted-foreground sm:inline">
                        {id}
                      </span>
                    )}
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
            {t("table.nothingActionable")}
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
              <span className="text-sm font-medium">{t("table.notes")}</span>
              <span className="font-mono text-xs text-muted-foreground">{notes.length}</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {t("table.notesHint")}
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
              <span className="text-sm font-medium">{t("table.fixedSince")}</span>
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
        scannedRepoUrl={repo?.url}
        snoozed={selectedIssue ? isSnoozed(selectedIssue.id) : false}
        onToggleSnooze={() => selectedIssue && toggleSnooze(selectedIssue.id)}
      />
    </Card>
  )
}
