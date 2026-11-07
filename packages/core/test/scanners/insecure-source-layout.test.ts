import { describe, expect, it } from "vitest"
import { insecureCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"
const java = 'String name = request.getParameter("name");\nstmt.executeQuery("SELECT * FROM users WHERE name = \'" + name + "\'");'
const kotlin = 'val name = call.parameters["name"]!!\nstmt.executeQuery("SELECT * FROM users WHERE name = \'$name\'")'
describe("production JVM namespaces", () => {
  it("scans benchmark and example namespace components under Java production roots", async () => {
    for (const path of ["src/main/java/org/owasp/benchmark/testcode/BenchmarkTest00001.java", "module/src/main/java/com/example/Route.java"]) {
      const issues = await insecureCodeScanner.run(makeContext({ files: { [path]: java } }))
      expect(issues).toHaveLength(1)
      expect(issues[0].confidence).toBe("high")
    }
  })
  it("scans Kotlin production namespace paths", async () => {
    const issues = await insecureCodeScanner.run(makeContext({ files: { "src/main/kotlin/com/example/Route.kt": kotlin } }))
    expect(issues).toHaveLength(1)
    expect(issues[0].confidence).toBe("high")
  })
  it("preserves outer documentation/example exclusions and vendored exclusions", async () => {
    for (const path of ["examples/app/src/main/java/com/example/Route.java", "examples/src/main/java/Route.java", "docs/app/src/main/java/Route.java", "vendor/app/src/main/java/Route.java", "module/src/main/java/vendor/Route.java", "benchmark/Route.java"]) {
      expect(await insecureCodeScanner.run(makeContext({ files: { [path]: java } }))).toEqual([])
    }
  })
})
