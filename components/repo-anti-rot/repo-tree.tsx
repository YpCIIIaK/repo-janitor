"use client"

import { useMemo, useState, useCallback, useEffect, useRef } from "react"
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useReactFlow,
  getNodesBounds,
  getViewportForBounds,
  type Node,
  type Edge,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { toPng, toSvg } from "html-to-image"
import { useTheme } from "next-themes"
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Code,
  Download,
  FileCode,
  Folder,
  GitBranch,
  Github,
  ImageDown,
  ListFilter,
  Maximize2,
  Minimize2,
  Search,
  X,
} from "lucide-react"
import type { Issue, Severity } from "@/lib/mock-data"
import { categoryLabels, severityLabels } from "@/lib/mock-data"
import {
  buildFileTree,
  countNodes,
  collapsibleIds,
  searchTree,
  type TreeNode,
  type TreeNodeKind,
} from "@/lib/file-tree"
import type { SeverityWeights } from "@/lib/score"
import { githubFileUrl } from "@/lib/github-link"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

// ---------------------------------------------------------------------------
// Visual constants
// ---------------------------------------------------------------------------

const NODE_W = 208
const HORIZONTAL_THRESHOLD = 30 // node count above which we lay the tree out L→R
const SEVERITIES = ["critical", "warning", "info"] as const

const ACCENT: Record<Severity, string> = {
  critical: "border-l-destructive",
  warning: "border-l-chart-2",
  info: "border-l-muted-foreground/50",
}
const DOT: Record<Severity, string> = {
  critical: "bg-destructive",
  warning: "bg-chart-2",
  info: "bg-muted-foreground/50",
}
const CHIP: Record<Severity, string> = {
  critical: "bg-destructive/15 text-destructive",
  warning: "bg-chart-2/15 text-chart-2",
  info: "bg-muted text-muted-foreground",
}

function KindIcon({ kind, id }: { kind: TreeNodeKind; id: string }) {
  const cls = "size-3.5 shrink-0 text-muted-foreground"
  if (kind === "file") return <FileCode className={cls} />
  if (kind === "bucket") return id === "bucket:branches" ? <GitBranch className={cls} /> : <Boxes className={cls} />
  return kind === "root" ? <Boxes className={cls} /> : <Folder className={cls} />
}

// ---------------------------------------------------------------------------
// Custom node
// ---------------------------------------------------------------------------

interface RotNodeData extends Record<string, unknown> {
  tree: TreeNode
  orientation: "TB" | "LR"
  collapsible: boolean
  collapsed: boolean
  selected: boolean
  highlighted: boolean
}

function RotNode({ data }: NodeProps<Node<RotNodeData>>) {
  const { tree, orientation, collapsible, collapsed, selected, highlighted } = data
  const accent = tree.worstSeverity ? ACCENT[tree.worstSeverity] : "border-l-border"
  const targetPos = orientation === "TB" ? Position.Top : Position.Left
  const sourcePos = orientation === "TB" ? Position.Bottom : Position.Right

  return (
    <div
      style={{ width: NODE_W }}
      className={cn(
        "rounded-md border border-l-4 bg-card px-2.5 py-2 shadow-sm transition-colors",
        accent,
        selected
          ? "ring-2 ring-primary"
          : highlighted
            ? "ring-2 ring-chart-3"
            : "hover:border-primary/40",
      )}
    >
      <Handle type="target" position={targetPos} className="!size-1.5 !border-0 !bg-border" />
      <div className="flex items-center gap-1.5">
        {collapsible &&
          (collapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
          ))}
        <KindIcon kind={tree.kind} id={tree.id} />
        <span className="min-w-0 flex-1 truncate font-mono text-xs" title={tree.path || tree.name}>
          {tree.name}
        </span>
      </div>
      <div className="mt-1.5 flex items-center gap-1 text-[10px]">
        {SEVERITIES.map((sev) =>
          tree.counts[sev] > 0 ? (
            <span
              key={sev}
              className={cn("rounded px-1 py-0.5 font-medium tabular-nums", CHIP[sev])}
              title={`${tree.counts[sev]} ${sev}`}
            >
              {tree.counts[sev]}
            </span>
          ) : null,
        )}
        {collapsed && tree.children.length > 0 && (
          <span className="ml-auto text-[10px] text-muted-foreground">{tree.children.length} hidden</span>
        )}
      </div>
      <Handle type="source" position={sourcePos} className="!size-1.5 !border-0 !bg-border" />
    </div>
  )
}

