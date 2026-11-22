import { describe, it, expect } from "vitest"
import { jsTaintScanner } from "../../src/scanners/js-taint"
import { makeContext } from "../helpers"

const run = async (files: Record<string, string>) => jsTaintScanner.run(makeContext({ files }))
const rules = async (files: Record<string, string>) => (await run(files)).map((i) => `${i.rule}@${i.location}`)

describe("js-taint — deep JavaScript/TypeScript analysis", () => {
  it("SQL text built from req.query (juice-shop search)", async () => {
    const src = `module.exports = function searchProducts () {
  return (req, res, next) => {
    let criteria = req.query.q === 'undefined' ? '' : req.query.q ?? ''
    criteria = (criteria.length <= 200) ? criteria : criteria.substring(0, 200)
    models.sequelize.query(\`SELECT * FROM Products WHERE ((name LIKE '%\${criteria}%' OR description LIKE '%\${criteria}%') AND deletedAt IS NULL)\`)
      .then(([products]) => res.json(products))
  }
}`
    const out = await run({ "routes/search.ts": src })
    const sqli = out.find((i) => i.rule === "js-taint-sqli")
    expect(sqli?.location).toBe("routes/search.ts:5")
    expect(sqli?.flow?.[0]?.text).toBe("req.query.q")
  })

  it("bound parameters are not SQL injection", async () => {
    const src = `app.get('/u', async (req, res) => {\n  const rows = await db.query('SELECT * FROM users WHERE id = $1', [req.query.id])\n  res.json(rows)\n})\n`
    expect(await rules({ "server.js": src })).not.toContain("js-taint-sqli@server.js:2")
  })

  it("follows a value into the project's own function in another file", async () => {
    const route = `import { findUser } from './repo'\napp.get('/u', (req, res) => {\n  const name = req.params.name\n  findUser(name)\n})\n`
    const repo = `export function findUser(n) {\n  return pool.query("SELECT * FROM users WHERE name = '" + n + "'")\n}\n`
    const out = await run({ "src/route.js": route, "src/repo.js": repo })
    const sqli = out.find((i) => i.rule === "js-taint-sqli")
    expect(sqli?.location).toBe("src/repo.js:2")
    expect(sqli?.confidence).toBe("medium")
  })

  it("shell, eval, file path, redirect and HTML sinks", async () => {
    const src = `const { exec } = require('child_process')
const fs = require('fs')
app.post('/x', (req, res) => {
  const { host, file, next, code } = req.body
  exec('ping -c 1 ' + host)
  eval(code)
  fs.readFile('/data/' + file, () => {})
  res.redirect(next)
  res.send('<h1>Hello ' + req.query.name + '</h1>')
})`
    const out = await rules({ "app.js": src })
    for (const r of ["js-taint-cmdi@app.js:5", "js-taint-code-injection@app.js:6", "js-taint-path-traversal@app.js:7", "js-taint-open-redirect@app.js:8", "js-taint-xss@app.js:9"]) expect(out).toContain(r)
  })

  it("sanitisers and safe shapes stop the flow", async () => {
    const src = `const path = require('path'); const fs = require('fs')
app.get('/x', (req, res) => {
  fs.readFile(path.join('/data', path.basename(req.query.f)), () => {})
  res.redirect('/profile/' + req.query.id)
  const n = parseInt(req.query.n)
  db.query('SELECT * FROM t LIMIT ' + n)
  fetch('https://api.example.com/items/' + req.query.id)
  res.send(escapeHtml(req.query.name))
})`
    expect(await rules({ "app.js": src })).toEqual([])
  })

  it("browser: location.hash into innerHTML, React dangerouslySetInnerHTML", async () => {
    const dom = `const q = new URLSearchParams(location.search).get('q')\ndocument.getElementById('r').innerHTML = 'Results for ' + q\n`
    expect(await rules({ "web/search.js": dom })).toContain("js-taint-xss@web/search.js:2")
    const react = `export default function Page() {\n  const p = useSearchParams()\n  return <div dangerouslySetInnerHTML={{ __html: p.get('msg') }} />\n}\n`
    expect(await rules({ "app/page.tsx": react })).toContain("js-taint-xss@app/page.tsx:3")
  })

  it("SSRF only when the input picks the host", async () => {
    const src = `app.get('/p', async (req, res) => {\n  await fetch(req.query.url)\n  await axios.get(\`https://\${req.query.host}/status\`)\n})\n`
    const out = await rules({ "proxy.js": src })
    expect(out).toContain("js-taint-ssrf@proxy.js:2")
    expect(out).toContain("js-taint-ssrf@proxy.js:3")
  })
})

describe("js-taint — Angular and Mongo shapes (juice-shop)", () => {
  it("Angular query param marked as trusted HTML", async () => {
    const src = `export class SearchResultComponent {\n  filterTable () {\n    let queryParam: string = this.route.snapshot.queryParams.q\n    queryParam = queryParam.trim()\n    this.searchValue = this.sanitizer.bypassSecurityTrustHtml(queryParam)\n  }\n}\n`
    expect(await rules({ "frontend/src/app/search-result.component.ts": src })).toContain("js-taint-xss@frontend/src/app/search-result.component.ts:5")
  })
  it("Mongo filter field taken straight from the body", async () => {
    const src = `module.exports = function productReviews () {\n  return (req, res) => {\n    db.reviewsCollection.update({ _id: req.body.id }, { $set: { message: req.body.message } }, { multi: true })\n  }\n}\n`
    expect(await rules({ "routes/updateProductReviews.ts": src })).toContain("js-taint-nosqli@routes/updateProductReviews.ts:3")
  })
})
