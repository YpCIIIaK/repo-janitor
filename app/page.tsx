"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TopBar } from "@/components/repo-anti-rot/top-bar"
import { RepoSidebar, type SidebarRepo } from "@/components/repo-anti-rot/repo-sidebar"
import { HealthOverview } from "@/components/repo-anti-rot/health-overview"
import { GradeCard } from "@/components/repo-anti-rot/grade-card"
import { IssueBreakdown } from "@/components/repo-anti-rot/issue-breakdown"
import { IssuesTable } from "@/components/repo-anti-rot/issues-table"
import { TrendChart } from "@/components/repo-anti-rot/trend-chart"
import { ReposOverview } from "@/components/repo-anti-rot/repos-overview"
import { RescanButton } from "@/components/repo-anti-rot/rescan-button"
import { NewScanDialog } from "@/components/repo-anti-rot/new-scan-dialog"
import { WelcomeScreen } from "@/components/repo-anti-rot/welcome-screen"
import { useRepos, removeRepo, repoStats, repoTrend, countSeverity, timeAgo } from "@/lib/reports-store"
import { cn } from "@/lib/utils"

const severityChip: Record<"critical" | "warning" | "info", string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  info: "bg-muted text-muted-foreground border-border",
}

// Sentinel id selecting the cross-repo overview instead of a single repo.
const OVERVIEW = "__overview__"

export default function Page() {
  const repos = useRepos()
  const [activeId, setActiveId] = useState<string>("")
  const [search, setSearch] = useState<string>("")
  const [scanOpen, setScanOpen] = useState(false)

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

  const sidebarRepos: SidebarRepo[] = repos.map((r) => ({
    id: r.id,
    name: r.name,
    defaultBranch: r.defaultBranch,
    grade: r.latest.grade,
    score: r.latest.score,
    lastScan: timeAgo(r.scannedAt),
  }))

  const repo = {
    id: current.id,
    owner: current.owner,
    name: current.name,
    defaultBranch: current.defaultBranch,
    grade: current.latest.grade,
    score: current.latest.score,
    lastScan: timeAgo(current.scannedAt),
  }

  const stats = repoStats(current)
  const issues = current.latest.issues
  const trend = repoTrend(current)
  const counts = {
    critical: countSeverity(issues, "critical"),
    warning: countSeverity(issues, "warning"),
    info: countSeverity(issues, "info"),
  }

  return (
    <div className="min-h-screen">
      <TopBar repo={repo} search={search} onSearch={setSearch} />
      <div className="flex">
        <RepoSidebar
          repositories={sidebarRepos}
          activeId={showOverview ? OVERVIEW : current.id}
          onSelect={setActiveId}
          onRemove={removeRepo}
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
                  : `${issues.length} open issue${issues.length === 1 ? "" : "s"} · scanned ${repo.lastScan}`}
              </p>
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
              <RescanButton repo={current} />
            </div>
          </div>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList>
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="issues">Issues</TabsTrigger>
              <TabsTrigger value="breakdown">Breakdown</TabsTrigger>
            </TabsList>

            <TabsContent value="overview" className="mt-6">
              <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
                <GradeCard grade={repo.grade} score={repo.score} lastScan={repo.lastScan} />
                <IssueBreakdown issues={issues} />
              </div>
              <div className="mt-6">
                <HealthOverview stats={stats} />
              </div>
              <div className="mt-6">
                <TrendChart data={trend} />
              </div>
              <div className="mt-6">
                <IssuesTable issues={issues} query={search} />
              </div>
            </TabsContent>

            <TabsContent value="issues" className="mt-6">
              <HealthOverview stats={stats} />
              <div className="mt-6">
                <IssuesTable issues={issues} query={search} />
              </div>
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
    </div>
  )
}
