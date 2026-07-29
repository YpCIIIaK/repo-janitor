"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CalendarHeatmap } from "@/components/charts/calendar-heatmap"
import { timeAgo } from "@/lib/reports-store"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { useTheme } from "next-themes"
import {
  GitCommitVertical,
  GitMerge,
  Tag,
  Loader2,
  Play,
  AlertTriangle,
  X,
  ArrowUp,
  ArrowDown,
  Clock,
  Square,
  ListChecks,
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Segmented } from "@/components/ui/segmented"
import { cn } from "@/lib/utils"
import {
  fetchCommits,
  streamHistory,
  type ActivityDay,
  type CommitNode,
  type CommitSkeleton,
  type CommitWithStats,
  type HistoryScope,
} from "@/lib/history-client"
import { CommitPicker } from "./commit-picker"
import { mergeHistoryPoints, trendPointAt } from "@/lib/reports-store"
import type { Grade, Issue, Severity } from "@/lib/mock-data"

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

const NODE_W = 248
const ROW_GAP = 128

/** Grade → CSS chart color (mirrors the rest of the dashboard). */
const GRADE_COLOR: Record<Grade, string> = {
  A: "var(--chart-1)",
  B: "var(--chart-1)",
  C: "var(--chart-2)",
  D: "var(--chart-3)",
  F: "var(--chart-4)",
}

const severityStyle: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  warning: "bg-chart-2/15 text-chart-2 border-chart-2/30",
  info: "bg-muted text-muted-foreground border-border",
}

function severityCounts(issues: Issue[]) {
  return {
    critical: issues.filter((i) => i.severity === "critical").length,
    warning: issues.filter((i) => i.severity === "warning").length,
    info: issues.filter((i) => i.severity === "info").length,
  }
}

function shortDate(ms: number) {
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" })
}

// ---------------------------------------------------------------------------
// Custom node
// ---------------------------------------------------------------------------

interface CommitNodeData extends Record<string, unknown> {
  commit: CommitSkeleton
  node?: CommitNode
  error?: string
  selected: boolean
}

