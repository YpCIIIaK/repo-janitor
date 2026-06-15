"use client"

import { useState } from "react"
import dynamic from "next/dynamic"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TopBar } from "@/components/repo-anti-rot/top-bar"
import { RepoSidebar, type SidebarRepo } from "@/components/repo-anti-rot/repo-sidebar"
import { HealthOverview } from "@/components/repo-anti-rot/health-overview"
import { GradeCard } from "@/components/repo-anti-rot/grade-card"
import { IssueBreakdown } from "@/components/repo-anti-rot/issue-breakdown"
import { IssuesTable } from "@/components/repo-anti-rot/issues-table"
import { CategoryScores } from "@/components/repo-anti-rot/category-scores"
import { HotspotFiles } from "@/components/repo-anti-rot/hotspot-files"
import { AiSummaryCard } from "@/components/repo-anti-rot/ai-summary-card"
import { AgeHistogram } from "@/components/repo-anti-rot/age-histogram"
import { TrendChart } from "@/components/repo-anti-rot/trend-chart"
import { ReposOverview } from "@/components/repo-anti-rot/repos-overview"
import { RescanButton } from "@/components/repo-anti-rot/rescan-button"
import { ExportMenu } from "@/components/repo-anti-rot/export-menu"
import { CommandPalette, type PaletteTab } from "@/components/repo-anti-rot/command-palette"
import { ScanScheduler } from "@/components/repo-anti-rot/scan-scheduler"
import { Button } from "@/components/ui/button"
import { Command as CommandIcon } from "lucide-react"
import { NewScanDialog } from "@/components/repo-anti-rot/new-scan-dialog"
import { WelcomeScreen } from "@/components/repo-anti-rot/welcome-screen"
import { RepoOverview } from "@/components/repo-anti-rot/repo-overview"
import { useRepos, removeRepo, repoStats, repoTrend, countSeverity, timeAgo, repoDiff, repoDiffDetail, newIssueIds, issueDensity } from "@/lib/reports-store"
import { Workflow, Info, GitGraph } from "lucide-react"
import { useSnoozed, partitionSnoozed, clearSnoozedForRepo } from "@/lib/snooze-store"
import { computeScore, scoreToGrade } from "@/lib/score"
import { cn } from "@/lib/utils"

// React Flow is client-only and heavy — load the tree lazily so it stays out of
// the initial bundle and only ships when the user opens the Tree tab.
const RepoTree = dynamic(
  () => import("@/components/repo-anti-rot/repo-tree").then((m) => m.RepoTree),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[600px] items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
        Loading map…
      </div>
    ),
  },
)

// Same lazy treatment for the commit-history tree (also React Flow based).
const CommitTree = dynamic(
  () => import("@/components/repo-anti-rot/commit-tree").then((m) => m.CommitTree),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[640px] items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
        Loading history…
      </div>
    ),
  },
)

const severityChip: Record<"critical" | "warning" | "info", string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  info: "bg-muted text-muted-foreground border-border",
}

// Sentinel id selecting the cross-repo overview instead of a single repo.
const OVERVIEW = "__overview__"

