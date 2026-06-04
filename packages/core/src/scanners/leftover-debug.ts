import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"
import { parseFile, walk, type Node } from "../ast"

/**
 * Leftover Debug scanner.
 *
 * Flags debugging statements that were meant to be temporary but got committed:
 *  - `debugger;` statements
 *  - noisy `console.*` calls (log/debug/trace/dir/table)
 *
 * Intentionally does NOT flag `console.error` / `console.warn` / `console.info` —
 * those are commonly legitimate logging. Test files are excluded (debug output
 * there is fine), and results are capped per-file and overall so one chatty file
 * can't flood the report. Severity is info: low risk, easy to clean up.
 */

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/
const TEST_RE = /(^|\/)(__tests__\/|test\/|tests\/|spec\/)|\.(test|spec)\.[cm]?[jt]sx?$/i
const DEBUG_METHODS = new Set(["log", "debug", "trace", "dir", "table"])

const MAX_PER_FILE = 8
const MAX_TOTAL = 50

function lineOf(node: Node): number {
  const loc = node.loc as { start?: { line?: number } } | undefined
  return loc?.start?.line ?? 0
}

/** Is this node a `console.<method>(...)` call we care about? */
function debugLabel(node: Node): string | null {
  if (node.type === "DebuggerStatement") return "debugger"
  if (node.type !== "CallExpression") return null
  const callee = node.callee as Node | undefined
  if (!callee || callee.type !== "MemberExpression") return null
  const obj = callee.object as { type?: string; name?: string } | undefined
  const prop = callee.property as { type?: string; name?: string } | undefined
  if (obj?.type !== "Identifier" || obj.name !== "console") return null
  if (prop?.type !== "Identifier" || !prop.name || !DEBUG_METHODS.has(prop.name)) return null
  return `console.${prop.name}`
}

export const leftoverDebugScanner: Scanner = {
  id: "leftover-debug",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (!SOURCE_RE.test(norm) || TEST_RE.test(norm)) continue

      const content = await ctx.readFile(file)
      if (!content) continue
      // Cheap pre-filter: skip files with no debug tokens at all.
      if (!content.includes("console.") && !content.includes("debugger")) continue

      const ast = parseFile(content, file)
      if (!ast) continue

      let perFile = 0
      const found: { line: number; label: string }[] = []
      walk(ast, (n) => {
        if (perFile >= MAX_PER_FILE) return
        const label = debugLabel(n)
        if (!label) return
        found.push({ line: lineOf(n), label })
        perFile++
      })

      for (const { line, label } of found) {
        if (issues.length >= MAX_TOTAL) break
        issues.push({
          id: `debug-${norm}:${line}`,
          category: "hygiene",
          severity: "info",
          title: `Leftover ${label} in source`,
          location: line ? `${norm}:${line}` : norm,
          ageDays: 0,
          detail:
            label === "debugger"
              ? "A `debugger` statement is committed in source — remove it before shipping."
              : `A \`${label}\` call is committed in source. If it was for debugging, remove it; ` +
                "for real logging prefer a logger or console.error/warn.",
          evidence: label === "debugger" ? "debugger" : `${label}(…)`,
        })
      }
    }

    return issues
  },
}
