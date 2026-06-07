import { describe, it, expect } from "vitest"
import {
  buildFileTree,
  countNodes,
  flattenTree,
  collapsibleIds,
  searchTree,
  type TreeNode,
} from "@/lib/file-tree"
import { DEFAULT_WEIGHTS } from "@/lib/score"
import { issue } from "./helpers"

/** Find a node by id anywhere in the tree. */
function find(root: TreeNode, id: string): TreeNode | undefined {
  return flattenTree(root).find((n) => n.id === id)
}

describe("buildFileTree", () => {
  it("returns a lone root for no findings", () => {
    const root = buildFileTree([])
    expect(root.kind).toBe("root")
    expect(root.children).toEqual([])
    expect(root.counts).toEqual({ critical: 0, warning: 0, info: 0 })
    expect(root.worstSeverity).toBeNull()
    expect(countNodes(root)).toBe(1)
  })

  it("uses the root label when provided", () => {
    expect(buildFileTree([], DEFAULT_WEIGHTS, { rootLabel: "acme/widget" }).name).toBe("acme/widget")
  })

  it("nests a file under its directory", () => {
    const root = buildFileTree([issue({ location: "lib/payments.ts:14" })])
    const dir = root.children[0]
    expect(dir).toMatchObject({ kind: "dir", name: "lib", path: "lib" })
    const file = dir.children[0]
    expect(file).toMatchObject({ kind: "file", name: "payments.ts", path: "lib/payments.ts" })
    expect(file.issues).toHaveLength(1)
  })

  it("normalizes Windows-style backslash paths to POSIX", () => {
    const root = buildFileTree([issue({ location: "lib\\win\\a.ts:3" })])
    const file = find(root, "lib/win/a.ts")
    expect(file).toMatchObject({ kind: "file", name: "a.ts", path: "lib/win/a.ts" })
  })

  it("treats a repo-level path as a file at the root", () => {
    const root = buildFileTree([issue({ location: "package.json" })])
    expect(root.children[0]).toMatchObject({ kind: "file", name: "package.json", path: "package.json" })
  })

  it("groups several findings on one file", () => {
    const root = buildFileTree([
      issue({ id: "a", location: "lib/x.ts:1" }),
      issue({ id: "b", location: "lib/x.ts:9" }),
    ])
    expect(find(root, "lib/x.ts")?.issues).toHaveLength(2)
  })

  it("compresses a linear single-child directory chain", () => {
    const root = buildFileTree([issue({ location: "src/legacy/handler.js:2" })])
    const dir = root.children[0]
    expect(dir).toMatchObject({ kind: "dir", name: "src/legacy", path: "src/legacy" })
    expect(dir.children[0]).toMatchObject({ kind: "file", name: "handler.js" })
  })

  it("does not compress a directory with multiple children", () => {
    const root = buildFileTree([
      issue({ id: "a", location: "src/a.ts:1" }),
      issue({ id: "b", location: "src/b.ts:1" }),
    ])
    const dir = root.children[0]
    expect(dir.name).toBe("src")
    expect(dir.children).toHaveLength(2)
  })
})

describe("aggregation", () => {
  it("rolls counts, weight and worst-severity up to ancestors", () => {
    const root = buildFileTree([
      issue({ severity: "critical", location: "lib/deep/a.ts:1" }),
      issue({ severity: "warning", location: "lib/deep/a.ts:2" }),
      issue({ severity: "info", location: "lib/b.ts:1" }),
    ])
    expect(root.counts).toEqual({ critical: 1, warning: 1, info: 1 })
    expect(root.worstSeverity).toBe("critical")
    expect(root.weight).toBe(DEFAULT_WEIGHTS.critical + DEFAULT_WEIGHTS.warning + DEFAULT_WEIGHTS.info)

    const file = find(root, "lib/deep/a.ts")!
    expect(file.counts).toEqual({ critical: 1, warning: 1, info: 0 })
    expect(file.worstSeverity).toBe("critical")
  })

  it("sorts a node's own issues worst-first", () => {
    const file = find(
      buildFileTree([
        issue({ id: "info", severity: "info", location: "f.ts:1" }),
        issue({ id: "crit", severity: "critical", location: "f.ts:2" }),
      ]),
      "f.ts",
    )!
    expect(file.issues.map((i) => i.severity)).toEqual(["critical", "info"])
  })
})

