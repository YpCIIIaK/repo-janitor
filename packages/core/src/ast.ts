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
/**
 * Generated JavaScript that must never reach the parser.
 *
 * Two costs, and the second is the one that bit. Findings about a bundle are
 * findings about the build, not the code, so they are noise. And a bundle is
 * enormous in exactly the way an AST is expensive: moment/moment commits a
 * `min/` directory whose `tests.js` alone is 5.3 MB. Parsing it took the
 * scanner's peak memory to 405 MB — three times what an ordinary repository
 * needs — which on a 512 MB instance killed the container along with every
 * other request in flight.
 *
 * The size and line-length tests are shape tests rather than name tests, because generated
 * files are not reliably named: a bundle has very few newlines for its size, so
 * average line length gives it away whatever it is called.
 */
const GENERATED_NAME = /(?:^|\/)(?:min|dist|bundles?)\/|\.(?:min|bundle|packed)\.(?:js|mjs|cjs|ts)$|\.js\.map$/i

/** Bytes above which a source file is assumed to be generated, whatever its name. */
const HUGE_SOURCE_BYTES = 512 * 1024

/** Average line length that no hand-written source sustains across a whole file. */
const MINIFIED_AVG_LINE = 200

export function looksGenerated(content: string, file: string): boolean {
  if (GENERATED_NAME.test(file)) return true
  if (content.length > HUGE_SOURCE_BYTES) return true
  let newlines = 0
  for (let i = 0; i < content.length; i++) if (content.charCodeAt(i) === 10) newlines++
  return content.length / (newlines + 1) > MINIFIED_AVG_LINE
}

export function parseFile(content: string, file: string, opts: { comments?: boolean } = {}): Node | null {
  if (looksGenerated(content, file)) return null
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
