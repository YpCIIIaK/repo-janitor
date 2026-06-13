import { describe, it, expect } from "vitest"
import { deadCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("deadCodeScanner (JS/TS unused exports)", () => {
  it("flags an exported value never imported anywhere", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": "export const used = 1\nexport const orphan = 2\n",
        "b.ts": "import { used } from './a'\nconsole.log(used)\n",
      },
    })
    const issues = await deadCodeScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("orphan")
    expect(issues[0].severity).toBe("info")
    expect(issues[0].category).toBe("dead-code")
  })

  it("does not flag an export that is imported", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": "export function helper() { return 1 }\n",
        "b.ts": "import { helper } from './a'\nhelper()\n",
      },
    })
    expect(await deadCodeScanner.run(ctx)).toHaveLength(0)
  })

  it("does not flag an export that is used within its own module", async () => {
    // EMOJI is never imported elsewhere but is read in-module, so it isn't dead —
    // removing it would break a.ts. genuinelyDead (used nowhere) still flags.
    const ctx = makeContext({
      files: {
        "a.ts":
          "export const EMOJI = { A: '🟢' }\nexport const genuinelyDead = 2\nexport function label(g) { return EMOJI[g] }\n",
        "b.ts": "import { label } from './a'\nlabel('A')\n",
      },
    })
    const issues = await deadCodeScanner.run(ctx)
    expect(issues.map((i) => i.title)).toEqual(["Unused export genuinelyDead"])
  })

  it("never flags exports from an index barrel", async () => {
    const ctx = makeContext({
      files: {
        "index.ts": "export const publicApi = 1\n",
        "other.ts": "export const x = 1\nimport './index'\n",
      },
    })
    const issues = await deadCodeScanner.run(ctx)
    expect(issues.some((i) => i.title.includes("publicApi"))).toBe(false)
  })

  it("exempts a module that is namespace-imported", async () => {
    const ctx = makeContext({
      files: {
        "a.ts": "export const one = 1\nexport const two = 2\n",
        "b.ts": "import * as a from './a'\nconsole.log(a)\n",
      },
    })
    expect(await deadCodeScanner.run(ctx)).toHaveLength(0)
  })

  it("ignores Next.js convention exports (GET, metadata, ...)", async () => {
    const ctx = makeContext({
      files: {
        "route.ts": "export async function GET() {}\nexport const metadata = {}\n",
        "other.ts": "export const x = 1\nimport './route'\n",
      },
    })
    const issues = await deadCodeScanner.run(ctx)
    expect(issues.some((i) => i.title.includes("GET"))).toBe(false)
    expect(issues.some((i) => i.title.includes("metadata"))).toBe(false)
  })

  it("does not run on a single file (needs ≥2 to graph)", async () => {
    const ctx = makeContext({ files: { "a.ts": "export const orphan = 1\n" } })
    expect(await deadCodeScanner.run(ctx)).toHaveLength(0)
  })
})

describe("deadCodeScanner (polyglot symbols)", () => {
  it("flags an unreferenced Python function", async () => {
    const ctx = makeContext({
      files: {
        "a.py": "def used():\n    return 1\n\ndef orphan():\n    return 2\n",
        "b.py": "from a import used\nused()\n",
      },
    })
    const issues = await deadCodeScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("orphan")
  })

  it("respects Python __all__ as public surface", async () => {
    const ctx = makeContext({
      files: { "a.py": "__all__ = ['exported']\n\ndef exported():\n    return 1\n" },
    })
    expect(await deadCodeScanner.run(ctx)).toHaveLength(0)
  })

  it("skips decorated Python defs (framework-registered)", async () => {
    const ctx = makeContext({
      files: { "a.py": "@app.route('/x')\ndef handler():\n    return 1\n" },
    })
    expect(await deadCodeScanner.run(ctx)).toHaveLength(0)
  })

  it("flags an unexported Go function but not an exported one", async () => {
    const ctx = makeContext({
      files: {
        "a.go": "package x\nfunc Exported() {}\nfunc orphan() {}\n",
      },
    })
    const issues = await deadCodeScanner.run(ctx)
    expect(issues).toHaveLength(1)
    expect(issues[0].title).toContain("orphan")
  })

  it("does not flag a module pulled in via dynamic import().then(m => m.X)", async () => {
    const ctx = makeContext({
      files: {
        "components/widget.ts": "export function Widget() { return 1 }\n",
        "page.ts": 'const W = import("./components/widget").then((m) => m.Widget)\nconsole.log(W)\n',
      },
    })
    const issues = await deadCodeScanner.run(ctx)
    expect(issues.some((i) => i.title.includes("Widget"))).toBe(false)
  })

  it("resolves the @/ alias for dynamic-import exemption", async () => {
    const ctx = makeContext({
      files: {
        "components/widget.ts": "export function Widget() { return 1 }\n",
        "app/page.ts": 'const W = import("@/components/widget").then((m) => m.Widget)\nconsole.log(W)\n',
      },
    })
    const issues = await deadCodeScanner.run(ctx)
    expect(issues.some((i) => i.title.includes("Widget"))).toBe(false)
  })

  it("does not flag a module pulled in via require()", async () => {
    const ctx = makeContext({
      files: {
        "lib/a.js": "exports.thing = 1\nmodule.exports.thing2 = function(){}\n",
        "lib/b.js": 'const m = require("./a")\nconsole.log(m)\nexport const orphan = 2\n',
      },
    })
    const issues = await deadCodeScanner.run(ctx)
    // b.ts's own orphan is still flagged, but a.js (require target) is exempt.
    expect(issues.some((i) => i.location.startsWith("lib/a.js"))).toBe(false)
  })
})
