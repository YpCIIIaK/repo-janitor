import { describe, it, expect } from "vitest"
import {
  computeScore,
  scoreToGrade,
  runScan,
  type Scanner,
  type Issue,
} from "../src/index"
import { DEFAULT_WEIGHTS } from "../src/config"
import { makeContext } from "./helpers"

/** Build a minimal valid Issue for tests. */
function issue(over: Partial<Issue> = {}): Issue {
  return {
    id: "x",
    category: "hygiene",
    severity: "warning",
    title: "t",
    location: "a.ts:1",
    ageDays: 0,
    detail: "d",
    ...over,
  }
}

/** A scanner that returns a fixed set of issues. */
function fixedScanner(id: string, issues: Issue[]): Scanner {
  return { id, category: "hygiene", run: async () => issues }
}

describe("computeScore", () => {
  it("starts at 100 with no issues", () => {
    expect(computeScore([])).toBe(100)
  })

  it("subtracts weighted penalties per severity", () => {
    const issues = [
      issue({ severity: "critical" }), // 10
      issue({ severity: "warning" }), // 3
      issue({ severity: "info" }), // 0.5
    ]
    // 100 - 13.5 = 86.5 → rounds to 87 (round-half-up)
    expect(computeScore(issues)).toBe(87)
  })

  it("clamps at 0 and never goes negative", () => {
    const many = Array.from({ length: 20 }, () => issue({ severity: "critical" }))
    expect(computeScore(many)).toBe(0)
  })

  it("honors custom weights", () => {
    const issues = [issue({ severity: "info" })]
    expect(computeScore(issues, { critical: 10, warning: 3, info: 10 })).toBe(90)
  })

  it("caps low-severity pile-ups so they can't outweigh a real critical", () => {
    // Linearly 200 info = 100 points (score 0); capped at 15 → score 85.
    const info = Array.from({ length: 200 }, () => issue({ severity: "info" }))
    expect(computeScore(info)).toBe(85)
    // Warnings cap at 40; criticals stay uncapped.
    const warnings = Array.from({ length: 100 }, () => issue({ severity: "warning" }))
    expect(computeScore(warnings)).toBe(60)
  })

  it("matches DEFAULT_WEIGHTS shape", () => {
    expect(DEFAULT_WEIGHTS).toMatchObject({ critical: 10, warning: 3, info: 0.5 })
  })
})

describe("scoreToGrade", () => {
  it.each([
    [100, "A"],
    [90, "A"],
    [89, "B"],
    [75, "B"],
    [74, "C"],
    [60, "C"],
    [59, "D"],
    [40, "D"],
    [39, "F"],
    [0, "F"],
  ])("score %i → grade %s", (score, grade) => {
    expect(scoreToGrade(score)).toBe(grade)
  })
})

