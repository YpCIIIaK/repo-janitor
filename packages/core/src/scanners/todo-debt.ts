import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"
import { type Node, parseFile } from "../ast"

/**
 * Stale-comment debt scanner.
 *
 * Finds debt markers (the four shouty ones) at the START of a comment and ranks
 * them by age (via `ScanContext.git.blameAgeDays`). Old debt is louder: a marker
 * open for over a year is a warning, fresher ones are info.
 *
 * The marker must lead the comment — prose that merely mentions a marker word
 * mid-sentence (like this very docstring) is not debt and is ignored. This
 * mirrors eslint's `no-warning-comments` with `location: "start"`.
 *
 * For JS/TS, comments are read from the parsed `File.comments` array (the AST
 * walker skips comment nodes on purpose). Every other language — and any file
 * babel can't parse — falls back to a line regex that understands hash, slash
 * and block comment styles, so markers are found across the polyglot set.
 */
const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts|py|go|rs|java|rb|php|c|cc|cpp|h|hpp|cs|kt|swift|scala)$/
// Marker must be the first word of the comment body, after any decoration
// (whitespace and `* > ! -`). A trailing `:` is optional.
const MARKER_RE = /^[\s*>!-]*(TODO|FIXME|HACK|XXX)\b:?\s*(.*)$/

/** A year-old marker is a warning; anything younger is info. */
const STALE_DAYS = 365

interface Hit {
  marker: string
  text: string
  line: number
}

/** Comment nodes babel attaches to the File when parsed with comments. */
interface Comment {
  value?: string
  loc?: { start?: { line?: number } }
}

function findMarker(text: string): { marker: string; rest: string } | null {
  const m = text.match(MARKER_RE)
  if (!m) return null
  return { marker: m[1], rest: m[2].trim() }
}

/**
 * Reduce a raw source line to the comment body so the leading-marker rule applies
 * to the comment, not the code before it (handles trailing comments like
 * `x = 1  # TODO: fix`). Lines without an opener (block-comment continuations
 * like ` * TODO …`) are returned as-is for the decoration strip in MARKER_RE.
 */
function commentBodyOf(line: string): string {
  const openers = [line.indexOf("//"), line.indexOf("#"), line.indexOf("/*")].filter((i) => i >= 0)
  if (openers.length === 0) return line
  const first = Math.min(...openers)
  return line.slice(first).replace(/^(\/\/+|\/\*+|#+)/, "")
}

function collectFromAst(ast: Node): Hit[] {
  const hits: Hit[] = []
  const comments = (ast.comments as Comment[] | undefined) ?? []
  for (const c of comments) {
    const startLine = c.loc?.start?.line ?? 0
    // A block comment can hold several markers on different lines; scan each line
    // so none is missed, attributing it to the right source line.
    const lines = (c.value ?? "").split("\n")
    for (let i = 0; i < lines.length; i++) {
      const found = findMarker(lines[i])
      if (found) hits.push({ marker: found.marker, text: found.rest, line: startLine + i })
    }
  }
  return hits
}

function collectFromText(content: string): Hit[] {
  const hits: Hit[] = []
  const lines = content.split("\n")
  for (let i = 0; i < lines.length; i++) {
    // only treat it as a marker when it sits in a comment-ish context
    if (!/(\/\/|\/\*|\*|#)/.test(lines[i])) continue
    const found = findMarker(commentBodyOf(lines[i]))
    if (found) hits.push({ marker: found.marker, text: found.rest, line: i + 1 })
  }
  return hits
}

function severityFor(ageDays: number): Severity {
  return ageDays >= STALE_DAYS ? "warning" : "info"
}

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export const todoDebtScanner: Scanner = {
  id: "todo-debt",
  category: "todo",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (!SOURCE_RE.test(file)) continue
      const content = await ctx.readFile(file)
      if (!content) continue

      const ast = parseFile(content, file, { comments: true })
      const hits = ast ? collectFromAst(ast) : collectFromText(content)

      for (const hit of hits) {
        const ageDays = await ctx.git.blameAgeDays(file, hit.line)
        const summary = hit.text ? `: ${truncate(hit.text)}` : ""
        issues.push({
          id: `todo-${file}:${hit.line}`,
          category: "todo",
          severity: severityFor(ageDays),
          title: `${hit.marker}${summary}`,
          location: `${file}:${hit.line}`,
          ageDays,
          detail:
            ageDays >= STALE_DAYS
              ? `${hit.marker} marker has been open for over a year (${ageDays} days). Stale debt — resolve or remove it.`
              : `${hit.marker} marker found in a comment${hit.text ? `: "${truncate(hit.text)}"` : ""}.`,
        })
      }
    }

    return issues
  },
}
