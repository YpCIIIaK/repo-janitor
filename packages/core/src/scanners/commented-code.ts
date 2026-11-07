import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Commented-out Code scanner.
 *
 * Flags blocks of commented-out *code* (not prose) — the `// const x = ...` /
 * `// doThing();` graveyards that pile up and confuse readers. Version control
 * already remembers deleted code, so commented-out blocks are pure rot.
 *
 * Deliberately conservative to avoid flagging real comments: it only fires on a
 * run of {@link MIN_RUN}+ consecutive single-line `//` comments where every line
 * carries *structural* code punctuation (statement terminators, arrows or
 * assignments) and doesn't read like prose. Matching on code syntax — not
 * keywords — is what keeps English sentences ("...if the code reads a var.") from
 * being misread as code. One info finding per block, at its first line; capped.
 */

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts|java|c|cc|cpp|h|hpp|cs|go|rs|swift|kt|scala|php)$/
const MIN_RUN = 3
const MAX_PER_FILE = 5
const MAX_TOTAL = 40

// Comment bodies that are clearly NOT commented-out code (directives / prose).
const SKIP_PREFIX =
  /^(?:!|\/|@|eslint|prettier|ts-|tslint|biome|c8|istanbul|prettier-ignore|todo\b|fixme\b|note\b|hack\b|xxx\b|https?:|www\.|copyright|spdx|licen[sc]e)/i

// Prose sentences end this way; real statements don't. Cheap, high-precision veto.
const PROSE_TAIL = /[.:?!]\s*$/

// Structural signals of source code (not mere keywords, which appear in prose):
//  - ends with a statement terminator `;` `{` `}` or a continuation `,` `)`
//  - an arrow function `=>`
//  - a single `=` assignment (not ==, ===, !=, <=, >=)
//  - starts with a closing bracket (dangling block tail)
const CODE_SIGNAL = /[;{},)]\s*$|=>|(?:^|[^=!<>])=(?:[^=]|$)|^[)}\]]/

// Four plain words in a row reads as a sentence, not a statement.
const PROSE_RUN = /\b[A-Za-z]{2,} [A-Za-z]{2,} [A-Za-z]{2,} [A-Za-z]{2,}\b/

/**
 * Indented after the marker (`//\t…`, `//    …`): the way doc comments lay
 * out an example — Go's doc convention, usage snippets, worked tables. Real
 * commented-out code starts at one space and only its inner lines indent.
 */
function isDocIndent(line: string): boolean {
  return /^\s*\/\/(\t| {2,})/.test(line)
}

/** Is this raw source line a single-line `//` comment? Returns its body or null. */
function commentBody(line: string): string | null {
  const m = line.match(/^\s*\/\/(.*)$/)
  return m ? m[1].trim() : null
}

/** Does a comment body look like commented-out code (vs. a real prose comment)? */
function looksLikeCode(body: string): boolean {
  if (!body || body.length < 2) return false
  if (SKIP_PREFIX.test(body)) return false
  // `//=> value`: the result line of a documented example (type-fest, sindresorhus).
  if (body.startsWith("=>")) return false
  if (PROSE_TAIL.test(body)) return false
  // Backticks almost always mean inline-code-in-prose (doc comments), not an
  // actual commented-out statement — skip to avoid flagging documentation.
  if (body.includes("`")) return false
  // A sentence that happens to end in ")" — "added trailing CRLF to FormData (backported from 7.1.0)".
  if (PROSE_RUN.test(body) && !/[;={}]/.test(body)) return false
  return CODE_SIGNAL.test(body)
}

const NOT_PRODUCT_RE =
  /(^|\/)(?:flow-typed|_?examples?|samples?|bench(?:mark)?s?|website|www|docs?|lang(?:uage)?s?|locales?|i18n|assets|legacy)\/|\.config\.[cm]?[jt]s$|\.d\.[cm]?ts$|\.(?:stories|story)\.[cm]?[jt]sx?$|(^|\/)example_[^/]*_test\.go$/i

/** Only actual line comments count: examples inside block documentation
 * and string literals are not executable source the user commented out.
 */
function lineCommentLines(lines: string[], nestedComments: boolean): Set<number> {
  const result = new Set<number>()
  let blockDepth = 0, quote = ""
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n]
    for (let i = 0; i < line.length; i++) {
      const c = line[i], next = line[i + 1]
      if (blockDepth) {
        if (nestedComments && c === "/" && next === "*") { blockDepth++; i++ }
        else if (c === "*" && next === "/") { blockDepth--; i++ }
      } else if (quote) {
        if (quote !== '"""' && c === "\\") { i++; continue }
        if (line.startsWith(quote, i)) { i += quote.length - 1; quote = "" }
      } else if (c === "/" && next === "/") {
        if (!line.slice(0, i).trim()) result.add(n)
        break
      } else if (c === "/" && next === "*") { blockDepth++; i++ }
      else if (c === '"' || c === "'" || c === "`") {
        quote = line.startsWith('"""', i) ? '"""' : c
        i += quote.length - 1
      }
    }
    // Ordinary source string/character literals end on this line. Template and
    // triple strings may legitimately contain lines beginning with //.
    if (quote === '"' || quote === "'") quote = ""
  }
  return result
}

