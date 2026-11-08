import { describe, expect, it } from "vitest"
import { insecureCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"
const scan = (source: string, path = "app/Search.scala") =>
  insecureCodeScanner.run(makeContext({ files: { [path]: source } }))

describe("Scala request-to-SQL flow", () => {
  it("finds a Play queryString alias interpolated into a JDBC query", async () => {
    const issues = await scan('val name = request.queryString("name").head\nval alias = name\nval query = s"SELECT * FROM users WHERE name = \'$alias\'"\nconnection.createStatement().executeQuery(query)')
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ confidence: "high", severity: "critical", location: "app/Search.scala:4" })
    expect(issues[0].id).toContain("insecure-sql-interpolated")
  })
  it("follows getQueryString and body.asText into direct JDBC SQL", async () => {
    expect(await scan('val name = request.getQueryString("name").getOrElse("")\nstmt.executeQuery(s"SELECT * FROM users WHERE name = \'$name\'")')).toHaveLength(1)
    expect(await scan('val clause = request.body.asText.get\nstmt.executeUpdate("DELETE FROM users WHERE " + clause)')).toHaveLength(1)
  })
  it("handles explicit interpolation expressions and request getters", async () => {
    expect(await scan('stmt.executeQuery(s"SELECT * FROM users WHERE name = \'${request.getQueryString("name").get}\'")')).toHaveLength(1)
  })
  it("detects interpolating before preparing a statement", async () => {
    expect(await scan('val name = request.queryString("name").head\nconnection.prepareStatement(s"SELECT * FROM users WHERE name = \'$name\'")')).toHaveLength(1)
  })
  it("handles triple-quoted SQL and multiline JDBC arguments", async () => {
    const issues = await scan('val name = request.queryString("name").head\nval query = s"""SELECT *\nFROM users\nWHERE name = \'$name\'""".stripMargin\nstmt.executeQuery(\nquery\n)')
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe("app/Search.scala:5")
  })
  it("keeps bound parameters and fixed SQL safe", async () => {
    expect(await scan('val name = request.queryString("name").head\nval q = connection.prepareStatement("SELECT * FROM users WHERE name = ?")\nq.setString(1, name)\nq.executeQuery()\nstmt.executeQuery("SELECT * FROM users WHERE name = \'fixed\'")')).toEqual([])
  })
  it("does not transfer unrelated, reassigned, escaped or out-of-scope input", async () => {
    expect(await scan('val input = request.queryString("name").head\nval name = "fixed"\nstmt.executeQuery(s"SELECT * FROM users WHERE name = \'$name\'")')).toEqual([])
    expect(await scan('var name = request.queryString("name").head\nname = "fixed"\nstmt.executeQuery(s"SELECT * FROM users WHERE name = \'$name\'")')).toEqual([])
    expect(await scan('val name = request.queryString("name").head\nstmt.executeQuery(s"SELECT * FROM users WHERE name = \'${escapeSql(name)}\'")')).toEqual([])
    expect(await scan('def first() = {\nval name = request.queryString("name").head\n}\ndef second() = {\nstmt.executeQuery(s"SELECT * FROM users WHERE name = \'$name\'")\n}')).toEqual([])
  })
  it("ignores comments and ordinary strings describing vulnerable code", async () => {
    expect(await scan('// stmt.executeQuery(s"SELECT ${request.body.asText}")\n/* nested /* comment */\nstmt.executeQuery(s"SELECT ${request.body.asText}")\n*/\nval help = "request.queryString"\nstmt.executeQuery(s"SELECT * FROM users WHERE name = \'$help\'")')).toEqual([])
  })
  it("does not treat literal dollar signs or source-looking string text as taint", async () => {
    expect(await scan('val name = request.queryString("name").head\nstmt.executeQuery("SELECT \'$name\'")\nstmt.executeQuery(s"SELECT \'$$name\'")\nval query = "SELECT request.body.asText"\nstmt.executeQuery(query)')).toEqual([])
  })
  it("allows explicit numeric parsing before interpolation", async () => {
    expect(await scan('val id = request.queryString("id").head.toInt\nstmt.executeQuery(s"SELECT * FROM users WHERE id = $id")')).toEqual([])
  })
  it("does not inspect bind values or non-SQL arguments as query text", async () => {
    expect(await scan('val name = request.queryString("name").head\nstmt.executeQuery("SELECT ?", name)\nother.executeQuery(name)')).toEqual([])
  })
  it("lowers severity for Scala test sources", async () => {
    const issues = await scan('val name = request.body.asText.get\nstmt.executeQuery(s"SELECT * FROM users WHERE name = \'$name\'")', "src/SearchTest.scala")
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe("warning")
  })
})

describe("Slick SQL interpolation", () => {
  it("allows normal parameter binding through sql and sqlu", async () => {
    expect(await scan('val name = request.getQueryString("name").get\nsql"SELECT * FROM users WHERE name = $name".as[User]\nsqlu"DELETE FROM users WHERE name = ${name}"')).toEqual([])
  })
  it("reports only tainted raw #$ splices", async () => {
    const issues = await scan('val table = request.queryString("table").head\nsql"SELECT * FROM #$table".as[User]\nsqlu"DELETE FROM #${request.getQueryString("table").get}"')
    expect(issues).toHaveLength(2)
    expect(issues.every(i => i.confidence === "high")).toBe(true)
  })
  it("allows fixed raw splices and ignores bound values next to fixed splices", async () => {
    expect(await scan('val name = request.getQueryString("name").get\nval table = "users"\nsql"SELECT * FROM #$table WHERE name = $name".as[User]')).toEqual([])
  })
  it("handles raw splices in multiline Slick strings", async () => {
    expect(await scan('val table = request.body.asText.get\nsql"""SELECT *\nFROM #$table\nWHERE id = 1""".as[User]')).toHaveLength(1)
  })
})
