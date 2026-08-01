import { describe, it, expect } from "vitest"
import {
  significantLines,
  findDuplicates,
  isComparable,
  duplicateCodeScanner,
  type NormalizedLine,
} from "../../src/scanners/duplicate-code"
import type { ScanContext } from "../../src/scanner"

const texts = (s: string) => significantLines(s).map((l) => l.text)

describe("significantLines", () => {
  it("drops blank lines and collapses whitespace", () => {
    expect(texts("const   a =  1\n\n\nconst b = 2\n")).toEqual(["const a = 1", "const b = 2"])
  })

  it("drops line comments", () => {
    expect(texts("// explain\nconst a = 1\n# python too\n")).toEqual(["const a = 1"])
  })

  it("drops block comments across lines", () => {
    expect(texts("/**\n * doc\n */\nconst a = 1\n")).toEqual(["const a = 1"])
  })

  it("drops lone punctuation", () => {
    // A closing brace matching a closing brace is not duplication.
    expect(texts("if (a) {\nwork()\n}\n")).toEqual(["if (a) {", "work()"])
  })

  it("drops imports", () => {
    // Two files importing the same six modules is a shared dependency, not a
    // copy — and left in, it would match nearly every file against every other.
    expect(texts('import { a } from "x"\nimport b from "y"\nconst c = 1\n')).toEqual(["const c = 1"])
  })

  it("keeps the original line numbers", () => {
    expect(significantLines("\n\n// x\nconst a = 1\n")[0].line).toBe(4)
  })
})

