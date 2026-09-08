"use client"

import { useId, useMemo, useState } from "react"
import { Box, ChevronDown, Minus, Plus, RotateCcw, Route } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type DependencyRuntime = "production" | "development" | "both" | "unknown"

export interface DependencyResearchNode {
  id: string
  name: string
  version?: string | null
  runtime: DependencyRuntime
  kind?: "root" | "workspace" | "direct" | "transitive"
  severity?: "critical" | "warning" | "info" | "none"
  installPath?: string | null
  packageManager?: string | null
  description?: string | null
}

export interface DependencyResearchEdge {
  source: string
  target: string
  label?: string | null
  optional?: boolean
}

export interface DependencyResearchPath {
  id: string
  label?: string | null
  nodeIds: string[]
  runtime: DependencyRuntime
}

export interface DependencyResearchSummary {
  title?: string
  description?: string
  totalNodes: number
  productionNodes: number
  developmentNodes: number
  unknownNodes?: number
  vulnerableNodes?: number
}

export interface DependencyResearchGraphProps {
  nodes: DependencyResearchNode[]
  edges: DependencyResearchEdge[]
  paths: DependencyResearchPath[]
  summary: DependencyResearchSummary
  className?: string
}

type RuntimeFilter = "all" | "production" | "development"

const NODE_WIDTH = 176
const NODE_HEIGHT = 62
const COLUMN_GAP = 88
const ROW_GAP = 30

const runtimeLabel: Record<DependencyRuntime, string> = {
  production: "Production",
  development: "Development",
  both: "Prod + dev",
  unknown: "Unknown",
}

function includedByFilter(node: DependencyResearchNode, filter: RuntimeFilter): boolean {
  if (filter === "all") return true
  if (node.kind === "root" || node.kind === "workspace") return true
  return node.runtime === filter || node.runtime === "both"
}

function computeDepths(nodes: DependencyResearchNode[], edges: DependencyResearchEdge[]): Map<string, number> {
  const ids = new Set(nodes.map((node) => node.id))
  const incoming = new Map(nodes.map((node) => [node.id, 0]))
  const outgoing = new Map<string, string[]>()
  for (const edge of edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target)) continue
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1)
    const list = outgoing.get(edge.source)
    if (list) list.push(edge.target)
    else outgoing.set(edge.source, [edge.target])
  }

  const depth = new Map<string, number>()
  const queue = nodes.filter((node) => incoming.get(node.id) === 0).map((node) => node.id)
  queue.forEach((id) => depth.set(id, 0))
  for (let index = 0; index < queue.length; index += 1) {
    const source = queue[index]
    for (const target of outgoing.get(source) ?? []) {
      depth.set(target, Math.max(depth.get(target) ?? 0, (depth.get(source) ?? 0) + 1))
      incoming.set(target, (incoming.get(target) ?? 1) - 1)
      if (incoming.get(target) === 0) queue.push(target)
    }
  }

  // Malformed or cyclic lock graphs still remain inspectable.
  let cyclicIndex = 0
  const cyclicColumns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)))
  nodes.forEach((node) => {
    if (!depth.has(node.id)) depth.set(node.id, cyclicIndex++ % cyclicColumns)
  })
  return depth
}

function severityClass(severity: DependencyResearchNode["severity"]): string {
  if (severity === "critical") return "border-destructive text-destructive"
  if (severity === "warning") return "border-chart-2 text-chart-2"
  if (severity === "info") return "border-muted-foreground/50 text-muted-foreground"
  return "border-border text-muted-foreground"
}

