import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"

/**
 * End-of-life Runtime scanner ⭐.
 *
 * Reports runtimes the project is pinned to that no longer receive security
 * patches: Node, Python, and the GitHub-hosted runner images.
 *
 * This is the purest example of what this project is for. Nothing in the
 * repository changes, nobody commits anything, and one day the code is running
 * on a platform that will never be patched again. The finding appears on its
 * own, from a date passing — decay in the literal sense, which no linter that
 * only reads the working tree can ever see.
 *
 * ## The table ages, so it is built to age safely
 *
 * EOL dates are bundled rather than fetched: a scanner that needs the network to
 * say anything is a scanner that says nothing in CI. The cost is that this table
 * is itself a decaying artefact — which, in this project, would be funny exactly
 * once. Two rules keep it honest:
 *
 *  1. **An unknown version is silence, never a finding.** Node 30 is not in the
 *     table below; the correct output for it is nothing at all. Anything else
 *     would mean the scanner starts crying wolf the moment it falls behind, and
 *     the failure mode of a stale table would be false positives — the one
 *     failure this project cannot afford.
 *  2. **Dates already passed stay passed.** Every entry here is a date, compared
 *     against the clock at scan time. Old entries never need revising; the table
 *     only ever needs *adding* to, and until someone adds to it the scanner
 *     under-reports. Under-reporting is the safe direction.
 *
 * ## A pin is not a floor
 *
 * `.nvmrc: 14` says "run this on Node 14". `engines.node: ">=14"` says "14 or
 * newer" — the project may well be running on 22, and the declaration is merely
 * permissive. Both are worth knowing and they are not the same fact, so a pin to
 * a dead runtime is a warning and a floor at one is info. Collapsing them would
 * put a scary badge on half of npm, since `>=14` floors are everywhere.
 */

/** Cap so a monorepo full of Dockerfiles cannot flood a report. */
const MAX_ISSUES = 30

/** Warn ahead of time once a runtime is this close to its EOL date. */
const APPROACHING_DAYS = 90

/**
 * When this table was last checked against upstream. Surfaced in the finding so
 * a reader can judge for themselves how much to trust it, rather than taking a
 * bundled constant on faith.
 */
const TABLE_AS_OF = "2026-07-30"

/**
 * EOL dates, ISO, from endoflife.date and the vendors' own schedules.
 *
 * Only entries there is a published date for. A runtime missing from a table is
 * treated as supported (see rule 1 above), so leaving one out costs a missed
 * finding, while guessing at one costs a false accusation.
 */
const NODE_EOL: Record<string, string> = {
  "8": "2019-12-31",
  "9": "2018-06-30",
  "10": "2021-04-30",
  "11": "2019-06-01",
  "12": "2022-04-30",
  "13": "2020-06-01",
  "14": "2023-04-30",
  "15": "2021-06-01",
  "16": "2023-09-11",
  "17": "2022-06-01",
  "18": "2025-04-30",
  "19": "2023-06-01",
  "20": "2026-04-30",
  "21": "2024-06-01",
  "22": "2027-04-30",
  "23": "2025-06-01",
  "24": "2028-04-30",
}

const PYTHON_EOL: Record<string, string> = {
  "2.7": "2020-01-01",
  "3.0": "2009-06-27",
  "3.1": "2012-04-09",
  "3.2": "2016-02-20",
  "3.3": "2017-09-29",
  "3.4": "2019-03-18",
  "3.5": "2020-09-13",
  "3.6": "2021-12-23",
  "3.7": "2023-06-27",
  "3.8": "2024-10-07",
  "3.9": "2025-10-31",
  "3.10": "2026-10-31",
  "3.11": "2027-10-31",
  "3.12": "2028-10-31",
  "3.13": "2029-10-31",
}

/**
 * Retirement dates for GitHub-hosted runner images.
 *
 * Different in kind from the two above: when one of these passes, workflows do
 * not merely go unpatched, they stop running. `ubuntu-latest` and the other
 * floating labels are deliberately absent — that is the recommended form and
 * moves on its own.
 */