/** A documentation paragraph can contain several short runs of example code.
 * Permit blank separators, but never cross executable source into another block.
 */
function commentParagraph(lines: string[], start: number, len: number): string[] {
  let a = start, b = start + len
  while (a > 0 && (commentBody(lines[a - 1]) !== null || !lines[a - 1].trim())) a--
  while (b < lines.length && (commentBody(lines[b]) !== null || !lines[b].trim())) b++
  return lines.slice(a, b).map(line => commentBody(line) ?? "")
}

/** Does the surrounding comment present the block as an example or input schema? */
function introducesExample(lines: string[], start: number, len: number, file: string): boolean {
  const near = commentParagraph(lines, start, len)
  if (near.some(b => /```|\ba la\b|\be\.g\.|\bexamples?\b|^sample\s*:?\s*$|^sample\s+(?:input|output|usage)\s*:|\buse case\b|like this|looks like|\bsyntax\b|\bformat\b|should be uncommented/i.test(b))) return true
  // SQL DDL in a Go/Java/etc comment describes the schema consumed by the
  // implementation or its fixtures; it is not commented host-language code.
  if (near.some(b => /^CREATE\s+TABLE\b/i.test(b))) return true
  // These languages cannot execute XML tags as source. Keep JS/JSX/TSX, PHP
  // templates and Scala (which supports XML literals) eligible for normal checks.
  if (/\.(?:java|go|c|cc|cpp|h|hpp|cs|rs|swift|kt)$/.test(file)) {
    return near.filter(b => /^<\/?[A-Za-z_][\w:.-]*(?:\s|\/?[>])/.test(b)).length >= 2
  }
  return false
}

export const commentedCodeScanner: Scanner = {
  id: "commented-code",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (!SOURCE_RE.test(norm) || norm.includes(".min.")) continue
      // Vendored code is someone else's to clean up.
      if (/(^|\/)(?:vendor|third_party|node_modules)\//.test(norm)) continue
      // Code shown to a reader or toggled by a user, not code someone forgot:
      // examples, docs sites, benchmarks, typed stubs, translations, legacy
      // copies, and tool configs (`// algolia: {…}`, playwright projects).
      if (NOT_PRODUCT_RE.test(norm)) continue

      const content = await ctx.readFile(file)
      if (!content || !content.includes("//")) continue

      const lines = content.split(/\r?\n/)
      const lineComments = lineCommentLines(lines, /\.(?:rs|swift|scala|kt)$/.test(norm))
      let perFile = 0
      let runStart = -1
      let runLen = 0

      const flush = () => {
        if (runLen < MIN_RUN) { runStart = -1; runLen = 0; return }
        const run = runStart === -1 ? [] : lines.slice(runStart, runStart + runLen)
        const docExample =
          // …unless the line above opens the expression the indented lines continue.
          (run.every(isDocIndent) && !/[({[,]\s*$|=>\s*$/.test(commentBody(lines[runStart - 1] ?? "") ?? "")) ||
          run.some((l) => /^\s*\/\/\s*[*-]\s/.test(l)) ||
          // introduced by "For example:" / "Testing for these options:"
          /:\s*$/.test(commentBody(lines[runStart - 1] ?? "") ?? "") ||
          /:\s*$/.test(commentBody(lines[runStart - 2] ?? "") ?? "") ||
          // The prose around it presents it: "a la ```…```", "looks like", "e.g.".
          introducesExample(lines, runStart, runLen, norm) ||
          run.some((l) => /::=/.test(l))
        if (!docExample && runLen >= MIN_RUN && perFile < MAX_PER_FILE && issues.length < MAX_TOTAL) {
          const lineNo = runStart + 1
          issues.push({
            id: `commented-${norm}:${lineNo}`,
            category: "hygiene",
            severity: "info",
            title: `Commented-out code block (${runLen} lines)`,
            location: `${norm}:${lineNo}`,
            ageDays: 0,
            detail:
              `A ${runLen}-line block of commented-out code starts here. Git history already preserves ` +
              `removed code, so commented-out blocks just add noise — delete it.`,
            evidence: lines[runStart].trim().slice(0, 120),
          })
          perFile++
        }
        runStart = -1
        runLen = 0
      }

      for (let i = 0; i < lines.length; i++) {
        const body = lineComments.has(i) ? commentBody(lines[i]) : null
        if (body !== null && looksLikeCode(body)) {
          if (runStart === -1) runStart = i
          runLen++
        } else {
          flush()
        }
      }
      flush()
    }

    return issues
  },
}
