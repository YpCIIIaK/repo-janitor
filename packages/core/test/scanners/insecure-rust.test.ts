import { describe, expect, it } from "vitest"
import { ruleOf } from "../../src/rules"
import { scanRustTlsSource } from "../../src/scanners/insecure-rust"
import { insecureCodeScanner } from "../../src/index"
import { makeContext } from "../helpers"
describe("Rust TLS verification bypass", () => {
  it("reports current, legacy reqwest and native_tls literal true flags", () => {
    const hits = scanRustTlsSource('use reqwest::Client;\nClient::builder().danger_accept_invalid_certs(true);\nClient::builder().tls_danger_accept_invalid_hostnames(\n true\n);\nnative_tls::TlsConnector::builder().danger_accept_invalid_hostnames(true);')
    expect(hits.map(h => h.line)).toEqual([2, 3, 6])
  })
  it("allows verification, dynamic flags and unrelated methods", () => {
    expect(scanRustTlsSource('reqwest::Client::builder().danger_accept_invalid_certs(false).danger_accept_invalid_hostnames(config);')).toEqual([])
    expect(scanRustTlsSource('Custom::builder().danger_accept_invalid_certs(true);')).toEqual([])
  })
  it("ignores comments and ordinary/raw string documentation", () => {
    expect(scanRustTlsSource('use reqwest::Client;\n// .danger_accept_invalid_certs(true)\n/* nested /* x */ .danger_accept_invalid_certs(true) */\nlet help = ".danger_accept_invalid_certs(true)";\nlet raw = r###" .danger_accept_invalid_certs(true) "###;')).toEqual([])
  })
  it("preserves locations, lowers test severity and skips example paths", async () => {
    const issues = await insecureCodeScanner.run(makeContext({ files: { "src/client.rs": 'use reqwest::Client;\nClient::builder().danger_accept_invalid_certs(true);', "tests/tls.rs": 'native_tls::TlsConnector::builder().danger_accept_invalid_hostnames(true);', "examples/client.rs": 'reqwest::Client::builder().danger_accept_invalid_certs(true);' } }))
    expect(issues).toHaveLength(2)
    expect(ruleOf(issues[0])).toBe("insecure-rust-tls-validation-disabled")
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ location: "src/client.rs:2", confidence: "high", severity: "critical" }), expect.objectContaining({ location: "tests/tls.rs:1", severity: "warning" })]))
  })
})