const nodeTypes = { rot: RotNode }

// ---------------------------------------------------------------------------
// Layout — a dependency-free tidy tree (parent centered over its children)
// ---------------------------------------------------------------------------

function layout(
  root: TreeNode,
  collapsed: Set<string>,
  orientation: "TB" | "LR",
  selectedId: string | null,
  matches: Set<string>,
): { nodes: Node<RotNodeData>[]; edges: Edge[] } {
  const isCollapsed = (n: TreeNode) => n.kind !== "root" && collapsed.has(n.id) && n.children.length > 0
  const cross = new Map<string, number>()
  let cursor = 0

  // Post-order: leaves take the next slot, parents center over their children.
  const place = (n: TreeNode) => {
    const kids = isCollapsed(n) ? [] : n.children
    if (kids.length) {
      kids.forEach(place)
      const a = cross.get(kids[0].id)!
      const b = cross.get(kids[kids.length - 1].id)!
      cross.set(n.id, (a + b) / 2)
    } else {
      cross.set(n.id, cursor++)
    }
  }
  place(root)

  const CROSS_GAP = orientation === "TB" ? NODE_W + 28 : 78
  const MAIN_GAP = orientation === "TB" ? 116 : NODE_W + 64

  const nodes: Node<RotNodeData>[] = []
  const edges: Edge[] = []
  const emit = (n: TreeNode, parentId: string | null) => {
    const c = cross.get(n.id)! * CROSS_GAP
    const m = n.depth * MAIN_GAP
    nodes.push({
      id: n.id,
      type: "rot",
      position: orientation === "TB" ? { x: c, y: m } : { x: m, y: c },
      data: {
        tree: n,
        orientation,
        collapsible: (n.kind === "dir" || n.kind === "bucket") && n.children.length > 0,
        collapsed: collapsed.has(n.id),
        selected: n.id === selectedId,
        highlighted: matches.has(n.id),
      },
    })
    if (parentId) {
      edges.push({
        id: `${parentId}->${n.id}`,
        source: parentId,
        target: n.id,
        type: "smoothstep",
        style: { stroke: "var(--border)", strokeWidth: 1.5 },
      })
    }
    if (!isCollapsed(n)) n.children.forEach((child) => emit(child, n.id))
  }
  emit(root, null)
  return { nodes, edges }
}

/** Collapse everything below depth 1 — keeps a large tree readable on first paint. */
function defaultCollapsed(root: TreeNode): Set<string> {
  const set = new Set<string>()
  const walk = (n: TreeNode) => {
    if (n.depth >= 1 && n.children.length > 0) set.add(n.id)
    n.children.forEach(walk)
  }
  walk(root)
  return set
}

function downloadDataUrl(dataUrl: string, name: string): void {
  const a = document.createElement("a")
  a.download = name
  a.href = dataUrl
  a.click()
}

// ---------------------------------------------------------------------------
// Detail card (in-canvas, info duplicated from the issues table/drawer)
// ---------------------------------------------------------------------------

