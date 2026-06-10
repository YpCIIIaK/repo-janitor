import type { Issue, IssueCategory, ScanReport, Severity } from "../schema"
import { sortIssues } from "./shared"

/**
 * SARIF 2.1.0 reporter.
 *
 * Emits the Static Analysis Results Interchange Format that GitHub code scanning
 * consumes (`github/codeql-action/upload-sarif`). With this, findings show up as
 * native annotations in the **Security ▸ Code scanning** tab and inline on the
 * diff of a pull request — no dashboard required.
 *
 * Mapping:
 *  - one SARIF *rule* per issue category that appears in the report
 *  - one SARIF *result* per finding, with `level` derived from our severity
 *    (critical → error, warning → warning, info → note)
 *  - file-anchored findings (`path` or `path:line`) get a `physicalLocation`;
 *    repo-level findings (stale branches, missing standard files) are still
 *    emitted but without a code location, so nothing is silently dropped
 *  - a stable `partialFingerprints` value (our deterministic issue id) lets
 *    GitHub track an alert across runs instead of re-opening it every scan
 */

const TOOL_NAME = "repo-anti-rot"
const TOOL_URI = "https://github.com/YpCIIIaK/repo-janitor"
const TOOL_VERSION = "0.0.0"
const SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json"

const LEVEL: Record<Severity, "error" | "warning" | "note"> = {
  critical: "error",
  warning: "warning",
  info: "note",
}

const CATEGORY_META: Record<IssueCategory, { name: string; description: string }> = {
  env: {
    name: "Environment variables",
    description: "Environment variables read in code but not documented in an example file, or documented but unused.",
  },
  dependency: {
    name: "Dependencies",
    description: "Outdated, abandoned, unused or missing-lockfile dependency problems.",
  },
  branch: {
    name: "Stale branches",
    description: "Long-abandoned remote branches that should be reviewed or deleted.",
  },
  todo: {
    name: "TODO debt",
    description: "Aging TODO / FIXME / HACK markers left in the source.",
  },
  security: {
    name: "Security",
    description:
      "Security findings: credentials or tokens committed to the repository (working tree or git history; evidence is redacted), and dependencies with known vulnerabilities (CVE/GHSA).",
  },
  "dead-code": {
    name: "Dead code",
    description: "Exports or symbols that are never referenced anywhere in the project.",
  },
  hygiene: {
    name: "Repository hygiene",
    description: "Missing standard files, leftover debug statements, large blobs, skipped tests, Dockerfile and other hygiene issues.",
  },
}

interface SarifRegion {
  startLine: number
}
interface SarifLocation {
  physicalLocation: {
    artifactLocation: { uri: string }
    region?: SarifRegion
  }
}

/** Resolve an issue's location to a repo-relative file uri (+ line), or null. */
function fileLocation(issue: Issue): { uri: string; line?: number } | null {
  if (issue.category === "branch") return null // "origin/<branch>" — not a file
  const loc = issue.location?.trim()
  if (!loc || loc === "." || loc.startsWith("origin/")) return null

  let uri = loc
  let line: number | undefined
  const m = loc.match(/^(.*):(\d+)$/)
  if (m) {
    uri = m[1]
    line = parseInt(m[2], 10)
  }
  uri = uri.replace(/\\/g, "/").replace(/^\.\//, "")
  if (!uri || uri === ".") return null
  return { uri, line }
}

/** Build the result message: headline + explanation (+ redacted evidence). */
function messageText(issue: Issue): string {
  const parts = [issue.title.trim(), issue.detail.trim()].filter(Boolean)
  let text = parts.join("\n\n")
  if (issue.evidence) text += `\n\n${issue.evidence.trim()}`
  return text
}

export function renderSarif(report: ScanReport): string {
  const issues = sortIssues(report.issues)

  // One rule per category actually present, in first-seen order → stable indices.
  const ruleIndex = new Map<IssueCategory, number>()
  const rules: unknown[] = []
  for (const issue of issues) {
    if (ruleIndex.has(issue.category)) continue
    const meta = CATEGORY_META[issue.category]
    ruleIndex.set(issue.category, rules.length)
    rules.push({
      id: issue.category,
      name: meta.name.replace(/\s+/g, ""),
      shortDescription: { text: meta.name },
      fullDescription: { text: meta.description },
      helpUri: `${TOOL_URI}#readme`,
      defaultConfiguration: { level: "warning" },
    })
  }

  const results = issues.map((issue) => {
    const file = fileLocation(issue)
    const locations: SarifLocation[] = file
      ? [
          {
            physicalLocation: {
              artifactLocation: { uri: file.uri },
              ...(file.line ? { region: { startLine: file.line } } : {}),
            },
          },
        ]
      : []
    return {
      ruleId: issue.category,
      ruleIndex: ruleIndex.get(issue.category) ?? 0,
      level: LEVEL[issue.severity],
      message: { text: messageText(issue) },
      ...(locations.length ? { locations } : {}),
      // Stable per-finding id so GitHub tracks alerts across runs rather than
      // closing and re-opening them every scan.
      partialFingerprints: { antiRotId: issue.id },
    }
  })

  const sarif = {
    $schema: SARIF_SCHEMA,
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            informationUri: TOOL_URI,
            version: TOOL_VERSION,
            semanticVersion: TOOL_VERSION,
            rules,
          },
        },
        results,
      },
    ],
  }

  return JSON.stringify(sarif, null, 2)
}