describe("runScan", () => {
  it("aggregates issues from all scanners and produces a valid report", async () => {
    const ctx = makeContext({ files: { "a.ts": "const a = 1\n" } })
    const report = await runScan(ctx, [
      fixedScanner("s1", [issue({ id: "i1", severity: "warning" })]),
      fixedScanner("s2", [issue({ id: "i2", severity: "info" })]),
    ])
    expect(report.issues.map((i) => i.id)).toEqual(["i1", "i2"])
    expect(report.schemaVersion).toBe(1)
    expect(report.repo.owner).toBe("acme")
    // 100 - 3 - 0.5 = 96.5 → 97
    expect(report.score).toBe(97)
    expect(report.grade).toBe("A")
  })

  it("isolates a throwing scanner: logs and continues", async () => {
    const logs: string[] = []
    const ctx = makeContext({ files: {}, logs })
    const boom: Scanner = {
      id: "boom",
      category: "hygiene",
      run: async () => {
        throw new Error("kaboom")
      },
    }
    const report = await runScan(ctx, [
      boom,
      fixedScanner("ok", [issue({ id: "kept" })]),
    ])
    expect(report.issues.map((i) => i.id)).toEqual(["kept"])
    expect(logs.some((l) => l.includes("boom") && l.includes("kaboom"))).toBe(true)
  })

  it("drops findings on a line carrying the same-line ignore marker", async () => {
    const ctx = makeContext({
      files: { "a.ts": "const ok = 1\nconst bad = 2 // repo-anti-rot-ignore\n" },
    })
    const report = await runScan(ctx, [
      fixedScanner("s", [
        issue({ id: "keep", location: "a.ts:1" }),
        issue({ id: "drop", location: "a.ts:2" }),
      ]),
    ])
    expect(report.issues.map((i) => i.id)).toEqual(["keep"])
  })

  it("drops findings on the line below a next-line ignore marker", async () => {
    const ctx = makeContext({
      files: { "a.ts": "// repo-anti-rot-ignore-next-line\nconst bad = 2\n" },
    })
    const report = await runScan(ctx, [
      fixedScanner("s", [issue({ id: "drop", location: "a.ts:2" })]),
    ])
    expect(report.issues).toHaveLength(0)
  })

  it("keeps findings without a file:line location (cannot be inline-ignored)", async () => {
    const ctx = makeContext({ files: { "a.ts": "x" } })
    const report = await runScan(ctx, [
      fixedScanner("s", [issue({ id: "branchy", location: "origin/feature" })]),
    ])
    expect(report.issues.map((i) => i.id)).toEqual(["branchy"])
  })

  it("drops findings matched by a config mute rule and rescores without them", async () => {
    const ctx = makeContext({
      files: {},
      config: {
        ignore: [],
        mute: [{ category: "todo", path: "legacy/**" }],
        weights: { critical: 10, warning: 3, info: 0.5 },
      },
    })
    const report = await runScan(ctx, [
      fixedScanner("s", [
        issue({ id: "muted", category: "todo", severity: "warning", location: "legacy/x.ts:1" }),
        issue({ id: "kept", category: "todo", severity: "warning", location: "src/x.ts:1" }),
      ]),
    ])
    expect(report.issues.map((i) => i.id)).toEqual(["kept"])
    expect(report.score).toBe(97) // only the kept warning (−3) counts
  })

  it("uses weights from ctx.config when scoring", async () => {
    const ctx = makeContext({
      files: {},
      config: { ignore: [], mute: [], weights: { critical: 50, warning: 3, info: 0.5 } },
    })
    const report = await runScan(ctx, [
      fixedScanner("s", [issue({ severity: "critical" })]),
    ])
    expect(report.score).toBe(50)
    expect(report.config?.weights.critical).toBe(50)
  })

  it("counts non-blank lines of recognized source into metrics", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": "line1\n\nline2\n", // 2 non-blank
        "b.go": "package main\n", // 1 non-blank
        "README.md": "# title\nlots of prose\n", // not source → ignored
      },
    })
    const report = await runScan(ctx, [])
    expect(report.metrics?.linesOfCode).toBe(3)
  })

  it("builds a repo profile: languages by LOC plus detected tooling", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": "line1\n\nline2\n", // TypeScript, 2 LOC
        "b.ts": "x\n", // TypeScript, 1 LOC
        "main.go": "package main\n", // Go, 1 LOC
        "package.json": "{}",
        "Dockerfile": "FROM node",
        "README.md": "# prose",
      },
    })
    const report = await runScan(ctx, [])
    expect(report.profile?.totalFiles).toBe(6)
    // TypeScript (3 LOC across 2 files) ranks above Go (1 LOC)
    expect(report.profile?.languages).toEqual([
      { language: "TypeScript", files: 2, loc: 3 },
      { language: "Go", files: 1, loc: 1 },
    ])
    expect(report.profile?.tools).toEqual(["Node.js", "Docker"])
    // LOC metric stays consistent with the language breakdown
    expect(report.metrics?.linesOfCode).toBe(4)
  })

  it("fires progress callbacks: start tick then one per scanner", async () => {
    const ctx = makeContext({ files: {} })
    const events: { completed: number; total: number; scanner?: string }[] = []
    await runScan(
      ctx,
      [fixedScanner("a", []), fixedScanner("b", [])],
      (p) => events.push(p),
    )
    expect(events).toEqual([
      { completed: 0, total: 2 },
      { scanner: "a", completed: 1, total: 2 },
      { scanner: "b", completed: 2, total: 2 },
    ])
  })
})
