import type { Issue, Severity } from "@/lib/mock-data"
import { DEFAULT_WEIGHTS, type SeverityWeights } from "@/lib/score"
import { locationToFile } from "@/lib/hotspots"

/**
 * Repository "rot tree" — the findings of one scan folded into a directory
 * hierarchy, so the visualization can show *where* decay concentrates.
 *
 * Crucially we only have the locations of findings, not a full file listing, so
 * the tree is built from the AFFECTED paths only. That keeps it honest (we never
 * invent files) and naturally uncluttered (clean parts of the repo simply don't
 * appear). Findings that don't resolve to a concrete file — stale branch refs
 * (`origin/...`) and repo-wide globs (`src/**`) — are collected into synthetic
 * "Branches" / "Repository" buckets hung off the root.
 *
 * Every node carries subtree-aggregated severity counts and the same weighted
 * penalty the health score uses, so the UI can color and rank by real impact.
 */

export type TreeNodeKind = "root" | "dir" | "file" | "bucket"

export interface TreeNode {
  /** Stable id: file path for files, `dir:<path>` for dirs, `bucket:<x>` / `root`. */
  id: string
  /** Display label — basename for files/dirs, the bucket/repo label otherwise. */
  name: string
  /** Full path from the root (`""` for the root). */
  path: string
  kind: TreeNodeKind
  children: TreeNode[]
  /** Findings attached directly to THIS node (files and buckets only). */
  issues: Issue[]
  /** Severity counts aggregated over the whole subtree (including this node). */
  counts: Record<Severity, number>
  /** Weighted penalty aggregated over the subtree (same weights as the score). */
  weight: number
  /** Worst severity anywhere in the subtree, or null when there are no findings. */
  worstSeverity: Severity | null
  /** Distance from the root (root = 0). */
  depth: number
}

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }

function emptyCounts(): Record<Severity, number> {
  return { critical: 0, warning: 0, info: 0 }
}

function makeNode(id: string, name: string, path: string, kind: TreeNodeKind): TreeNode {
  return {
    id,
    name,
    path,
    kind,
    children: [],
    issues: [],
    counts: emptyCounts(),
    weight: 0,
    worstSeverity: null,
    depth: 0,
  }
}

/** Normalize a path to forward slashes without a leading `./` or `/`. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\/+/, "")
}

/** Which synthetic bucket a non-file finding belongs to. */
function bucketFor(location: string): { id: string; name: string } {
  const head = location.split(" @ ")[0].trim()
  if (head.startsWith("origin/")) return { id: "bucket:branches", name: "Branches" }
  return { id: "bucket:repository", name: "Repository" }
}

/** Fold a linear chain of single-child directories into one node (`src` → `src/legacy`). */
function compress(node: TreeNode): void {
  for (const child of node.children) compress(child)
  while (node.kind === "dir" && node.children.length === 1 && node.children[0].kind === "dir") {
    const only = node.children[0]
    node.name = `${node.name}/${only.name}`
    node.path = only.path
    node.id = `dir:${only.path}`
    node.children = only.children
  }
}

/** Post-order pass: roll up counts/weight/worst-severity and stamp depth. */
function aggregate(node: TreeNode, weights: SeverityWeights, depth: number): void {
  node.depth = depth
  for (const child of node.children) aggregate(child, weights, depth + 1)

  const counts = emptyCounts()
  let weight = 0
  for (const issue of node.issues) {
    counts[issue.severity]++
    weight += weights[issue.severity]
  }
  for (const child of node.children) {
    counts.critical += child.counts.critical
    counts.warning += child.counts.warning
    counts.info += child.counts.info
    weight += child.weight
  }

  node.counts = counts
  node.weight = weight
  node.worstSeverity = counts.critical
    ? "critical"
    : counts.warning
      ? "warning"
      : counts.info
        ? "info"
        : null
  node.issues.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity])
}

/** Rank children worst-first; synthetic buckets always sink to the bottom. */
function sortTree(node: TreeNode): void {
  node.children.sort((a, b) => {
    const aBucket = a.kind === "bucket" ? 1 : 0
    const bBucket = b.kind === "bucket" ? 1 : 0
    if (aBucket !== bBucket) return aBucket - bBucket
    if (b.weight !== a.weight) return b.weight - a.weight
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1 // dirs before files on a tie
    return a.name.localeCompare(b.name)
  })
  for (const child of node.children) sortTree(child)
}