describe("findDuplicates", () => {
  /** Twelve distinct, comfortably long lines. */
  const body = (tag: string) =>
    Array.from({ length: 12 }, (_, i) => ({
      text: `const value${i} = compute${tag}(${i}, options, context, fallbackValue)`,
      line: i + 1,
    }))

  const asFile = (lines: { text: string; line: number }[]): NormalizedLine[] => lines

  it("finds a block repeated in two files", () => {
    const blocks = findDuplicates(
      new Map([
        ["a.ts", asFile(body("X"))],
        ["b.ts", asFile(body("X"))],
      ]),
    )
    expect(blocks).toHaveLength(1)
    expect(blocks[0].places.map((p) => p.file)).toEqual(["a.ts", "b.ts"])
  })

  it("extends to the full length of the clone rather than the window", () => {
    const blocks = findDuplicates(
      new Map([
        ["a.ts", asFile(body("X"))],
        ["b.ts", asFile(body("X"))],
      ]),
    )
    // Twelve identical lines, not the eight-line window that first matched.
    expect(blocks[0].length).toBe(12)
  })

  it("reports a clone once, not once per window", () => {
    const blocks = findDuplicates(
      new Map([
        ["a.ts", asFile(body("X"))],
        ["b.ts", asFile(body("X"))],
      ]),
    )
    expect(blocks).toHaveLength(1)
  })

  it("counts every copy", () => {
    const blocks = findDuplicates(
      new Map([
        ["a.ts", asFile(body("X"))],
        ["b.ts", asFile(body("X"))],
        ["c.ts", asFile(body("X"))],
      ]),
    )
    expect(blocks[0].places).toHaveLength(3)
  })

  it("says nothing about files that merely resemble each other", () => {
    expect(
      findDuplicates(
        new Map([
          ["a.ts", asFile(body("X"))],
          ["b.ts", asFile(body("Y"))],
        ]),
      ),
    ).toEqual([])
  })

  it("says nothing about a block below the window", () => {
    const short = body("X").slice(0, 5)
    expect(
      findDuplicates(
        new Map([
          ["a.ts", asFile(short)],
          ["b.ts", asFile(short)],
        ]),
      ),
    ).toEqual([])
  })

  it("says nothing about eight short lines", () => {
    // Boilerplate passes the line count and fails the length floor, which is
    // what keeps switch arms and error handling out of the report.
    const tiny = Array.from({ length: 10 }, (_, i) => ({ text: `x${i}()`, line: i + 1 }))
    expect(
      findDuplicates(
        new Map([
          ["a.ts", asFile(tiny)],
          ["b.ts", asFile(tiny)],
        ]),
      ),
    ).toEqual([])
  })

  it("says nothing about a repeated type signature", () => {
    // Straight from redux's createStore: an overload set repeats its type
    // parameters and parameter list once per signature because the language
    // requires it. Telling a maintainer to de-duplicate that is telling them
    // to stop using overloads.
    const sig = [
      "Ext extends {} = {},",
      "StateExt extends {} = {}",
      ">(",
      "reducer: Reducer<S, A>,",
      "preloadedState?: PreloadedState | undefined,",
      "enhancer?: StoreEnhancer<Ext, StateExt>",
      "): Store<S, A, UnknownIfNonSpecific<StateExt>> & NoInfer<Ext>",
      "S,",
      "A extends Action,",
      "PreloadedState = S",
    ].map((text, i) => ({ text, line: i + 1 }))
    expect(
      findDuplicates(
        new Map([
          ["a.ts", asFile(sig)],
          ["b.ts", asFile(sig)],
        ]),
      ),
    ).toEqual([])
  })

  it("still reports a block that merely mentions types", () => {
    // The guard is about blocks that are ONLY declarations; real code carrying
    // annotations must survive it.
    const real = Array.from({ length: 12 }, (_, i) => ({
      text: `const parsed${i}: Result = parse(input.field${i}, options, context, fallback)`,
      line: i + 1,
    }))
    expect(
      findDuplicates(
        new Map([
          ["a.ts", asFile(real)],
          ["b.ts", asFile(real)],
        ]),
      ),
    ).toHaveLength(1)
  })

  it("says nothing about a repeated block of inline SVG", () => {
    // vite's SponsorBanner.vue carries a logo whose <filter> definitions repeat
    // twelve times. That made it the loudest finding of the run and the least
    // useful one: the duplication is inside an exported asset nobody hand-edits.
    const svg = [
      '<filter id="e" width="25.513" height="9.425" x="68.425">',
      'color-interpolation-filters="sRGB"',
      'filterUnits="userSpaceOnUse"',
      '<feFlood flood-opacity="0" result="BackgroundImageFix" />',
      '<feBlend in="SourceGraphic" in2="BackgroundImageFix" result="shape" />',
      "<feGaussianBlur",
      'result="effect1_foregroundBlur_318_41192"',
      'stdDeviation="1.473"',
      "</filter>",
      '<filter id="f" width="25.513" height="9.425" x="68.425">',
    ].map((text, i) => ({ text, line: i + 1 }))
    expect(
      findDuplicates(
        new Map([
          ["a.vue", asFile(svg)],
          ["b.vue", asFile(svg)],
        ]),
      ),
    ).toEqual([])
  })

  it("finds a block repeated inside one file", () => {
    const twice = [...body("X"), ...body("X").map((l) => ({ ...l, line: l.line + 20 }))]
    const blocks = findDuplicates(new Map([["a.ts", asFile(twice)]]))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].places.map((p) => p.startLine)).toEqual([1, 21])
  })
})

