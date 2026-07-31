"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Tabs, TabsContent } from "@/components/ui/tabs"
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
import { ShareButton } from "@/components/repo-anti-rot/share-button"
import { CommandPalette, type PaletteTab } from "@/components/repo-anti-rot/command-palette"
import { ScanScheduler } from "@/components/repo-anti-rot/scan-scheduler"
import { Button } from "@/components/ui/button"
import { Command as CommandIcon } from "lucide-react"
import { NewScanDialog } from "@/components/repo-anti-rot/new-scan-dialog"
import { RepoOverview } from "@/components/repo-anti-rot/repo-overview"
import { useRepos, removeRepo, repoStats, repoTrend, countSeverity, timeAgo, repoDiff, repoDiffDetail, newIssueIds, issueDensity } from "@/lib/reports-store"
import { Settings as SettingsIcon, HelpCircle } from "lucide-react"
import { SettingsDialog } from "@/components/repo-anti-rot/settings-dialog"
import { OnboardingDialog } from "@/components/repo-anti-rot/onboarding-dialog"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { ModePanel } from "@/components/repo-anti-rot/mode-panel"
import { ScanHistory } from "@/components/repo-anti-rot/scan-history"
import { filterMode } from "@/lib/issue-modes"
import { useSnoozed, partitionSnoozed, clearSnoozedForRepo } from "@/lib/snooze-store"
import { computeScore, scoreToGrade } from "@/lib/score"
import { scopeLine } from "@/lib/verdict"
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

/**
 * The dashboard — everything about repositories already scanned on this browser.
 *
 * Reports live in localStorage, so the server renders this with an empty store
 * and the real list arrives on hydration. That rules out redirecting when the
 * list is empty: the redirect would fire on every first paint, including for
 * people who do have reports. An empty state that links home is honest about the
 * same situation and cannot misfire.
 */