function CommitFlowNode({ data }: NodeProps<Node<CommitNodeData>>) {
  const { commit, node, error, selected } = data
  const report = node?.report
  const grade = report?.grade
  const color = grade ? GRADE_COLOR[grade] : "var(--muted-foreground)"
  const counts = report ? severityCounts(report.issues) : null
  const diff = node?.diffVsParent

  return (
    <div
      style={{ width: NODE_W, borderLeftColor: color }}
      className={cn(
        "rounded-md border border-l-4 bg-card px-3 py-2 shadow-sm transition-all",
        selected ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-border",
      )}
    >
      <Handle type="target" position={Position.Top} className="!bg-border" />
      <Handle type="source" position={Position.Bottom} className="!bg-border" />

      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          {commit.parents.length >= 2 ? (
            <GitMerge className="size-3.5 shrink-0 text-chart-5" />
          ) : commit.tagged ? (
            <Tag className="size-3.5 shrink-0 text-chart-2" />
          ) : (
            <GitCommitVertical className="size-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="truncate font-mono text-xs text-muted-foreground">{commit.shortSha}</span>
        </span>
        {report ? (
          <span className="flex shrink-0 items-center gap-1.5">
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{report.score}</span>
            <span
              className="flex size-6 items-center justify-center rounded font-mono text-xs font-bold"
              style={{ color, backgroundColor: `color-mix(in oklab, ${color} 15%, transparent)` }}
            >
              {grade}
            </span>
          </span>
        ) : error ? (
          <AlertTriangle className="size-4 shrink-0 text-destructive" />
        ) : (
          <Loader2 className="size-4 shrink-0 animate-spin text-muted-foreground" />
        )}
      </div>

      <p className="mt-1 truncate text-xs" title={commit.subject}>
        {commit.subject || <span className="text-muted-foreground">(no message)</span>}
      </p>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
        <span>{shortDate(commit.date)}</span>
        {counts && (
          <span className="flex items-center gap-1.5 font-mono tabular-nums">
            <span className="text-destructive">{counts.critical}</span>
            <span className="text-chart-2">{counts.warning}</span>
            <span>{counts.info}</span>
          </span>
        )}
      </div>

      {diff && diff.hasParent && (diff.added > 0 || diff.fixed > 0) && (
        <div className="mt-1.5 flex gap-1.5 text-[10px] font-medium">
          {diff.added > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-destructive/15 px-1.5 text-destructive">
              <ArrowUp className="size-2.5" />
              {diff.added}
            </span>
          )}
          {diff.fixed > 0 && (
            <span className="flex items-center gap-0.5 rounded-full bg-chart-1/15 px-1.5 text-chart-1">
              <ArrowDown className="size-2.5" />
              {diff.fixed}
            </span>
          )}
        </div>
      )}
    </div>
  )
}

const nodeTypes = { commit: CommitFlowNode }

// ---------------------------------------------------------------------------
// Side panel — full scan of the selected commit
// ---------------------------------------------------------------------------

function NodeScanDetail({
  commit,
  node,
  error,
  onClose,
}: {
  commit: CommitSkeleton
  node?: CommitNode
  error?: string
  onClose: () => void
}) {
  const report = node?.report
  const counts = report ? severityCounts(report.issues) : null

  return (
    <div className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-lg border border-border bg-card/95 shadow-lg backdrop-blur">
      <div className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="min-w-0">
          <p className="truncate font-mono text-xs text-muted-foreground">{commit.shortSha}</p>
          <p className="mt-0.5 line-clamp-2 text-sm font-medium" title={commit.subject}>
            {commit.subject || "(no message)"}
          </p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="size-3" />
            {shortDate(commit.date)}
          </p>
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent">
          <X className="size-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : !report ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Scanning…
          </p>
        ) : (
          <>
            <div className="mb-3 flex items-center gap-2">
              <span
                className="flex size-9 items-center justify-center rounded-md font-mono text-base font-bold"
                style={{
                  color: GRADE_COLOR[report.grade],
                  backgroundColor: `color-mix(in oklab, ${GRADE_COLOR[report.grade]} 15%, transparent)`,
                }}
              >
                {report.grade}
              </span>
              <div className="text-sm">
                <div className="font-mono tabular-nums">{report.score}/100</div>
                <div className="text-xs text-muted-foreground">{report.issues.length} findings</div>
              </div>
            </div>

            {counts && (
              <div className="mb-3 flex gap-1.5 text-xs">
                <span className={cn("rounded-full border px-2 py-0.5", severityStyle.critical)}>{counts.critical} critical</span>
                <span className={cn("rounded-full border px-2 py-0.5", severityStyle.warning)}>{counts.warning} warning</span>
                <span className={cn("rounded-full border px-2 py-0.5", severityStyle.info)}>{counts.info} info</span>
              </div>
            )}

            {report.issues.length === 0 ? (
              <p className="rounded-md border border-border py-6 text-center text-sm text-muted-foreground">Clean scan ✅</p>
            ) : (
              <ul className="space-y-1.5">
                {report.issues.map((issue) => (
                  <li key={issue.id} className="rounded-md border border-border px-2.5 py-1.5">
                    <div className="flex items-center gap-2">
                      <span className={cn("size-1.5 shrink-0 rounded-full", issue.severity === "critical" ? "bg-destructive" : issue.severity === "warning" ? "bg-chart-2" : "bg-muted-foreground/50")} />
                      <span className="truncate text-xs font-medium">{issue.title}</span>
                    </div>
                    <p className="mt-0.5 truncate pl-3.5 font-mono text-[11px] text-muted-foreground">{issue.location}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const DEFAULT_SAMPLE = 18
const MAX_SAMPLE = 40

function CommitTreeInner({ initialUrl = "" }: { initialUrl?: string }) {
  const { resolvedTheme } = useTheme()
  const [url, setUrl] = useState(initialUrl)
  const [scope, setScope] = useState<"sample" | "all" | "pick">("sample")
  const [pool, setPool] = useState<CommitWithStats[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [loadingPool, setLoadingPool] = useState(false)
  const [sample, setSample] = useState(DEFAULT_SAMPLE)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [commits, setCommits] = useState<CommitSkeleton[]>([])
  const [activity, setActivity] = useState<ActivityDay[]>([])
  // Held in a ref, not state: aborting must not depend on a re-render having
  // happened, and the controller is not something the UI reads.
  const abortRef = useRef<AbortController | null>(null)
  // sha → scanned node (or error). State (not a ref) so React Flow re-renders as
  // each commit's scan streams in.
  const [data, setData] = useState<Map<string, { node?: CommitNode; error?: string }>>(new Map())
  const [selectedSha, setSelectedSha] = useState<string | null>(null)

  const nodes: Node<CommitNodeData>[] = useMemo(
    () =>
      commits.map((c, i) => {
        const entry = data.get(c.sha)
        return {
          id: c.sha,
          type: "commit",
          position: { x: 0, y: i * ROW_GAP },
          data: { commit: c, node: entry?.node, error: entry?.error, selected: c.sha === selectedSha },
        }
      }),
    [commits, selectedSha, data],
  )

  // First-parent history is linear, so connect each sampled commit to the next.
  const edges: Edge[] = useMemo(
    () =>
      commits.slice(0, -1).map((c, i) => ({
        id: `${c.sha}-${commits[i + 1].sha}`,
        source: c.sha,
        target: commits[i + 1].sha,
        type: "smoothstep",
        animated: loading,
        style: { stroke: "var(--border)" },
      })),
    [commits, loading],
  )

  const onNodeClick = useCallback((_: unknown, n: Node) => setSelectedSha(n.id), [])

  // Leaving the tab is a stop too. Without this, switching away mid-run leaves
  // the server scanning hundreds of commits for a component that no longer
  // exists — the same waste the Stop button exists to prevent, just silent.
  useEffect(() => () => abortRef.current?.abort(), [])

  const selected = selectedSha ? commits.find((c) => c.sha === selectedSha) : undefined
  const selectedData = selectedSha ? data.get(selectedSha) : undefined

  /**
   * Stop the run in progress.
   *
   * Aborting the fetch closes the response stream, which the route treats as its
   * cue to stop scanning — so this ends the server's work too, not just the
   * progress bar. Whatever has already been scanned stays on screen: a partial
   * tree is the useful half of a run you cut short.
   */
  function stop() {
    abortRef.current?.abort()
  }

  /**
   * Load the commit log so the picker has something to show. Cheap next to a
   * scan: one blobless clone and one `git log`, no checkouts.
   */
  async function loadPool() {
    const controller = new AbortController()
    abortRef.current = controller
    setLoadingPool(true)
    setError(null)
    setStatus("Reading commit log…")
    try {
      const { commits: cs, capped } = await fetchCommits(url.trim(), controller.signal)
      setPool(cs)
      setPicked(new Set())
      setStatus(
        capped
          ? `${cs.length} commits (capped) — pick the ones worth scanning.`
          : `${cs.length} commits — pick the ones worth scanning.`,
      )
    } catch (err) {
      if (!controller.signal.aborted) {
        setError(String(err instanceof Error ? err.message : err))
        setStatus("")
      }
    } finally {
      setLoadingPool(false)
      abortRef.current = null
    }
  }

  async function build() {
    const controller = new AbortController()
    abortRef.current = controller

    setLoading(true)
    setError(null)
    setCommits([])
    setActivity([])
    setSelectedSha(null)
    setData(new Map())
    setStatus("Cloning history…")

    let done = 0
    let total = 0
    try {
      const requested: HistoryScope =
        scope === "pick"
          ? { shas: [...picked] }
          : scope === "all"
            ? { all: true }
            : { sample }

      // Commit dates, so each scanned report can be filed at the moment it
      // describes rather than at the moment we measured it.
      const dateOf = new Map<string, number>()

      await streamHistory(url.trim(), requested, {
        signal: controller.signal,
        onCommits: (cs) => {
          total = cs.length
          setCommits(cs)
          for (const c of cs) dateOf.set(c.sha, c.date)
          setStatus(`Scanning ${total} commits…`)
        },
        onActivity: setActivity,
        onNode: (sha, node) => {
          done++
          setStatus(`Scanned ${done}/${total} commits…`)
          setData((prev) => new Map(prev).set(sha, { node }))

          // Fold the measurement into the repo's timeline, dated by the commit.
          // Best-effort: a repo that has never been scanned normally has no
          // timeline to insert into, and that is not an error worth surfacing
          // in the middle of a run.
          const at = dateOf.get(sha)
          const rep = node.report
          if (at && rep?.repo) {
            mergeHistoryPoints(
              `${rep.repo.owner}/${rep.repo.name}`,
              [trendPointAt(rep, new Date(at).toISOString())],
            )
          }
        },
        onNodeError: (sha, err) => {
          done++
          setData((prev) => new Map(prev).set(sha, { error: err }))
        },
      })
      setStatus(total > 0 ? `Done — ${total} commits scanned.` : "")
    } catch (err) {
      // Stopping is something the user did, not something that went wrong.
      // Reporting it as an error would make a deliberate act look like a bug.
      if (controller.signal.aborted) {
        setStatus(done > 0 ? `Stopped — ${done} of ${total} commits scanned.` : "Stopped.")
      } else {
        setError(String(err instanceof Error ? err.message : err))
        setStatus("")
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const hasTree = commits.length > 0

  // Days since the last commit. A repository that stopped being committed to is
  // the plainest decay signal there is, and it is the one thing the heatmap
  // shows at a glance that a list of commits does not.
  const latestCommitDay = useMemo(
    () => (activity.length === 0 ? null : activity.reduce((a, b) => (a.date > b.date ? a : b)).date),
    [activity],
  )
  // Reuses the app's own relative-time helper rather than reading the clock
  // here: same wording as every other timestamp in the dashboard, and the
  // clock read stays out of the render body where it is not a pure input.
  const lastCommitAgo = latestCommitDay ? timeAgo(`${latestCommitDay}T00:00:00Z`) : null

  return (
    <div className="space-y-4">
      {activity.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Commit activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <CalendarHeatmap data={activity} />
            <p className="text-xs text-muted-foreground">
              Every commit in the history, not just the scanned sample.
              {lastCommitAgo && ` Last commit ${lastCommitAgo}.`}
            </p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Commit health tree</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Clone a repo&apos;s history, sample its commits (releases, merges, and a weekly spread), and scan
            each — then walk the health of the codebase commit by commit.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/owner/repo.git"
              className="min-w-[16rem] flex-1 font-mono text-sm"
              disabled={loading}
            />
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Segmented
                aria-label="Which commits to scan"
                size="sm"
                value={scope}
                onChange={(v) => setScope(v as typeof scope)}
                items={[
                  { value: "sample", label: "Sample" },
                  { value: "pick", label: "Pick" },
                  { value: "all", label: "All" },
                ]}
              />
              {scope === "sample" && (
                <label className="flex items-center gap-1.5">
                  commits
                  <Input
                    type="number"
                    min={1}
                    max={MAX_SAMPLE}
                    value={sample}
                    onChange={(e) => setSample(Math.max(1, Math.min(MAX_SAMPLE, Number(e.target.value) || DEFAULT_SAMPLE)))}
                    className="w-16 tabular-nums"
                    disabled={loading}
                  />
                </label>
              )}
            </div>
            {/* While a run is going the primary button becomes Stop rather than
                a disabled Building… — "every commit" can queue hundreds of
                clones, and the moment you realise you picked too many is the
                moment you need a way out, not a spinner. */}
            {loading || loadingPool ? (
              <Button variant="destructive" onClick={stop}>
                <Square className="size-4" />
                Stop
              </Button>
            ) : scope === "pick" && pool.length === 0 ? (
              <Button onClick={loadPool} disabled={!url.trim()}>
                <ListChecks className="size-4" />
                Load commits
              </Button>
            ) : (
              <Button
                onClick={build}
                disabled={!url.trim() || (scope === "pick" && picked.size === 0)}
              >
                <Play className="size-4" />
                {scope === "pick" ? `Scan ${picked.size} selected` : "Build tree"}
              </Button>
            )}
          </div>

          {scope === "pick" && pool.length > 0 && (
            <CommitPicker
              commits={pool}
              selected={picked}
              onChange={setPicked}
              disabled={loading}
            />
          )}

          {status && <p className="text-xs text-muted-foreground">{status}</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </CardContent>
      </Card>

      {hasTree && (
        <div className="relative h-[640px] w-full overflow-hidden rounded-lg border border-border bg-background">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            colorMode={(resolvedTheme as "light" | "dark") ?? "light"}
            fitView
            fitViewOptions={{ padding: 0.25 }}
            minZoom={0.2}
            nodesConnectable={false}
            edgesFocusable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={20} className="opacity-50" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable className="!bg-card" nodeColor={() => "var(--muted-foreground)"} />
          </ReactFlow>

          {selected && (
            <NodeScanDetail
              commit={selected}
              node={selectedData?.node}
              error={selectedData?.error}
              onClose={() => setSelectedSha(null)}
            />
          )}
        </div>
      )}
    </div>
  )
}

export function CommitTree({ initialUrl }: { initialUrl?: string }) {
  return (
    <ReactFlowProvider>
      <CommitTreeInner initialUrl={initialUrl} />
    </ReactFlowProvider>
  )
}
