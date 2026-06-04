"use client"

import { useMemo, useState } from "react"
import {
  Bell,
  BellOff,
  Check,
  ChevronDown,
  ChevronRight,
  Clipboard,
  Github,
  LayoutList,
  Layers,
  Link2,
  Sparkles,
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
import { useSnoozed, setSnoozed, snoozeKey, partitionSnoozed } from "@/lib/snooze-store"
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

const severityStyle: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  info: "bg-muted text-muted-foreground border-border",
}

function formatAge(days: number) {
  if (days >= 365) return `${Math.floor(days / 365)}y`
  if (days >= 30) return `${Math.floor(days / 30)}mo`
  return `${days}d`
}

function fullAge(days: number) {
  if (days >= 365) {
    const y = Math.floor(days / 365)
    return `${y} year${y === 1 ? "" : "s"} old`
  }
  if (days >= 30) {
    const m = Math.floor(days / 30)
    return `${m} month${m === 1 ? "" : "s"} old`
  }
  return `${days} day${days === 1 ? "" : "s"} old`
}

function issueAsMarkdown(issue: Issue) {
  const lines = [
    `- **[${severityLabels[issue.severity]}] ${issue.title}**`,
    `  - Category: ${categoryLabels[issue.category]}`,
    `  - Location: \`${issue.location}\``,
    `  - Age: ${fullAge(issue.ageDays)}`,
    `  - ${issue.detail}`,
  ]
  if (issue.evidence) {
    lines.push(
      issue.evidence.includes("\n")
        ? `\n\`\`\`\n${issue.evidence}\n\`\`\``
        : `  - \`${issue.evidence}\``,
    )
  }
  if (issue.aiNote) lines.push(`  - 🤖 AI: ${issue.aiNote}`)
  return lines.join("\n")
}

const severityWeight: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

/** A single expandable issue row plus its detail panel. */
function IssueRow({
  issue,
  open,
  onToggle,
  githubUrl,
  snoozed,
  onToggleSnooze,
}: {
  issue: Issue
  open: boolean
  onToggle: () => void
  githubUrl: string | null
  snoozed: boolean
  onToggleSnooze: () => void
}) {
  return (
    <div className={cn(snoozed && "opacity-60")}>
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
      >
        {open ? (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        )}
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
      {open && (
        <div className="space-y-3 bg-secondary/40 px-4 pb-4 pl-11 pt-1">
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">Severity</dt>
            <dd>
              <span
                className={cn(
                  "inline-block rounded-full border px-2 py-0.5 font-medium",
                  severityStyle[issue.severity],
                )}
              >
                {severityLabels[issue.severity]}
              </span>
            </dd>
            <dt className="text-muted-foreground">Category</dt>
            <dd className="text-foreground">{categoryLabels[issue.category]}</dd>
            <dt className="text-muted-foreground">Location</dt>
            <dd className="break-all font-mono text-foreground">{issue.location}</dd>
            <dt className="text-muted-foreground">Age</dt>
            <dd className="text-foreground">{fullAge(issue.ageDays)}</dd>
          </dl>
          {issue.evidence && (
            <pre className="overflow-x-auto rounded-md border border-border bg-background/60 px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90">
              <code>{issue.evidence}</code>
            </pre>
          )}
          <p className="text-sm leading-relaxed text-foreground/90">{issue.detail}</p>
          {issue.aiNote && (
            <div className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
              <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-primary">
                <Sparkles className="size-3.5" />
                AI analysis
              </div>
              <p className="text-sm leading-relaxed text-foreground/90">{issue.aiNote}</p>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {githubUrl && (
              <Button
                asChild
                size="sm"
                variant="ghost"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <a href={githubUrl} target="_blank" rel="noopener noreferrer">
                  <Github className="size-3.5" />
                  Open on GitHub
                </a>
              </Button>
            )}
            <CopyMenu githubUrl={githubUrl} issue={issue} />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={onToggleSnooze}
            >
              {snoozed ? <Bell className="size-3.5" /> : <BellOff className="size-3.5" />}
              {snoozed ? "Unsnooze" : "Snooze"}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Small inline button that copies text and flips to a checkmark briefly. */
function CopyButton({
  value,
  label,
  icon: Icon = Clipboard,
}: {
  value: string
  label: string
  icon?: typeof Clipboard
}) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1200)
        } catch {
          /* clipboard blocked — silently ignore */
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-primary" /> : <Icon className="size-3.5" />}
      {copied ? "Copied" : label}
    </Button>
  )
}

async function writeClipboard(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    /* clipboard blocked — silently ignore */
  }
}

/** Single "Copy ▾" menu collapsing the per-issue copy actions into one control. */
function CopyMenu({ githubUrl, issue }: { githubUrl: string | null; issue: Issue }) {
  const [copied, setCopied] = useState(false)
  const copy = async (value: string) => {
    await writeClipboard(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {copied ? <Check className="size-3.5 text-primary" /> : <Clipboard className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
          <ChevronDown className="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-40">
        {githubUrl && (
          <DropdownMenuItem onSelect={() => copy(githubUrl)}>
            <Link2 className="size-3.5" />
            Copy link
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => copy(issue.location)}>
          <Clipboard className="size-3.5" />
          Copy location
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => copy(issueAsMarkdown(issue))}>
          <Clipboard className="size-3.5" />
          Copy as Markdown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function IssuesTable({
  issues,
  repo,
  query = "",
}: {
  issues: Issue[]
  repo?: TableRepo
  query?: string
}) {
  const [severity, setSeverity] = useState<string>("all")
  const [category, setCategory] = useState<string>("all")
  const [expanded, setExpanded] = useState<string | null>(null)
  const [grouped, setGrouped] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [showSnoozed, setShowSnoozed] = useState(false)

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
      .filter((i) => (severity === "all" ? true : i.severity === severity))
      .filter((i) => (category === "all" ? true : i.category === category))
    return query.trim() ? result : result.sort((a, b) => b.ageDays - a.ageDays)
  }, [base, query, severity, category])

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

  const toggleSection = (cat: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })

  const linkFor = (issue: Issue) =>
    githubFileUrl(repo?.url, repo?.commit, repo?.defaultBranch, issue.location)

  const renderRow = (issue: Issue) => (
    <IssueRow
      key={issue.id}
      issue={issue}
      open={expanded === issue.id}
      onToggle={() => setExpanded(expanded === issue.id ? null : issue.id)}
      githubUrl={linkFor(issue)}
      snoozed={isSnoozed(issue.id)}
      onToggleSnooze={() => toggleSnooze(issue.id)}
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
          {muted.length > 0 && (
            <Button
              size="sm"
              variant="ghost"
              className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => setShowSnoozed((s) => !s)}
              title={showSnoozed ? "Hide snoozed findings" : "Show snoozed findings"}
            >
              {showSnoozed ? <BellOff className="size-4" /> : <Bell className="size-4" />}
              {showSnoozed ? "Hide snoozed" : `Snoozed (${muted.length})`}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setGrouped((g) => !g)}
            title={grouped ? "Show as a flat list" : "Group by scanner"}
          >
            {grouped ? <LayoutList className="size-4" /> : <Layers className="size-4" />}
            {grouped ? "Flat" : "Group"}
          </Button>
          {filtered.length > 0 && (
            <CopyButton
              value={filtered.map(issueAsMarkdown).join("\n")}
              label="Copy all"
            />
          )}
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="h-8 w-[130px] bg-secondary text-sm">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severity</SelectItem>
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
        ) : (
          <div className="divide-y divide-border border-t border-border">
            {filtered.map(renderRow)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
