import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Duplicate Code scanner ⭐.
 *
 * Finds blocks of code that appear more than once, verbatim, in different places.
 *
 * Duplication is the entropy signal with the clearest time axis in this whole
 * tool. Nobody sets out to write the same forty lines twice; it happens because
 * the original was in an awkward place, or nobody knew it existed, or there was
 * no time to find out. Each copy then drifts on its own — a bug is fixed in two
 * of the three, a validation rule is tightened in one. That is the decay: not the
 * copying, which is often the reasonable call under a deadline, but the fact that
 * from then on there is no single answer to what the code does.
 *
 * ## Precision over recall, on purpose
 *
 * Serious clone detectors normalise identifiers so that a renamed copy still
 * matches. This one does not. It collapses whitespace and drops noise lines, and
 * then requires the remaining text to be **identical**.
 *
 * That misses real duplication — a copy with the variables renamed goes
 * unreported. It is still the right trade here. A finding that says "these two
 * blocks are the same" can be checked in ten seconds by opening both; a finding
 * that says "these are structurally similar" starts an argument, and a tool that
 * starts arguments gets switched off. The rule this project keeps everywhere
 * applies again: under-report rather than misreport.
 *
 * ## What is deliberately not counted
 *
 *  - **Generated and vendored code.** Nobody maintains it, so nobody can fix it.
 *  - **Test files.** Tests repeat themselves by design — a table of cases that
 *    differ in one value is a good test suite, not a decaying one. Reporting them
 *    would bury the real findings under the honest ones.
 *  - **Short blocks.** Eight significant lines minimum, plus a length floor, so
 *    that import headers, switch arms and error-handling boilerplate do not
 *    register.
 */

/** Consecutive significant lines that must match before anything is reported. */
const WINDOW = 8

/** Minimum total characters in a block, so eight short lines do not qualify. */
const MIN_CHARS = 240

/** Cap on findings. */
const MAX_ISSUES = 15

/** Cap on files read, so a huge monorepo cannot turn this into the slow scanner. */
const MAX_FILES = 4000

/** A block repeated at least this many times is a pattern, not an accident. */
const MANY_COPIES = 4

/** Lines in a duplicated block beyond which it stops being a snippet. */
const LARGE_BLOCK = 30

const CODE_EXT =
  /\.(?:[cm]?[jt]sx?|py|go|rs|rb|php|java|kt|kts|swift|scala|cs|c|cc|cpp|h|hpp|m|mm|dart|ex|exs|vue|svelte)$/i

/**
 * Paths nobody maintains by hand, or whose repetition is the point.
 *
 * `template-*` earns its place from vite, which produced fifteen findings from
 * `packages/create-vite/`: `template-react` and `template-react-ts` are the same
 * starter app in two languages, and being the same is their entire job. A
 * scaffold that had diverged would be the bug.
 */
const SKIP_PATH =
  /(^|\/)(?:node_modules|vendor|third_party|thirdparty|dist|build|out|target|generated|__generated__|\.next|\.nuxt|coverage|migrations|__snapshots__|__fixtures__|fixtures?|testdata|examples?|templates?(?:[-_.][\w.-]*)?|scaffolds?|starters?|playgrounds?)\//i

/** Files that are machine output even when their directory looks ordinary. */
const GENERATED_FILE =
  /(?:\.min\.[jt]s|\.bundle\.js|\.g\.dart|_pb2?\.py|\.pb\.go|\.generated\.[a-z]+|\.d\.ts)$/i