describe("isComparable", () => {
  it("takes ordinary source", () => {
    expect(isComparable("src/lib/thing.ts")).toBe(true)
    expect(isComparable("app/models/user.rb")).toBe(true)
  })

  it("skips tests", () => {
    // Tests repeat themselves by design: a table of cases differing in one
    // value is a good suite, not a decaying one.
    expect(isComparable("src/thing.test.ts")).toBe(false)
    expect(isComparable("tests/test_thing.py")).toBe(false)
  })

  it("skips generated and vendored trees", () => {
    expect(isComparable("dist/index.js")).toBe(false)
    expect(isComparable("vendor/github.com/x/y.go")).toBe(false)
    expect(isComparable("src/api.pb.go")).toBe(false)
    expect(isComparable("src/types.d.ts")).toBe(false)
  })

  it("skips migrations", () => {
    // Each is a frozen record of one moment; they repeat and must not change.
    expect(isComparable("db/migrations/0007_add_users.ts")).toBe(false)
  })

  it("skips scaffolding templates", () => {
    // vite's create-vite ships template-react beside template-react-ts: the same
    // starter app in two languages, and being the same is their whole job. A
    // scaffold that had diverged would be the bug.
    expect(isComparable("packages/create-vite/template-react/src/App.jsx")).toBe(false)
    expect(isComparable("packages/create-vite/template-react-ts/src/App.tsx")).toBe(false)
  })

  it("skips playground apps", () => {
    // vite's `playground/ssr` and `playground/ssr-html` are variants of one
    // sample server, kept side by side so each exercises a different path.
    expect(isComparable("playground/ssr/server.js")).toBe(false)
  })

  it("skips non-code", () => {
    expect(isComparable("README.md")).toBe(false)
    expect(isComparable("data/cities.json")).toBe(false)
  })
})

describe("duplicateCodeScanner", () => {
  const ctx = (files: Record<string, string>): ScanContext =>
    ({
      root: "/repo",
      repo: { owner: "acme", name: "widget", defaultBranch: "main" },
      files: Object.keys(files),
      readFile: async (p: string) => files[p] ?? null,
      git: { blameAgeDays: async () => 120, listBranches: async () => [] },
      log: () => {},
    }) as unknown as ScanContext

  const CLONE = Array.from(
    { length: 14 },
    (_, i) => `  const result${i} = transform(input.field${i}, options, context, fallback)`,
  ).join("\n")

  it("says nothing about a repository with no duplication", async () => {
    const issues = await duplicateCodeScanner.run(
      ctx({ "src/a.ts": CLONE, "src/b.ts": "export const x = 1\n" }),
    )
    expect(issues).toEqual([])
  })

  it("reports a clone across two files", async () => {
    const [issue] = await duplicateCodeScanner.run(
      ctx({ "src/a.ts": CLONE, "src/b.ts": `export function go() {\n${CLONE}\n}\n` }),
    )
    expect(issue.title).toMatch(/duplicated between two files/)
    expect(issue.location).toBe("src/a.ts:1")
    expect(issue.ageDays).toBe(120)
  })

  it("calls a large clone a warning", async () => {
    const big = Array.from(
      { length: 34 },
      (_, i) => `  const result${i} = transform(input.field${i}, options, context, fallback)`,
    ).join("\n")
    const [issue] = await duplicateCodeScanner.run(ctx({ "src/a.ts": big, "src/b.ts": big }))
    expect(issue.severity).toBe("warning")
  })

  it("calls a small clone in two places info", async () => {
    const [issue] = await duplicateCodeScanner.run(ctx({ "src/a.ts": CLONE, "src/b.ts": CLONE }))
    expect(issue.severity).toBe("info")
  })

  it("counts four copies as a pattern rather than an accident", async () => {
    const [issue] = await duplicateCodeScanner.run(
      ctx({ "src/a.ts": CLONE, "src/b.ts": CLONE, "src/c.ts": CLONE, "src/d.ts": CLONE }),
    )
    expect(issue.severity).toBe("warning")
    expect(issue.title).toMatch(/repeated in 4 places/)
  })

  it("ignores duplication between test files", async () => {
    const issues = await duplicateCodeScanner.run(
      ctx({ "src/a.test.ts": CLONE, "src/b.test.ts": CLONE }),
    )
    expect(issues).toEqual([])
  })

  it("ignores a minified bundle with no newlines", async () => {
    const min = `const a=1;${"x".repeat(3000)}`
    const issues = await duplicateCodeScanner.run(ctx({ "src/a.js": min, "src/b.js": min }))
    expect(issues).toEqual([])
  })

  it("does nothing in a single-file repository", async () => {
    expect(await duplicateCodeScanner.run(ctx({ "src/a.ts": CLONE }))).toEqual([])
  })
})
