import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * CI Health scanner ⭐.
 *
 * Asks one question the presence of a green badge cannot answer: **is anything
 * actually being checked?**
 *
 * A repository with tests, a workflow file and a passing badge can still be
 * running nothing. The test job was excluded from the trigger during a migration;
 * a flaky step got `continue-on-error: true` "for now" in 2023; someone appended
 * `|| true` to make a release go out. Each of those leaves CI green forever,
 * which is worse than no CI at all — no CI is a known gap, while a green check
 * that verifies nothing is a false statement that the whole team relies on.
 *
 * This is decay in the project's exact sense. Nobody broke anything; a temporary
 * measure stopped being temporary, and the signal quietly stopped meaning what it
 * says.
 *
 * ## Deliberately not "you have no CI"
 *
 * That finding already exists in `project-hygiene`, and it is the easy half. The
 * rules here only fire on repositories that have gone to the trouble of setting
 * CI up — the population where a wrong belief is actually held.
 *
 * ## The searched corpus is everything that can run a command
 *
 * Workflows call reusable workflows and composite actions, so a test invocation
 * may live in a file that is not `.github/workflows/ci.yml`. Every rule that
 * reports an ABSENCE searches all of them, and matches as loosely as it can get
 * away with: for a negative rule, a loose match means fewer findings, and under-
 * reporting is the direction this project errs in.
 */

const WORKFLOW_RE = /^\.github\/workflows\/[^/]+\.ya?ml$/i
/** Composite / JS actions defined in-repo — `run:` steps live here too. */
const ACTION_RE = /(^|\/)action\.ya?ml$/i

const MAX_ISSUES = 20

/**
 * Configs belonging to CI systems other than Actions.
 *
 * Their presence silences the "tests are never run" rule outright. nest is the
 * case that forced this: its only workflow is CodeQL, its entire test suite runs
 * on CircleCI, and the finding as first written told a project with excellent CI
 * that it had none. These files cannot be read with any confidence here — every
 * provider has its own schema — so the honest response to one is to stop talking.
 */
const OTHER_CI_CONFIG = [
  ".circleci/config.yml",
  ".circleci/config.yaml",
  ".travis.yml",
  "azure-pipelines.yml",
  ".gitlab-ci.yml",
  "Jenkinsfile",
  ".drone.yml",
  "appveyor.yml",
  ".appveyor.yml",
  "bitbucket-pipelines.yml",
  ".buildkite/pipeline.yml",
  ".teamcity/settings.kts",
  "cloudbuild.yaml",
  ".woodpecker.yml",
]

/**
 * Ways a test suite gets invoked, across ecosystems and task runners.
 *
 * Loose on purpose (see the header): every entry here can only ever SILENCE the
 * "tests never run" finding. The cost of an over-broad entry is a missed
 * finding; the cost of a narrow one is accusing a project that does run its
 * tests, through a runner nobody thought to list.
 */
const TEST_INVOCATION =
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b|\b(?:vitest|jest|mocha|ava|playwright|cypress|karma|tap\b)|\bpytest\b|\bpython\s+-m\s+(?:pytest|unittest)\b|\btox\b|\bnose2?\b|\bgo\s+test\b|\bcargo\s+test\b|\bmvn\s+(?:.*\s)?test\b|\bgradle(?:w)?\s+.*\btest\b|\bmake\s+.*test\b|\brake\s+(?:test|spec)\b|\brspec\b|\bphpunit\b|\bdotnet\s+test\b|\bbazel\s+test\b|\bnx\s+.*\btest\b|\bturbo\s+run\s+.*test\b|\bct_run\b|\bmix\s+test\b|\bswift\s+test\b/i

/**
 * An action whose whole job is running tests, referenced by `uses:`.
 *
 * Same reasoning as above — presence silences, so breadth is safe.
 */
const TEST_ACTION = /uses:\s*\S*(?:test|coverage|codecov|coveralls|sonar)/i

