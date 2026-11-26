import { describe, it, expect } from "vitest"
import { profileRepo } from "../src/repo-profile"

const ctxOf = (files: Record<string, string>) => ({
  files: Object.keys(files),
  readFile: async (f: string) => files[f] ?? null,
  fileSize: async (f: string) => (files[f] ?? "").length,
})
const realFile = (i: number) => `<?php\nfunction handler_${i}($req) {\n  $id = (int) $req['id'];\n  $row = db_query("SELECT * FROM t${i} WHERE id = ?", [$id]);\n  if (!$row) return not_found(${i});\n  return render('view_${i}', ['row' => $row, 'n' => ${i} * 2]);\n}\n// helper ${i}: ${"x".repeat(i % 7)}\n`.repeat(2) + `function extra_${i}_${i * 31}() { return ${i}; }\n`.repeat((i % 5) + 1)

describe("repo profile", () => {
  it("an ordinary application is not junk", async () => {
    const files: Record<string, string> = { "composer.json": "{}" }
    for (let i = 0; i < 60; i++) files[`src/mod${i % 6}/file${i}.php`] = realFile(i)
    const p = await profileRepo(ctxOf(files))
    expect(p.junk).toBe(false)
  })

  it("minified bundles", async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 40; i++) files[`static/js/app${i}.js`] = `var a${i}=1;`.repeat(800)
    const p = await profileRepo(ctxOf(files))
    expect(p.junk).toBe(true)
    expect(p.reasons[0]).toMatch(/generated or minified/)
  })

  it("copies of one file", async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 240; i++) files[`sites/site${i}/index.php`] = realFile(i % 10)
    expect((await profileRepo(ctxOf(files))).reasons.join()).toMatch(/distinct texts/)
  })

  it("one template with different text (doorway pages)", async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 240; i++) files[`pages/p${i}.html`] = `<html><head><title>"Cheap offer ${i} in city ${i}"</title></head><body><h1>"Best deal number ${i}"</h1><p>"Buy now in town ${i * 7}"</p>${"<div class='x'>filler</div>".repeat(10)}</body></html>`
    expect((await profileRepo(ctxOf(files))).reasons.join()).toMatch(/template/)
  })

  it("a dump of exercise folders", async () => {
    const files: Record<string, string> = {}
    for (let i = 1; i <= 40; i++) files[`day${i}/main.py`] = `# day ${i}\n` + `print(sum(range(${i})))\nx_${i} = [${i}, ${i * 3}]\n`.repeat(i % 4 + 1)
    expect((await profileRepo(ctxOf(files))).reasons.join()).toMatch(/exercise/)
  })

  it("an app that ships built assets and copied scaffolds next to its own code is not junk", async () => {
    const files: Record<string, string> = { "package.json": "{}" }
    for (let i = 0; i < 6; i++) files[`public/js/lib${i}.min.js`] = "var a=1;".repeat(80_000)
    for (let i = 0; i < 40; i++) files[`src/part${i}.js`] = `export function part${i}(x) {\n${"  x = x + 1\n".repeat(i + 3)}  return x * ${i}\n}\n`
    for (let i = 0; i < 30; i++) files[`templates/t${i}/server.js`] = "module.exports = function server() { return 'scaffold' }\n".repeat(10)
    const p = await profileRepo(ctxOf(files))
    expect(p.junk).toBe(false)
  })

  it("small repositories are left alone", async () => {
    const files: Record<string, string> = {}
    for (let i = 0; i < 10; i++) files[`a${i}.min.js`] = "x".repeat(5000)
    expect((await profileRepo(ctxOf(files))).junk).toBe(false)
  })
})