export function DependencyResearchGraph({
  nodes,
  edges,
  paths,
  summary,
  className,
}: DependencyResearchGraphProps) {
  const markerId = useId().replace(/:/g, "")
  const [filter, setFilter] = useState<RuntimeFilter>("all")
  const [scale, setScale] = useState(1)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [pathsOpen, setPathsOpen] = useState(false)

  const graph = useMemo(() => {
    const visibleNodes = nodes.filter((node) => includedByFilter(node, filter))
    const visibleIds = new Set(visibleNodes.map((node) => node.id))
    const visibleEdges = edges.filter((edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target))
    const depths = computeDepths(visibleNodes, visibleEdges)
    const columns = new Map<number, DependencyResearchNode[]>()
    visibleNodes.forEach((node) => {
      const depth = depths.get(node.id) ?? 0
      columns.set(depth, [...(columns.get(depth) ?? []), node])
    })
    columns.forEach((column) => column.sort((a, b) => a.name.localeCompare(b.name)))

    const maxRows = Math.max(1, ...[...columns.values()].map((column) => column.length))
    const maxDepth = Math.max(0, ...depths.values())
    const width = Math.max(560, (maxDepth + 1) * NODE_WIDTH + maxDepth * COLUMN_GAP + 48)
    const height = Math.max(270, maxRows * NODE_HEIGHT + (maxRows - 1) * ROW_GAP + 52)
    const positions = new Map<string, { x: number; y: number }>()
    columns.forEach((column, depth) => {
      const columnHeight = column.length * NODE_HEIGHT + Math.max(0, column.length - 1) * ROW_GAP
      const top = (height - columnHeight) / 2
      column.forEach((node, index) => {
        positions.set(node.id, {
          x: 24 + depth * (NODE_WIDTH + COLUMN_GAP),
          y: top + index * (NODE_HEIGHT + ROW_GAP),
        })
      })
    })
    return { visibleNodes, visibleEdges, visibleIds, positions, width, height }
  }, [edges, filter, nodes])

  const selected = nodes.find((node) => node.id === selectedId) ?? null
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const selectedPaths = selected ? paths.filter((path) => path.nodeIds.includes(selected.id)) : []
  const highlightedIds = new Set(selectedPaths.flatMap((path) => path.nodeIds))
  const highlightedEdges = new Set(
    selectedPaths.flatMap((path) => path.nodeIds.slice(1).map((id, index) => `${path.nodeIds[index]}:${id}`)),
  )
  const viewWidth = graph.width / scale
  const viewHeight = graph.height / scale

  function changeFilter(next: RuntimeFilter) {
    setFilter(next)
    const selectedNode = nodes.find((node) => node.id === selectedId)
    if (selectedNode && !includedByFilter(selectedNode, next)) setSelectedId(null)
  }

  return (
    <Card className={className}>
      <CardHeader className="gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-base">{summary.title ?? "Dependency path research"}</CardTitle>
            <CardDescription>
              {summary.description ?? "Inspect why a package is installed and whether it reaches production."}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-1.5 text-xs" aria-label="Research summary">
            <span className="rounded-md bg-muted px-2 py-1">{summary.totalNodes} packages</span>
            <span className="rounded-md bg-primary/10 px-2 py-1 text-primary">
              {summary.productionNodes} production
            </span>
            <span className="rounded-md bg-chart-3/10 px-2 py-1 text-chart-3">
              {summary.developmentNodes} development
            </span>
            {!!summary.vulnerableNodes && (
              <span className="rounded-md bg-destructive/10 px-2 py-1 text-destructive">
                {summary.vulnerableNodes} vulnerable
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="inline-flex rounded-md border bg-muted/30 p-0.5" aria-label="Filter dependencies by runtime">
            {(["all", "production", "development"] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => changeFilter(value)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs capitalize text-muted-foreground transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  filter === value && "bg-background font-medium text-foreground shadow-sm",
                )}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1" aria-label="Graph zoom controls">
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="Zoom out"
              disabled={scale <= 0.6}
              onClick={() => setScale((value) => Math.max(0.6, value - 0.2))}
            >
              <Minus className="size-3.5" />
            </Button>
            <span className="w-11 text-center font-mono text-xs tabular-nums" aria-live="polite">
              {Math.round(scale * 100)}%
            </span>
            <Button
              type="button"
              size="icon"
              variant="outline"
              className="size-8"
              aria-label="Zoom in"
              disabled={scale >= 1.8}
              onClick={() => setScale((value) => Math.min(1.8, value + 0.2))}
            >
              <Plus className="size-3.5" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="size-8"
              aria-label="Reset zoom"
              onClick={() => setScale(1)}
            >
              <RotateCcw className="size-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="max-h-[36rem] overflow-auto rounded-lg border bg-muted/15" aria-label="Dependency graph">
          {graph.visibleNodes.length === 0 ? (
            <div className="grid min-h-64 place-items-center px-4 text-sm text-muted-foreground">
              No dependencies match this runtime filter.
            </div>
          ) : (
            <svg
              role="img"
              aria-labelledby={`${markerId}-title ${markerId}-description`}
              viewBox={`0 0 ${viewWidth} ${viewHeight}`}
              className="min-h-72 min-w-[560px]"
              style={{ aspectRatio: `${viewWidth} / ${viewHeight}` }}
            >
              <title id={`${markerId}-title`}>Dependency relationship graph</title>
              <desc id={`${markerId}-description`}>
                {graph.visibleNodes.length} visible packages. Use Tab to select a package and inspect its paths.
              </desc>
              <defs>
                <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
                  <path d="M0,0 L8,4 L0,8 Z" fill="var(--border)" />
                </marker>
              </defs>
              {graph.visibleEdges.map((edge, edgeIndex) => {
                const source = graph.positions.get(edge.source)
                const target = graph.positions.get(edge.target)
                if (!source || !target) return null
                const startX = source.x + NODE_WIDTH
                const startY = source.y + NODE_HEIGHT / 2
                const endX = target.x
                const endY = target.y + NODE_HEIGHT / 2
                const midX = (startX + endX) / 2
                const highlighted = highlightedEdges.has(`${edge.source}:${edge.target}`)
                return (
                  <path
                    key={`${edge.source}:${edge.target}:${edgeIndex}`}
                    d={`M ${startX} ${startY} C ${midX} ${startY}, ${midX} ${endY}, ${endX} ${endY}`}
                    fill="none"
                    stroke={highlighted ? "var(--primary)" : "var(--border)"}
                    strokeWidth={highlighted ? 2.5 : 1.5}
                    strokeDasharray={edge.optional ? "5 4" : undefined}
                    markerEnd={`url(#${markerId})`}
                  />
                )
              })}
              {graph.visibleNodes.map((node) => {
                const position = graph.positions.get(node.id)!
                const active = node.id === selectedId
                const highlighted = highlightedIds.has(node.id)
                return (
                  <g
                    key={node.id}
                    role="button"
                    tabIndex={0}
                    aria-label={`${node.name} ${node.version ?? ""}, ${runtimeLabel[node.runtime]}`}
                    aria-pressed={active}
                    onClick={() => setSelectedId(active ? null : node.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault()
                        setSelectedId(active ? null : node.id)
                      }
                    }}
                    className="cursor-pointer outline-none"
                  >
                    <rect
                      x={position.x}
                      y={position.y}
                      width={NODE_WIDTH}
                      height={NODE_HEIGHT}
                      rx="8"
                      fill="var(--card)"
                      stroke={active ? "var(--primary)" : highlighted ? "var(--chart-3)" : "var(--border)"}
                      strokeWidth={active ? 3 : highlighted ? 2 : 1.5}
                    />
                    <circle
                      cx={position.x + 15}
                      cy={position.y + 18}
                      r="4"
                      fill={node.runtime === "production" || node.runtime === "both" ? "var(--primary)" : "var(--muted-foreground)"}
                    />
                    <text x={position.x + 26} y={position.y + 22} fill="var(--foreground)" fontSize="12" fontWeight="600">
                      {node.name.length > 19 ? `${node.name.slice(0, 18)}…` : node.name}
                    </text>
                    <text x={position.x + 14} y={position.y + 43} fill="var(--muted-foreground)" fontSize="10">
                      {node.version ? `v${node.version} · ` : ""}{runtimeLabel[node.runtime]}
                    </text>
                    {node.severity && node.severity !== "none" && (
                      <circle
                        cx={position.x + NODE_WIDTH - 13}
                        cy={position.y + NODE_HEIGHT - 13}
                        r="4"
                        fill={node.severity === "critical" ? "var(--destructive)" : "var(--chart-2)"}
                      />
                    )}
                  </g>
                )
              })}
            </svg>
          )}
        </div>

        {selected && (
          <div className="rounded-lg border bg-card p-3" aria-live="polite">
            <div className="flex items-start gap-3">
              <Box className={cn("mt-0.5 size-4 shrink-0", severityClass(selected.severity))} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-mono text-sm font-semibold">{selected.name}</span>
                  {selected.version && <span className="font-mono text-xs text-muted-foreground">{selected.version}</span>}
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {runtimeLabel[selected.runtime]}
                  </span>
                </div>
                {selected.description && <p className="mt-1 text-xs text-muted-foreground">{selected.description}</p>}
                <dl className="mt-2 grid gap-1 text-xs sm:grid-cols-2">
                  {selected.installPath && (
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">Installed at</dt>
                      <dd className="truncate font-mono" title={selected.installPath}>{selected.installPath}</dd>
                    </div>
                  )}
                  {selected.packageManager && (
                    <div>
                      <dt className="text-muted-foreground">Resolved by</dt>
                      <dd>{selected.packageManager}</dd>
                    </div>
                  )}
                </dl>
              </div>
            </div>
          </div>
        )}

        <div className="rounded-lg border">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-expanded={pathsOpen}
            onClick={() => setPathsOpen((value) => !value)}
          >
            <Route className="size-3.5 text-muted-foreground" />
            Resolved paths ({selected ? selectedPaths.length : paths.length})
            <ChevronDown className={cn("ml-auto size-3.5 transition-transform", pathsOpen && "rotate-180")} />
          </button>
          {pathsOpen && (
            <div className="border-t px-3 py-2">
              {(selected ? selectedPaths : paths).length === 0 ? (
                <p className="text-xs text-muted-foreground">No complete path was recovered from the lockfile.</p>
              ) : (
                <ul className="space-y-2">
                  {(selected ? selectedPaths : paths).map((path) => (
                    <li key={path.id} className="text-xs">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{path.label ?? runtimeLabel[path.runtime]}</span>
                        <span className="text-muted-foreground">{runtimeLabel[path.runtime]}</span>
                      </div>
                      <p className="mt-0.5 overflow-x-auto whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                        {path.nodeIds.map((id) => nodeById.get(id)?.name ?? id).join(" → ")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
