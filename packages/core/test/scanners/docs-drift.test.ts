import { describe, it, expect } from "vitest"
import {
  findCommandRefs,
  findWorkflowBadges,
  soleManager,
  docsDriftScanner,
} from "../../src/scanners/docs-drift"
import type { ScanContext } from "../../src/scanner"

describe("findCommandRefs", () => {
  /**
   * Commands are only read inside a fenced block, so every case gets one. The
   * fence is the rule that keeps prose out — pnpm's README opens sentences with
   * "pnpm uses…" and "pnpm is…", which a looser rule reads as instructions.
   */
  const fenced = (body: string) => "```bash\n" + body + "```\n"

  /** Script invocations only — subcommands are returned too, but tested below. */
  const scripts = (body: string) =>
    findCommandRefs(fenced(body))
      .filter((r) => !r.isSubcommand)
      .map((r) => `${r.manager}:${r.script}`)

  it("reads an explicit run", () => {
    expect(scripts("npm run build\n")).toEqual(["npm:build"])
  })

  it("reads a bare lifecycle verb", () => {
    // `npm test` runs the `test` script — the word IS a script name here.
    expect(scripts("npm test\n")).toEqual(["npm:test"])
  })

  it("ignores the manager's own subcommands", () => {
    // Reporting a missing "install script" would be absurd.
    expect(scripts("npm install\npnpm add lodash\nyarn upgrade\npnpm dlx foo\n")).toEqual([])
  })

  it("still returns subcommands, marked as such", () => {
    // The wrong-manager rule is only ever about `install`, so dropping these in
    // the parser is what made that rule unreachable in the first draft.
    const refs = findCommandRefs(fenced("npm install\n"))
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ manager: "npm", script: "install", isSubcommand: true })
  })

  it("strips a shell prompt", () => {
    expect(scripts("$ pnpm run dev\n> npm run lint\n")).toEqual(["pnpm:dev", "npm:lint"])
  })

  it("ignores prose that happens to begin with the manager's name", () => {
    // Straight from pnpm's own README. A rule as loose as "the line starts with
    // the manager" reads these as instructions to run `uses` and `is`.
    const prose =
      "pnpm uses a content-addressable filesystem to store all files.\n" +
      "pnpm is up to 2x faster than npm and Yarn classic.\n"
    expect(findCommandRefs(prose)).toEqual([])
  })

  it("does not treat a bare word as a script for pnpm or yarn", () => {
    // `yarn prettier .` and `pnpm lefthook install` run a BINARY from
    // node_modules when no script matches, so "no such script" is not something
    // the repository can establish. Seven false positives on prettier's docs.
    expect(scripts("yarn prettier . --write\npnpm lefthook install\nbun simple-git-hooks\n")).toEqual(
      [],
    )
  })

  it("still reads a bare lifecycle verb, which is always a script", () => {
    expect(scripts("pnpm test\nyarn start\n")).toEqual(["pnpm:test", "yarn:start"])
  })

  it("ignores a command mentioned mid-sentence", () => {
    // Prose about a command is not an instruction to run one, and parsing prose
    // is how this scanner would embarrass itself.
    expect(scripts("You can use npm run build to compile.\n")).toEqual([])
  })

  it("ignores placeholders", () => {
    expect(
      scripts("npm run <script>\nnpm run [name]\npnpm run $TASK\nnpm run your-task\n"),
    ).toEqual([])
  })

  it("keeps script names with colons and dots", () => {
    expect(scripts("pnpm run build:cli\nnpm run test.unit\n")).toEqual([
      "pnpm:build:cli",
      "npm:test.unit",
    ])
  })

  describe("flags", () => {
    it("steps over a value-taking filter to reach the verb", () => {
      // The shape that produced five false positives on this project's own
      // README: `--filter` itself was read as the script name. It reaches the
      // real word now — and `build` is still not reported, because a bare word
      // could be a binary; `test` is, being a lifecycle verb.
      expect(scripts("pnpm --filter repo-anti-rot build:fast\n")).toEqual([])
      expect(scripts("pnpm --filter @repo-anti-rot/core test\n")).toEqual(["pnpm:test"])
    })

    it("checks a filtered script when `run` makes it unambiguous", () => {
      expect(scripts("pnpm --filter=web run build\n")).toEqual(["pnpm:build"])
    })

    it("steps over standalone flags", () => {
      expect(scripts("pnpm -r --if-present test\n")).toEqual(["pnpm:test"])
    })

    it("gives up on an unrecognised flag rather than guessing", () => {
      // We cannot know whether an unknown flag takes a value, and guessing wrong
      // turns its value into a "missing script".
      expect(scripts("pnpm --mystery value build\n")).toEqual([])
    })
  })

  it("stops once the reader has been sent to another directory", () => {
    // Express's README, exactly: the Quick Start scaffolds an app elsewhere and
    // then documents ITS scripts. "express has no start script" would be true
    // and completely beside the point.
    expect(
      scripts("npm run build\n\nexpress /tmp/foo && cd /tmp/foo\n\nnpm install\nnpm start\n"),
    ).toEqual(["npm:build"])
  })

  it("records whether anything followed the subcommand", () => {
    // `npm i -g widget` installs a published package; the local lockfile has no
    // say in it. Flagging it as "this repo uses pnpm" is wrong advice.
    expect(findCommandRefs(fenced("npm install\n"))[0].hasArgs).toBe(false)
    expect(findCommandRefs(fenced("npm i -g repo-anti-rot\n"))[0].hasArgs).toBe(true)
  })

  it("reports the line the command is on", () => {
    expect(findCommandRefs("# Setup\n\n```bash\npnpm run dev\n```\n")[0].line).toBe(4)
  })
})

