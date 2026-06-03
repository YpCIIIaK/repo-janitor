import { parse } from "@babel/parser"

/**
 * Shared AST helpers for scanners that need to read source structurally.
 *
 * We walk @babel's tree as loose objects (no @babel/types dependency) so the
 * helpers stay tiny and every scanner can reuse the same parse settings. Used
 * by env-lifecycle, todo-debt, dependency-funeral and dead-code.
 */

/** Loose AST node — walked structurally without @babel/types. */
export type Node = { type?: string; [key: string]: unknown }

/** Keys that hold metadata / cyclic refs we never want to recurse into. */
export const SKIP_KEYS = new Set([
  "loc",
  "start",
  "end",
  "range",
  "comments",
  "leadingComments",
  "trailingComments",
  "innerComments",
  "extra",
  "errors",
  "tokens",
])

/** Babel plugins to enable based on file extension. */
export function pluginsFor(file: string): ("typescript" | "jsx")[] {
  if (file.endsWith(".ts") || file.endsWith(".mts") || file.endsWith(".cts")) return ["typescript"]
  if (file.endsWith(".tsx")) return ["typescript", "jsx"]
  return ["jsx"] // .js .jsx .mjs
}

/**
 * Parse a source file into a loose AST, or return null if it fails to parse
 * even with error recovery. Callers that need coverage on unparseable files
 * should fall back to a regex sweep when this returns null.
 *
 * Pass `attachComment: true` when you need comment nodes (e.g. todo-debt);
 * env/import scanners leave it off so comments are stripped.
 */
export function parseFile(content: string, file: string, opts: { comments?: boolean } = {}): Node | null {
  try {
    return parse(content, {
      sourceType: "unambiguous",
      plugins: pluginsFor(file),
      errorRecovery: true,
      attachComment: opts.comments ?? false,
      allowReturnOutsideFunction: true,
      allowAwaitOutsideFunction: true,
      allowSuperOutsideMethod: true,
      allowUndeclaredExports: true,
    }) as unknown as Node
  } catch {
    return null
  }
}

/** Depth-first walk, invoking `visit` on every node that has a string `type`. */
export function walk(node: unknown, visit: (n: Node) => void): void {
  if (!node || typeof node !== "object") return
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit)
    return
  }
  const n = node as Node
  if (typeof n.type === "string") visit(n)
  for (const key in n) {
    if (SKIP_KEYS.has(key)) continue
    const val = n[key]
    if (val && typeof val === "object") walk(val, visit)
  }
}
