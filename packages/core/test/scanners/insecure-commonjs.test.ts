import { describe, expect, it } from "vitest"
import { insecureCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"

describe("CommonJS security coverage", () => {
  it("scans executable cjs files with the same source rules as js", async () => {
    const source = 'const https = require("https");\nconst agent = new https.Agent({ rejectUnauthorized: false });'
    const scan = (name: string) => insecureCodeScanner.run(makeContext({ files: { [name]: source } }))
    const js = await scan("src/client.js")
    const cjs = await scan("src/client.cjs")
    expect(js.length).toBeGreaterThan(0)
    expect(cjs.map(i => i.title)).toEqual(js.map(i => i.title))
  })
  it("keeps verified TLS and literal examples safe", async () => {
    const issues = await insecureCodeScanner.run(makeContext({ files: {
      "src/client.cjs": 'const agent = new https.Agent({ rejectUnauthorized: true });\nconst help = "rejectUnauthorized: false";',
    } }))
    expect(issues).toEqual([])
  })
})