describe("non-file findings", () => {
  it("buckets branch refs under Branches", () => {
    const root = buildFileTree([issue({ category: "branch", location: "origin/feature/x" })])
    const bucket = root.children.find((c) => c.id === "bucket:branches")
    expect(bucket?.name).toBe("Branches")
    expect(bucket?.issues).toHaveLength(1)
  })

  it("buckets repo-wide globs under Repository", () => {
    const root = buildFileTree([issue({ location: "src/**" })])
    expect(root.children.find((c) => c.id === "bucket:repository")?.issues).toHaveLength(1)
  })
})

describe("ordering", () => {
  it("ranks children worst-weight first and sinks buckets to the end", () => {
    const root = buildFileTree([
      issue({ severity: "info", location: "light.ts:1" }),
      issue({ severity: "critical", location: "heavy.ts:1" }),
      issue({ category: "branch", severity: "critical", location: "origin/x" }),
    ])
    expect(root.children.map((c) => c.id)).toEqual(["heavy.ts", "light.ts", "bucket:branches"])
  })
})

describe("collapsibleIds", () => {
  it("lists directories with children, never files or leaf buckets", () => {
    const root = buildFileTree([
      issue({ id: "a", location: "lib/deep/a.ts:1" }),
      issue({ id: "b", category: "branch", location: "origin/x" }),
    ])
    const ids = collapsibleIds(root)
    expect(ids).toContain("dir:lib/deep") // compressed dir with a file child
    // buckets hold issues directly (no child nodes) → not collapsible
    expect(ids).not.toContain("bucket:branches")
    // files are never collapsible
    expect(ids).not.toContain("lib/deep/a.ts")
  })
})

describe("searchTree", () => {
  const tree = () =>
    buildFileTree([
      issue({ id: "a", location: "lib/payments.ts:1" }),
      issue({ id: "b", location: "src/utils/date.ts:1" }),
    ])

  it("returns empty results for a blank query", () => {
    const r = searchTree(tree(), "   ")
    expect(r.matches.size).toBe(0)
    expect(r.focusId).toBeNull()
  })

  it("matches by path substring and expands the ancestors", () => {
    const r = searchTree(tree(), "payments")
    expect(r.matches.has("lib/payments.ts")).toBe(true)
    expect(r.expand.has("dir:lib")).toBe(true) // ancestor revealed
    expect(r.focusId).toBe("lib/payments.ts")
  })

  it("is case-insensitive and can match a directory name", () => {
    const r = searchTree(tree(), "SRC")
    // "src/utils" is one compressed node whose path contains "src"
    expect([...r.matches].some((id) => id.includes("src"))).toBe(true)
  })

  it("focuses the first match in pre-order (parent before child)", () => {
    const root = buildFileTree([issue({ location: "app/app.ts:1" })])
    // both the "app" dir and "app.ts" contain "app"; the dir comes first
    expect(searchTree(root, "app").focusId).toBe("dir:app")
  })

  it("finds nothing for a non-matching query", () => {
    expect(searchTree(tree(), "kubernetes").matches.size).toBe(0)
  })
})

describe("countNodes / flattenTree", () => {
  it("counts every node including the root", () => {
    // root + dir(lib) + file(a.ts) + file(b.ts) = 4
    const root = buildFileTree([
      issue({ id: "a", location: "lib/a.ts:1" }),
      issue({ id: "b", location: "lib/b.ts:1" }),
    ])
    expect(countNodes(root)).toBe(4)
    expect(flattenTree(root)).toHaveLength(4)
  })
})