export interface BuildTreeOptions {
  /** Label for the root node (e.g. `owner/name`). Defaults to "repo". */
  rootLabel?: string
}

/**
 * Build the rot tree for a scan's findings. The returned root aggregates the
 * whole subtree, so a caller can read `root.counts` / `root.worstSeverity` for a
 * repo-level summary or walk `children` to render the hierarchy.
 */
export function buildFileTree(
  issues: Issue[],
  weights: SeverityWeights = DEFAULT_WEIGHTS,
  opts: BuildTreeOptions = {},
): TreeNode {
  const root = makeNode("root", opts.rootLabel ?? "repo", "", "root")
  const buckets = new Map<string, TreeNode>()

  for (const issue of issues) {
    const file = locationToFile(issue.location)
    if (file) {
      const segments = normalizePath(file).split("/").filter(Boolean)
      if (segments.length === 0) continue
      let parent = root
      let acc = ""
      segments.forEach((seg, i) => {
        acc = acc ? `${acc}/${seg}` : seg
        const isLeaf = i === segments.length - 1
        const kind: TreeNodeKind = isLeaf ? "file" : "dir"
        const id = isLeaf ? acc : `dir:${acc}`
        let child = parent.children.find((c) => c.id === id)
        if (!child) {
          child = makeNode(id, seg, acc, kind)
          parent.children.push(child)
        }
        parent = child
      })
      parent.issues.push(issue)
    } else {
      const b = bucketFor(issue.location)
      let bucket = buckets.get(b.id)
      if (!bucket) {
        bucket = makeNode(b.id, b.name, b.name, "bucket")
        buckets.set(b.id, bucket)
        root.children.push(bucket)
      }
      bucket.issues.push(issue)
    }
  }

  compress(root)
  aggregate(root, weights, 0)
  sortTree(root)
  return root
}

/** Total node count including the root — used to pick the tree's orientation. */
export function countNodes(node: TreeNode): number {
  return 1 + node.children.reduce((sum, c) => sum + countNodes(c), 0)
}

/** Depth-first flatten (root first), handy for tests and list rendering. */
export function flattenTree(node: TreeNode): TreeNode[] {
  return [node, ...node.children.flatMap(flattenTree)]
}

/** Every directory/bucket id that has children — the set "collapse all" toggles. */
export function collapsibleIds(node: TreeNode): string[] {
  const ids: string[] = []
  const walk = (n: TreeNode) => {
    if ((n.kind === "dir" || n.kind === "bucket") && n.children.length > 0) ids.push(n.id)
    n.children.forEach(walk)
  }
  walk(node)
  return ids
}

export interface TreeSearch {
  /** Ids of nodes whose path or name matches the query. */
  matches: Set<string>
  /** Ancestor ids that must be expanded to reveal the matches. */
  expand: Set<string>
  /** First match in pre-order, to pan/zoom the view to — null when nothing matches. */
  focusId: string | null
}

/**
 * Find nodes matching a free-text query (case-insensitive substring over path
 * and name). Returns the match set, the ancestors to expand so matches are
 * visible, and a single focus target. Pure — the view drives collapse/pan from it.
 */
export function searchTree(root: TreeNode, query: string): TreeSearch {
  const q = query.trim().toLowerCase()
  const result: TreeSearch = { matches: new Set(), expand: new Set(), focusId: null }
  if (!q) return result

  const walk = (node: TreeNode, ancestors: string[]) => {
    if (node.kind !== "root" && `${node.path}\n${node.name}`.toLowerCase().includes(q)) {
      result.matches.add(node.id)
      for (const a of ancestors) result.expand.add(a)
      if (result.focusId === null) result.focusId = node.id
    }
    const nextAncestors = node.kind === "root" ? ancestors : [...ancestors, node.id]
    node.children.forEach((child) => walk(child, nextAncestors))
  }
  walk(root, [])
  return result
}
