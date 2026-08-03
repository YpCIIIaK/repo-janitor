import { describe, it, expect } from "vitest"
import { looksGenerated, parseFile } from "../src/index"

/**
 * The guard that keeps generated JavaScript out of the parser.
 *
 * It exists because of a production outage, not a code-review opinion.
 * moment/moment commits a `min/` directory whose `tests.js` is 5.3 MB; parsing
 * it took the scanner's peak memory to 405 MB against an ordinary repository's
 * 90–145 MB, and on a 512 MB instance that killed the container and every
 * request in flight with it. With the guard the same repository peaks at 186 MB
 * and scans through.
 *
 * The risk of a guard like this is the opposite failure — quietly skipping real
 * source — so the tests are mostly about what it must NOT match.
 */

const lines = (n: number, text: string) => Array.from({ length: n }, () => text).join("\n")

describe("looksGenerated", () => {
  it("matches build output by path", () => {
    for (const f of [
      "min/moment.js",
      "dist/index.js",
      "packages/x/dist/bundle.js",
      "bundles/app.js",
      "vendor/thing.min.js",
      "app.bundle.js",
      "out/app.js.map",
    ]) {
      expect(looksGenerated("const a = 1\n", f)).toBe(true)
    }
  })

  it("matches a bundle by shape even when the name is innocent", () => {
    // One enormous line is the giveaway. Generated files are not reliably named
    // — moment's is `min/tests.js`, which looks like a test suite.
    const minified = `var a=1;${"b".repeat(5000)}`
    expect(looksGenerated(minified, "src/app.js")).toBe(true)
  })

  it("matches any file too large to be hand-written", () => {
    const huge = lines(30_000, "const someIdentifier = 1")
    expect(huge.length).toBeGreaterThan(512 * 1024)
    expect(looksGenerated(huge, "src/data.ts")).toBe(true)
  })

  it("does not match ordinary source", () => {
    const src = [
      "import { a } from './a'",
      "",
      "export function hello(name: string) {",
      "  return `hi ${name}`",
      "}",
    ].join("\n")
    for (const f of ["src/hello.ts", "lib/index.js", "app/page.tsx", "test/hello.test.ts"]) {
      expect(looksGenerated(src, f)).toBe(false)
    }
  })

  it("does not match a long file of normal lines", () => {
    // Length alone is not the signal — a 3000-line hand-written module is common
    // and must still be scanned.
    const long = lines(3000, "const x = compute(someArgument, anotherArgument) // a comment")
    expect(long.length).toBeLessThan(512 * 1024)
    expect(looksGenerated(long, "src/big.ts")).toBe(false)
  })

  it("does not match a source file that merely contains one long line", () => {
    // A single embedded data URI or a long string literal is not a bundle.
    const src = `${lines(400, "const x = 1")}\nconst logo = "${"A".repeat(4000)}"\n`
    expect(looksGenerated(src, "src/logo.ts")).toBe(false)
  })

  it("is not defeated by a directory merely named after one", () => {
    expect(looksGenerated("const a = 1\n", "src/administration/index.ts")).toBe(false)
    expect(looksGenerated("const a = 1\n", "src/mineral.ts")).toBe(false)
  })
})

describe("parseFile", () => {
  it("returns null for generated input instead of parsing it", () => {
    expect(parseFile("var a=1", "dist/app.js")).toBeNull()
  })

  it("still parses ordinary source", () => {
    expect(parseFile("export const a = 1", "src/a.ts")).not.toBeNull()
  })
})