/** Test files: repetition there is a feature. */
const TEST_FILE =
  /(^|\/)(?:tests?|spec|__tests__|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|[^/]+_test\.(?:py|go|rb)$|[^/]+Test\.(?:java|kt|cs)$|_spec\.rb$/i

/**
 * Lines that carry no weight of their own.
 *
 * A closing brace matching a closing brace is not duplication, and neither is an
 * import block — two files importing the same six modules is what a shared
 * dependency looks like. Dropping them before hashing is what stops the scanner
 * reporting every file in a project against every other.
 */
const NOISE =
  /^(?:[{}()[\];,]+|else\s*\{?|\}?\s*else\s*(?:if.*)?\{?|return;?|break;?|continue;?|pass|end|fi|done|<\/?\w+\s*\/?>)$/

const IMPORTISH = /^(?:import\b|from\s+\S+\s+import\b|#include\b|using\s+\w|require\s*\(|use\s+\w|package\b|export\s+\*|export\s+\{)/

const COMMENT = /^(?:\/\/|#|\*|\/\*|--|;;)/

export interface NormalizedLine {
  /** Collapsed text used for matching. */
  text: string
  /** 1-based line number in the original file. */
  line: number
}

/**
 * Strip a file down to the lines worth comparing.
 *
 * Exported for tests: what counts as a significant line decides everything the
 * scanner reports, so the rule wants cases of its own.
 */
export function significantLines(content: string): NormalizedLine[] {
  const out: NormalizedLine[] = []
  const lines = content.split(/\r?\n/)
  let inBlockComment = false

  for (let i = 0; i < lines.length; i++) {
    let text = lines[i].trim()
    if (inBlockComment) {
      if (text.includes("*/")) inBlockComment = false
      continue
    }
    if (text.startsWith("/*")) {
      if (!text.includes("*/")) inBlockComment = true
      continue
    }
    if (!text || COMMENT.test(text)) continue
    text = text.replace(/\s+/g, " ")
    if (NOISE.test(text) || IMPORTISH.test(text)) continue
    out.push({ text, line: i + 1 })
  }

  return out
}

/**
 * Lines that declare a shape rather than do anything.
 *
 * A TypeScript overload set repeats its type parameters and its parameter list
 * once per signature — the language requires it, and there is no version of the
 * code that does not. redux produced both of this scanner's first false
 * positives that way: ten lines of `createStore` overloads matching the next ten,
 * and a signature matching the same signature in `types/store.ts`. Telling a
 * maintainer to de-duplicate an overload set is telling them to stop using
 * overloads.
 */
const DECLARATIVE = [
  /^(?:export\s+)?(?:declare\s+)?(?:type|interface|enum|abstract\s+class)\b/,
  /^[\w$]+\??\s*:\s*[^=]+,?$/, // name: Type   (an annotation, not an assignment)
  /^[A-Z]\w*(?:\s+extends\s+.+?)?(?:\s*=\s*[^=]*?)?,?$/, // generic parameter
  /^\)?\s*:\s*.+$/, // a return-type line
  /^[<>(),\s|&]*$/, // punctuation left over from a signature
]

function isDeclarative(text: string): boolean {
  return DECLARATIVE.some((re) => re.test(text))
}

/**
 * Share of a block that is type-level. Above this it is a declaration, and the
 * repetition is the language's doing rather than the author's.
 */
const DECLARATIVE_SHARE = 0.7

/** An SVG element — the marker that a block of markup is a pasted asset. */
const SVG_TAG =
  /^<\/?(?:svg|g|defs|path|filter|fe[A-Z]\w*|clipPath|mask|stop|linearGradient|radialGradient|circle|rect|ellipse|polygon|polyline|line|use|symbol)\b/i

/** A bare `name="value"` attribute on its own line. */
const ATTRIBUTE = /^[a-z][\w-]*(?::[\w-]+)?=["'][^"']*["']\s*\/?>?$/i

/**
 * Is this block a pasted SVG rather than code?
 *
 * vite's SponsorBanner.vue carries an inline logo whose `<filter>` definitions
 * repeat twelve times — which made it the loudest finding in the whole run and
 * the least useful one, since the "duplication" is inside an exported asset
 * nobody edits by hand. The test needs both halves: mostly markup AND at least
 * one SVG element, so that duplicated JSX — which is real duplication people do
 * want to hear about — still reports.
 */
function isPastedSvg(block: NormalizedLine[]): boolean {
  const markup = block.filter((l) => SVG_TAG.test(l.text) || ATTRIBUTE.test(l.text) || /^<\/?\w/.test(l.text))
  return (
    markup.length / block.length >= DECLARATIVE_SHARE && block.some((l) => SVG_TAG.test(l.text))
  )
}

/** Cheap, stable string hash (FNV-1a, 32-bit) for window keys. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

interface Occurrence {
  file: string
  /** Index into that file's significant-line array. */
  index: number
}

export interface DuplicateBlock {
  /** Every place the block appears, first occurrence first. */
  places: { file: string; startLine: number; endLine: number }[]
  /** Significant lines in the block. */
  length: number
  /** First line of the first occurrence, as evidence. */
  sample: string
}

/**
 * Find repeated blocks across a set of already-normalised files.
 *
 * Pure and exported: this is the algorithm, and it is the part most worth
 * pinning down with tests that do not involve reading a repository.
 */
export function findDuplicates(files: Map<string, NormalizedLine[]>): DuplicateBlock[] {
  // 1) Hash every window of WINDOW consecutive significant lines.
  const windows = new Map<string, Occurrence[]>()
  const keys = new Map<string, string[]>()

  for (const [file, lines] of files) {
    if (lines.length < WINDOW) continue
    const fileKeys: string[] = []
    for (let i = 0; i + WINDOW <= lines.length; i++) {
      const key = hash(
        lines
          .slice(i, i + WINDOW)
          .map((l) => l.text)
          .join("\n"),
      )
      fileKeys.push(key)
      const bucket = windows.get(key)
      if (bucket) bucket.push({ file, index: i })
      else windows.set(key, [{ file, index: i }])
    }
    keys.set(file, fileKeys)
  }

  // 2) Walk each file's windows in order, emitting maximal blocks. A window
  //    already covered by an emitted block is skipped, so a 40-line clone
  //    reports once rather than thirty-three times.
  const covered = new Map<string, Set<number>>()
  const isCovered = (file: string, i: number) => covered.get(file)?.has(i) ?? false
  const cover = (file: string, from: number, to: number) => {
    let set = covered.get(file)
    if (!set) covered.set(file, (set = new Set()))
    for (let i = from; i <= to; i++) set.add(i)
  }

  const blocks: DuplicateBlock[] = []

  for (const [file, fileKeys] of keys) {
    const lines = files.get(file) as NormalizedLine[]

    for (let i = 0; i < fileKeys.length; i++) {
      if (isCovered(file, i)) continue
      const group = windows.get(fileKeys[i]) as Occurrence[]
      // Only the first occurrence of a group opens a block; the others are found
      // as its partners.
      if (group.length < 2 || group[0].file !== file || group[0].index !== i) continue

      const partners = group.slice(1).filter((o) => !isCovered(o.file, o.index))
      if (partners.length === 0) continue

      // 3) Extend while every partner keeps matching in lockstep.
      let extra = 0
      for (;;) {
        const next = i + extra + 1
        const nextKey = keys.get(file)?.[next]
        if (nextKey === undefined) break
        const nextGroup = windows.get(nextKey)
        if (!nextGroup) break
        const allFollow = partners.every((p) =>
          nextGroup.some((o) => o.file === p.file && o.index === p.index + extra + 1),
        )
        if (!allFollow) break
        extra++
      }

      const length = WINDOW + extra
      const place = (o: Occurrence) => {
        const ls = files.get(o.file) as NormalizedLine[]
        return {
          file: o.file,
          startLine: ls[o.index].line,
          endLine: ls[Math.min(o.index + length - 1, ls.length - 1)].line,
        }
      }

      const block = lines.slice(i, i + length)
      const text = block.map((l) => l.text).join("\n")
      if (text.length < MIN_CHARS) continue
      if (block.filter((l) => isDeclarative(l.text)).length / block.length >= DECLARATIVE_SHARE) {
        continue
      }
      if (isPastedSvg(block)) continue

      cover(file, i, i + extra)
      for (const p of partners) cover(p.file, p.index, p.index + extra)

      blocks.push({
        places: [place(group[0]), ...partners.map(place)],
        length,
        sample: lines[i].text.slice(0, 160),
      })
    }
  }

  // Biggest first: a 60-line clone is the finding, an 8-line one is a footnote.
  return blocks.sort((a, b) => b.length - a.length || b.places.length - a.places.length)
}

/** Is this file worth comparing at all? */
export function isComparable(file: string): boolean {
  const norm = file.replace(/\\/g, "/")
  return (
    CODE_EXT.test(norm) &&
    !SKIP_PATH.test(norm) &&
    !GENERATED_FILE.test(norm) &&
    !TEST_FILE.test(norm)
  )
}

export const duplicateCodeScanner: Scanner = {
  id: "duplicate-code",
  category: "hygiene",

  async run(ctx: ScanContext): Promise<Issue[]> {
    const candidates = ctx.files.filter(isComparable).slice(0, MAX_FILES)
    if (candidates.length < 2) return []

    const normalized = new Map<string, NormalizedLine[]>()
    for (const file of candidates) {
      const content = await ctx.readFile(file)
      if (!content) continue
      // A single enormous line is minified output whatever it is called.
      if (content.length > 2000 && !content.includes("\n")) continue
      const lines = significantLines(content)
      if (lines.length >= WINDOW) normalized.set(file.replace(/\\/g, "/"), lines)
    }

    const blocks = findDuplicates(normalized).slice(0, MAX_ISSUES)
    const issues: Issue[] = []

    for (const b of blocks) {
      const [first, ...rest] = b.places
      const copies = b.places.length
      const severity =
        b.length >= LARGE_BLOCK || copies >= MANY_COPIES ? "warning" : "info"

      const where = rest
        .slice(0, 4)
        .map((p) => `${p.file}:${p.startLine}`)
        .join(", ")
      const more = rest.length > 4 ? ` and ${rest.length - 4} more` : ""

      let ageDays = 0
      try {
        ageDays = await ctx.git.blameAgeDays(first.file, first.startLine)
      } catch {
        /* blame is a nicety */
      }

      issues.push({
        id: `duplicate-${first.file}-${first.startLine}`,
        category: "hygiene",
        severity,
        title:
          copies === 2
            ? `${b.length} lines duplicated between two files`
            : `${b.length} lines repeated in ${copies} places`,
        location: `${first.file}:${first.startLine}`,
        ageDays,
        detail:
          `The same ${b.length} significant lines appear at ${where}${more}. Matching is verbatim ` +
          `after whitespace and comments are dropped, so these really are the same text rather than ` +
          `merely similar code. Copies drift: a fix lands in one of them, a validation rule is ` +
          `tightened in another, and from then on there is no single answer to what this code does. ` +
          `Test files, generated output and vendored directories are excluded from this check.`,
        evidence: b.sample,
      })
    }

    return issues
  },
}