function NodeDetail({
  node,
  githubFor,
  onClose,
  onViewInIssues,
}: {
  node: TreeNode
  githubFor: (file: string) => string | null
  onClose: () => void
  onViewInIssues: (node: TreeNode) => void
}) {
  const ghUrl = node.kind === "file" ? githubFor(node.path) : null
  return (
    <div className="absolute right-3 top-3 z-10 flex max-h-[calc(100%-1.5rem)] w-80 flex-col rounded-lg border border-border bg-card shadow-lg">
      <div className="flex items-start justify-between gap-2 border-b border-border p-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <KindIcon kind={node.kind} id={node.id} />
            <span className="truncate font-mono text-xs" title={node.path || node.name}>
              {node.name}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {node.issues.length} finding{node.issues.length === 1 ? "" : "s"}
          </p>
        </div>
        <Button size="icon" variant="ghost" className="size-6 shrink-0" onClick={onClose} title="Close">
          <X className="size-3.5" />
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {node.issues.map((issue) => (
          <div key={issue.id} className="rounded-md border border-border/60 bg-background/40 p-2">
            <div className="flex items-center gap-1.5">
              <span className={cn("rounded px-1 py-0.5 text-[10px] font-medium", CHIP[issue.severity])}>
                {severityLabels[issue.severity]}
              </span>
              <span className="text-[10px] text-muted-foreground">{categoryLabels[issue.category]}</span>
            </div>
            <p className="mt-1 text-xs font-medium leading-snug text-foreground">{issue.title}</p>
            <p className="mt-0.5 break-all font-mono text-[10px] text-muted-foreground">{issue.location}</p>
            {issue.detail && <p className="mt-1 text-[11px] leading-relaxed text-foreground/80">{issue.detail}</p>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1 border-t border-border p-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => onViewInIssues(node)}
        >
          <ListFilter className="size-3.5" />
          View in Issues
        </Button>
        {ghUrl && (
          <Button
            asChild
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            <a href={ghUrl} target="_blank" rel="noopener noreferrer">
              <Github className="size-3.5" />
              GitHub
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inner component (inside ReactFlowProvider so it can use the flow instance)
// ---------------------------------------------------------------------------

interface TreeRepo {
  owner: string
  name: string
  url?: string
  commit?: string
  defaultBranch?: string
}

interface RepoTreeProps {
  issues: Issue[]
  weights?: SeverityWeights
  repo: TreeRepo
  /** Switch to the Issues tab filtered to a file (empty string = no filter). */
  onViewInIssues: (file: string) => void
}

function RepoTreeInner({ issues, weights, repo, onViewInIssues }: RepoTreeProps) {
  const { resolvedTheme } = useTheme()
  const { fitView, getNodes } = useReactFlow()
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Severity filter — toggle a severity off to drop those findings (and any node
  // that only held them) from the map.
  const [active, setActive] = useState<Set<Severity>>(() => new Set(SEVERITIES))
  const severityTotals = useMemo(() => {
    const t: Record<Severity, number> = { critical: 0, warning: 0, info: 0 }
    for (const i of issues) t[i.severity]++
    return t
  }, [issues])
  const filteredIssues = useMemo(() => issues.filter((i) => active.has(i.severity)), [issues, active])

  const root = useMemo(
    () => buildFileTree(filteredIssues, weights, { rootLabel: `${repo.owner}/${repo.name}` }),
    [filteredIssues, weights, repo.owner, repo.name],
  )
  const total = useMemo(() => countNodes(root), [root])
  const orientation: "TB" | "LR" = total > HORIZONTAL_THRESHOLD ? "LR" : "TB"

  const [collapsed, setCollapsed] = useState<Set<string>>(() =>
    total > HORIZONTAL_THRESHOLD ? defaultCollapsed(root) : new Set(),
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState("")

  const searchResult = useMemo(() => searchTree(root, query), [root, query])

  // Reveal the ancestors of any search match so the matches become visible.
  useEffect(() => {
    if (searchResult.expand.size === 0) return
    setCollapsed((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of searchResult.expand) if (next.delete(id)) changed = true
      return changed ? next : prev
    })
  }, [searchResult])

  const nodeById = useMemo(() => {
    const m = new Map<string, TreeNode>()
    const walk = (n: TreeNode) => {
      m.set(n.id, n)
      n.children.forEach(walk)
    }
    walk(root)
    return m
  }, [root])

  const { nodes, edges } = useMemo(
    () => layout(root, collapsed, orientation, selectedId, searchResult.matches),
    [root, collapsed, orientation, selectedId, searchResult.matches],
  )

  // Pan/zoom to the first match once it's actually present in the rendered nodes.
  useEffect(() => {
    const id = searchResult.focusId
    if (!id || !nodes.some((n) => n.id === id)) return
    fitView({ nodes: [{ id }], duration: 500, padding: 0.4, maxZoom: 1.3 })
  }, [searchResult.focusId, nodes, fitView])

  const onNodeClick = useCallback(
    (_: unknown, rfNode: Node) => {
      const tn = nodeById.get(rfNode.id)
      if (!tn) return
      if ((tn.kind === "dir" || tn.kind === "bucket") && tn.children.length > 0) {
        setCollapsed((prev) => {
          const next = new Set(prev)
          if (next.has(tn.id)) next.delete(tn.id)
          else next.add(tn.id)
          return next
        })
      } else if (tn.issues.length > 0) {
        setSelectedId(tn.id)
      }
    },
    [nodeById],
  )

  const githubFor = useCallback(
    (file: string) => githubFileUrl(repo.url, repo.commit, repo.defaultBranch, file),
    [repo.url, repo.commit, repo.defaultBranch],
  )

  const toggleSeverity = (sev: Severity) =>
    setActive((prev) => {
      const next = new Set(prev)
      if (next.has(sev)) next.delete(sev)
      else next.add(sev)
      return next
    })

  const collapseAll = useCallback(() => setCollapsed(new Set(collapsibleIds(root))), [root])
  const expandAll = useCallback(() => setCollapsed(new Set()), [])

  const exportImage = useCallback(
    (format: "png" | "svg") => {
      const flowNodes = getNodes()
      if (flowNodes.length === 0) return
      const bounds = getNodesBounds(flowNodes)
      const width = Math.min(4096, Math.ceil(bounds.width) + 80)
      const height = Math.min(4096, Math.ceil(bounds.height) + 80)
      const vp = getViewportForBounds(bounds, width, height, 0.2, 2, 0.1)
      const el = wrapperRef.current?.querySelector(".react-flow__viewport") as HTMLElement | null
      if (!el) return
      const opts = {
        backgroundColor: resolvedTheme === "dark" ? "#0a0a0a" : "#ffffff",
        width,
        height,
        style: {
          width: `${width}px`,
          height: `${height}px`,
          transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
        },
      }
      const render = format === "png" ? toPng : toSvg
      render(el, opts)
        .then((dataUrl) => downloadDataUrl(dataUrl, `${repo.owner}-${repo.name}-map.${format}`))
        .catch(() => {
          /* export is best-effort */
        })
    },
    [getNodes, resolvedTheme, repo.owner, repo.name],
  )

  const selected = selectedId ? nodeById.get(selectedId) : null
  const empty = root.children.length === 0

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          {SEVERITIES.map((sev) => {
            const on = active.has(sev)
            return (
              <button
                key={sev}
                type="button"
                onClick={() => toggleSeverity(sev)}
                title={on ? `Hide ${sev}` : `Show ${sev}`}
                className={cn(
                  "flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium transition",
                  on ? cn(CHIP[sev], "border-transparent") : "border-border text-muted-foreground opacity-50 hover:opacity-100",
                )}
              >
                <span className={cn("size-1.5 rounded-full", DOT[sev])} />
                {severityLabels[sev]}
                <span className="tabular-nums">{severityTotals[sev]}</span>
              </button>
            )
          })}
        </div>

        <div className="relative ml-auto w-full sm:w-56">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a file or folder…"
            className="h-8 pl-8 text-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              title="Clear"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2 text-xs" onClick={expandAll} title="Expand all">
            <Maximize2 className="size-3.5" />
            <span className="hidden sm:inline">Expand</span>
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2 text-xs" onClick={collapseAll} title="Collapse all">
            <Minimize2 className="size-3.5" />
            <span className="hidden sm:inline">Collapse</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2 text-xs" disabled={empty} title="Export map">
                <Download className="size-3.5" />
                <span className="hidden sm:inline">Export</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => exportImage("png")}>
                <ImageDown className="size-4" />
                Export as PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => exportImage("svg")}>
                <Code className="size-4" />
                Export as SVG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Canvas */}
      <div ref={wrapperRef} className="relative h-[600px] w-full overflow-hidden rounded-lg border border-border bg-background">
        {empty ? (
          <div className="flex h-full flex-col items-center justify-center text-center">
            <Boxes className="size-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Nothing to map</p>
            <p className="mt-1 max-w-xs text-xs text-muted-foreground">
              No findings match the active severity filters — adjust them above, or the last scan was clean.
            </p>
          </div>
        ) : (
          <>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              colorMode={(resolvedTheme as "light" | "dark") ?? "light"}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              minZoom={0.2}
              nodesConnectable={false}
              edgesFocusable={false}
              proOptions={{ hideAttribution: true }}
            >
              <Background gap={20} className="opacity-50" />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable className="!bg-card" nodeColor={() => "var(--muted-foreground)"} />
            </ReactFlow>

            {/* Legend */}
            <div className="pointer-events-none absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-card/90 px-3 py-1 text-[10px] text-muted-foreground shadow-sm backdrop-blur">
              {SEVERITIES.map((sev) => (
                <span key={sev} className="flex items-center gap-1">
                  <span className={cn("size-2 rounded-full", DOT[sev])} />
                  {severityLabels[sev]}
                </span>
              ))}
            </div>

            {selected && (
              <NodeDetail
                node={selected}
                githubFor={githubFor}
                onClose={() => setSelectedId(null)}
                onViewInIssues={(n) => {
                  onViewInIssues(n.kind === "file" ? n.path : "")
                  setSelectedId(null)
                }}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

export function RepoTree(props: RepoTreeProps) {
  return (
    <ReactFlowProvider>
      <RepoTreeInner {...props} />
    </ReactFlowProvider>
  )
}
