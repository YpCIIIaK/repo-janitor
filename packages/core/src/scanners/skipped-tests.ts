import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"

/**
 * Skipped / Focused Tests scanner.
 *
 * Disabled and focused tests are quietly rotting coverage:
 *  - **focused** (`describe.only`, `it.only`, `fit`, `fdescribe`) — *worse than
 *    skipping*: it silently disables every other test in the file, so CI can stay
 *    green while almost nothing runs. Flagged as a warning.
 *  - **skipped** (`it.skip`, `xit`, `xdescribe`, `it.todo`, pytest `@skip`) — a
 *    test that no longer runs. Flagged as info.
 *
 * Line-based so findings carry a `file:line` location (and respect inline
 * ignores). Capped per-file and overall.
 */

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts|py)$/
const MAX_PER_FILE = 10
const MAX_TOTAL = 60

interface Rule {
  re: RegExp
  severity: Severity
  label: string
}

// Order matters only for the message; each line is tested against all rules but
// reported once (first match wins) to avoid double-counting `it.only`.
const RULES: Rule[] = [
  // Focused tests — disable the rest of the suite. Highest signal.
  { re: /\b(?:describe|it|test|context|suite)\.only\s*\(/, severity: "warning", label: "focused test (.only)" },
  { re: /\bf(?:it|describe|test)\s*\(/, severity: "warning", label: "focused test (fit/fdescribe)" },
  // Skipped tests — no longer run.
  { re: /\b(?:describe|it|test|context|suite)\.skip\s*\(/, severity: "info", label: "skipped test (.skip)" },
  { re: /\bx(?:it|describe|test|context)\s*\(/, severity: "info", label: "skipped test (xit/xdescribe)" },
  { re: /\b(?:it|test)\.todo\s*\(/, severity: "info", label: "unimplemented test (.todo)" },
  // Python (pytest / unittest).
  { re: /@(?:pytest\.mark\.skip|unittest\.skip)\b/, severity: "info", label: "skipped test (@skip)" },
  { re: /\b(?:self\.skipTest|pytest\.skip)\s*\(/, severity: "info", label: "skipped test (skip call)" },
]

export const skippedTestsScanner: Scanner = {
  id: "skipped-tests",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (!SOURCE_RE.test(norm) || norm.includes(".min.")) continue

      const content = await ctx.readFile(file)
      if (!content) continue
      // Cheap pre-filter: nothing test-skip-ish in the whole file.
      if (!/\.(?:only|skip|todo)\s*\(|\bf(?:it|describe|test)\s*\(|\bx(?:it|describe|test|context)\s*\(|@(?:pytest\.mark\.skip|unittest\.skip)|skipTest|pytest\.skip/.test(content)) {
        continue
      }

      const lines = content.split(/\r?\n/)
      let perFile = 0
      for (let i = 0; i < lines.length && perFile < MAX_PER_FILE && issues.length < MAX_TOTAL; i++) {
        const line = lines[i]
        const rule = RULES.find((r) => r.re.test(line))
        if (!rule) continue
        const lineNo = i + 1
        const focused = rule.severity === "warning"
        issues.push({
          id: `skiptest-${norm}:${lineNo}`,
          category: "hygiene",
          severity: rule.severity,
          title: `Disabled coverage: ${rule.label}`,
          location: `${norm}:${lineNo}`,
          ageDays: 0,
          detail: focused
            ? `A ${rule.label} is committed — focusing disables every other test in this file, so the ` +
              `suite can pass while almost nothing runs. Remove the focus before merging.`
            : `A ${rule.label} is committed. It no longer runs, so the behaviour it covered is ` +
              `unprotected. Re-enable it or delete it if it's obsolete.`,
          evidence: line.trim().slice(0, 120),
        })
        perFile++
      }
    }

    return issues
  },
}