export default function Page() {
  const repos = useRepos()
  const snoozed = useSnoozed()
  const [activeId, setActiveId] = useState<string>("")
  const [search, setSearch] = useState<string>("")
  const [scanOpen, setScanOpen] = useState(false)
  const [tab, setTab] = useState<PaletteTab>("overview")
  const [paletteOpen, setPaletteOpen] = useState(false)

  const showOverview = activeId === OVERVIEW
  // Resolve the selected repo, falling back to the most recent one.
  const current = repos.find((r) => r.id === activeId) ?? repos[0]

  if (repos.length === 0 || !current) {
    return (
      <div className="min-h-screen">
        <TopBar />
        <WelcomeScreen />
      </div>
    )
  }

  // Snooze is "won't fix": muted findings drop out of counts and the score,
  // which we recompute in the browser using the same weights as the engine.
  const sidebarRepos: SidebarRepo[] = repos.map((r) => {
    const { live } = partitionSnoozed(r.id, r.latest.issues, snoozed)
    const score = computeScore(live, r.latest.config?.weights)
    return {
      id: r.id,
      name: r.name,
      defaultBranch: r.defaultBranch,
      grade: scoreToGrade(score),
      score,
      lastScan: timeAgo(r.scannedAt),
    }
  })

  const allIssues = current.latest.issues
  const weights = current.latest.config?.weights
  const { live: issues } = partitionSnoozed(current.id, allIssues, snoozed)
  const liveScore = computeScore(issues, weights)
  const liveGrade = scoreToGrade(liveScore)

  const repo = {
    id: current.id,
    owner: current.owner,
    name: current.name,
    defaultBranch: current.defaultBranch,
    grade: liveGrade,
    score: liveScore,
    lastScan: timeAgo(current.scannedAt),
  }

  const stats = repoStats(current, issues, liveScore)
  const trend = repoTrend(current)
  const counts = {
    critical: countSeverity(issues, "critical"),
    warning: countSeverity(issues, "warning"),
    info: countSeverity(issues, "info"),
  }

  const handleRemove = (id: string) => {
    clearSnoozedForRepo(id)
    removeRepo(id)
  }

  // Scan-over-scan delta (new vs fixed findings) for the header badge.
  const diff = repoDiff(current)
  // Per-finding diff for the issues table: badge new findings, list fixed ones.
  const newIds = newIssueIds(current)
  const fixedIssues = repoDiffDetail(current).fixed

  // Issue density (findings per 1000 LOC) — size-normalized health signal.
  const density = issueDensity(current, issues.length)

  // Context the issues table needs to build GitHub links and toggle snooze.
  const tableRepo = {
    id: current.id,
    url: current.url,
    commit: current.latest.repo.commit,
    defaultBranch: current.defaultBranch,
  }

  return (
    <div className="min-h-screen">
      <TopBar repo={repo} search={search} onSearch={setSearch} />
      <div className="flex">
        <RepoSidebar
          repositories={sidebarRepos}
          activeId={showOverview ? OVERVIEW : current.id}
          onSelect={setActiveId}
          onRemove={handleRemove}
          onNewScan={() => setScanOpen(true)}
          onShowOverview={repos.length > 1 ? () => setActiveId(OVERVIEW) : undefined}
        />

        {showOverview ? (
          <main className="min-w-0 flex-1 px-4 py-6 md:px-6">
            <ReposOverview repos={repos} onSelect={setActiveId} />
          </main>
        ) : (
        <main className="min-w-0 flex-1 px-4 py-6 md:px-6">
          <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="text-balance text-2xl font-semibold tracking-tight">
                {repo.owner}/{repo.name}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {issues.length === 0
                  ? "No open issues — last scan was clean."
                  : `${issues.length} open issue${issues.length === 1 ? "" : "s"}`}
                {issues.length > 0 && density && (
                  <span title={`${density.loc.toLocaleString()} lines of code`}>
                    {" · "}
                    {density.perKloc.toFixed(1)}/kLOC
                  </span>
                )}
                {issues.length > 0 && ` · scanned ${repo.lastScan}`}
              </p>
              {diff.hasPrev && (diff.added > 0 || diff.fixed > 0) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
                  {diff.added > 0 && (
                    <span className="rounded-full border border-destructive/30 bg-destructive/15 px-2 py-0.5 font-medium tabular-nums text-destructive">
                      +{diff.added} new
                    </span>
                  )}
                  {diff.fixed > 0 && (
                    <span className="rounded-full border border-chart-1/30 bg-chart-1/15 px-2 py-0.5 font-medium tabular-nums text-chart-1">
                      −{diff.fixed} fixed
                    </span>
                  )}
                  <span className="text-muted-foreground">since last scan</span>
                </div>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex gap-1.5 text-xs">
                {(["critical", "warning", "info"] as const).map((sev) => (
                  <span
                    key={sev}
                    className={cn(
                      "rounded-full border px-2 py-0.5 font-medium tabular-nums",
                      severityChip[sev],
                      counts[sev] === 0 && "opacity-50",
                    )}
                  >
                    {counts[sev]} {sev}
                  </span>
                ))}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPaletteOpen(true)}
                title="Command palette (⌘K / Ctrl+K)"
              >
                <CommandIcon className="size-4" />
                <kbd className="ml-1 hidden rounded bg-muted px-1 text-[10px] font-medium text-muted-foreground sm:inline">
                  ⌘K
                </kbd>
              </Button>
              <ExportMenu report={current.latest} />
              <RescanButton repo={current} />
            </div>
          </div>

          <Tabs value={tab} onValueChange={(v) => setTab(v as PaletteTab)} className="w-full">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="issues">Issues</TabsTrigger>
              <TabsTrigger value="tree">
                <Workflow className="size-4" />
                Tree
              </TabsTrigger>
              <TabsTrigger value="history">
                <GitGraph className="size-4" />
                History
              </TabsTrigger>
              <TabsTrigger value="about">
                <Info className="size-4" />
                About
              </TabsTrigger>
              <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <div className="mb-6">
                <AiSummaryCard
                  repoId={current.id}
                  owner={current.owner}
                  name={current.name}
                  issues={issues}
                  weights={weights}
                />
              </div>
              <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                <GradeCard grade={repo.grade} score={repo.score} lastScan={repo.lastScan} />
                <IssueBreakdown issues={issues} />
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <CategoryScores issues={issues} weights={weights} />
                <HotspotFiles issues={issues} weights={weights} repo={tableRepo} />
              </div>
              <div className="mt-6">
                <HealthOverview stats={stats} />
              </div>
              <div className="mt-6 grid gap-6 lg:grid-cols-2">
                <TrendChart data={trend} />
                <AgeHistogram issues={issues} />
              </div>
              <div className="mt-6">
                <IssuesTable issues={allIssues} repo={tableRepo} query={search} newIds={newIds} fixed={fixedIssues} />
              </div>
            </TabsContent>

            <TabsContent value="issues" className="mt-6">
              <HealthOverview stats={stats} />
              <div className="mt-6">
                <IssuesTable issues={allIssues} repo={tableRepo} query={search} newIds={newIds} fixed={fixedIssues} />
              </div>
            </TabsContent>

            <TabsContent value="tree" className="mt-6">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                  Repository map — files and branches that carry findings, colored by worst severity.
                  Click a folder to expand, a file for details.
                </p>
              </div>
              <RepoTree
                issues={issues}
                weights={weights}
                repo={{
                  owner: current.owner,
                  name: current.name,
                  url: current.url,
                  commit: current.latest.repo.commit,
                  defaultBranch: current.defaultBranch,
                }}
                onViewInIssues={(file) => {
                  setSearch(file)
                  setTab("issues")
                }}
              />
            </TabsContent>

            <TabsContent value="history" className="mt-6">
              <CommitTree initialUrl={current.url} />
            </TabsContent>

            <TabsContent value="about" className="mt-6">
              <RepoOverview
                profile={current.latest.profile}
                linesOfCode={current.latest.metrics?.linesOfCode}
                grade={repo.grade}
                score={repo.score}
                lastScan={repo.lastScan}
                repo={{
                  owner: current.owner,
                  name: current.name,
                  url: current.url,
                  defaultBranch: current.defaultBranch,
                  commit: current.latest.repo.commit,
                }}
              />
            </TabsContent>

            <TabsContent value="breakdown" className="mt-6 space-y-6">
              <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                <GradeCard grade={repo.grade} score={repo.score} lastScan={repo.lastScan} />
                <IssueBreakdown issues={issues} />
              </div>
              <TrendChart data={trend} />
            </TabsContent>
          </Tabs>
        </main>
        )}
      </div>

      <NewScanDialog
        open={scanOpen}
        onOpenChange={setScanOpen}
        onOpenRepo={(id) => setActiveId(id)}
      />

      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        repos={sidebarRepos.map((r) => {
          const full = repos.find((x) => x.id === r.id)
          return { id: r.id, owner: full?.owner ?? "", name: r.name, grade: r.grade, score: r.score }
        })}
        activeId={showOverview ? OVERVIEW : current.id}
        onSelectRepo={setActiveId}
        onShowOverview={repos.length > 1 ? () => setActiveId(OVERVIEW) : undefined}
        onNewScan={() => setScanOpen(true)}
        onGoToTab={(t) => {
          setActiveId(current.id) // ensure we're on a repo (not the overview)
          setTab(t)
        }}
        report={showOverview ? undefined : current.latest}
      />

      <ScanScheduler />
    </div>
  )
}
