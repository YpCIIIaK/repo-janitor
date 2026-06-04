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

/** Is this raw source line a single-line `//` comment? Returns its body or null. */
function commentBody(line: string): string | null {
  const m = line.match(/^\s*\/\/(.*)$/)
  return m ? m[1].trim() : null
}

/** Does a comment body look like commented-out code (vs. a real prose comment)? */
function looksLikeCode(body: string): boolean {
  if (!body || body.length < 2) return false
  if (SKIP_PREFIX.test(body)) return false
  if (PROSE_TAIL.test(body)) return false
  // Backticks almost always mean inline-code-in-prose (doc comments), not an
  // actual commented-out statement — skip to avoid flagging documentation.
  if (body.includes("`")) return false
  return CODE_SIGNAL.test(body)
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

      const content = await ctx.readFile(file)
      if (!content || !content.includes("//")) continue

      const lines = content.split(/\r?\n/)
      let perFile = 0
      let runStart = -1
      let runLen = 0

      const flush = () => {
        if (runLen >= MIN_RUN && perFile < MAX_PER_FILE && issues.length < MAX_TOTAL) {
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
        const body = commentBody(lines[i])
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
