import { describe, expect, it } from "vitest"
import { insecureCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"
const scan = (source: string) => insecureCodeScanner.run(makeContext({ files: { "src/App.swift": source } }))
describe("Swift injection flows", () => {
  it("follows input into SQL text", async () => {
    const issues = await scan('let name = nameTextField.text!\nlet query = "SELECT * FROM users WHERE name = \\(name)"\nsqlite3_exec(db, query, nil, nil, nil)')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ confidence: "high", severity: "critical", location: "src/App.swift:3" })
  })
  it("detects request-derived SQL", async () => {
    expect(await scan('let name = req.query["name"]!\ndb.executeQuery("SELECT * FROM users WHERE name = \\(name)")')).toHaveLength(1)
  })
  it("follows input into WebView HTML", async () => {
    const issues = await scan('let html = textView.text\nwebView.loadHTMLString(html, baseURL: nil)')
    expect(issues).toHaveLength(1)
    expect(issues[0].id).toContain("swift-webview-html")
  })
  it("ignores bound SQL, fixed HTML and escaped values", async () => {
    expect(await scan('let name = nameTextField.text!\nsqlite3_prepare_v2(db, "SELECT * FROM users WHERE name = ?", -1, &stmt, nil)\nsqlite3_bind_text(stmt, 1, name, -1, nil)\nwebView.loadHTMLString("<p>Hello</p>", baseURL: nil)\nlet safe = escapeHTML(textView.text)\nwebView.loadHTMLString(safe, baseURL: nil)')).toEqual([])
  })
  it("clears taint at scope boundaries and reassignment", async () => {
    expect(await scan('func first() {\nlet name = nameTextField.text!\n}\nfunc second() {\nlet query = "SELECT * FROM users WHERE name = \\(name)"\nsqlite3_exec(db, query, nil, nil, nil)\n}\nvar html = textView.text\nhtml = "fixed"\nwebView.loadHTMLString(html, baseURL: nil)')).toEqual([])
  })
  it("constrains taint to the query or HTML argument", async () => {
    expect(await scan('let name = nameTextField.text!\nlet query = "SELECT * FROM users WHERE name = \\(name)"\nsqlite3_exec(db, "SELECT 1", query, nil, nil)\nwebView.loadHTMLString("fixed", baseURL: textView.text)')).toEqual([])
  })
  it("does not mistake a string mentioning an input property for user data", async () => {
    expect(await scan('let html = "textView.text"\nwebView.loadHTMLString(html, baseURL: nil)')).toEqual([])
  })
  it("does not propagate through an escaping call inside interpolation", async () => {
    expect(await scan('let name = nameTextField.text!\nwebView.loadHTMLString("<p>\\(escapeHTML(name))</p>", baseURL: nil)')).toEqual([])
  })
  it("ignores comments and string examples", async () => {
    expect(await scan('// webView.loadHTMLString(textView.text, baseURL: nil)\n/* nested /* block */\nwebView.loadHTMLString(textView.text, baseURL: nil)\n*/\nlet help = "webView.loadHTMLString(textView.text, baseURL: nil)"')).toEqual([])
  })
})