const RUNNER_EOL: Record<string, string> = {
  "ubuntu-16.04": "2021-09-20",
  "ubuntu-18.04": "2023-04-01",
  "ubuntu-20.04": "2025-04-15",
  "macos-10.15": "2022-08-30",
  "macos-11": "2024-06-28",
  "macos-12": "2024-12-03",
  "windows-2016": "2022-04-15",
  "windows-2019": "2025-06-30",
}

export type EolKind = "node" | "python" | "runner"

export interface EolFinding {
  kind: EolKind
  /** The version or image label exactly as written in the file. */
  version: string
  /**
   * The release line it resolved to — the key in the table above.
   *
   * Kept apart from `version` because that is raw text: `3.6-slim`, `>= 18`,
   * `v14.21.3`. Titles read off this one, so a finding says "Python 3.6" rather
   * than "Python 3.6-slim", while `evidence` still carries the original line.
   */
  release: string
  /** ISO date the runtime went (or goes) out of support. */
  eol: string
  /** A pin says "run on this"; a floor says "this or newer". */
  pinned: boolean
  file: string
  line: number
  evidence: string
}

/** Whole days from `from` to `to`; negative when `to` is in the past. */
function daysUntil(iso: string, now: number): number {
  const t = Date.parse(`${iso}T00:00:00Z`)
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY
  return Math.round((t - now) / 86_400_000)
}

/** `v18.20.4` / `18.x` / `>=18.0.0` → `18`. Null when no major is present. */
function nodeMajor(raw: string): string | null {
  const m = raw.trim().match(/(\d+)/)
  return m ? m[1] : null
}

/** `3.7.9` / `>=3.7` / `3.7-slim` → `3.7`. Null when no minor is present. */
function pythonMinor(raw: string): string | null {
  const m = raw.trim().match(/(\d+)\.(\d+)/)
  return m ? `${m[1]}.${m[2]}` : null
}

/**
 * A version range whose lowest allowed version is the one we resolved, i.e. a
 * floor rather than a pin. `>=14`, `^16`, `>14` are floors; `14`, `14.2.0`,
 * `18.x`, `~18.1` name one line and are pins.
 *
 * `^16` counts as a floor because caret allows 16.x only — but the point of the
 * distinction is whether the dead major is what actually runs, and under `^16`
 * it always is. Treated as a pin, then; only genuinely open-ended ranges (`>=`,
 * `>`, `||`) are floors.
 */
function isFloor(range: string): boolean {
  return /(^|\s)(>=?|\|\|)/.test(range.trim())
}

/**
 * Is this key's value a YAML flow sequence — `node-version: [16, 17]`?
 *
 * Block sequences (a `-` list on following lines) are not detected, and that is
 * the same call made the same way: unrecognised shape means silence.
 */
