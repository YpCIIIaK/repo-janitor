import { describe, expect, it } from "vitest"
import { insecureCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"
const scan = (source: string) => insecureCodeScanner.run(makeContext({ files: { "src/Route.kt": source } }))
describe("Kotlin request SQL interpolation", () => {
  it("tracks Ktor input into dollar interpolation", async () => {
    const issues = await scan('val name = call.request.queryParameters["name"]!!\nval sql = "SELECT * FROM users WHERE name = \'$name\'"\nconnection.prepareStatement(sql)')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ confidence: "high", severity: "critical", location: "src/Route.kt:3" })
  })
  it("tracks servlet input and braced interpolation", async () => {
    expect(await scan('val name = request.getParameter("name")\nstatement.executeQuery("SELECT * FROM users WHERE name = \'${name}\'")')).toHaveLength(1)
  })
  it("tracks aliases and request bodies", async () => {
    expect(await scan('val body = call.receiveText()\nval alias = body\nstatement.executeQuery("SELECT * FROM users WHERE name = \'$alias\'")')).toHaveLength(1)
  })
  it("ignores raw multiline examples", async () => {
    expect(await scan('val example = """\nval name = request.getParameter("name")\nstatement.executeQuery("SELECT * FROM users WHERE name = $name")\n"""')).toEqual([])
  })
  it("keeps bound parameters safe", async () => {
    expect(await scan('val name = call.parameters["name"]!!\nstatement.prepareStatement("SELECT * FROM users WHERE name = ?")\nstatement.setString(1, name)\njdbc.query("SELECT * FROM users WHERE name = ?", name)')).toEqual([])
  })
  it("clears reassigned and out-of-scope input", async () => {
    expect(await scan('var name = request.getParameter("name")\nname = "fixed"\nstatement.executeQuery("SELECT * FROM users WHERE name = \'$name\'")\nval value = request.getParameter("value")\n}\nfun other() {\nstatement.executeQuery("SELECT * FROM users WHERE name = \'$value\'")')).toEqual([])
  })
  it("ignores transformed input, comments and literal source mentions", async () => {
    expect(await scan('// statement.executeQuery("SELECT $name FROM users")\n/* val name = request.getParameter("name") */\nval name = "call.parameters[name]"\nstatement.executeQuery("SELECT * FROM users WHERE name = \'$name\'")\nval safe = escapeSql(call.parameters["name"])\nstatement.executeQuery("SELECT * FROM users WHERE name = \'$safe\'")')).toEqual([])
  })
})
