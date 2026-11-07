import { describe, expect, it } from "vitest"
import { ruleOf } from "../../src/rules"
import { scanCppTlsSource } from "../../src/scanners/insecure-cpp"
import { insecureCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"
describe("C/C++ libcurl TLS verification bypass", () => {
  it("detects zero and false verification options across lines", () => {
    expect(scanCppTlsSource('curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0L);\ncurl_easy_setopt(\n curl, CURLOPT_SSL_VERIFYHOST, false\n);').map(h => h.line)).toEqual([1, 2])
  })
  it("allows enabled verification, unknown values and unrelated calls", () => {
    expect(scanCppTlsSource('curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 1L);\ncurl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 2L);\ncurl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, config);\ncustom.curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0);\ncustom->curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0);')).toEqual([])
  })
  it("ignores comments, strings and C++ raw strings", () => {
    expect(scanCppTlsSource('// curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0);\n/* curl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0); */\nconst char* help = "curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0)";\nauto raw = R"doc(curl_easy_setopt(curl, CURLOPT_SSL_VERIFYPEER, 0))doc";')).toEqual([])
  })
  it("retains production locations; excludes test/vendor/example fixtures", async () => {
    const source = '\n// setup\ncurl_easy_setopt(curl, CURLOPT_SSL_VERIFYHOST, 0L);'
    const issues = await insecureCodeScanner.run(makeContext({ files: { "src/client.cpp": source, "tests/client.c": source, "vendor/client.h": source, "examples/client.cc": source } }))
    expect(issues).toHaveLength(1)
    expect(issues[0].confidence).toBeUndefined()
    expect(ruleOf(issues[0])).toBe("insecure-cpp-tls-validation-disabled")
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ location: "src/client.cpp:3", severity: "critical" })]))
  })
})
