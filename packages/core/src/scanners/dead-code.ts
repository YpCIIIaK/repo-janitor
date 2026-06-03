import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"
import { type Node, parseFile, walk } from "../ast"

/**
 * Dead Code scanner (conservative).
 *
 * Flags exported **values** (const/function/class) that are never imported or
 * re-exported anywhere in the project — "unused exports". This is the most
 * false-positive-prone scanner, so it leans hard toward silence:
 *
 *  - default exports are ignored (no stable name to track references by)
 *  - type-only exports (interface/type) are ignored — public types look unused
 *  - `index.*` barrels are treated as the public API and never flagged
 *  - any module that is namespace-imported (`import * as x`) or star-re-exported
 *    (`export * from`) is fully exempt — we can't prove its members are unused
 *  - name collisions resolve toward "used" (a miss), never toward a false flag
 *
 * Severity is always `info`. For a precise reference graph, swap in ts-morph/knip.
 */
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/
const EXT_CANDIDATES = ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"]
const INDEX_CANDIDATES = ["/index.ts", "/index.tsx", "/index.js", "/index.jsx", "/index.mjs"]

/**
 * Exports consumed by a framework/tooling convention rather than by an `import`,
 * so they look unused to a reference graph. Flagging them is a false positive.
 *  - Next.js route segment config + metadata + Route Handlers
 *  - default is handled separately (never flagged)
 */
const CONVENTION_EXPORTS = new Set([
  // Next.js metadata / segment config
  "metadata", "generateMetadata", "viewport", "generateViewport",
  "generateStaticParams", "dynamic", "dynamicParams", "revalidate",
  "fetchCache", "runtime", "preferredRegion", "maxDuration", "config", "middleware",
  // Route Handler HTTP verbs
  "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
])

/**
 * Popular component kits (shadcn/ui & friends) install their *entire* catalog
 * into a directory like `components/ui/`, but apps only use a handful. Reporting
 * each unused primitive as its own issue floods the report and tanks the score
 * with code the team never wrote and won't prune. We instead collapse all dead
 * exports under such a directory into ONE informational note (see emit loop).
 *
 * Returns the kit root (e.g. "src/components/ui") if the file lives in one, else null.
 */
function uiKitRoot(file: string): string | null {
  const m = file.match(/^(.*?\bcomponents\/(?:ui|magicui|aceternity))(?:\/|$)/)
  return m ? m[1] : null
}

interface ExportSite {
  name: string
  file: string
  line: number
  code?: string
}

/** Normalize a "/"-separated path, collapsing "." and ".." segments. */
function normalize(path: string): string {
  const out: string[] = []
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") out.pop()
    else out.push(seg)
  }
  return out.join("/")
}

function dirname(file: string): string {
  const i = file.lastIndexOf("/")
  return i === -1 ? "" : file.slice(0, i)
}

/** Resolve a relative import specifier to a project file, or null if external/unresolved. */
function resolveModule(spec: string, fromFile: string, fileSet: Set<string>): string | null {
  if (!spec.startsWith(".")) return null
  const base = normalize(`${dirname(fromFile)}/${spec}`)
  for (const ext of EXT_CANDIDATES) {
    if (fileSet.has(base + ext)) return base + ext
  }
  for (const idx of INDEX_CANDIDATES) {
    if (fileSet.has(base + idx)) return base + idx
  }
  return null
}

function isType(decl: Node | undefined): boolean {
  const t = decl?.type
  return (
    t === "TSInterfaceDeclaration" ||
    t === "TSTypeAliasDeclaration" ||
    t === "TSModuleDeclaration"
  )
}

