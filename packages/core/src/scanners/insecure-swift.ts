import type { Severity } from "../schema"
interface SwiftHit { rule: { id: string; severity: Severity; title: string; detail: string }; line: number; evidence: string; tainted: boolean }

/** Swift's local, straight-line flows only. Unknown transformations and scope
 * boundaries deliberately stop propagation; this is not whole-program analysis. */
const INPUT = /\b(?:\w*(?:[Tt]extField|[Tt]extView|[Ss]earchBar)|textField|textView|searchBar)\s*\.\s*text\b|\b(?:req|request)\s*\.\s*(?:query\s*\[|content\s*\.\s*get\s*\()/
const SQL = /\b(?:SELECT\b.*\bFROM|INSERT\s+INTO|UPDATE\b.*\bSET|DELETE\s+FROM)\b/i

/** Replace comments with spaces, keeping line numbers and quoted source intact. */
function uncomment(content: string): string {
  let out = "", depth = 0, quoted = false, escaped = false
  for (let i = 0; i < content.length; i++) {
    const c = content[i], next = content[i + 1]
    if (depth) {
      if (c === "/" && next === "*") { depth++; out += "  "; i++ }
      else if (c === "*" && next === "/") { depth--; out += "  "; i++ }
      else out += c === "\n" ? "\n" : " "
    } else if (!quoted && c === "/" && next === "*") { depth++; out += "  "; i++ }
    else if (!quoted && c === "/" && next === "/") {
      while (i < content.length && content[i] !== "\n") { out += " "; i++ }
      if (i < content.length) out += "\n"
    } else {
      out += c
      if (c === '"' && !escaped) quoted = !quoted
      escaped = c === "\\" && !escaped
    }
  }
  return out
}

/** Split only the call's outer arguments, preserving Swift string commas. */
function argumentsOf(value: string): string[] {
  const args: string[] = []
  let start = 0, depth = 0, quoted = false, escaped = false
  for (let i = 0; i < value.length; i++) {
    const c = value[i]
    if (c === '"' && !escaped) quoted = !quoted
    if (!quoted) {
      if (c === "(" || c === "[") depth++
      if (c === ")" && depth === 0) { args.push(value.slice(start, i)); return args }
      if (c === ")" || c === "]") depth--
      if (c === "," && depth === 0) { args.push(value.slice(start, i)); start = i + 1 }
    }
    escaped = c === "\\" && !escaped
  }
  args.push(value.slice(start))
  return args
}

export function scanSwiftSource(content: string): SwiftHit[] {
  // Raw/multiline strings require a Swift parser to disambiguate safely.
  if (/"""|#+"/.test(content)) return []
  const hits: SwiftHit[] = [], tainted = new Set<string>(), sqlValues = new Set<string>()
  const lines = uncomment(content).split(/\r?\n/)
  const usesInput = (value: string): boolean => {
    // Only raw values, concatenation and interpolation propagate. A call such as
    // escapeHTML(field.text) is a transformation whose semantics are unknown.
    const outsideStrings = value.replace(/"(?:\\.|[^"\\])*"/g, "")
    if (/\b[A-Za-z_]\w*\s*\(/.test(outsideStrings.replace(/\b(?:get)\s*\(/g, "")) && !INPUT.test(value)) return false
    if (/^\s*(?:try[!?]?\s+)?\w+\s*\(/.test(value) && !/^\s*(?:req|request)\./.test(value)) return false
    const inputs = outsideStrings + " " + [...value.matchAll(/\\\(([^)]*)\)/g)].map(m => m[1]).join(" ")
    return INPUT.test(inputs) || [...tainted].some(n => new RegExp(`\\b${n}\\b`).test(outsideStrings) || new RegExp(`\\\\\\([^)]*\\b${n}\\b`).test(value))
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/\b(?:func|init|deinit)\b|^\s*}/.test(line)) { tainted.clear(); sqlValues.clear() }
    const assignment = /^\s*(?:(?:let|var)\s+)?([A-Za-z_]\w*)(?:\s*:\s*[^=]+)?\s*=\s*(?!=)(.*)/.exec(line)
    if (assignment) {
      const [, name, value] = assignment
      if (usesInput(value)) tainted.add(name); else tainted.delete(name)
      if (tainted.has(name) && SQL.test(value)) sqlValues.add(name); else sqlValues.delete(name)
    }
    // A sink must occur outside a string literal. This also rejects examples
    // embedded in an ordinary Swift string.
    const code = line.replace(/"(?:\\.|[^"\\])*"/g, m => " ".repeat(m.length))
    const sqlSink = /\b(?:sqlite3_(?:exec|prepare_v2|prepare_v3)|(?:\w+\.)?(?:executeQuery|executeUpdate))\s*\(/.exec(code)
    const htmlSink = /\.loadHTMLString\s*\(/.exec(code)
    let id: string | undefined
    if (sqlSink) {
      const args = argumentsOf(line.slice(sqlSink.index + sqlSink[0].length))
      const query = args[sqlSink[0].startsWith("sqlite3_") ? 1 : 0] ?? ""
      if ((SQL.test(query) && usesInput(query)) || [...sqlValues].some(n => new RegExp(`^\\s*${n}\\s*$`).test(query))) id = "sql-interpolated"
    }
    if (htmlSink && usesInput(argumentsOf(line.slice(htmlSink.index + htmlSink[0].length))[0] ?? "")) id = "swift-webview-html"
    if (!id) continue
    hits.push({
      rule: {
        id, severity: id === "sql-interpolated" ? "critical" : "warning",
        title: id === "sql-interpolated" ? "SQL query includes Swift user input" : "User input loaded as WebView HTML",
        detail: id === "sql-interpolated"
          ? "User input is assembled into SQL text. Use sqlite3_bind_* or your database library's bound parameters."
          : "A text field or request value reaches loadHTMLString without escaping. Escape it as text or use a fixed HTML template with escaped values.",
      }, line: i + 1, evidence: line.trim(), tainted: true,
    })
  }
  return hits
}
