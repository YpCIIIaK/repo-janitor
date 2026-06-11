import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"
import { type Node, parseFile, walk } from "../ast"

/**
 * Env Lifecycle scanner.
 *
 * Finds env vars referenced in code but missing from `.env.example`, and vars
 * declared in `.env.example` but never used.
 *
 * Reference resolution is AST-based (@babel/parser) so it understands:
 *   - member access:        process.env.FOO
 *   - computed access:      process.env["FOO"]
 *   - destructuring:        const { FOO, BAR } = process.env
 *   - defaults:             process.env.FOO ?? "x"   |   const { FOO = "x" } = process.env
 *   - dynamic access:       process.env[key]  /  const e = process.env  /  { ...rest } = process.env
 *
 * Crucially it ignores matches inside strings and comments (the old regex did not).
 * If a file fails to parse (exotic/partial syntax) we fall back to a regex sweep
 * for that single file so coverage never regresses.
 *
 * Beyond JS/TS, a per-language regex pass covers the common env idioms in Python
 * (`os.environ` / `os.getenv`), Go (`os.Getenv` / `os.LookupEnv`), Ruby (`ENV[]` /
 * `ENV.fetch`) and PHP (`getenv` / `$_ENV` / Laravel's `env()`), feeding the same usage model. The
 * documented-vars file may be `.env.example`, `.env.sample`, `.env.template` or
 * `.env.dist`.
 */
const ENV_REGEX = /process\.env\.([A-Z0-9_]+)/g

// Example/template files that document required env vars, in preference order.
const EXAMPLE_FILES = [".env.example", ".env.sample", ".env.template", ".env.dist"]

// Env vars injected by the platform/runtime/CI, or GitHub Action inputs. Code
// legitimately reads these, but they are NEVER documented in a project's
// `.env.example` (CI provides them; action inputs live in `action.yml`). Flagging
// them as "undocumented" is a false positive, so they're excluded from that check.
const PLATFORM_ENV_PREFIXES = ["GITHUB_", "RUNNER_", "INPUT_", "CI_", "VERCEL_", "NETLIFY_"]
const PLATFORM_ENV_EXACT = new Set([
  "CI",
  "NODE_ENV",
  "NO_COLOR",
  "FORCE_COLOR",
  "TERM",
  "TZ",
  "LANG",
  "LC_ALL",
  "HOME",
  "PATH",
  "PWD",
  "SHELL",
  "USER",
  "HOSTNAME",
  "TMPDIR",
])

/** True for env vars supplied by the platform/CI rather than the project. */
function isPlatformEnv(name: string): boolean {
  return PLATFORM_ENV_EXACT.has(name) || PLATFORM_ENV_PREFIXES.some((p) => name.startsWith(p))
}

/**
 * Non-JS env access, matched by regex per language. JS/TS keeps its precise
 * AST analysis above; these cover the common `os.environ` / `os.Getenv` / `ENV[]`
 * / `getenv()` idioms so Python, Go, Ruby and PHP repos get real findings too.
 *
 * Each `read` pattern captures the var name in group 1; an optional `fallbackGroup`
 * (a trailing comma / default arg) marks the read as having an in-code default.
 * `dynamic` patterns (non-literal access) flip `acc.dynamic`, which disables the
 * "declared but unused" check since we can no longer prove a var is unused.
 */
interface EnvPattern {
  re: RegExp
  fallbackGroup?: number
}
interface LangEnvConfig {
  reads: EnvPattern[]
  dynamic: RegExp[]
}

