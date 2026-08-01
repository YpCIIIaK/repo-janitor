import { describe, it, expect } from "vitest"
import { scanCiFile, triggersOf, ciHealthScanner } from "../../src/scanners/ci-health"
import type { ScanContext } from "../../src/scanner"

/** Every per-file rule assumes a verification workflow, so fixtures carry a trigger. */
const ON = "on: [push, pull_request]\n"
const rules = (yaml: string) =>
  scanCiFile(".github/workflows/ci.yml", ON + yaml).map((f) => f.rule)

describe("scanCiFile", () => {
  it("reports a literal continue-on-error", () => {
    const yaml = ["      - name: Lint", "        run: pnpm lint", "        continue-on-error: true"].join("\n")
    expect(rules(yaml)).toEqual(["silenced-failure"])
  })

  it("leaves an expression-valued continue-on-error alone", () => {
    // The documented way to run an allowed-to-fail matrix leg beside required
    // ones. Flagging it punishes the projects careful enough to separate them.
    const yaml = "    continue-on-error: ${{ matrix.experimental }}"
    expect(rules(yaml)).toEqual([])
  })

  it("leaves continue-on-error: false alone", () => {
    expect(rules("    continue-on-error: false")).toEqual([])
  })

  it("leaves continue-on-error on a cache step alone", () => {
    // pnpm carries nine of these, all on actions/cache, where it is not merely
    // acceptable but recommended: a cache miss must not fail a build. Nothing
    // is silenced there except caching, and a step with no command is not a
    // check that could have failed.
    const yaml = [
      "      - name: Cache store",
      "        uses: actions/cache@v4",
      "        timeout-minutes: 1",
      "        continue-on-error: true",
      "        with:",
      "          path: ~/.cache",
    ].join("\n")
    expect(rules(yaml)).toEqual([])
  })

  it("still reports it on the next step along, which does run something", () => {
    const yaml = [
      "      - uses: actions/cache@v4",
      "        continue-on-error: true",
      "      - name: Typecheck",
      "        run: tsc --noEmit",
      "        continue-on-error: true",
    ].join("\n")
    expect(rules(yaml)).toEqual(["silenced-failure"])
    expect(scanCiFile("w.yml", yaml)[0].line).toBe(5)
  })

  it("reports a step switched off with if: false", () => {
    expect(rules("    if: false")).toEqual(["disabled"])
    expect(rules("    if: 'false'")).toEqual(["disabled"])
  })

  it("leaves a real condition alone", () => {
    expect(rules("    if: github.event_name == 'push'")).toEqual([])
  })

  it("reports a test command whose failure is discarded", () => {
    expect(rules("        run: pytest || true")).toEqual(["swallowed"])
    expect(rules("        run: npm test; exit 0")).toEqual(["swallowed"])
    expect(rules("        run: flake8 --exit-zero && pnpm test")).toEqual([])
  })

  it("ignores || true on a line that is not running tests", () => {
    // Ordinary shell on a cleanup or a cache warm-up; it means nothing there.
    expect(rules("        run: rm -rf .cache || true")).toEqual([])
    expect(rules("        run: docker stop db || true")).toEqual([])
  })

  it("ignores a commented-out silencer", () => {
    expect(rules("        # continue-on-error: true")).toEqual([])
  })

  it("points at the line", () => {
    const yaml = "jobs:\n  a:\n    steps:\n      - run: x\n        continue-on-error: true\n"
    expect(scanCiFile("w.yml", yaml)[0].line).toBe(5)
  })

  it("says nothing about a workflow that never runs on a change", () => {
    // babel regenerates test fixtures on a schedule; `continue-on-error` there
    // absorbs "nothing to commit". Not a silenced check — never a check.
    const yaml =
      "on:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  a:\n    steps:\n      - run: yarn jest\n        continue-on-error: true\n"
    expect(scanCiFile(".github/workflows/update-compat-data.yml", yaml)).toEqual([])
  })

  it("says nothing about a step that regenerates fixtures", () => {
    // Straight from babel: `jest -u` rewrites snapshots to match the code. It
    // is the opposite operation to checking, so silencing it is not a gap.
    const yaml = [
      "      - name: Update tests and commit test fixtures",
      "        continue-on-error: true",
      "        run: |",
      "          yarn jest -u",
      '          git commit -am "chore: update test fixtures"',
    ].join("\n")
    expect(rules(yaml)).toEqual([])
  })

  it("says nothing about a regenerating command whose failure is discarded", () => {
    expect(rules("        run: yarn jest -u --ci || true")).toEqual([])
  })
})

describe("triggersOf", () => {
  it("reads the inline scalar form", () => {
    expect([...triggersOf("on: push\njobs:\n  a: {}\n")]).toEqual(["push"])
  })

  it("reads the inline list form", () => {
    expect([...triggersOf("on: [push, pull_request]\n")].sort()).toEqual(["pull_request", "push"])
  })

  it("reads the block form", () => {
    const yaml = "name: CI\non:\n  push:\n    branches: [main]\n  pull_request:\njobs:\n  build:\n"
    const t = triggersOf(yaml)
    expect(t.has("push")).toBe(true)
    expect(t.has("pull_request")).toBe(true)
  })

  it("accepts the quoted key some repos use", () => {
    // YAML 1.1 reads a bare `on` as the boolean true, so quoting it is correct
    // and reasonably common.
    expect([...triggersOf('"on": [workflow_dispatch]\n')]).toEqual(["workflow_dispatch"])
  })

  it("does not mistake a job key for a trigger", () => {
    const yaml = "on:\n  push:\njobs:\n  pull_request_checks:\n    steps: []\n"
    expect(triggersOf(yaml).has("pull_request_checks")).toBe(false)
  })
})

