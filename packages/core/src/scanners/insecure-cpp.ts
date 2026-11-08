import type { NativeTlsHit } from "./insecure-rust"
import { maskNativeSource } from "./native-source-mask"

/** Explicit libcurl bypass: https://curl.se/libcurl/c/CURLOPT_SSL_VERIFYPEER.html */
export function scanCppTlsSource(source: string): NativeTlsHit[] {
  const code = maskNativeSource(source), hits: NativeTlsHit[] = []
  for (const m of code.matchAll(/\bcurl_easy_setopt\s*\(\s*[A-Za-z_]\w*\s*,\s*CURLOPT_SSL_VERIFY(?:PEER|HOST)\s*,\s*(?:0(?:[uUlL]{0,3})|false)\s*\)/g)) {
    if (/[.>\w]/.test(code[m.index! - 1] ?? "")) continue
    const line = code.slice(0, m.index).split("\n").length
    hits.push({ rule: { id: "cpp-tls-validation-disabled", severity: "critical", title: "libcurl TLS server verification is explicitly disabled", detail: "Setting CURLOPT_SSL_VERIFYPEER or CURLOPT_SSL_VERIFYHOST to zero disables server authentication and permits man-in-the-middle connections. Keep peer verification at 1L and host verification at 2L; configure trusted CA roots for private certificates." }, line, evidence: source.split(/\r?\n/)[line - 1].trim() })
  }
  return hits
}