export default function DashboardPage() {
  const router = useRouter()
  const repos = useRepos()
  const snoozed = useSnoozed()
  const [activeId, setActiveId] = useState<string>("")
  const [search, setSearch] = useState<string>("")
  const [scanOpen, setScanOpen] = useState(false)
  const [tab, setTab] = useState<PaletteTab>("overview")
  const [paletteOpen, setPaletteOpen] = useState(false)

  const goHome = () => router.push("/")

  /**
   * `/app?repo=owner/name` — which report to open, handed over by the landing
   * page after a scan.
   *
   * Read in an effect from `window.location` rather than with `useSearchParams`.
   * Both would work, but the hook forces a Suspense boundary around the whole
   * dashboard during prerender, and this needs no boundary: the effect is
   * client-only, so there is no server render to disagree with.
   *
   * A parameter is needed at all because "the repository just scanned" is not
   * the same as "the first in the list" — re-scanning a repository already in
   * the store updates it in place and leaves it wherever it was.
   */
  useEffect(() => {
    try {
      const wanted = new URLSearchParams(window.location.search).get("repo")
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (wanted) setActiveId(wanted)
    } catch {
      /* no query string to read — fall back to the most recent report */
    }
  }, [])

  const showOverview = activeId === OVERVIEW
  // Resolve the selected repo, falling back to the most recent one.
  const current = repos.find((r) => r.id === activeId) ?? repos[0]

  if (!current) {
    return (
      <div className="min-h-screen">
        <TopBar />
        <main className="mx-auto w-full max-w-md px-4 py-24 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Nothing scanned yet</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Reports are kept in this browser. Scan a repository and it will show up here.
          </p>
          <Link
            href="/"
            className="mt-6 inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            Scan a repository
          </Link>
        </main>
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
      // Stored history holds the score as scanned; the live score above can
      // differ once findings are snoozed. Appending the live value keeps the
      // last point of the line agreeing with the number printed next to it.
      scoreHistory: [...r.history.slice(0, -1).map((p) => p.score), score],
    }
  })

  // What a clean result is clean across. "Nothing found" is equally true of an
  // empty repository and a large one, and only this tells them apart.
  const scanScope = scopeLine(current.latest.profile)

  const allIssues = current.latest.issues
  const weights = current.latest.config?.weights
  const { live: issues } = partitionSnoozed(current.id, allIssues, snoozed)
  const liveScore = computeScore(issues, weights)
  const liveGrade = scoreToGrade(liveScore)

  // Tab badges count LIVE findings, so snoozing the last one empties the badge
  // instead of promising something the tab no longer shows.
  const modeCounts = {
    security: filterMode(issues, "security").length,
    links: filterMode(issues, "links").length,
  }

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
    // App shell: the sidebar owns the full height, so the rail is continuous and
    // the header belongs to the content rather than spanning both.
    <div className="flex min-h-screen">
      <RepoSidebar
        repositories={sidebarRepos}
        activeId={showOverview ? OVERVIEW : current.id}
        onSelect={(id) => {
          setActiveId(id)
          setTab("overview")
        }}
        onRemove={handleRemove}
        onNewScan={() => setScanOpen(true)}
        onShowOverview={repos.length > 1 ? () => setActiveId(OVERVIEW) : undefined}
        onHome={goHome}
        section={showOverview ? undefined : tab}
        onSelectSection={(s) => {
          setActiveId(current.id)
          setTab(s)
        }}
        counts={{
          issues: issues.length,
          security: modeCounts.security,
          links: modeCounts.links,
        }}
        railExtras={
          <>
            <ThemeSwitcher variant="rail" />
            <SettingsDialog
              trigger={
                <button
                  title="Settings"
                  aria-label="Settings"
                  className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                >
                  <SettingsIcon className="size-4" />
                </button>
              }
            />
            <OnboardingDialog
              trigger={
                <button
                  title="Connect a repository"
                  aria-label="Connect a repository"
                  className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
                >
                  <HelpCircle className="size-4" />
                </button>
              }
            />
          </>
        }
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar repo={repo} search={search} onSearch={setSearch} onHome={goHome} />

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
                {/* "No open issues" states an absence. What was actually
                    established is that a specific amount of code was read and
                    nothing came back — so say the amount. */}
                {issues.length === 0
                  ? scanScope
                    ? `Clean scan across ${scanScope}`
                    : "Clean scan — nothing found"
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
              <ShareButton report={current.latest} repoUrl={current.url} />
              <ExportMenu report={current.latest} />
              <RescanButton repo={current} />
            </div>
          </div>

          {/* No TabsList: the sections live in the sidebar now. Radix drives the
              panels from `value` alone, so the tab strip is gone without the
              content plumbing changing. */}
          <Tabs value={tab} onValueChange={(v) => setTab(v as PaletteTab)} className="w-full">

            <TabsContent value="overview" className="mt-6">
              <AiSummaryCard
                repoId={current.id}
                owner={current.owner}
                name={current.name}
                issues={issues}
                weights={weights}
              />

              <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                <GradeCard
                  grade={repo.grade}
                  score={repo.score}
                  lastScan={repo.lastScan}
                  issues={issues}
                  weights={weights}
                  scope={scanScope}
                />
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
                <IssuesTable issues={allIssues} repo={tableRepo} query={search} newIds={newIds} fixed={fixedIssues} weights={weights} />
              </div>
            </TabsContent>

            <TabsContent value="issues" className="mt-6">
              <HealthOverview stats={stats} />
              <div className="mt-6">
                <IssuesTable issues={allIssues} repo={tableRepo} query={search} newIds={newIds} fixed={fixedIssues} weights={weights} />
              </div>
            </TabsContent>

            <TabsContent value="security" className="mt-6">
              <ModePanel mode="security" issues={allIssues} repo={tableRepo} query={search} weights={weights} />
            </TabsContent>

            <TabsContent value="links" className="mt-6">
              <ModePanel mode="links" issues={allIssues} repo={tableRepo} query={search} weights={weights} />
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

            <TabsContent value="history" className="mt-6 space-y-6">
              <ScanHistory history={current.history} />
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
                <GradeCard
                  grade={repo.grade}
                  score={repo.score}
                  lastScan={repo.lastScan}
                  issues={issues}
                  weights={weights}
                  scope={scanScope}
                />
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
