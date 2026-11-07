import type { Severity } from "../schema"
import { maskNativeSource } from "./native-source-mask"
export interface NativeTlsHit { rule: { id: string; severity: Severity; title: string; detail: string }; line: number; evidence: string }

/** Explicit verification bypass only. API contract:
 * https://docs.rs/reqwest/latest/reqwest/struct.ClientBuilder.html
 * https://docs.rs/native-tls/latest/native_tls/struct.TlsConnectorBuilder.html */
export function scanRustTlsSource(source: string): NativeTlsHit[] {
  const code = maskNativeSource(source)
  // These method names also occur on user types. Require a known TLS crate.
  if (!/\b(?:reqwest|native_tls)\s*::/.test(code)) return []
  const hits: NativeTlsHit[] = []
  for (const m of code.matchAll(/\.\s*(?:tls_)?danger_accept_invalid_(?:certs|hostnames)\s*\(\s*true\s*\)/g)) {
    const line = code.slice(0, m.index).split("\n").length
    hits.push({ rule: { id: "rust-tls-validation-disabled", severity: "critical", title: "TLS server verification is explicitly disabled", detail: "Accepting invalid server certificates or hostnames allows a man-in-the-middle connection. Remove the true bypass flag; use the default verifier and add trusted roots for a private CA." }, line, evidence: source.split(/\r?\n/)[line - 1].trim() })
  }
  return hits
}
