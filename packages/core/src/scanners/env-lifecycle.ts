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
 */
const ENV_REGEX = /process\.env\.([A-Z0-9_]+)/g

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
      if (!/\.(ts|tsx|js|jsx|mjs|mts|cts)$/.test(file)) continue
      const content = await ctx.readFile(file)
      if (!content) continue
      const ok = analyzeWithAst(content, file, acc)
      if (!ok) {
        // parse failed — degrade gracefully to the old regex sweep for this file
        for (const match of content.matchAll(ENV_REGEX)) {
          const line = content.slice(0, match.index ?? 0).split("\n").length
          recordUsage(acc, match[1], file, line)
        }
      }
    }

    // collect vars declared in .env.example (supports optional `export ` prefix)
    const example = await ctx.readFile(".env.example")
    const hasExample = example !== null
    const declared = new Set<string>()
    if (example) {
      for (const line of example.split("\n")) {
        const m = line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/)
        if (m) declared.add(m[1])
      }
    }

    // Location of a var's first read in code, or the example file as a last resort.
    const usageLoc = (name: string): string => {
      const at = acc.usedAt.get(name)
      return at ? `${at.file}:${at.line}` : ".env.example"
    }

    const undocumented = [...acc.used].filter((n) => !declared.has(n)).sort()

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
            ? `${name} (optional) not in .env.example`
            : `${name} used but not in .env.example`,
          location: usageLoc(name),
          ageDays: 0,
          detail: hasFallback
            ? `Code reads process.env.${name} but it is not documented in .env.example. A fallback default is provided in code, so this is optional — document it for clarity or ignore.`
            : `Code reads process.env.${name} but it is not documented in .env.example.`,
        })
      }
    } else if (undocumented.length > 0) {
      // No .env.example at all → don't spam one warning per var (the repo simply
      // doesn't use the convention). Surface a single info nudge instead.
      issues.push({
        id: `env-no-example`,
        category: "env",
        severity: "info",
        title: `No .env.example — ${undocumented.length} env var${undocumented.length === 1 ? "" : "s"} undocumented`,
        location: usageLoc(undocumented[0]),
        ageDays: 0,
        detail: `This repo has no .env.example, but code reads ${undocumented.length} env var${
          undocumented.length === 1 ? "" : "s"
        }: ${undocumented.join(", ")}. Add a .env.example so contributors and deploys know what to set.`,
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
          location: ".env.example",
          ageDays: 0,
          detail: `${name} exists in .env.example but is not referenced anywhere in the codebase.`,
        })
      }
    }

    return issues
  },
}
