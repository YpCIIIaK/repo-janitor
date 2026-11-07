import type { Severity } from "../schema"

interface ScalaHit {
  rule: { id: string; severity: Severity; title: string; detail: string }
  line: number
  evidence: string
  tainted: boolean
}
interface Literal {
  start: number
  end: number
  prefix: string
  text: string
  expressions: { value: string; raw: boolean }[]
}
const SQL = /\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH)\b/i
const SOURCE = /\b(?:req|request)\s*\.\s*(?:queryString\b|getQueryString\s*\(|body\s*\.\s*asText\b)/

/** Read ordinary/triple strings and interpolation holes, including quotes in ${...}. */
function literalAt(source: string, start: number): Literal {
  const delimiter = source.startsWith('"""', start) ? '"""' : '"'
  const prefix = /[A-Za-z_]\w*$/.exec(source.slice(0, start))?.[0] ?? ""
  const interpolated = /^(?:s|sql|sqlu)$/.test(prefix)
  const expressions: Literal["expressions"] = []
  let i = start + delimiter.length
  for (; i < source.length;) {
    if (source.startsWith(delimiter, i)) {
      return { start, end: i + delimiter.length, prefix, text: source.slice(start + delimiter.length, i), expressions }
    }
    if (delimiter === '"' && source[i] === "\\") { i += 2; continue }
    if (interpolated && source[i] === "$" && source[i + 1] === "$") { i += 2; continue }
    if (interpolated && source[i] === "$") {
      const raw = source[i - 1] === "#"
      if (source[i + 1] === "{") {
        const beginning = i + 2
        let depth = 1
        i = beginning
        for (; i < source.length && depth; i++) {
          if (source[i] === '"') { i = literalAt(source, i).end - 1; continue }
          if (source[i] === "{") depth++
          if (source[i] === "}") depth--
        }
        if (!depth) expressions.push({ value: source.slice(beginning, i - 1), raw })
        continue
      }
      const name = /^[A-Za-z_]\w*/.exec(source.slice(i + 1))
      if (name) { expressions.push({ value: name[0], raw }); i += name[0].length + 1; continue }
    }
    i++
  }
  return { start, end: source.length, prefix, text: "", expressions: [] }
}

function literals(source: string): Literal[] {
  const result: Literal[] = []
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '"') continue
    const literal = literalAt(source, i)
    result.push(literal)
    i = literal.end - 1
  }
  return result
}
function maskStrings(source: string): string {
  let result = source
  for (const literal of literals(source).reverse()) {
    result = result.slice(0, literal.start) + " ".repeat(literal.end - literal.start) + result.slice(literal.end)
  }
  return result
}

/** Preserve line numbers while removing nested Scala comments. */
function uncomment(source: string): string {
  let result = "", depth = 0
  for (let i = 0; i < source.length; i++) {
    const c = source[i], next = source[i + 1]
    if (depth) {
      if (c === "/" && next === "*") { depth++; result += "  "; i++ }
      else if (c === "*" && next === "/") { depth--; result += "  "; i++ }
      else result += c === "\n" ? "\n" : " "
    } else if (c === '"') {
      const literal = literalAt(source, i)
      result += source.slice(i, literal.end)
      i = literal.end - 1
    } else if (c === "/" && next === "*") { depth++; result += "  "; i++ }
    else if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") { result += " "; i++ }
      if (i < source.length) result += "\n"
    } else result += c
  }
  return result
}

/** Statements may contain multiline SQL and multiline JDBC argument lists. */
function statements(source: string): { text: string; line: number }[] {
  const result: { text: string; line: number }[] = []
  let start = 0, line = 1, startLine = 1, parentheses = 0
  for (let i = 0; i < source.length; i++) {
    const c = source[i]
    if (c === '"') {
      const literal = literalAt(source, i)
      line += source.slice(i, literal.end).split("\n").length - 1
      i = literal.end - 1
      continue
    }
    if (c === "(" || c === "[") parentheses++
    if (c === ")" || c === "]") parentheses = Math.max(0, parentheses - 1)
    if (c === ";" || c === "\n" && !parentheses) {
      result.push({ text: source.slice(start, i), line: startLine })
      start = i + 1
      startLine = line + (c === "\n" ? 1 : 0)
    }
    if (c === "\n") line++
  }
  result.push({ text: source.slice(start), line: startLine })
  return result
}

