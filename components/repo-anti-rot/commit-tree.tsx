"use client"

import { useCallback, useMemo, useState } from "react"
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
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { streamHistory, type CommitNode, type CommitSkeleton } from "@/lib/history-client"
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
  const [scope, setScope] = useState<"sample" | "all">("sample")
  const [sample, setSample] = useState(DEFAULT_SAMPLE)
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [commits, setCommits] = useState<CommitSkeleton[]>([])
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

  const selected = selectedSha ? commits.find((c) => c.sha === selectedSha) : undefined
  const selectedData = selectedSha ? data.get(selectedSha) : undefined

  async function build() {
    setLoading(true)
    setError(null)
    setCommits([])
    setSelectedSha(null)
    setData(new Map())
    setStatus("Cloning history…")

    let done = 0
    let total = 0
    try {
      await streamHistory(url.trim(), scope === "all" ? { all: true } : { sample }, {
        onCommits: (cs) => {
          total = cs.length
          setCommits(cs)
          setStatus(`Scanning ${total} commits…`)
        },
        onNode: (sha, node) => {
          done++
          setStatus(`Scanned ${done}/${total} commits…`)
          setData((prev) => new Map(prev).set(sha, { node }))
        },
        onNodeError: (sha, err) => {
          done++
          setData((prev) => new Map(prev).set(sha, { error: err }))
        },
      })
      setStatus(total > 0 ? `Done — ${total} commits scanned.` : "")
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err))
      setStatus("")
    } finally {
      setLoading(false)
    }
  }

  const hasTree = commits.length > 0

  return (
    <div className="space-y-4">
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
              <div className="flex rounded-md border border-border p-0.5">
                <button
                  type="button"
                  onClick={() => setScope("sample")}
                  disabled={loading}
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                    scope === "sample" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  Sample
                </button>
                <button
                  type="button"
                  onClick={() => setScope("all")}
                  disabled={loading}
                  className={cn(
                    "rounded px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50",
                    scope === "all" ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  All
                </button>
              </div>
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
            <Button onClick={build} disabled={loading || !url.trim()}>
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />}
              {loading ? "Building…" : "Build tree"}
            </Button>
          </div>
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
