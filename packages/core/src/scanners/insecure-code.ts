import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"

/**
 * Insecure Code scanner ⭐.
 *
 * Finds dangerous constructs in the repository's own source — the class of
 * problem you fix by editing a line, as opposed to {@link vulnerableDepsScanner}
 * (someone else's CVE) or {@link secretsScanner} (a leaked value).
 *
 * Deliberately high-precision rather than exhaustive. This is pattern matching,
 * not dataflow analysis: it cannot prove a value is attacker-controlled. So every
 * rule that could fire on safe code requires evidence of *dynamic* input —
 * interpolation, concatenation, an f-string — and rules that would need real
 * taint tracking to be trustworthy are simply absent. A scanner that cries wolf
 * gets its whole category ignored, which costs more than the findings it misses.
 *
 * Matches inside line comments are skipped, and findings in test files are
 * lowered one step: `rejectUnauthorized: false` against a local fixture server is
 * normal, the same line in `src/` is not.
 */

const JS_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/i
const PY_RE = /\.py$/i
// Vendored/generated code is not ours to fix, and minified bundles produce
// garbage line numbers.
const SKIP_RE = /(^|\/)(?:node_modules|vendor|third_party|dist|build|out|\.next)\/|\.min\.[cm]?js$/i
const TEST_RE =
  /(^|\/)(?:__tests__|tests?|specs?|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test_[^/]+\.py$|_test\.py$|(?:^|\/)conftest\.py$/i

const MAX_PER_FILE = 6
const MAX_TOTAL = 60
/** Skip enormous files: generated payloads dominate the report and cost time. */
const MAX_BYTES = 400_000

type Lang = "js" | "py"

interface VulnRule {
  /** Stable slug — part of the issue id, so renaming one resets its snooze. */
  id: string
  lang: Lang
  re: RegExp
  severity: Severity
  title: string
  /** What is wrong and what to do instead. Findings without a fix are noise. */
  detail: string
}

const RULES: VulnRule[] = [
  // ---- JavaScript / TypeScript -------------------------------------------
  {
    id: "eval-dynamic",
    lang: "js",
    // Only when the argument is not a plain string literal: `eval("1+1")` is
    // pointless but harmless, `eval(userInput)` is remote code execution.
    re: /\beval\s*\(\s*[^)'"`\s]/g,
    severity: "critical",
    title: "eval() on a non-literal value",
    detail:
      "`eval` executes whatever string it is given. If any part of that string can come from a " +
      "request, a file or a URL, this is remote code execution. Replace it with an explicit " +
      "lookup — `JSON.parse` for data, a map of allowed operations for behaviour.",
  },
  {
    id: "new-function",
    lang: "js",
    re: /\bnew\s+Function\s*\(/g,
    severity: "critical",
    title: "Code built at runtime with new Function()",
    detail:
      "`new Function(...)` compiles a string into code, with the same consequences as `eval` and " +
      "the same fix: express the behaviour directly instead of assembling it from text.",
  },
  {
    id: "exec-interpolated",
    lang: "js",
    // A shell command assembled from a template literal or string concatenation.
    re: /\bexec(?:Sync|File)?\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/g,
    severity: "critical",
    title: "Shell command built by string interpolation",
    detail:
      "`exec` runs its argument through a shell, so an interpolated value containing `;` or `$(...)` " +
      "runs as a separate command. Use `execFile`/`spawn` with an argument array, which never " +
      "involves a shell, instead of building one string.",
  },
  {
    id: "sql-interpolated",
    lang: "js",
    re: /\b(?:query|execute|raw)\s*\(\s*(?:`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^`]*\$\{|['"][^'"]*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^'"]*['"]\s*\+)/gi,
    severity: "critical",
    title: "SQL query assembled by string interpolation",
    detail:
      "The query text is built by pasting a value into SQL, which is what SQL injection is. Use a " +
      "parameterised query — placeholders plus a values array — so the driver sends the value " +
      "separately from the statement.",
  },
  {
    id: "innerhtml-dynamic",
    lang: "js",
    re: /\.innerHTML\s*=\s*[^;\n]*(?:\$\{|\+\s*[A-Za-z_$])/g,
    severity: "warning",
    title: "innerHTML assigned a value built at runtime",
    detail:
      "Assigning built-up HTML runs any `<script>` or event handler inside it. If the value can " +
      "carry user input this is cross-site scripting. Use `textContent` for text, or sanitise " +
      "before assigning if markup really is required.",
  },
  {
    id: "react-dangerous-html",
    lang: "js",
    re: /dangerouslySetInnerHTML/g,
    severity: "warning",
    title: "dangerouslySetInnerHTML bypasses React's escaping",
    detail:
      "React escapes output by default; this prop turns that off for the subtree. Confirm the HTML " +
      "is either a literal you wrote or has been through a sanitiser such as DOMPurify.",
  },
  {
    id: "tls-verification-off",
    lang: "js",
    re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0/g,
    severity: "critical",
    title: "TLS certificate verification disabled",
    detail:
      "This accepts any certificate, including one an attacker on the network presents — the " +
      "connection is encrypted but not authenticated, which defeats the point. If it was to work " +
      "around a self-signed certificate, add that certificate as a trusted CA instead.",
  },
  {
    id: "weak-hash",
    lang: "js",
    re: /createHash\s*\(\s*['"](?:md5|sha1)['"]/gi,
    severity: "warning",
    title: "Weak hash algorithm (MD5/SHA-1)",
    detail:
      "MD5 and SHA-1 have practical collision attacks and must not be used for signatures, " +
      "integrity checks or password storage. Use SHA-256 for integrity, and a purpose-built " +
      "password hash (argon2, bcrypt, scrypt) for passwords. Harmless for cache keys.",
  },
  {
    id: "random-for-secret",
    lang: "js",
    // A leading `\w*` so camelCase names match too: `sessionToken` has no word
    // boundary before "Token", and that is the spelling people actually use.
    re: /\b\w*(?:token|secret|password|passwd|salt|nonce|api_?key|session_?id)\w*\s*[=:]\s*[^;\n]*Math\.random\s*\(/gi,
    severity: "warning",
    title: "Security value generated with Math.random()",
    detail:
      "`Math.random` is a predictable pseudo-random generator, not a cryptographic one — its output " +
      "can be reconstructed from earlier values. Use `crypto.randomBytes` / `crypto.getRandomValues` " +
      "for anything anyone is not supposed to guess.",
  },

  // ---- Python -------------------------------------------------------------
  {
    id: "py-shell-true",
    lang: "py",
    // No dotAll flag needed: `[^)]` already spans newlines, and `s` requires an
    // ES2018 target the dashboard's tsconfig does not use.
    re: /\bsubprocess\.(?:run|call|check_output|check_call|Popen)\s*\([^)]*shell\s*=\s*True/g,
    severity: "critical",
    title: "subprocess called with shell=True",
    detail:
      "`shell=True` sends the command through a shell, so any interpolated value containing `;` or " +
      "backticks runs as its own command. Drop it and pass the command as a list of arguments.",
  },
  {
    id: "py-os-system",
    lang: "py",
    re: /\bos\.system\s*\(\s*(?:f['"]|['"][^'"]*['"]\s*[+%]|[A-Za-z_])/g,
    severity: "critical",
    title: "os.system() with a constructed command",
    detail:
      "`os.system` always runs a shell, and the command here is built rather than fixed. Use " +
      "`subprocess.run([...])` with an argument list, which does not involve a shell at all.",
  },
  {
    id: "py-yaml-load",
    lang: "py",
    // yaml.load without a Loader= argument constructs arbitrary Python objects.
    re: /\byaml\.load\s*\((?![^)]*Loader\s*=)/g,
    severity: "critical",
    title: "yaml.load() without a safe loader",
    detail:
      "Plain `yaml.load` can instantiate arbitrary Python objects from the document, which makes " +
      "parsing an untrusted file equivalent to running it. Use `yaml.safe_load`.",
  },
  {
    id: "py-pickle-load",
    lang: "py",
    re: /\bpickle\.loads?\s*\(/g,
    severity: "warning",
    title: "pickle deserialises arbitrary objects",
    detail:
      "Unpickling executes constructors chosen by the data, so a crafted payload runs code. It is " +
      "safe only for data you produced yourself and stored somewhere nobody else can write. For " +
      "anything crossing a trust boundary use JSON.",
  },
  {
    id: "py-eval-exec",
    lang: "py",
    re: /\b(?:eval|exec)\s*\(\s*[^)'"\s]/g,
    severity: "critical",
    title: "eval()/exec() on a non-literal value",
    detail:
      "Both execute the string they are handed. If any part of it can come from outside the " +
      "program this is remote code execution. Use `ast.literal_eval` for data, or an explicit " +
      "mapping of permitted operations.",
  },
  {
    id: "py-verify-false",
    lang: "py",
    re: /\brequests\.(?:get|post|put|patch|delete|head|request)\s*\([^)]*verify\s*=\s*False/g,
    severity: "critical",
    title: "TLS certificate verification disabled",
    detail:
      "`verify=False` accepts any certificate, so the connection is encrypted but not authenticated " +
      "and can be intercepted. Point `verify=` at the CA bundle that should be trusted instead.",
  },
]

/**
 * Ranges on a line that are inside a string or regex literal — text, not code.
 *
 * From a dogfood run: this scanner flagged its OWN rule table. `rejectUnauthorized:
 * false` really does appear there, inside `/…/g`, and the words "new Function()"
 * appear in the prose explaining the rule. Neither executes.
 *
 * That is not a quirk of scanning ourselves. Linters, security tooling, WAF
 * configs, documentation and test matchers all hold dangerous-looking text in
 * patterns and strings. A description of code is not code, and a scanner that
 * cannot tell the difference reports every security tool as insecure.
 *
 * The trade is deliberate and small: code assembled inside a string is missed.
 * That is the eval-family case, which the eval rules already catch at the call.
 *
 * Exported for tests — the distinction is load-bearing.
 */
export function literalRanges(line: string): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0

  while (i < line.length) {
    const c = line[i]

    // A line comment ends the line for our purposes.
    if (c === "/" && (line[i + 1] === "/" || line[i + 1] === "*")) break

    if (c === '"' || c === "'" || c === "`") {
      const start = i
      i++
      while (i < line.length) {
        if (line[i] === "\\") i += 2
        else if (line[i] === c) break
        else i++
      }
      // Unterminated (a multi-line template): treat the rest of the line as text.
      ranges.push([start, i >= line.length ? line.length : i])
      i++
      continue
    }

    if (c === "/") {
      // `/` opens a regex only where a value may begin; after an identifier,
      // number or closing bracket it is division.
      const before = line.slice(0, i).trimEnd()
      const prev = before[before.length - 1] ?? ""
      if (prev === "" || /[(,=:[!&|?{};+*%<>~^-]/.test(prev)) {
        const start = i
        let j = i + 1
        let inClass = false
        for (; j < line.length; j++) {
          const ch = line[j]
          if (ch === "\\") j++
          else if (ch === "[") inClass = true
          else if (ch === "]") inClass = false
          else if (ch === "/" && !inClass) break
        }
        if (j < line.length) {
          ranges.push([start, j])
          i = j + 1
          continue
        }
      }
    }

    i++
  }

  return ranges
}

/** Line-comment markers, used to skip commented-out code. */
const COMMENT_MARKERS: Record<Lang, string[]> = {
  js: ["//"],
  py: ["#"],
}

function langOf(path: string): Lang | null {
  if (JS_RE.test(path)) return "js"
  if (PY_RE.test(path)) return "py"
  return null
}

/** 1-based line number of a string index. */
function lineAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length
}

const LOWER: Record<Severity, Severity> = {
  critical: "warning",
  warning: "info",
  info: "info",
}

/**
 * Rules that almost always fire on purpose in tests (fixtures that exercise
 * eval / Function / the scanner itself). Reporting them even at lowered severity
 * is noise — the finding is the test, not a vulnerability.
 */
const SKIP_IN_TEST = new Set(["new-function", "eval-dynamic"])

export interface CodeHit {
  rule: VulnRule
  line: number
  evidence: string
}

/**
 * Collect rule hits for one file's contents.
 *
 * Exported for tests: the rule set is the interesting part of this scanner and
 * deserves to be exercised without a ScanContext around it.
 */
export function scanSource(content: string, lang: Lang): CodeHit[] {
  const markers = COMMENT_MARKERS[lang]
  // One finding per line: overlapping rules on the same line describe one defect.
  const byLine = new Map<number, CodeHit>()

  for (const rule of RULES) {
    if (rule.lang !== lang) continue
    rule.re.lastIndex = 0
    for (const m of content.matchAll(rule.re)) {
      const idx = m.index ?? 0
      const lineStart = content.lastIndexOf("\n", idx - 1) + 1
      const prefix = content.slice(lineStart, idx)
      if (markers.some((mk) => prefix.includes(mk))) continue

      const line = lineAt(content, idx)
      const lineEnd = content.indexOf("\n", idx)
      const rawLine = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
      const text = rawLine.trim()

      if (lang === "js") {
        const col = idx - lineStart
        if (literalRanges(rawLine).some(([a, b]) => col > a && col < b)) continue
      }

      const existing = byLine.get(line)
      // Keep the most severe rule when several match the same line.
      if (existing && rank(existing.rule.severity) >= rank(rule.severity)) continue
      byLine.set(line, { rule, line, evidence: text.slice(0, 160) })
    }
  }

  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

function rank(s: Severity): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : 1
}

export const insecureCodeScanner: Scanner = {
  id: "insecure-code",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (SKIP_RE.test(norm)) continue

      const lang = langOf(norm)
      if (!lang) continue

      const size = await ctx.fileSize?.(file)
      if (size !== null && size !== undefined && size > MAX_BYTES) continue

      const content = await ctx.readFile(file)
      if (!content) continue

      const isTest = TEST_RE.test(norm)

      let perFile = 0
      for (const hit of scanSource(content, lang)) {
        if (issues.length >= MAX_TOTAL || perFile >= MAX_PER_FILE) break
        if (isTest && SKIP_IN_TEST.has(hit.rule.id)) continue
        perFile++

        // Blame gives the finding an age, so a fresh regression is visible next
        // to code that has been wrong for two years. Failure is not fatal.
        let ageDays = 0
        try {
          ageDays = await ctx.git.blameAgeDays(file, hit.line)
        } catch {
          /* blame unavailable — age stays 0 */
        }

        issues.push({
          id: `insecure-${hit.rule.id}-${norm}:${hit.line}`,
          category: "security",
          severity: isTest ? LOWER[hit.rule.severity] : hit.rule.severity,
          title: hit.rule.title,
          location: `${norm}:${hit.line}`,
          ageDays,
          detail: isTest
            ? `${hit.rule.detail} Lowered one severity step because this is a test file, where the ` +
              "pattern is often deliberate."
            : hit.rule.detail,
          evidence: hit.evidence,
        })
      }
    }

    return issues
  },
}
