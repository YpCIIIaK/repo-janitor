import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"
import { type Node, parseFile, walk } from "../ast"

/**
 * Skipped / Focused Tests scanner.
 *
 * Disabled and focused tests are quietly rotting coverage:
 *  - **focused** (`describe.only`, `it.only`, `fit`, `fdescribe`) — *worse than
 *    skipping*: it silently disables every other test in the file, so CI can stay
 *    green while almost nothing runs. Flagged as a warning.
 *  - **skipped** (`it.skip`, `xit`, `xdescribe`, `it.todo`, pytest `@skip`) — a
 *    test that no longer runs. Flagged as info.
 *
 * JS/TS is analysed via the AST so a marker mentioned inside a STRING (e.g. a
 * scanner's own test fixture: `"describe.only('x')"`) is not mistaken for a real
 * focused test. If a file can't be parsed we fall back to the line regex. Python
 * stays line-based. Findings carry a `file:line` location; capped per-file/overall.
 */

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts|py)$/
const JS_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/
const MAX_PER_FILE = 10
const MAX_TOTAL = 60

interface Hit {
  severity: Severity
  label: string
}

// Hosts that take `.only` / `.skip` modifiers in the common runners.
const HOSTS = new Set(["describe", "it", "test", "context", "suite"])

/** Classify a JS/TS call node as a focused/skipped test, or null. */
function jsHit(node: Node): Hit | null {
  if (node.type !== "CallExpression" && node.type !== "OptionalCallExpression") return null
  const callee = node.callee as Node | undefined
  if (!callee) return null

  if ((callee.type === "MemberExpression" || callee.type === "OptionalMemberExpression") && !callee.computed) {
    const obj = callee.object as { type?: string; name?: string } | undefined
    const prop = callee.property as { type?: string; name?: string } | undefined
    if (obj?.type !== "Identifier" || prop?.type !== "Identifier") return null
    const host = obj.name ?? ""
    const mod = prop.name
    if (mod === "only" && HOSTS.has(host)) return { severity: "warning", label: "focused test (.only)" }
    if (mod === "skip" && HOSTS.has(host)) return { severity: "info", label: "skipped test (.skip)" }
    if (mod === "todo" && (host === "it" || host === "test"))
      return { severity: "info", label: "unimplemented test (.todo)" }
    return null
  }

  if (callee.type === "Identifier") {
    const name = (callee as { name?: string }).name ?? ""
    if (/^f(?:it|describe|test)$/.test(name)) return { severity: "warning", label: "focused test (fit/fdescribe)" }
    if (/^x(?:it|describe|test|context)$/.test(name)) return { severity: "info", label: "skipped test (xit/xdescribe)" }
  }
  return null
}

interface Rule {
  re: RegExp
  severity: Severity
  label: string
}

// Line-regex rules for the JS fallback (unparseable files) and Python.
const JS_RULES: Rule[] = [
  { re: /\b(?:describe|it|test|context|suite)\.only\s*\(/, severity: "warning", label: "focused test (.only)" },
  { re: /\bf(?:it|describe|test)\s*\(/, severity: "warning", label: "focused test (fit/fdescribe)" },
  { re: /\b(?:describe|it|test|context|suite)\.skip\s*\(/, severity: "info", label: "skipped test (.skip)" },
  { re: /\bx(?:it|describe|test|context)\s*\(/, severity: "info", label: "skipped test (xit/xdescribe)" },
  { re: /\b(?:it|test)\.todo\s*\(/, severity: "info", label: "unimplemented test (.todo)" },
]
const PY_RULES: Rule[] = [
  { re: /@(?:pytest\.mark\.skip|unittest\.skip)\b/, severity: "info", label: "skipped test (@skip)" },
  { re: /\b(?:self\.skipTest|pytest\.skip)\s*\(/, severity: "info", label: "skipped test (skip call)" },
]

const PREFILTER =
  /\.(?:only|skip|todo)\s*\(|\bf(?:it|describe|test)\s*\(|\bx(?:it|describe|test|context)\s*\(|@(?:pytest\.mark\.skip|unittest\.skip)|skipTest|pytest\.skip/

function lineOf(node: Node): number {
  const loc = node.loc as { start?: { line?: number } } | undefined
  return loc?.start?.line ?? 0
}

export const skippedTestsScanner: Scanner = {
  id: "skipped-tests",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (!SOURCE_RE.test(norm) || norm.includes(".min.")) continue

      const content = await ctx.readFile(file)
      if (!content) continue
      if (!PREFILTER.test(content)) continue

      // One hit per line (first match wins), so chained modifiers don't double-count.
      const byLine = new Map<number, Hit>()
      const isJs = JS_RE.test(norm)

      if (isJs) {
        const ast = parseFile(content, file)
        if (ast) {
          walk(ast, (n) => {
            if (byLine.size >= MAX_PER_FILE) return
            const hit = jsHit(n)
            if (!hit) return
            const line = lineOf(n)
            if (!byLine.has(line)) byLine.set(line, hit)
          })
        } else {
          collectByRegex(content, JS_RULES, byLine)
        }
      } else {
        // Python.
        collectByRegex(content, PY_RULES, byLine)
      }

      const lines = content.split(/\r?\n/)
      let perFile = 0
      for (const [lineNo, hit] of [...byLine.entries()].sort((a, b) => a[0] - b[0])) {
        if (perFile >= MAX_PER_FILE || issues.length >= MAX_TOTAL) break
        const focused = hit.severity === "warning"
        issues.push({
          id: `skiptest-${norm}:${lineNo}`,
          category: "hygiene",
          severity: hit.severity,
          title: `Disabled coverage: ${hit.label}`,
          location: `${norm}:${lineNo}`,
          ageDays: 0,
          detail: focused
            ? `A ${hit.label} is committed — focusing disables every other test in this file, so the ` +
              `suite can pass while almost nothing runs. Remove the focus before merging.`
            : `A ${hit.label} is committed. It no longer runs, so the behaviour it covered is ` +
              `unprotected. Re-enable it or delete it if it's obsolete.`,
          evidence: (lines[lineNo - 1] ?? "").trim().slice(0, 120),
        })
        perFile++
      }
    }

    return issues
  },
}

/** Line-regex collection into the per-line map (first match wins per line). */
function collectByRegex(content: string, rules: Rule[], byLine: Map<number, Hit>): void {
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length && byLine.size < MAX_PER_FILE; i++) {
    const rule = rules.find((r) => r.re.test(lines[i]))
    if (rule && !byLine.has(i + 1)) byLine.set(i + 1, { severity: rule.severity, label: rule.label })
  }
}
