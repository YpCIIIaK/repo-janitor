import { describe, it, expect } from "vitest"
import { insecureCodeScanner, literalRanges } from "../../src/index"
import { makeContext } from "../helpers"

/**
 * These cases come from running the scanner on this repository, where it
 * reported its own rule table. Security tooling, linters and documentation all
 * hold dangerous-looking text in strings and patterns; a scanner that cannot
 * tell a description of code from code flags every one of them.
 */
describe("literal handling", () => {
  it("does not flag dangerous text inside a regex literal", async () => {
    const issues = await insecureCodeScanner.run(
      makeContext({
        files: { "rules.ts": "const rule = { re: /rejectUnauthorized\\s*:\\s*false/g }\n" },
      }),
    )
    expect(issues).toHaveLength(0)
  })

  it("does not flag dangerous text inside a string", async () => {
    const issues = await insecureCodeScanner.run(
      makeContext({
        files: { "docs.ts": 'const help = "never use new Function() on user input"\n' },
      }),
    )
    expect(issues).toHaveLength(0)
  })

  it("still flags the real call on a line that also contains a string", async () => {
    // The guard must not become a blanket exemption for lines with quotes in.
    const issues = await insecureCodeScanner.run(
      makeContext({ files: { "a.ts": 'log("running"); eval(payload)\n' } }),
    )
    expect(issues).toHaveLength(1)
  })

  it("tells a regex literal from a division", () => {
    // Closes at 17, not the `/` at 14: that one is inside a character class.
    expect(literalRanges("const r = /ab[/]c/g")).toEqual([[10, 17]])
    expect(literalRanges("const x = a / b / c")).toEqual([]) // division, not a regex
    expect(literalRanges("const s = 'hi'")).toEqual([[10, 13]])
  })
})

/**
 * The interesting property of this scanner is not that it fires — it is that it
 * does NOT fire on the safe form of the same construct. Most rules therefore
 * come in pairs: the dangerous line and its innocent twin.
 */
describe("insecureCodeScanner", () => {
  async function run(files: Record<string, string>) {
    return insecureCodeScanner.run(makeContext({ files }))
  }

  it("flags eval() on a non-literal but not on a string literal", async () => {
    const bad = await run({ "src/a.ts": "const r = eval(userInput)\n" })
    expect(bad).toHaveLength(1)
    expect(bad[0].severity).toBe("critical")
    expect(bad[0].location).toBe("src/a.ts:1")

    // `eval("1+1")` is pointless, not dangerous — no attacker-controlled input
    // can reach it, so reporting it would be pure noise.
    expect(await run({ "src/b.ts": 'const r = eval("1+1")\n' })).toHaveLength(0)
  })

  it("flags a shell command built by interpolation but not a fixed one", async () => {
    const bad = await run({ "src/a.ts": "execSync(`git checkout ${branch}`)\n" })
    expect(bad).toHaveLength(1)
    expect(bad[0].title).toContain("Shell command")

    expect(await run({ "src/b.ts": 'execSync("git status")\n' })).toHaveLength(0)
    // The recommended fix must not itself be flagged.
    expect(await run({ "src/c.ts": 'execFile("git", ["checkout", branch])\n' })).toHaveLength(0)
  })

  it("flags interpolated SQL but not a parameterised query", async () => {
    const bad = await run({ "src/db.ts": "db.query(`SELECT * FROM users WHERE id = ${id}`)\n" })
    expect(bad).toHaveLength(1)
    expect(bad[0].severity).toBe("critical")

    expect(
      await run({ "src/ok.ts": 'db.query("SELECT * FROM users WHERE id = $1", [id])\n' }),
    ).toHaveLength(0)
  })

  it("flags disabled TLS verification in both spellings", async () => {
    const a = await run({ "src/a.ts": "const agent = new Agent({ rejectUnauthorized: false })\n" })
    expect(a).toHaveLength(1)
    expect(a[0].severity).toBe("critical")

    const b = await run({ "src/b.py": "requests.get(url, verify=False)\n" })
    expect(b).toHaveLength(1)
    expect(b[0].severity).toBe("critical")
  })

  it("flags Python shell=True and yaml.load, not their safe forms", async () => {
    const bad = await run({
      "app.py": "subprocess.run(cmd, shell=True)\ndata = yaml.load(text)\n",
    })
    expect(bad).toHaveLength(2)
    expect(bad.every((i) => i.severity === "critical")).toBe(true)

    const good = await run({
      "ok.py": "subprocess.run(['ls', '-la'])\ndata = yaml.safe_load(text)\nyaml.load(t, Loader=yaml.SafeLoader)\n",
    })
    expect(good).toHaveLength(0)
  })

  it("flags Math.random only when it produces something meant to be unguessable", async () => {
    const bad = await run({ "src/a.ts": "const sessionToken = Math.random().toString(36)\n" })
    expect(bad).toHaveLength(1)

    // Jitter, sampling and animation are the overwhelmingly common uses.
    expect(await run({ "src/b.ts": "const delay = Math.random() * 1000\n" })).toHaveLength(0)
  })

  it("skips matches inside comments — commented-out code is not running code", async () => {
    expect(await run({ "src/a.ts": "// const r = eval(userInput)\n" })).toHaveLength(0)
    expect(await run({ "app.py": "# subprocess.run(cmd, shell=True)\n" })).toHaveLength(0)
  })

  it("lowers severity in test files, where the pattern is often deliberate", async () => {
    const issues = await run({ "src/api.test.ts": "new Agent({ rejectUnauthorized: false })\n" })
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning") // critical, lowered one step
    expect(issues[0].detail).toContain("test file")
  })

  it("skips eval / new Function in tests — those are usually the thing under test", async () => {
    expect(await run({ "src/theme-init.test.ts": "new Function(script)()\n" })).toHaveLength(0)
    expect(await run({ "src/eval.test.ts": "eval(userInput)\n" })).toHaveLength(0)
  })

  it("ignores vendored and generated code, which is not ours to fix", async () => {
    expect(
      await run({
        "node_modules/lib/index.js": "eval(x)\n",
        "dist/bundle.js": "eval(x)\n",
        "vendor/thing.js": "eval(x)\n",
        "static/app.min.js": "eval(x)\n",
      }),
    ).toHaveLength(0)
  })

  it("reports one finding per line even when several rules match", async () => {
    const issues = await run({ "src/a.ts": "eval(new Function(src))\n" })
    expect(issues).toHaveLength(1)
  })

  it("attaches blame age so a fresh regression is distinguishable", async () => {
    const ctx = makeContext({
      files: { "src/a.ts": "const r = eval(userInput)\n" },
      blameAges: { "src/a.ts:1": 400 },
    })
    const issues = await insecureCodeScanner.run(ctx)
    expect(issues[0].ageDays).toBe(400)
  })

  it("produces stable ids so a snooze survives a rescan", async () => {
    const files = { "src/a.ts": "const r = eval(userInput)\n" }
    const first = await run(files)
    const second = await run(files)
    expect(first[0].id).toBe(second[0].id)
    expect(first[0].id).toContain("eval-dynamic")
  })
})