/** First JDBC argument only: bound parameters and other arguments are not query text. */
function firstArgument(source: string): string {
  const masked = maskStrings(source)
  let depth = 0
  for (let i = 0; i < masked.length; i++) {
    if ((masked[i] === "," || masked[i] === ")") && !depth) return source.slice(0, i)
    if (masked[i] === "(" || masked[i] === "[") depth++
    if (masked[i] === ")" || masked[i] === "]") depth--
  }
  return source
}

/** Local Play request-to-SQL flows. Unknown transforms and scope/control-flow
 * boundaries stop propagation; Slick's normal $ interpolation binds parameters.
 * References: CWE-89, Oracle JDBC prepared statements, Slick Plain SQL docs.
 */
export function scanScalaSource(content: string): ScalaHit[] {
  const hits: ScalaHit[] = [], tainted = new Set<string>(), queries = new Set<string>()
  const carries = (expression: string): boolean => {
    const outside = maskStrings(expression)
    // Numeric/boolean parsing cannot preserve attacker-selected SQL syntax.
    if (/\.(?:toInt|toLong|toShort|toByte|toFloat|toDouble|toBoolean)(?:Option)?\b/.test(outside)) return false
    // Only known request accessors/defaulting propagate through method calls.
    const calls = [...outside.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)]
    if (calls.some(m => !/^(?:queryString|getQueryString|getOrElse|mkString)$/.test(m[1]))) return false
    return SOURCE.test(outside) || [...tainted].some(name => new RegExp(`\\b${name}\\b`).test(outside)) ||
      literals(expression).some(literal => literal.expressions.some(part =>
        (!(literal.prefix === "sql" || literal.prefix === "sqlu") || part.raw) && carries(part.value)))
  }
  const isQuery = (expression: string): boolean => literals(expression).some(l => SQL.test(l.text)) ||
    [...queries].some(name => new RegExp(`\\b${name}\\b`).test(maskStrings(expression)))
  for (const statement of statements(uncomment(content))) {
    const code = statement.text, executable = maskStrings(code)
    if (/\b(?:def|class|object|trait)\b|^\s*}|\b(?:if|for|while|catch|match)\b/.test(executable)) {
      tainted.clear(); queries.clear()
    }
    const assignment = /^\s*(?:(?:val|var)\s+)?([A-Za-z_]\w*)(?:\s*:\s*[^=]+)?\s*=\s*(?!=)([\s\S]*)$/.exec(code)
    if (assignment) {
      const [, name, value] = assignment
      const input = carries(value), sql = input && isQuery(value)
      if (input) tainted.add(name); else tainted.delete(name)
      if (sql) queries.add(name); else queries.delete(name)
    }
    const add = (offset: number) => {
      const line = statement.line + code.slice(0, offset).split("\n").length - 1
      if (hits.some(hit => hit.line === line)) return
      hits.push({ rule: {
        id: "sql-interpolated", severity: "critical", title: "Scala request input interpolated into SQL text",
        detail: "Request input becomes SQL source text. Use JDBC prepared statements with bound parameters, or Slick's ordinary $ interpolation; #$ splices literal SQL and must not contain request data.",
      }, line, evidence: content.split(/\r?\n/)[line - 1]?.trim().slice(0, 160) ?? "", tainted: true })
    }
    for (const sink of executable.matchAll(/\.\s*(?:executeQuery|executeUpdate|executeLargeUpdate|execute|prepareStatement|prepareCall)\s*\(/g)) {
      const argument = firstArgument(code.slice((sink.index ?? 0) + sink[0].length))
      if (carries(argument) && isQuery(argument)) add(sink.index ?? 0)
    }
    for (const literal of literals(code)) {
      if (/^(?:sql|sqlu)$/.test(literal.prefix) && SQL.test(literal.text) &&
        literal.expressions.some(part => part.raw && carries(part.value))) add(literal.start)
    }
  }
  return hits
}