describe("ciHealthScanner", () => {
  const ctx = (files: Record<string, string>): ScanContext =>
    ({
      root: "/repo",
      repo: { owner: "acme", name: "widget", defaultBranch: "main" },
      files: Object.keys(files),
      readFile: async (p: string) => files[p] ?? null,
      git: { blameAgeDays: async () => 300, listBranches: async () => [] },
      log: () => {},
    }) as unknown as ScanContext

  const GOOD =
    "on: [push, pull_request]\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps:\n      - run: pnpm test\n"

  it("says nothing about a healthy setup", async () => {
    const issues = await ciHealthScanner.run(
      ctx({ ".github/workflows/ci.yml": GOOD, "src/a.test.ts": "test('x',()=>{})" }),
    )
    expect(issues).toEqual([])
  })

  it("says nothing at all when there is no CI", async () => {
    // That finding belongs to project-hygiene, and it is a different one: a gap
    // somebody knows about, versus a belief that is wrong.
    const issues = await ciHealthScanner.run(ctx({ "src/a.test.ts": "test('x',()=>{})" }))
    expect(issues).toEqual([])
  })

  it("reports tests that exist but are never run", async () => {
    const [issue] = await ciHealthScanner.run(
      ctx({
        ".github/workflows/ci.yml": "on: [push, pull_request]\njobs:\n  lint:\n    steps:\n      - run: pnpm lint\n",
        "src/a.test.ts": "test('x',()=>{})",
      }),
    )
    expect(issue.id).toBe("ci-tests-not-run")
    expect(issue.severity).toBe("warning")
  })

  it("does not claim tests are unrun when a composite action runs them", async () => {
    // The invocation often lives outside .github/workflows entirely.
    const issues = await ciHealthScanner.run(
      ctx({
        ".github/workflows/ci.yml":
          "on: [push, pull_request]\njobs:\n  a:\n    steps:\n      - uses: ./.github/actions/verify\n",
        ".github/actions/verify/action.yml": "runs:\n  using: composite\n  steps:\n    - run: cargo test\n",
        "src/lib_test.rs": "#[test] fn x() {}",
      }),
    )
    expect(issues).toEqual([])
  })

  it("does not claim tests are unrun when a task runner runs them", async () => {
    const issues = await ciHealthScanner.run(
      ctx({
        ".github/workflows/ci.yml":
          "on: [push, pull_request]\njobs:\n  a:\n    steps:\n      - run: turbo run test --filter=web\n",
        "packages/web/src/a.spec.ts": "x",
      }),
    )
    expect(issues).toEqual([])
  })

  it("says nothing about missing test runs in a repo with no tests", async () => {
    // "Write some tests" is a different conversation, and someone else's.
    const issues = await ciHealthScanner.run(
      ctx({
        ".github/workflows/ci.yml": "on: [push, pull_request]\njobs:\n  a:\n    steps:\n      - run: pnpm lint\n",
        "src/index.ts": "export const a = 1",
      }),
    )
    expect(issues).toEqual([])
  })

  it("does not claim tests are unrun when another CI system is configured", async () => {
    // nest's only workflow is CodeQL and its whole suite runs on CircleCI. The
    // rule as first written told a project with excellent CI that it had none.
    const issues = await ciHealthScanner.run(
      ctx({
        ".github/workflows/codeql-analysis.yml": "on: [push, pull_request]\njobs:\n  a:\n    steps: []\n",
        ".circleci/config.yml": "version: 2.1\njobs:\n  test:\n    steps:\n      - run: npm test\n",
        "packages/core/test/a.spec.ts": "x",
      }),
    )
    expect(issues).toEqual([])
  })

  it("reports a silenced failure with a line to open", async () => {
    const [issue] = await ciHealthScanner.run(
      ctx({
        ".github/workflows/ci.yml":
          "on: [push, pull_request]\njobs:\n  a:\n    steps:\n      - run: pnpm test\n        continue-on-error: true\n",
        "src/a.test.ts": "x",
      }),
    )
    expect(issue.location).toBe(".github/workflows/ci.yml:6")
    expect(issue.ageDays).toBe(300)
  })

  it("reports the missing pull-request gate", async () => {
    const [issue] = await ciHealthScanner.run(
      ctx({
        ".github/workflows/ci.yml": "on:\n  push:\n    branches: [main]\njobs:\n  a:\n    steps:\n      - run: pnpm test\n",
        "src/a.test.ts": "x",
      }),
    )
    expect(issue.id).toBe("ci-no-pr-trigger")
    expect(issue.severity).toBe("info")
  })

  it("accepts a merge queue as the gate", async () => {
    const issues = await ciHealthScanner.run(
      ctx({
        ".github/workflows/ci.yml":
          "on:\n  push:\n  merge_group:\njobs:\n  a:\n    steps:\n      - run: pnpm test\n",
        "src/a.test.ts": "x",
      }),
    )
    expect(issues).toEqual([])
  })

  it("does not ask for a pull-request gate from a release-only workflow", async () => {
    // Nothing to gate: it runs on tags and on a schedule, not on changes.
    const issues = await ciHealthScanner.run(
      ctx({
        ".github/workflows/release.yml":
          "on:\n  schedule:\n    - cron: '0 0 * * *'\njobs:\n  a:\n    steps:\n      - run: pnpm test\n",
        "src/a.test.ts": "x",
      }),
    )
    expect(issues).toEqual([])
  })
})