describe("findWorkflowBadges", () => {
  it("reads the modern file-name form", () => {
    const md = "[![CI](https://github.com/acme/widget/actions/workflows/ci.yml/badge.svg)](x)"
    expect(findWorkflowBadges(md).map((b) => b.workflow)).toEqual(["ci.yml"])
  })

  it("reads the older workflow-name form", () => {
    const md = "![Build](https://github.com/acme/widget/workflows/Build/badge.svg)"
    expect(findWorkflowBadges(md).map((b) => b.workflow)).toEqual(["Build"])
  })

  it("decodes a percent-encoded workflow name", () => {
    const md = "![x](https://github.com/acme/widget/workflows/Unit%20Tests/badge.svg)"
    expect(findWorkflowBadges(md).map((b) => b.workflow)).toEqual(["Unit Tests"])
  })

  it("ignores badges that are not workflow status", () => {
    const md = "![npm](https://img.shields.io/npm/v/widget.svg) ![cov](https://codecov.io/x.svg)"
    expect(findWorkflowBadges(md)).toEqual([])
  })
})

describe("soleManager", () => {
  it("names the manager when exactly one lockfile is committed", () => {
    expect(soleManager(["pnpm-lock.yaml", "package.json"])).toBe("pnpm")
  })

  it("says nothing when two lockfiles disagree", () => {
    // Two lockfiles is its own problem, and not one this scanner reports. With
    // both present there is no contradiction to point at.
    expect(soleManager(["pnpm-lock.yaml", "package-lock.json"])).toBeNull()
  })

  it("says nothing when there is no lockfile", () => {
    expect(soleManager(["package.json"])).toBeNull()
  })
})