/** Test files, for deciding whether this project has tests to run in the first place. */
const TEST_FILE_RE =
  /(^|\/)(?:tests?|spec|__tests__|e2e)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(^|\/)test_[^/]+\.py$|[^/]+_test\.(?:py|go|rb)$|(^|\/)[^/]+Test\.(?:java|kt|cs)$|_spec\.rb$/i

export interface CiFinding {
  rule: "silenced-failure" | "disabled" | "swallowed"
  file: string
  line: number
  evidence: string
}

function withoutComment(line: string): string {
  return line.replace(/\s+#.*$/, "")
}

/**
 * Per-file rules: the ones that point at a specific line someone can open.
 *
 * Exported for tests — these are the rules, and each earns a case written
 * against a realistic workflow.
 */
/**
 * Flags that turn a test runner into a fixture generator.
 *
 * `jest -u` does not check anything — it rewrites the snapshots to match
 * whatever the code does now, which is the opposite operation.
 */
const REGENERATES = /(?:^|\s)(?:-u|--update|--update-snapshots?|--write|--fix)(?:\s|$)/

/** A run block that changes the repository is doing work, not checking it. */
const MUTATES = /\bgit\s+(?:commit|push|add)\b/

export function scanCiFile(file: string, content: string): CiFinding[] {
  const out: CiFinding[] = []
  const lines = content.split(/\r?\n/)

  // A workflow that never runs on a change is not the check anyone believes in.
  //
  // babel produced all three of the first draft's remaining findings from two
  // bot workflows that regenerate test fixtures on a schedule: `continue-on-
  // error` there absorbs "nothing to commit", and `jest -u || true` rewrites
  // snapshots rather than verifying them. Neither is a silenced check, because
  // neither was ever a check. Every rule below assumes verification, so the file
  // has to be a verification workflow first.
  if (WORKFLOW_RE.test(file)) {
    const t = triggersOf(content)
    if (!t.has("push") && !t.has("pull_request") && !t.has("merge_group")) return []
  }

  // State for the step currently being read, so `continue-on-error` can be
  // judged by what the step actually does rather than on its own.
  let stepHasRun = false
  let stepRunText = ""
  let pending: CiFinding | null = null

  const flushStep = () => {
    // A step that rewrites fixtures or commits to the repository is doing work,
    // not checking it, and `continue-on-error` on it usually absorbs a boring
    // exit code like "nothing to commit".
    const verifies = stepHasRun && !REGENERATES.test(stepRunText) && !MUTATES.test(stepRunText)
    if (pending && verifies) out.push(pending)
    pending = null
    stepHasRun = false
    stepRunText = ""
  }

  for (let i = 0; i < lines.length; i++) {
    const line = withoutComment(lines[i])
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue
    const at = i + 1
    const evidence = trimmed.slice(0, 200)

    // A new list item under `steps:` ends the previous step.
    if (/^-\s+(?:name|uses|run|id|shell)\s*:/.test(trimmed)) flushStep()
    if (/(?:^|^-\s+)run\s*:/.test(trimmed)) stepHasRun = true
    // Once inside a step's `run:`, keep the text: a block scalar spans lines and
    // the `git commit` that explains the silencing is rarely the first of them.
    if (stepHasRun) stepRunText += `\n${trimmed}`

    // `continue-on-error: true` — the step runs, fails, and the job goes green.
    //
    // Two narrowings, each of which a real repository forced.
    //
    // Only a LITERAL true: `continue-on-error: ${{ matrix.experimental }}` is
    // the documented way to run an allowed-to-fail matrix leg beside required
    // ones, and flagging it would punish exactly the projects careful enough to
    // separate the two.
    //
    // And only on a step that RUNS a command. pnpm puts `continue-on-error:
    // true` on nine `actions/cache` steps, which is not merely acceptable but
    // recommended — a cache miss or a timeout must not fail a build. Nothing is
    // being silenced there except caching. The finding is "a check that could
    // have failed was told not to", and a step with no command is not a check.
    if (/^continue-on-error\s*:\s*true\s*$/.test(trimmed)) {
      pending = { rule: "silenced-failure", file, line: at, evidence }
      continue
    }

    // `if: false` — a job that is switched off but still listed, so the checks
    // UI keeps showing its name as if it ran.
    if (/^if\s*:\s*(?:false|'false'|"false")\s*$/.test(trimmed)) {
      out.push({ rule: "disabled", file, line: at, evidence })
      continue
    }

    // A command whose failure is discarded: `pytest || true`, `npm test; exit 0`.
    //
    // Two narrowings, both of which cost findings and are worth it. Restricted
    // to lines that invoke a test runner, because `|| true` on a cleanup or a
    // cache warm-up is ordinary shell and means nothing. And anchored to the end
    // of the line, because the discard has to apply to the LAST command: in
    // `flake8 --exit-zero && pnpm test` the swallowing belongs to the linter and
    // the suite can still fail the build, which is the correct setup and would
    // have been reported as the broken one.
    if (
      TEST_INVOCATION.test(trimmed) &&
      !REGENERATES.test(trimmed) &&
      /(?:\|\|\s*(?:true|:)|;\s*exit\s+0)\s*$/.test(trimmed)
    ) {
      out.push({ rule: "swallowed", file, line: at, evidence })
    }
  }

  flushStep()
  // Line order, so a report reads down the file rather than by rule.
  return out.sort((a, b) => a.line - b.line)
}

/**
 * Trigger events named anywhere in a workflow's `on:` block.
 *
 * Handles all three shapes GitHub accepts — `on: push`, `on: [push,
 * pull_request]` and a block mapping — and stops at the next top-level key so a
 * `pull_request` mentioned under `jobs:` is not mistaken for a trigger.
 */
export function triggersOf(content: string): Set<string> {
  const lines = content.split(/\r?\n/)
  const out = new Set<string>()
  let inBlock = false

  for (const raw of lines) {
    const line = withoutComment(raw)
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith("#")) continue

    // `on:` is a top-level key. YAML 1.1 reads a bare `on` as the boolean true,
    // which is why some repos quote it — accept both.
    const start = trimmed.match(/^["']?on["']?\s*:(.*)$/)
    if (start && /^[^\s]/.test(line)) {
      const rest = start[1].trim()
      if (rest) {
        // `on: push` or `on: [push, pull_request]`
        for (const w of rest.replace(/[[\]]/g, "").split(",")) {
          const t = w.trim()
          if (t) out.add(t)
        }
        continue
      }
      inBlock = true
      continue
    }

    if (!inBlock) continue
    // A new top-level key ends the block.
    if (/^[^\s#]/.test(line)) {
      inBlock = false
      continue
    }
    const key = trimmed.match(/^-?\s*([a-z_]+)\s*:?/)
    if (key) out.add(key[1])
  }

  return out
}

const RULE_TEXT: Record<
  CiFinding["rule"],
  { title: string; detail: string }
> = {
  "silenced-failure": {
    title: "CI failure is silenced with continue-on-error",
    detail:
      "This step is allowed to fail without failing the job, so whatever it checks has stopped " +
      "being checked while the badge stays green. That is worse than not running it at all: a " +
      "missing check is a known gap, a green check that verifies nothing is a false statement the " +
      "whole team relies on. If the step is genuinely optional, say so in its name; if it was " +
      "silenced to get a release out, it has outlived that release.",
  },
  disabled: {
    title: "Workflow step is switched off with if: false",
    detail:
      "`if: false` never runs, but the job keeps its name in the checks UI, so a reviewer sees a " +
      "familiar list and assumes it passed. Deleting it, or commenting it out with a note saying " +
      "why, is honest; leaving it looking live is not.",
  },
  swallowed: {
    title: "Test failures are discarded by the command that runs them",
    detail:
      "The test command's exit code is thrown away (`|| true`, `; exit 0`, `--exit-zero`), so the " +
      "suite can fail every run and CI will never notice. Usually added to unblock one urgent " +
      "merge and then forgotten — from that day on the tests are documentation, not a gate.",
  },
}

export const ciHealthScanner: Scanner = {
  id: "ci-health",
  category: "hygiene",

  async run(ctx: ScanContext): Promise<Issue[]> {
    const files = ctx.files.map((f) => f.replace(/\\/g, "/"))
    const workflows = files.filter((f) => WORKFLOW_RE.test(f))
    // No CI at all is `project-hygiene`'s finding, and a different one: a gap
    // somebody knows about versus a belief that is wrong.
    if (workflows.length === 0) return []

    const runnable = [...workflows, ...files.filter((f) => ACTION_RE.test(f))]
    const issues: Issue[] = []
    const contents = new Map<string, string>()

    for (const file of runnable) {
      const content = await ctx.readFile(file)
      if (!content) continue
      contents.set(file, content)

      for (const f of scanCiFile(file, content)) {
        if (issues.length >= MAX_ISSUES) break
        const { title, detail } = RULE_TEXT[f.rule]
        let ageDays = 0
        try {
          ageDays = await ctx.git.blameAgeDays(f.file, f.line)
        } catch {
          /* blame is a nicety */
        }
        issues.push({
          id: `ci-${f.rule}-${f.file}-${f.line}`,
          category: "hygiene",
          severity: "warning",
          title,
          location: `${f.file}:${f.line}`,
          ageDays,
          detail,
          evidence: f.evidence,
        })
      }
    }

    const workflowText = workflows
      .map((f) => contents.get(f) ?? "")
      .concat(files.filter((f) => ACTION_RE.test(f)).map((f) => contents.get(f) ?? ""))
      .join("\n")

    // --- tests that exist but are never run ---------------------------------
    //
    // Only when the project demonstrably HAS tests. "You should write tests" is
    // project-hygiene's business and a different conversation; this rule is
    // about a suite somebody wrote and CI does not run.
    const hasTestFiles = files.some((f) => TEST_FILE_RE.test(f))
    const elsewhere = OTHER_CI_CONFIG.some((c) => files.includes(c))
    if (hasTestFiles && !elsewhere && issues.length < MAX_ISSUES) {
      const runsTests = TEST_INVOCATION.test(workflowText) || TEST_ACTION.test(workflowText)
      if (!runsTests) {
        issues.push({
          id: "ci-tests-not-run",
          category: "hygiene",
          severity: "warning",
          title: "The test suite is never run in CI",
          location: workflows[0],
          ageDays: 0,
          detail:
            "This repository has test files and has GitHub Actions configured, but no workflow " +
            "invokes a test runner. Tests that only run on the machine of whoever remembers to run " +
            "them decay silently: the first one to break stays broken, and by the time anyone looks " +
            "the suite is a wall of red nobody wants to own. Running them on every push is the " +
            "cheapest thing in this entire report.",
          evidence: `${workflows.length} workflow${workflows.length === 1 ? "" : "s"}, no test invocation`,
        })
      }
    }

    // --- nothing checked before merge ---------------------------------------
    if (issues.length < MAX_ISSUES) {
      const triggers = new Set<string>()
      for (const f of workflows) {
        for (const t of triggersOf(contents.get(f) ?? "")) triggers.add(t)
      }
      // `merge_group` means checks run in the merge queue, which is the same
      // guarantee by a newer mechanism.
      const gated = triggers.has("pull_request") || triggers.has("merge_group")
      // A repo whose workflows are all releases and schedules is not missing a
      // gate, it just has nothing to gate. Requiring a push trigger keeps the
      // rule to repositories that plainly do run CI on changes.
      if (!gated && triggers.has("push")) {
        issues.push({
          id: "ci-no-pr-trigger",
          category: "hygiene",
          severity: "info",
          title: "No workflow runs on pull requests",
          location: workflows[0],
          ageDays: 0,
          detail:
            "Workflows here run on push but none is triggered by `pull_request` or a merge queue, " +
            "so a change is only checked after it has landed on a branch — never as a condition of " +
            "review. Adding `pull_request` to the trigger list is a one-line change and it moves " +
            "every existing check from a report to a gate.",
          evidence: `triggers: ${[...triggers].sort().join(", ") || "none detected"}`,
        })
      }
    }

    return issues
  },
}
