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

/** Tabular explanatory rows with syntax that cannot be host-language code.
 * These appear in binary format docs, type-inference tables and test diagrams.
 * Ordinary assignments, expression arrows and container initializers stay eligible.
 */
function isDocumentationRow(body: string): boolean {
  // Chained numeric equalities, e.g. day = 1 = 0b00001, are equations, not assignments.
  if (/^[\w*+ /-]+\s*=\s*(?:0x[\da-f]+|0b[01]+|\d+)\s*=\s*(?:0x[\da-f]+|0b[01]+|\d+)\s*$/i.test(body)) return true
  // Go range type placeholders cannot be identifiers on the assignment's left.
  if (/^\[[^\]]+\](?:,\s*\[[^\]]+\])?\s*:=\s*range\s*\[[^\]]+\]$/.test(body)) return true
  // A numbered diagram label followed by prose, not a language's arrow expression.
  if (/^Index\s+\d+\s*->\s+\S/.test(body)) return true
  // ASCII field diagrams begin and end cells with pipes, not expression operands.
  if (/^\|\s*[A-Za-z0-9_]+\s*\|/.test(body)) return true
  // Hex code mapping annotated with parenthetical names/prose, not function calls.
  return /^[A-Za-z_]\w*(?:\s+is\s+alias\s+for\s+[A-Za-z_]\w*)?\s*=\s*0x[\da-f]+\s+\([A-Za-z][^)]*\)(?:\s+\([^)]+\))*$/.test(body)
}

/** Does a comment body look like commented-out code (vs. a real prose comment)? */
function looksLikeCode(body: string): boolean {
  if (!body || body.length < 2) return false
  // Kubebuilder consumes these CRD schema/resource markers during generation.
  if (body.startsWith("+kubebuilder:")) return false
  if (SKIP_PREFIX.test(body) || isDocumentationRow(body)) return false
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

/** Non-host-language notation: protocol grammar, embedded-script argument maps,
 * and labelled bit-layout equations. Require a whole matching run and its
 * distinguishing syntax rather than treating arbitrary assignments as docs.
 */
function isDocumentationNotation(lines: string[], start: number, len: number, file: string): boolean {
  const bodies = lines.slice(start, start + len).map(line => commentBody(line) ?? "")
  // CSS value-definition grammar is not executable JavaScript/TypeScript.
  if (/\.[cm]?[jt]sx?$/.test(file) &&
      /^Spec:\s+[a-z][a-z-]+(?:\s+[a-z]+)?\s*=\s*<[a-z-]+>\s*\|\|\s*<[a-z-]+>$/i.test(bodies[0] ?? "") &&
      bodies.slice(1).every(body => /^[a-z]+(?:-[a-z]+)+\s*=\s*[a-z]+(?:\s*\|\s*[a-z]+)+$/i.test(body))) return true
  if (/\.go$/.test(file)) {
    // ABNF rule names contain hyphens; %d/%x terminals and repetition are not Go.
    if (bodies.every(body => /^[A-Za-z][\w]*-[\w-]+\s*=\s*.+$/.test(body)) &&
        bodies.some(body => /%[dx][\da-f]+(?:-[\da-f]+)?/i.test(body))) return true
    // Redis Lua argument declarations immediately introduce an embedded script.
    if (bodies.every(body => /^(?:KEYS|ARGV)\[\d+\]\s*=\s*\S/.test(body))) {
      const nextSource = lines.slice(start + len).find(line => line.trim() && commentBody(line) === null) ?? ""
      if (/\bredis\.NewScript\s*\(/.test(nextSource)) return true
    }
  }
  // Labels followed by symbolic binary fields and explicit bit widths, not calls.
  return bodies.every(body => /^[A-Za-z][A-Za-z0-9 -]*:\s+[01xy]{4,}(?:\s*\+\s*[01xy]{4,})*\s+\(\d+ bits\)$/.test(body))
}

/** Does the surrounding comment present the block as an example or input schema? */
function introducesExample(lines: string[], start: number, len: number, file: string): boolean {
  const near = commentParagraph(lines, start, len)
  // Swift source headers present public initializer snippets under Usage.
  // Require the heading before this indented run, and never cross real source.
  if (/\.swift$/.test(file) && lines.slice(start, start + len).every(isDocIndent)) {
    const before = lines.slice(0, start)
    if (before.every(line => !line.trim() || commentBody(line) !== null) &&
        before.some(line => /^usage\s*:\s*$/i.test(commentBody(line) ?? ""))) return true
  }
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

/** Labelled AST examples are documentation, not disabled statements.
 * Anonymous classes and exports cannot be JavaScript labelled statements.
 * Object rows additionally need a computed property: ordinary labelled blocks
 * and bare expression blocks remain eligible for the dead-code check.
 */
function semanticExampleRows(lines: string[], comments: Set<number>, file: string): Set<number> {
  const rows = new Set<number>()
  if (!/\.[cm]?[jt]sx?$/.test(file)) return rows
  const objectExample = /^\{\s*(?:\[[A-Za-z_$][\w$]*\]\s*:\s*(?:"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*)|[A-Za-z_$][\w$]*(?:\s*:\s*(?:"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*))?)\s*\}$/
  const objectRow = /^(?:yes|no|depends):\s*\{/
  let pending: number[] = []
  const flush = () => {
    const bodies = pending.map(n => commentBody(lines[n]) ?? "")
    const computedObject = bodies.some(b => /^(?:yes|no|depends):\s*\{\s*\[/.test(b))
    if (pending.length >= MIN_RUN && bodies.some(b => b.startsWith("yes:")) && bodies.some(b => b.startsWith("no:"))) {
      for (let i = 0; i < pending.length; i++) {
        if (!objectRow.test(bodies[i]) || computedObject) rows.add(pending[i])
      }
    }
    pending = []
  }
  for (let n = 0; n < lines.length; n++) {
    const body = comments.has(n) ? commentBody(lines[n]) ?? "" : ""
    const example = /^(?:yes|no|depends):\s*(.*)$/.exec(body)?.[1]
    if (example && (/^(?:class\s*\{|export\b)/.test(example) || objectExample.test(example))) pending.push(n)
    else flush()
  }
  flush()
  return rows
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
      const semanticRows = semanticExampleRows(lines, lineComments, norm)
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
          isDocumentationNotation(lines, runStart, runLen, norm) ||
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
        if (body !== null && !semanticRows.has(i) && looksLikeCode(body)) {
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