describe("docsDriftScanner", () => {
  /** Commands only count inside a fence, so every fixture README uses one. */
  const FENCE = (body: string) => "```bash\n" + body + "\n```\n"

  const ctx = (files: Record<string, string>): ScanContext =>
    ({
      root: "/repo",
      repo: { owner: "acme", name: "widget", defaultBranch: "main" },
      files: Object.keys(files),
      readFile: async (p: string) => files[p] ?? null,
      git: { blameAgeDays: async () => 42, listBranches: async () => [] },
    }) as unknown as ScanContext

  const PKG = JSON.stringify({ scripts: { build: "tsc", test: "vitest" } })

  it("says nothing when the docs match the repository", async () => {
    const issues = await docsDriftScanner.run(
      ctx({
        "README.md": "# Widget\n" + FENCE("pnpm install\npnpm run build\npnpm test"),
        "package.json": PKG,
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      }),
    )
    expect(issues).toEqual([])
  })

  it("reports a documented script that does not exist", async () => {
    const issues = await docsDriftScanner.run(
      ctx({ "README.md": FENCE("npm run dev"), "package.json": PKG }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("dev")
    expect(issues[0].location).toBe("README.md:2") // line 1 is the fence
    expect(issues[0].ageDays).toBe(42)
  })

  it("accepts a script defined in any workspace package", async () => {
    // The root README routinely documents a command that lives in a package.
    // Checking the root manifest alone would report every one as missing.
    const issues = await docsDriftScanner.run(
      ctx({
        "README.md": FENCE("pnpm run bundle"),
        "package.json": PKG,
        "packages/cli/package.json": JSON.stringify({ scripts: { bundle: "tsup" } }),
      }),
    )
    expect(issues).toEqual([])
  })

  it("stays silent when no manifest could be read", async () => {
    // "Not in scripts" would mean "we could not look". A scanner must not report
    // its own blindness as the project's fault.
    const issues = await docsDriftScanner.run(
      ctx({ "README.md": FENCE("npm run build"), "package.json": "{ not json" }),
    )
    expect(issues).toEqual([])
  })

  it("reports a badge for a workflow that is not there", async () => {
    const issues = await docsDriftScanner.run(
      ctx({
        "README.md": "![CI](https://github.com/acme/widget/actions/workflows/ci.yml/badge.svg)\n",
        "package.json": PKG,
        ".github/workflows/test.yml": "name: Test\non: [push]\n",
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("ci.yml")
  })

  it("accepts a badge that resolves by workflow name", async () => {
    const issues = await docsDriftScanner.run(
      ctx({
        "README.md": "![B](https://github.com/acme/widget/workflows/Build%20and%20test/badge.svg)\n",
        "package.json": PKG,
        ".github/workflows/ci.yml": "name: Build and test\non: [push]\n",
      }),
    )
    expect(issues).toEqual([])
  })

  it("reports install instructions the lockfile contradicts", async () => {
    const issues = await docsDriftScanner.run(
      ctx({
        "README.md": FENCE("npm install"),
        "package.json": PKG,
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      }),
    )
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("pnpm project")
  })

  it("does not police a global install of a published package", async () => {
    // Found on this project's README: `npm i -g repo-anti-rot`. Nothing to do
    // with installing this repo's dependencies.
    const issues = await docsDriftScanner.run(
      ctx({
        "README.md": FENCE("npm i -g repo-anti-rot"),
        "package.json": PKG,
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      }),
    )
    expect(issues).toEqual([])
  })

  it("does not police non-install commands across managers", async () => {
    // `npm run build` in a pnpm repo works fine. Only installing with the wrong
    // manager writes a second lockfile and breaks a workspace tree.
    const issues = await docsDriftScanner.run(
      ctx({
        "README.md": FENCE("npm run build"),
        "package.json": PKG,
        "pnpm-lock.yaml": "lockfileVersion: '9.0'\n",
      }),
    )
    expect(issues).toEqual([])
  })

  it("ignores markdown that is not documentation", async () => {
    const issues = await docsDriftScanner.run(
      ctx({ "CHANGELOG.md": FENCE("npm run gone"), "package.json": PKG }),
    )
    expect(issues).toEqual([])
  })

  it("ignores a package.json inside node_modules", async () => {
    // A dependency's scripts are not this project's public commands.
    const issues = await docsDriftScanner.run(
      ctx({
        "README.md": FENCE("npm run someDepScript"),
        "package.json": PKG,
        "node_modules/dep/package.json": JSON.stringify({ scripts: { someDepScript: "x" } }),
      }),
    )
    expect(issues).toHaveLength(1)
  })

  it("reports nothing when there is no documentation", async () => {
    expect(await docsDriftScanner.run(ctx({ "package.json": PKG }))).toEqual([])
  })
})
