import type { CodeHit } from "./insecure-code"

/** Straight-line Kotlin request-to-SQL flows; no whole-program inference. */
export function scanKotlinSource(content: string): CodeHit[] {
  const hits: CodeHit[] = [], input = new Set<string>(), queries = new Set<string>()
  let blockDepth = 0, rawString = false
  for (const [i, raw] of content.split(/\r?\n/).entries()) {
    const triples = raw.match(/"""/g)?.length ?? 0
    if (rawString || triples) {
      input.clear(); queries.clear()
      if (triples % 2) rawString = !rawString
      continue
    }
    let code = "", quoted = false
    for (let j = 0; j < raw.length; j++) {
      const c = raw[j], n = raw[j + 1]
      if (blockDepth) {
        if (c === "/" && n === "*") { blockDepth++; j++ }
        else if (c === "*" && n === "/") { blockDepth--; j++ }
      } else if (quoted) {
        code += c
        if (c === "\\") { code += n ?? ""; j++ }
        else if (c === '"') quoted = false
      } else if (c === '"') { quoted = true; code += c }
      else if (c === "/" && n === "*") { blockDepth++; j++ }
      else if (c === "/" && n === "/") break
      else code += c
    }
    if (/\bfun\b|^\s*}|\b(?:if|when|for|while|catch)\s*\(/.test(code)) { input.clear(); queries.clear() }
    if (code.includes('"""')) { input.clear(); queries.clear(); continue }
    const carries = (v: string): boolean => {
      const outside = v.replace(/"(?:\\.|[^"\\])*"/g, "")
      if (/^\s*[\w.]+\s*\(/.test(v) && !/^\s*(?:request\.getParameter|call\.receiveText)\s*\(/.test(v)) return false
      if (/\b(?:call\.(?:parameters|request\.queryParameters)\s*\[|request\.getParameter\s*\(|call\.receiveText\s*\()/.test(outside)) return true
      const names = [...v.matchAll(/(?<!\\)\$(?:([A-Za-z_]\w*)|\{\s*([A-Za-z_]\w*)\s*\})/g)].map(m => m[1] ?? m[2])
      return [...input].some(n => new RegExp(`\\b${n}\\b`).test(outside) || names.includes(n))
    }
    const assignment = /^\s*(?:(?:val|var)\s+)?([A-Za-z_]\w*)(?:\s*:\s*[^=]+)?\s*=\s*(?!=)(.*)/.exec(code)
    if (assignment) {
      const [, n, v] = assignment
      if (carries(v)) input.add(n); else input.delete(n)
      if (input.has(n) && /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(v)) queries.add(n); else queries.delete(n)
    }
    const executable = code.replace(/"(?:\\.|[^"\\])*"/g, s => " ".repeat(s.length))
    const sink = /\.\s*(?:executeQuery|executeUpdate|prepareStatement|createNativeQuery|query)\s*\(/.exec(executable)
    if (!sink) continue
    const rest = code.slice(sink.index + sink[0].length)
    let end = rest.length, depth = 0, inString = false
    for (let j = 0; j < rest.length; j++) {
      const c = rest[j]
      if (c === "\\" && inString) { j++; continue }
      if (c === '"') inString = !inString
      if (inString) continue
      if ((c === "," || c === ")") && depth === 0) { end = j; break }
      if (c === "(" || c === "[") depth++
      if (c === ")" || c === "]") depth--
    }
    const query = rest.slice(0, end).trim()
    if (!(queries.has(query) || /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(query) && carries(query))) continue
    hits.push({ rule: { id: "sql-interpolated", lang: "java", severity: "critical", title: "SQL query includes Kotlin request input", detail: "Request input is interpolated into SQL text. Keep SQL static and bind input through prepared-statement parameters." }, line: i + 1, evidence: raw.trim().slice(0, 160), tainted: true })
  }
  return hits
}
