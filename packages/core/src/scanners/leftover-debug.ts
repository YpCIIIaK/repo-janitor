import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"
import { parseFile, walk, type Node } from "../ast"

/**
 * Leftover Debug scanner.
 *
 * Flags debugging statements that were meant to be temporary but got committed.
 *  - JS/TS (AST): `debugger;` and noisy `console.*` (log/debug/trace/dir/table) —
 *    NOT `console.error`/`warn`/`info`, which are commonly legitimate logging.
 *  - Python / Go / Rust / Ruby / PHP (regex): the idiomatic print & breakpoint
 *    leftovers (see {@link LANG_DEBUG}). Interactive debuggers (`breakpoint()`,
 *    `pdb.set_trace()`, `dbg!`, `binding.pry`, `dd()`) are warnings; plain prints
 *    are info. Matches inside line comments are skipped.
 *
 * Test files are excluded (debug output there is fine) across all languages, and
 * results are capped per-file and overall so one chatty file can't flood the report.
 */

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/
// Polyglot test-file detection — debug output in tests/fixtures is expected.
const TEST_RE =
  /(^|\/)(?:__tests__|tests?|specs?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.(?:py|go|rb)$|_spec\.rb$|(?:^|\/)conftest\.py$/i
const DEBUG_METHODS = new Set(["log", "debug", "trace", "dir", "table"])

const MAX_PER_FILE = 8
const MAX_TOTAL = 50

// Source extensions a built entrypoint (dist/*.js) maps back to.
const ENTRY_SRC_EXTS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"]

/** Join a dir and a (possibly `./`-prefixed) relative path, resolving . and .. */
function joinPath(dir: string, rel: string): string {
  const parts = `${dir}/${rel}`.split("/")
  const out: string[] = []
  for (const p of parts) {
    if (p === "" || p === ".") continue
    if (p === "..") out.pop()
    else out.push(p)
  }
  return out.join("/")
}

/**
 * Map a built entrypoint path (e.g. `packages/cli/dist/index.js`) to the source
 * files the scanner actually sees (`packages/cli/src/index.{ts,…}`): dist/ is
 * git-ignored, so manifests point at outputs we never scan. Returns every
 * plausible source path; membership is tested against the real file list.
 */
function entrySourceCandidates(distPath: string): string[] {
  const noExt = distPath.replace(/\.[^./]+$/, "")
  const srcified = noExt.replace(/(^|\/)dist(\/)/, "$1src$2")
  return ENTRY_SRC_EXTS.map((e) => `${srcified}.${e}`)
}

/**
 * Collect the source files that are *program entrypoints* — CLIs and GitHub
 * Actions — from their manifests (`bin` in package.json, `runs.main` in
 * action.yml). In an entrypoint, `console.log` is the program's output channel,
 * not leftover debug, so we don't flag it there.
 */
async function collectEntrypoints(ctx: ScanContext): Promise<Set<string>> {
  const entries = new Set<string>()
  for (const file of ctx.files) {
    const norm = file.replace(/\\/g, "/")
    const lower = norm.toLowerCase()
    const dir = norm.includes("/") ? norm.slice(0, norm.lastIndexOf("/")) : ""

    if (lower === "package.json" || lower.endsWith("/package.json")) {
      const txt = await ctx.readFile(file)
      if (!txt) continue
      let json: { bin?: unknown }
      try {
        json = JSON.parse(txt)
      } catch {
        continue
      }
      const bin = json.bin
      const paths =
        typeof bin === "string"
          ? [bin]
          : bin && typeof bin === "object"
            ? Object.values(bin as Record<string, unknown>).map(String)
            : []
      for (const p of paths)
        for (const c of entrySourceCandidates(joinPath(dir, p))) entries.add(c)
    } else if (lower.endsWith("/action.yml") || lower.endsWith("/action.yaml") || lower === "action.yml" || lower === "action.yaml") {
      const txt = await ctx.readFile(file)
      if (!txt) continue
      const m = txt.match(/(?:^|\n)\s*main:\s*["']?([^"'\n#]+?)["']?\s*(?:#.*)?$/m)
      if (m) for (const c of entrySourceCandidates(joinPath(dir, m[1].trim()))) entries.add(c)
    }
  }
  return entries
}

interface DebugRule {
  re: RegExp
  severity: Severity
  label: string
}

/** Per-language leftover-debug patterns (regex). Var name is irrelevant here. */
const LANG_DEBUG: Record<string, DebugRule[]> = {
  py: [
    { re: /\bbreakpoint\s*\(/g, severity: "warning", label: "breakpoint()" },
    { re: /\bi?pdb\.set_trace\s*\(/g, severity: "warning", label: "pdb.set_trace()" },
    { re: /\bprint\s*\(/g, severity: "info", label: "print()" },
    { re: /\bpprint\s*\(/g, severity: "info", label: "pprint()" },
  ],
  go: [{ re: /\bfmt\.Print(?:ln|f)?\s*\(/g, severity: "info", label: "fmt.Print" }],
  rs: [
    { re: /\bdbg!\s*\(/g, severity: "warning", label: "dbg!()" },
    { re: /\b(?:e?println!|print!)\s*\(/g, severity: "info", label: "println!" },
  ],
  rb: [{ re: /\bbinding\.(?:pry|irb)\b/g, severity: "warning", label: "binding.pry" }],
  php: [
    { re: /\b(?:dd|dump)\s*\(/g, severity: "warning", label: "dd()" },
    { re: /\b(?:var_dump|print_r|var_export)\s*\(/g, severity: "info", label: "var_dump()" },
  ],
}

// Line-comment markers per language, used to skip matches inside comments.
const COMMENT_MARKERS: Record<string, string[]> = {
  py: ["#"],
  rb: ["#"],
  go: ["//"],
  rs: ["//"],
  php: ["//", "#"],
}

function debugLangOf(file: string): keyof typeof LANG_DEBUG | null {
  const ext = file.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  if (ext === "py") return "py"
  if (ext === "go") return "go"
  if (ext === "rs") return "rs"
  if (ext === "rb") return "rb"
  if (ext === "php") return "php"
  return null
}

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

/** 1-based line number of a string index. */
function lineAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length
}

interface RegexHit {
  line: number
  label: string
  severity: Severity
  evidence: string
}

/** Collect leftover-debug hits from a non-JS file using its language rules. */
function scanRegexDebug(content: string, lang: keyof typeof LANG_DEBUG): RegexHit[] {
  const rules = LANG_DEBUG[lang]
  const markers = COMMENT_MARKERS[lang] ?? []
  const byLine = new Map<number, RegexHit>()

  for (const rule of rules) {
    for (const m of content.matchAll(rule.re)) {
      const idx = m.index ?? 0
      const lineStart = content.lastIndexOf("\n", idx - 1) + 1
      const prefix = content.slice(lineStart, idx)
      // Skip matches that sit after a line-comment marker (commented-out code).
      if (markers.some((mk) => prefix.includes(mk))) continue

      const line = lineAt(content, idx)
      const existing = byLine.get(line)
      // One hit per line; prefer the more severe rule (warning over info).
      if (existing && !(rule.severity === "warning" && existing.severity !== "warning")) continue

      const lineEnd = content.indexOf("\n", idx)
      const lineText = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd).trim()
      byLine.set(line, { line, label: rule.label, severity: rule.severity, evidence: lineText.slice(0, 120) })
    }
  }

  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

export const leftoverDebugScanner: Scanner = {
  id: "leftover-debug",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []
    const entrypoints = await collectEntrypoints(ctx)

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (TEST_RE.test(norm)) continue

      const isJs = SOURCE_RE.test(norm)
      const lang = isJs ? null : debugLangOf(norm)
      if (!isJs && !lang) continue

      const content = await ctx.readFile(file)
      if (!content) continue

      if (isJs) {
        // Cheap pre-filter: skip files with no debug tokens at all.
        if (!content.includes("console.") && !content.includes("debugger")) continue

        const ast = parseFile(content, file)
        if (!ast) continue

        // In a CLI / Action entrypoint, console.log IS the program's output, not
        // leftover debug — only a stray `debugger` is worth flagging there.
        const isEntrypoint = content.startsWith("#!") || entrypoints.has(norm)

        let perFile = 0
        const found: { line: number; label: string }[] = []
        walk(ast, (n) => {
          if (perFile >= MAX_PER_FILE) return
          const label = debugLabel(n)
          if (!label) return
          if (isEntrypoint && label !== "debugger") return
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
      } else if (lang) {
        // Python / Go / Rust / Ruby / PHP — regex-based.
        let perFile = 0
        for (const hit of scanRegexDebug(content, lang)) {
          if (issues.length >= MAX_TOTAL || perFile >= MAX_PER_FILE) break
          issues.push({
            id: `debug-${norm}:${hit.line}`,
            category: "hygiene",
            severity: hit.severity,
            title: `Leftover ${hit.label} in source`,
            location: `${norm}:${hit.line}`,
            ageDays: 0,
            detail:
              hit.severity === "warning"
                ? `A \`${hit.label}\` debug statement is committed in source — remove it before shipping ` +
                  "(it can halt execution or leak internals)."
                : `A \`${hit.label}\` call is committed in source. If it was for debugging, remove it; ` +
                  "for real output prefer a proper logger.",
            evidence: hit.evidence,
          })
          perFile++
        }
      }
    }

    return issues
  },
}
