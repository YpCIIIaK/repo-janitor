import { describe, it, expect } from "vitest"
import { scanWorkflow, workflowSecurityScanner } from "../../src/scanners/workflow-security"
import type { ScanContext } from "../../src/scanner"

const rules = (yaml: string) => scanWorkflow(yaml).map((f) => f.rule)

/** A workflow with nothing wrong, used as the base for the negative cases. */
const SAFE = `name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - run: npm ci && npm test
`

describe("scanWorkflow", () => {
  it("finds nothing in a correct workflow", () => {
    // The case that matters most. A scanner that cannot stay quiet on good input
    // teaches people to ignore it.
    expect(scanWorkflow(SAFE)).toEqual([])
  })

  describe("pull_request_target", () => {
    it("flags checking out the pull request's own code", () => {
      const yaml = `on:
  pull_request_target:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.event.pull_request.head.sha }}
      - run: npm test
`
      expect(rules(yaml)).toContain("pr-target-checkout")
    })

    it("does not flag pull_request_target on its own", () => {
      // The trigger is not the bug — labelling and greeting bots use it
      // correctly and must not be nagged. The bug is running the contributed
      // code with the credentials it grants.
      const yaml = `on:
  pull_request_target:
permissions:
  pull-requests: write
jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/labeler@8558fd7
`
      expect(rules(yaml)).not.toContain("pr-target-checkout")
    })

    it("does not flag checking out a PR ref under the safe trigger", () => {
      const yaml = `on:
  pull_request:
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          ref: \${{ github.event.pull_request.head.sha }}
`
      expect(rules(yaml)).not.toContain("pr-target-checkout")
    })
  })

  describe("script injection", () => {
    it("flags an attacker-controlled context inside run:", () => {
      const yaml = `${SAFE}      - run: echo "Thanks for \${{ github.event.pull_request.title }}"
`
      expect(rules(yaml)).toContain("script-injection")
    })

    it("flags it on a continuation line of a block scalar", () => {
      const yaml = `on: [pull_request]
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: |
          echo start
          echo "\${{ github.event.issue.body }}"
          echo done
`
      expect(rules(yaml)).toContain("script-injection")
    })

    it("does not flag the same value passed through env:", () => {
      // This IS the recommended fix, so flagging it would be telling people to
      // undo the thing the message asked them to do.
      const yaml = `on: [pull_request]
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - env:
          TITLE: \${{ github.event.pull_request.title }}
        run: echo "$TITLE"
`
      expect(rules(yaml)).not.toContain("script-injection")
    })

    it("does not flag contexts an outsider cannot control", () => {
      const yaml = `${SAFE}      - run: echo "\${{ github.sha }} \${{ github.repository }} \${{ matrix.node }}"
`
      expect(rules(yaml)).not.toContain("script-injection")
    })
  })

  describe("action pinning", () => {
    it("flags a third-party action on a mutable tag", () => {
      expect(rules(`${SAFE}      - uses: tj-actions/changed-files@v44\n`)).toContain("action-tag")
    })

    it("flags a first-party action more gently", () => {
      const found = rules(`on: [push]
permissions:
  contents: read
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
`)
      expect(found).toContain("action-tag-first-party")
      expect(found).not.toContain("action-tag")
    })

    it("flags an action with no ref at all", () => {
      expect(rules(`${SAFE}      - uses: some/action\n`)).toContain("action-unpinned")
    })

    it("accepts a full commit sha", () => {
      const found = rules(`${SAFE}      - uses: tj-actions/changed-files@d6babd6899969df1a11d14c368283ea4436bca78\n`)
      expect(found).not.toContain("action-tag")
      expect(found).not.toContain("action-unpinned")
    })

    it("ignores local and docker references", () => {
      // Neither is fetched from a third party, so pinning does not apply.
      const found = rules(`${SAFE}      - uses: ./.github/actions/setup
      - uses: docker://alpine:3.19
`)
      expect(found).not.toContain("action-unpinned")
      expect(found).not.toContain("action-tag")
    })
  })

  describe("permissions", () => {
    it("flags a workflow with no top-level permissions", () => {
      expect(
        rules(`on: [push]
jobs:
  a:
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`),
      ).toContain("no-permissions")
    })

    it("does not count a job-level block as the top-level one", () => {
      // Only the top-level key changes the default for every job, and the
      // default is what is write-all on an older repository.
      expect(
        rules(`on: [push]
jobs:
  a:
    permissions:
      contents: read
    runs-on: ubuntu-latest
    steps:
      - run: echo hi
`),
      ).toContain("no-permissions")
    })

    it("says nothing about a file that defines no jobs", () => {
      // Reusable fragments and stray yaml are not workflows to secure.
      expect(rules("name: notes\non: [push]\n")).toEqual([])
    })
  })

  it("flags a self-hosted runner", () => {
    expect(rules(`${SAFE}  other:
    runs-on: self-hosted
`)).toContain("self-hosted-runner")
  })

  it("is not fooled by a comment", () => {
    // `# uses: foo/bar@v1` is documentation, not a step.
    expect(rules(`${SAFE}      # uses: evil/action@v1
`)).not.toContain("action-tag")
  })
})

describe("workflowSecurityScanner", () => {
  const ctx = (files: Record<string, string>): ScanContext =>
    ({
      root: "/repo",
      repo: { owner: "acme", name: "widget", defaultBranch: "main" },
      files: Object.keys(files),
      readFile: async (p: string) => files[p] ?? null,
      git: {
        blameAgeDays: async () => 12,
        listBranches: async () => [],
      },
    }) as unknown as ScanContext

  it("reports nothing when there are no workflows", async () => {
    expect(await workflowSecurityScanner.run(ctx({ "src/index.ts": "export {}" }))).toEqual([])
  })

  it("produces a locatable issue with the age from blame", async () => {
    const issues = await workflowSecurityScanner.run(
      ctx({ ".github/workflows/ci.yml": `${SAFE}      - uses: tj-actions/changed-files@v44\n` }),
    )
    const issue = issues.find((i) => i.id.startsWith("action-tag-"))!
    expect(issue.location).toMatch(/^\.github\/workflows\/ci\.yml:\d+$/)
    expect(issue.ageDays).toBe(12)
    expect(issue.title).toContain("tj-actions/changed-files")
    expect(issue.category).toBe("security")
  })

  it("survives a repository where blame is unavailable", async () => {
    const broken = ctx({ ".github/workflows/ci.yml": `${SAFE}      - uses: some/action\n` })
    broken.git.blameAgeDays = async () => {
      throw new Error("not a git repository")
    }
    const issues = await workflowSecurityScanner.run(broken)
    expect(issues.length).toBeGreaterThan(0)
    expect(issues[0].ageDays).toBe(0)
  })

  it("only reads .github/workflows", async () => {
    // A docker-compose.yml with `permissions:` in it is not a workflow.
    expect(
      await workflowSecurityScanner.run(
        ctx({ "deploy/ci.yml": "jobs:\n  a:\n    runs-on: ubuntu-latest\n" }),
      ),
    ).toEqual([])
  })
})