function isMatrixList(line: string): boolean {
  return /:\s*\[/.test(line)
}

/** Strip a trailing `# comment`. */
function withoutComment(line: string): string {
  return line.replace(/\s+#.*$/, "")
}

/**
 * Everything wrong in one file.
 *
 * Exported for tests: the rules are the product, and each wants a case written
 * against a realistic file rather than a synthetic line.
 */
export function scanFileForEol(file: string, content: string): EolFinding[] {
  const norm = file.replace(/\\/g, "/")
  const lines = content.split(/\r?\n/)
  const out: EolFinding[] = []

  const push = (
    kind: EolKind,
    version: string,
    table: Record<string, string>,
    key: string | null,
    pinned: boolean,
    line: number,
    evidence: string,
  ) => {
    if (!key) return
    const eol = table[key]
    if (!eol) return // unknown to the table → say nothing
    out.push({
      kind,
      version,
      release: key,
      eol,
      pinned,
      file: norm,
      line,
      evidence: evidence.trim().slice(0, 200),
    })
  }

  const base = norm.split("/").pop() ?? norm

  // --- .nvmrc / .node-version — a pin, by definition ------------------------
  if (base === ".nvmrc" || base === ".node-version") {
    const idx = lines.findIndex((l) => l.trim() && !l.trim().startsWith("#"))
    const first = idx === -1 ? "" : lines[idx].trim()
    // `lts/hydrogen` and friends name a line without a number; they move on
    // their own and are not a pin to a dead major.
    if (/^v?\d/.test(first)) {
      push("node", first, NODE_EOL, nodeMajor(first), true, idx + 1, first)
    }
    return out
  }

  // --- package.json engines -------------------------------------------------
  if (base === "package.json") {
    try {
      const json = JSON.parse(content) as { engines?: Record<string, string> }
      const node = json.engines?.node
      if (node) {
        // Line number by search: JSON.parse discards positions, and a finding
        // that cannot be opened at the right line is half a finding.
        const idx = lines.findIndex((l) => /"node"\s*:/.test(l))
        push("node", node, NODE_EOL, nodeMajor(node), !isFloor(node), idx + 1 || 1, lines[idx] ?? node)
      }
    } catch {
      /* malformed package.json — other files still get scanned */
    }
    return out
  }

  // --- Python: pyproject.toml / setup.py / setup.cfg ------------------------
  if (base === "pyproject.toml" || base === "setup.py" || base === "setup.cfg") {
    for (let i = 0; i < lines.length; i++) {
      const line = withoutComment(lines[i])
      const m = line.match(/(?:requires-python|python_requires)\s*[=:]\s*["']([^"']+)["']/)
      if (!m) continue
      push("python", m[1], PYTHON_EOL, pythonMinor(m[1]), !isFloor(m[1]), i + 1, line)
    }
    return out
  }

  // --- Dockerfiles ----------------------------------------------------------
  if (/(^|\/)Dockerfile(\.[\w.-]+)?$/i.test(norm) || /\.dockerfile$/i.test(norm)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (/^\s*#/.test(line)) continue
      const from = line.match(/^\s*FROM\s+(\S+)/i)
      if (!from) continue
      const image = from[1]
      // Digest-pinned images carry no readable version, and a build-arg image
      // is not a version at all.
      if (image.startsWith("$") || image.includes("@sha256:")) continue
      const [name, tag] = splitImage(image)
      if (!tag) continue
      if (name === "node") push("node", tag, NODE_EOL, nodeMajor(tag), true, i + 1, line)
      else if (name === "python") push("python", tag, PYTHON_EOL, pythonMinor(tag), true, i + 1, line)
    }
    return out
  }

  // --- GitHub Actions workflows --------------------------------------------
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/i.test(norm)) {
    for (let i = 0; i < lines.length; i++) {
      const line = withoutComment(lines[i])
      if (/^\s*#/.test(line)) continue

      // runs-on: ubuntu-18.04  /  runs-on: [self-hosted, ubuntu-18.04]
      if (/^\s*runs-on\s*:/.test(line)) {
        for (const label of Object.keys(RUNNER_EOL)) {
          if (line.includes(label)) {
            push("runner", label, RUNNER_EOL, label, true, i + 1, line)
            break
          }
        }
      }

      // node-version: 14  /  python-version: "3.7"  — what setup-* installs.
      //
      // A single value is the only version CI ever runs on, which is a pin. A
      // LIST is a build matrix, and a matrix that includes an old version is
      // usually a library deliberately proving it still supports it — express
      // tests on `[16, 17]` on purpose. Flagging that would be telling a
      // maintainer off for the compatibility promise they are keeping, so lists
      // are skipped. `${{ matrix.node }}` falls out too: it is not a number.
      const nodeV = line.match(/^\s*node-version\s*:\s*['"]?([^'"\s]+)/)
      if (nodeV && /^v?\d/.test(nodeV[1]) && !isMatrixList(line)) {
        push("node", nodeV[1], NODE_EOL, nodeMajor(nodeV[1]), !isFloor(nodeV[1]), i + 1, line)
      }
      const pyV = line.match(/^\s*python-version\s*:\s*['"]?([^'"\s]+)/)
      if (pyV && /^\d/.test(pyV[1]) && !isMatrixList(line)) {
        push("python", pyV[1], PYTHON_EOL, pythonMinor(pyV[1]), !isFloor(pyV[1]), i + 1, line)
      }
    }
  }

  return out
}

/** `node:20-alpine` → `["node", "20-alpine"]`; registry hosts and paths kept out. */
function splitImage(image: string): [string, string | null] {
  const lastSeg = image.split("/").pop() ?? image
  const colon = lastSeg.lastIndexOf(":")
  if (colon < 0) return [lastSeg.toLowerCase(), null]
  return [lastSeg.slice(0, colon).toLowerCase(), lastSeg.slice(colon + 1)]
}

const KIND_LABEL: Record<EolKind, string> = {
  node: "Node.js",
  python: "Python",
  runner: "GitHub-hosted runner",
}

/** Files worth opening at all — keeps a huge repo from being read end to end. */
function isCandidate(file: string): boolean {
  const norm = file.replace(/\\/g, "/")
  const base = norm.split("/").pop() ?? norm
  return (
    base === ".nvmrc" ||
    base === ".node-version" ||
    base === "package.json" ||
    base === "pyproject.toml" ||
    base === "setup.py" ||
    base === "setup.cfg" ||
    /(^|\/)Dockerfile(\.[\w.-]+)?$/i.test(norm) ||
    /\.dockerfile$/i.test(norm) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(norm)
  )
}

function describe(f: EolFinding, days: number): { severity: Severity; title: string; detail: string } {
  const label = KIND_LABEL[f.kind]
  const past = days < 0
  const ago = Math.abs(days)

  if (!past) {
    return {
      severity: "info",
      title: `${label} ${f.release} reaches end of life in ${days} days`,
      detail:
        `${label} ${f.release} stops receiving support on ${f.eol}. Nothing is wrong yet — this is the ` +
        `cheap moment to move, before it becomes an unplanned upgrade under a security advisory. ` +
        `(EOL dates as of ${TABLE_AS_OF}.)`,
    }
  }

  const years = (ago / 365).toFixed(1)
  const common =
    `${label} ${f.release} went out of support on ${f.eol} — ${ago} days ago, about ${years} years. ` +
    `No security patches are issued for it, so any vulnerability found from that date on stays open ` +
    `for as long as you stay on it.`

  if (f.kind === "runner") {
    return {
      severity: "critical",
      title: `Workflow targets a retired runner image: ${f.release}`,
      detail:
        `GitHub retired the ${f.release} image on ${f.eol}. Retired images are not merely unsupported, ` +
        `they are removed — a workflow requesting one fails to start rather than running on something ` +
        `older. Move to a current label, preferably a floating one like ubuntu-latest. ` +
        `(Retirement dates as of ${TABLE_AS_OF}.)`,
    }
  }

  if (!f.pinned) {
    return {
      severity: "info",
      title: `Declared floor allows end-of-life ${label} ${f.release}`,
      detail:
        `${common} This is a floor, not a pin: the project may well run on something current, and this ` +
        `only says an unsupported runtime is still permitted. Raising the floor documents what you ` +
        `actually support and stops anyone installing onto a dead runtime. (EOL dates as of ${TABLE_AS_OF}.)`,
    }
  }

  return {
    severity: "warning",
    title: `Pinned to end-of-life ${label} ${f.release}`,
    detail: `${common} (EOL dates as of ${TABLE_AS_OF}.)`,
  }
}

export const eolRuntimeScanner: Scanner = {
  id: "eol-runtime",
  category: "dependency",

  async run(ctx: ScanContext): Promise<Issue[]> {
    const candidates = ctx.files.filter(isCandidate)
    if (candidates.length === 0) return []

    const now = Date.now()
    const issues: Issue[] = []

    for (const file of candidates) {
      if (issues.length >= MAX_ISSUES) break
      const content = await ctx.readFile(file)
      if (!content) continue

      for (const finding of scanFileForEol(file, content)) {
        if (issues.length >= MAX_ISSUES) break
        const days = daysUntil(finding.eol, now)
        // Comfortably supported → nothing to say. Only the past and the near
        // future are findings.
        if (days > APPROACHING_DAYS) continue

        const { severity, title, detail } = describe(finding, days)

        let ageDays = 0
        try {
          ageDays = await ctx.git.blameAgeDays(finding.file, finding.line)
        } catch {
          /* blame is a nicety; a finding without an age is still a finding */
        }

        issues.push({
          id: `eol-${finding.kind}-${finding.file}-${finding.line}`,
          category: "dependency",
          severity,
          title,
          location: `${finding.file}:${finding.line}`,
          ageDays,
          detail,
          evidence: finding.evidence,
        })
      }
    }

    return issues
  },
}