const NAME = `([A-Za-z_][A-Za-z0-9_]*)`
const LANG_PATTERNS: Record<string, LangEnvConfig> = {
  py: {
    reads: [
      { re: new RegExp(`os\\.environ\\.get\\(\\s*["']${NAME}["']\\s*(,)?`, "g"), fallbackGroup: 2 },
      { re: new RegExp(`(?:os\\.)?getenv\\(\\s*["']${NAME}["']\\s*(,)?`, "g"), fallbackGroup: 2 },
      { re: new RegExp(`(?:os\\.environ|environ)\\[\\s*["']${NAME}["']\\s*\\]`, "g") },
    ],
    dynamic: [/(?:os\.environ|environ)\[\s*[^"'\]\s]/, /(?:os\.)?getenv\(\s*[^"'\s)]/],
  },
  go: {
    reads: [
      { re: new RegExp(`os\\.Getenv\\(\\s*"${NAME}"`, "g") },
      { re: new RegExp(`os\\.LookupEnv\\(\\s*"${NAME}"`, "g") },
    ],
    dynamic: [/os\.(?:Getenv|LookupEnv)\(\s*[^"\s)]/],
  },
  rb: {
    reads: [
      { re: new RegExp(`ENV\\[\\s*["']${NAME}["']\\s*\\]`, "g") },
      { re: new RegExp(`ENV\\.fetch\\(\\s*["']${NAME}["']\\s*(,)?`, "g"), fallbackGroup: 2 },
    ],
    dynamic: [/ENV\[\s*[^"'\]\s]/],
  },
  php: {
    reads: [
      { re: new RegExp(`getenv\\(\\s*["']${NAME}["']`, "g") },
      { re: new RegExp(`\\$_ENV\\[\\s*["']${NAME}["']\\s*\\]`, "g") },
      // Laravel's env() helper: env('APP_KEY') / env('APP_KEY', 'default') (optional).
      { re: new RegExp(`\\benv\\(\\s*["']${NAME}["']\\s*(,)?`, "g"), fallbackGroup: 2 },
    ],
    dynamic: [/getenv\(\s*\$/, /\$_ENV\[\s*\$/, /\benv\(\s*\$/],
  },
}

/** Map a file extension to its env-pattern language key, or null. */
function envLangOf(file: string): keyof typeof LANG_PATTERNS | null {
  const m = file.toLowerCase().match(/\.([a-z0-9]+)$/)
  const ext = m?.[1]
  if (ext === "py") return "py"
  if (ext === "go") return "go"
  if (ext === "rb") return "rb"
  if (ext === "php") return "php"
  return null
}

/**
 * Build a reusable index→line lookup for one file. Precomputes newline offsets
 * once (O(n)) so each of the many regex matches costs O(log n) instead of the
 * O(n) slice+split the old `lineAt` did per call (quadratic on large files).
 */
function makeLineLookup(content: string): (index: number) => number {
  const offsets = [0]
  for (let i = 0; i < content.length; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) offsets.push(i + 1)
  }
  return (index: number): number => {
    let lo = 0
    let hi = offsets.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (offsets[mid] <= index) lo = mid
      else hi = mid - 1
    }
    return lo + 1 // 1-based
  }
}

/** Populate `acc` from a non-JS source file using its language's regex patterns. */
function analyzeWithRegexLang(content: string, file: string, lang: keyof typeof LANG_PATTERNS, acc: EnvUsage): void {
  const cfg = LANG_PATTERNS[lang]
  const lineOf = makeLineLookup(content)
  for (const p of cfg.reads) {
    for (const m of content.matchAll(p.re)) {
      const name = m[1]
      if (!name) continue
      recordUsage(acc, name, file, lineOf(m.index ?? 0))
      if (p.fallbackGroup && m[p.fallbackGroup]) acc.withFallback.add(name)
    }
  }
  for (const d of cfg.dynamic) {
    if (d.test(content)) acc.dynamic = true
  }
}

interface EnvUsage {
  /** vars statically proven to be read from process.env */
  used: Set<string>
  /** first source site (file:line) each var is read at — used for issue location */
  usedAt: Map<string, { file: string; line: number }>
  /** subset of `used` that has an in-code fallback default (?? / || / = default) */
  withFallback: Set<string>
  /** true when code accesses env dynamically — we then can't trust "unused" claims */
  dynamic: boolean
}

/** Best-effort 1-based line of a node from its loc. */
function lineOf(node: Node): number {
  const loc = node.loc as { start?: { line?: number } } | undefined
  return loc?.start?.line ?? 0
}

/** Record a var as used, remembering the first place we saw it. */
function recordUsage(acc: EnvUsage, name: string, file: string, line: number): void {
  acc.used.add(name)
  if (!acc.usedAt.has(name)) acc.usedAt.set(name, { file, line })
}

function isProcessEnv(n: unknown): n is Node {
  const node = n as Node | null
  return (
    !!node &&
    (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
    !node.computed &&
    (node.object as Node)?.type === "Identifier" &&
    (node.object as Node).name === "process" &&
    (node.property as Node)?.type === "Identifier" &&
    (node.property as Node).name === "env"
  )
}

/** Resolve `process.env.X` / `process.env["X"]` to "X", else null. */
function envVarName(n: unknown): string | null {
  const node = n as Node | null
  if (!node) return null
  if (node.type !== "MemberExpression" && node.type !== "OptionalMemberExpression") return null
  if (!isProcessEnv(node.object)) return null
  const prop = node.property as Node
  if (!node.computed && prop?.type === "Identifier") return prop.name as string
  if (node.computed && prop?.type === "StringLiteral") return prop.value as string
  return null
}

function analyzeWithAst(content: string, file: string, acc: EnvUsage): boolean {
  const ast = parseFile(content, file)
  if (!ast) return false // signal caller to use the regex fallback for this file

  walk(ast, (node) => {
    // 1) direct access: process.env.X / process.env["X"] / process.env[expr]
    if (
      (node.type === "MemberExpression" || node.type === "OptionalMemberExpression") &&
      isProcessEnv(node.object)
    ) {
      const prop = node.property as Node
      if (!node.computed && prop?.type === "Identifier") {
        recordUsage(acc, prop.name as string, file, lineOf(node))
      } else if (node.computed && prop?.type === "StringLiteral") {
        recordUsage(acc, prop.value as string, file, lineOf(node))
      } else if (node.computed) {
        acc.dynamic = true // process.env[someVariable]
      }
    }

    // 2) fallback defaults: process.env.X ?? "y"  |  process.env.X || "y"
    if (node.type === "LogicalExpression" && (node.operator === "??" || node.operator === "||")) {
      const name = envVarName(node.left)
      if (name) acc.withFallback.add(name)
    }

    // 3) destructuring: const { X, Y: a, Z = "d", ...rest } = process.env
    if (node.type === "VariableDeclarator" && isProcessEnv(node.init)) {
      const id = node.id as Node
      if (id.type === "ObjectPattern") {
        for (const raw of (id.properties as Node[]) ?? []) {
          if (raw.type === "RestElement") {
            acc.dynamic = true
            continue
          }
          if (raw.type !== "ObjectProperty") continue
          const key = raw.key as Node
          let name: string | null = null
          if (!raw.computed && key?.type === "Identifier") name = key.name as string
          else if (key?.type === "StringLiteral") name = key.value as string
          if (!name) continue
          recordUsage(acc, name, file, lineOf(raw))
          if ((raw.value as Node)?.type === "AssignmentPattern") acc.withFallback.add(name)
        }
      } else if (id.type === "Identifier") {
        // const env = process.env  → later `env.X` accesses are invisible to us
        acc.dynamic = true
      }
    }
  })

  return true
}

export const envLifecycleScanner: Scanner = {
  id: "env-lifecycle",
  category: "env",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []
    const acc: EnvUsage = { used: new Set(), usedAt: new Map(), withFallback: new Set(), dynamic: false }

    for (const file of ctx.files) {
      const isJs = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/.test(file)
      const lang = isJs ? null : envLangOf(file)
      if (!isJs && !lang) continue
      const content = await ctx.readFile(file)
      if (!content) continue

      if (isJs) {
        const ok = analyzeWithAst(content, file, acc)
        if (!ok) {
          // parse failed — degrade gracefully to the old regex sweep for this file
          const lineOf = makeLineLookup(content)
          for (const match of content.matchAll(ENV_REGEX)) {
            recordUsage(acc, match[1], file, lineOf(match.index ?? 0))
          }
        }
      } else if (lang) {
        // Python / Go / Ruby / PHP — regex-based env access extraction.
        analyzeWithRegexLang(content, file, lang, acc)
      }
    }

    // collect vars declared in the env example/template file (first one found).
    let example: string | null = null
    let exampleName = EXAMPLE_FILES[0]
    for (const f of EXAMPLE_FILES) {
      const c = await ctx.readFile(f)
      if (c !== null) {
        example = c
        exampleName = f
        break
      }
    }
    const hasExample = example !== null
    const declared = new Set<string>()
    if (example) {
      // supports optional `export ` prefix
      for (const line of example.split("\n")) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/)
        if (m) declared.add(m[1])
      }
    }

    // Location of a var's first read in code, or the example file as a last resort.
    const usageLoc = (name: string): string => {
      const at = acc.usedAt.get(name)
      return at ? `${at.file}:${at.line}` : exampleName
    }

    const undocumented = [...acc.used].filter((n) => !declared.has(n) && !isPlatformEnv(n)).sort()

    if (hasExample) {
      // The repo uses the .env.example convention — each undocumented var read in
      // code is a real gap (onboarding/deploys won't know to set it). → warning.
      for (const name of undocumented) {
        const hasFallback = acc.withFallback.has(name)
        issues.push({
          id: `env-missing-${name}`,
          category: "env",
          // A var with an in-code fallback default still works without being set,
          // so it's optional — info, not a warning. Only vars that are required
          // (no fallback) yet undocumented are a real onboarding/deploy gap.
          severity: hasFallback ? "info" : "warning",
          title: hasFallback
            ? `${name} (optional) not in ${exampleName}`
            : `${name} used but not in ${exampleName}`,
          location: usageLoc(name),
          ageDays: 0,
          detail: hasFallback
            ? `Code reads the ${name} env var but it is not documented in ${exampleName}. A fallback default is provided in code, so this is optional — document it for clarity or ignore.`
            : `Code reads the ${name} env var but it is not documented in ${exampleName}.`,
        })
      }
    } else if (undocumented.length > 0) {
      // No .env.example at all → don't spam one warning per var (the repo simply
      // doesn't use the convention). Surface a single info nudge instead.
      issues.push({
        id: `env-no-example`,
        category: "env",
        severity: "info",
        title: `No ${exampleName} — ${undocumented.length} env var${undocumented.length === 1 ? "" : "s"} undocumented`,
        location: usageLoc(undocumented[0]),
        ageDays: 0,
        detail: `This repo has no ${exampleName}, but code reads ${undocumented.length} env var${
          undocumented.length === 1 ? "" : "s"
        }: ${undocumented.join(", ")}. Add a ${exampleName} so contributors and deploys know what to set.`,
      })
    }

    // declared but unused → info (dead env var).
    // Skipped entirely when dynamic access is present, since we can't prove a var
    // is unused if the code reads process.env through a variable/alias/rest.
    if (!acc.dynamic) {
      for (const name of [...declared].sort()) {
        if (acc.used.has(name)) continue
        issues.push({
          id: `env-dead-${name}`,
          category: "env",
          severity: "info",
          title: `${name} declared but never used`,
          location: exampleName,
          ageDays: 0,
          detail: `${name} exists in ${exampleName} but is not referenced anywhere in the codebase.`,
        })
      }
    }

    return issues
  },
}
