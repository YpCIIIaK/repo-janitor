import type { CodeHit } from "./insecure-code"

const REQUEST = /\$_(?:GET|POST|REQUEST|COOKIE|FILES)\b|\bfile_get_contents\s*\(\s*['"]php:\/\/input['"]/i

/** Local PHP request-to-sink checks. Deliberately bounded to straight-line
 * assignments: unknown transformations and scope/control-flow boundaries kill
 * the flow rather than guessing whether validation was effective. */
export function scanPhpSecurity(content: string): CodeHit[] {
  const hits: CodeHit[] = []
  const tainted = new Set<string>()
  let blockComment = false
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (/\/\/\s*(?:nosemgrep|phpcs:ignore)|\bNOSONAR\b/.test(raw)) continue
    let code = ""
    let quote = ""
    // Keep string values for php://input and libxml options, but mask comments.
    for (let j = 0; j < raw.length; j++) {
      const c = raw[j], next = raw[j + 1]
      if (blockComment) {
        if (c === "*" && next === "/") { blockComment = false; j++ }
        continue
      }
      if (quote) {
        code += c
        if (c === "\\") { code += next ?? ""; j++ }
        else if (c === quote) quote = ""
      } else if (c === "'" || c === '"') { quote = c; code += c }
      else if (c === "/" && next === "*") { blockComment = true; j++ }
      else if (c === "#" || c === "/" && next === "/") break
      else code += c
    }
    if (/\b(?:function|if|else|switch|for|foreach|while|try|catch)\b|^\s*}/.test(code)) tainted.clear()
    // Quoted documentation cannot introduce executable sinks or variable reads.
    const executable = code.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g, s => " ".repeat(s.length))
    const carries = (expr: string) => {
      const value = expr.replace(/\\\$/g, "").replace(/'(?:\\.|[^'\\])*'/g, "")
      return REQUEST.test(value) || /\bfile_get_contents\s*\(\s*['"]php:\/\/input['"]/.test(expr) ||
        [...value.matchAll(/\$[A-Za-z_]\w*/g)].some(m => tainted.has(m[0]))
    }
    for (const statement of code.split(";")) {
      const assignment = statement.match(/^\s*(?:<\?php\s*)?(\$[A-Za-z_]\w*)\s*=\s*(.*)$/)
      if (assignment) {
        const [, name, value] = assignment
        // Only plain values, concatenation and aliases propagate. A function
        // might validate or map to an allowlist, so do not infer its output.
        const rawBody = /^\s*file_get_contents\s*\(\s*['"]php:\/\/input['"]\s*\)\s*$/.test(value)
        if (rawBody || carries(value) && !/\b[A-Za-z_]\w*\s*\(/.test(value)) tainted.add(name)
        else tainted.delete(name)
      }
    }
    const add = (id: string, title: string, detail: string) => hits.push({
      rule: { id, lang: "php", re: /$^/g, severity: "critical", title, detail },
      line: i + 1, evidence: raw.trim().slice(0, 160), tainted: true,
    })
    // Reading an arbitrary request-selected file exposes server files. Keep
    // basename/allowlist transformations out of this deliberately narrow rule.
    const read = /\b(?:readfile|file_get_contents)\s*\(/g
    for (const m of executable.matchAll(read)) {
      const args = code.slice((m.index ?? 0) + m[0].length).split(/[,;]/)[0]
      if (carries(args) && !/\b(?:basename|realpath|filter_var)\s*\(/.test(args)) {
        add("php-path-traversal", "Request input selects a local file", "A request-controlled path reaches a file read. Map input to an explicit allowlist of files, or canonicalize the path and verify it stays inside the intended directory before opening it.")
        break
      }
    }
    const xml = /(?:\bsimplexml_load_string|->\s*loadXML)\s*\(/g
    for (const m of executable.matchAll(xml)) {
      const args = code.slice((m.index ?? 0) + m[0].length)
      if (carries(args.split(",")[0]) && /\bLIBXML_(?:NOENT|DTDLOAD)\b/.test(args) && !/\bLIBXML_NO_XXE\b/.test(args)) {
        add("php-xxe", "Untrusted XML enables external entity processing", "Request-controlled XML is parsed with LIBXML_NOENT or LIBXML_DTDLOAD. Remove external entity/DTD loading options, reject document types, and use LIBXML_NO_XXE where supported; LIBXML_NONET alone does not block local file entities.")
        break
      }
    }
    if (/\bTwig\\(?:Environment|Loader)|\bTwig_Environment\b/.test(content)) {
      const template = /->\s*createTemplate\s*\(/g
      for (const m of executable.matchAll(template)) {
        if (carries(code.slice((m.index ?? 0) + m[0].length).split(/[,;]/)[0])) {
          add("php-ssti", "Request input becomes Twig template source", "An attacker-controlled value is compiled as Twig template code. Keep template source static and pass request values as render context data; HTML escaping does not prevent template injection.")
          break
        }
      }
    }
  }
  return hits
}