export const deadCodeScanner: Scanner = {
  id: "dead-code",
  category: "dead-code",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const sources = ctx.files.filter((f) => SOURCE_RE.test(f))
    if (sources.length < 2) return [] // single-file projects: nothing meaningful to graph

    const fileSet = new Set(sources)
    const exports: ExportSite[] = []
    const usedNames = new Set<string>() // names imported / re-exported anywhere
    const exemptFiles = new Set<string>() // namespace-imported or star-re-exported modules

    for (const file of sources) {
      const content = await ctx.readFile(file)
      if (!content) continue
      const ast = parseFile(content, file)
      if (!ast) continue
      const isBarrel = /(^|\/)index\.[a-z]+$/.test(file)
      const srcLines = content.split("\n")
      // Capture a small block of context, not just the signature line: a leading
      // comment (JSDoc strongly implies a public API) plus the declaration's first
      // few lines. This gives a human — and the optional AI pass — enough to judge
      // intent instead of guessing from one line.
      const snip = (n: Node) => {
        const start = lineOf(n) // 1-based
        if (start < 1) return undefined

        // Leading comment block directly above the export, if any.
        const lead: string[] = []
        for (let i = start - 2; i >= 0 && lead.length < 6; i--) {
          const t = srcLines[i]?.trim() ?? ""
          if (t === "") break
          if (t.startsWith("*") || t.startsWith("/*") || t.startsWith("*/") || t.startsWith("//")) {
            lead.unshift(srcLines[i])
          } else break
        }

        // Declaration body: stop when braces balance (function/class) or at the
        // end of a simple `const x = …` statement.
        const body: string[] = []
        let depth = 0
        let sawBrace = false
        for (let i = start - 1; i < srcLines.length && body.length < 12; i++) {
          const raw = srcLines[i] ?? ""
          body.push(raw)
          for (const ch of raw) {
            if (ch === "{") { depth++; sawBrace = true }
            else if (ch === "}") depth--
          }
          if (sawBrace && depth <= 0) break
          if (!sawBrace && raw.trim().endsWith(";")) break
        }

        let out = [...lead, ...body].join("\n").replace(/\s+$/, "")
        if (out.length > 600) out = out.slice(0, 597) + "…"
        return out.trim() || undefined
      }

      walk(ast, (node) => {
        // --- references that mark an export as "used" ---
        if (node.type === "ImportDeclaration") {
          for (const spec of (node.specifiers as Node[]) ?? []) {
            if (spec.type === "ImportSpecifier") {
              const imported = spec.imported as Node
              const name = imported?.type === "Identifier" ? (imported.name as string) : (imported?.value as string)
              if (name) usedNames.add(name)
            } else if (spec.type === "ImportNamespaceSpecifier") {
              const target = resolveModule((node.source as Node)?.value as string, file, fileSet)
              if (target) exemptFiles.add(target)
            }
          }
          return
        }
        if (node.type === "ExportAllDeclaration") {
          const target = resolveModule((node.source as Node)?.value as string, file, fileSet)
          if (target) exemptFiles.add(target)
          return
        }
        if (node.type === "ExportNamedDeclaration" && node.source) {
          // re-export: `export { a, b } from './m'` → those names are used
          for (const spec of (node.specifiers as Node[]) ?? []) {
            const local = (spec.local as Node) ?? (spec.exported as Node)
            if (local?.type === "Identifier") usedNames.add(local.name as string)
          }
          return
        }

        // --- export origins we might flag (skip barrels) ---
        if (node.type === "ExportNamedDeclaration" && !node.source) {
          const decl = node.declaration as Node | undefined
          if (decl && !isType(decl) && !isBarrel) {
            if (decl.type === "FunctionDeclaration" || decl.type === "ClassDeclaration") {
              const id = decl.id as Node
              if (id?.type === "Identifier") exports.push({ name: id.name as string, file, line: lineOf(node), code: snip(node) })
            } else if (decl.type === "VariableDeclaration") {
              for (const d of (decl.declarations as Node[]) ?? []) {
                const id = d.id as Node
                if (id?.type === "Identifier") exports.push({ name: id.name as string, file, line: lineOf(node), code: snip(node) })
              }
            }
          }
          // `export { x, y as z }` (no source) → exported names are the public surface
          if (!isBarrel) {
            for (const spec of (node.specifiers as Node[]) ?? []) {
              const exported = spec.exported as Node
              const name = exported?.type === "Identifier" ? (exported.name as string) : undefined
              if (name && name !== "default") exports.push({ name, file, line: lineOf(node), code: snip(node) })
            }
          }
        }
      })
    }

    // Total exports per file — used to tell a fully-unused kit component
    // ("you imported zero of it") from a partially-used one.
    const totalByFile = new Map<string, number>()
    for (const exp of exports) totalByFile.set(exp.file, (totalByFile.get(exp.file) ?? 0) + 1)

    const issues: Issue[] = []
    const kitDead = new Map<string, ExportSite[]>() // kit root → its dead exports

    for (const exp of exports) {
      if (exemptFiles.has(exp.file)) continue
      if (usedNames.has(exp.name)) continue
      if (CONVENTION_EXPORTS.has(exp.name)) continue // framework-consumed, not dead

      const kit = uiKitRoot(exp.file)
      if (kit) {
        // Defer to the per-kit summary instead of one issue per primitive.
        const bucket = kitDead.get(kit)
        if (bucket) bucket.push(exp)
        else kitDead.set(kit, [exp])
        continue
      }

      issues.push({
        id: `dead-export-${exp.file}:${exp.name}`,
        category: "dead-code",
        severity: "info",
        title: `Unused export ${exp.name}`,
        location: `${exp.file}:${exp.line}`,
        ageDays: 0,
        detail: `${exp.name} is exported from ${exp.file} but never imported or re-exported anywhere in the project. Verify before removing — dynamic usage can't be detected.`,
        evidence: exp.code,
      })
    }

    // One informational note per UI kit — keeps the finding without skewing the score.
    for (const [kit, dead] of kitDead) {
      const deadByFile = new Map<string, number>()
      for (const d of dead) deadByFile.set(d.file, (deadByFile.get(d.file) ?? 0) + 1)

      const fully: string[] = [] // components with zero used exports
      const partial: string[] = [] // components used, but with some dead exports
      for (const [file, n] of deadByFile) {
        const name = file.slice(kit.length + 1).replace(/\.(t|j)sx?$/, "")
        if (n === totalByFile.get(file)) fully.push(name)
        else partial.push(name)
      }
      fully.sort()
      partial.sort()

      const show = (list: string[], cap: number) =>
        list.length <= cap ? list.join(", ") : `${list.slice(0, cap).join(", ")} +${list.length - cap} more`

      const parts: string[] = [
        `${kit} looks like a bulk-installed UI kit (e.g. shadcn/ui): ${dead.length} exports across ${deadByFile.size} components are never imported.`,
      ]
      if (fully.length) parts.push(`Entirely unused: ${show(fully, 15)}.`)
      if (partial.length) parts.push(`Partially used (some unused exports): ${show(partial, 10)}.`)
      parts.push(`Reported as a single note so it doesn't skew the score — prune what you don't need, or ignore if you track the kit upstream.`)

      issues.push({
        id: `dead-code-uikit-${kit}`,
        category: "dead-code",
        severity: "info",
        title: `${dead.length} unused UI-kit exports in ${kit}`,
        location: kit,
        ageDays: 0,
        detail: parts.join(" "),
      })
    }

    return issues
  },
}

/** Best-effort 1-based line of a node from its loc. */
function lineOf(node: Node): number {
  const loc = node.loc as { start?: { line?: number } } | undefined
  return loc?.start?.line ?? 0
}
