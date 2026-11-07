import type { CodeHit } from "./insecure-code"

/** Parse one call without confusing commas inside strings with arguments. */
function callArguments(rest: string): string[] {
  const args: string[] = []
  let start = 0, depth = 0, quoted = false
  for (let j = 0; j < rest.length; j++) {
    const c = rest[j]
    if (c === "\\" && quoted) { j++; continue }
    if (c === '"') quoted = !quoted
    if (quoted) continue
    if ((c === "," || c === ")") && depth === 0) {
      args.push(rest.slice(start, j).trim())
      start = j + 1
      if (c === ")") return args
    }
    if (c === "(" || c === "[") depth++
    if (c === ")" || c === "]") depth--
  }
  args.push(rest.slice(start).trim())
  return args
}

/** Straight-line Kotlin request-to-SQL flows; no whole-program inference. */
export function scanKotlinSource(content: string): CodeHit[] {
  const hits: CodeHit[] = [], input = new Set<string>(), queries = new Set<string>(), safeValues = new Set<string>()
  let blockDepth = 0, rawString = false
  for (const [i, raw] of content.split(/\r?\n/).entries()) {
    const triples = raw.match(/"""/g)?.length ?? 0
    if (rawString || triples) {
      input.clear(); queries.clear(); safeValues.clear()
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
    if (/\bfun\b|^\s*}|\b(?:if|when|for|while|catch)\s*\(/.test(code)) { input.clear(); queries.clear(); safeValues.clear() }
    if (code.includes('"""')) { input.clear(); queries.clear(); safeValues.clear(); continue }
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
      if (carries(v)) { input.add(n); safeValues.delete(n) }
      else { input.delete(n); safeValues.add(n) }
      if (input.has(n) && /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(v)) queries.add(n); else queries.delete(n)
    }
    const executable = code.replace(/"(?:\\.|[^"\\])*"/g, s => " ".repeat(s.length))
    const command = /\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(/.exec(executable)
    const builder = /\bProcessBuilder\s*\(/.exec(executable)
    const unknownCommand = (argument: string): boolean => {
      const names = [...argument.matchAll(/(?<!\\)\$(?:([A-Za-z_]\w*)|\{\s*([A-Za-z_]\w*)\s*\})/g)].map(m => m[1] ?? m[2])
      if (/^[A-Za-z_]\w*$/.test(argument)) names.push(argument)
      return names.some(name => !safeValues.has(name))
    }
    let unsafeCommand = false, uncertainCommand = false
    if (command) {
      const argument = callArguments(code.slice(command.index + command[0].length))[0] ?? ""
      unsafeCommand = carries(argument)
      uncertainCommand = unknownCommand(argument)
    }
    if (builder) {
      const args = callArguments(code.slice(builder.index + builder[0].length))
      if (/^"(?:\/bin\/)?(?:sh|bash|zsh)"$/.test(args[0] ?? "") && args[1] === '"-c"') unsafeCommand ||= carries(args[2] ?? "")
    }
    if (unsafeCommand || uncertainCommand) hits.push({ rule: { id: "exec-interpolated", re: /$^/g, lang: "java", severity: "critical", title: "Kotlin request input controls a process command", detail: "Request input chooses an executable or is interpreted as shell code. Use a fixed executable with separate argument values and avoid a shell command string." }, line: i + 1, evidence: raw.trim().slice(0, 160), tainted: unsafeCommand })
    const sink = /\.\s*(?:executeQuery|executeUpdate|prepareStatement|createNativeQuery|query)\s*\(/.exec(executable)
    if (!sink) continue
    const query = callArguments(code.slice(sink.index + sink[0].length))[0] ?? ""
    if (!(queries.has(query) || /\b(?:SELECT|INSERT|UPDATE|DELETE)\b/i.test(query) && carries(query))) continue
    hits.push({ rule: { id: "sql-interpolated", re: /$^/g, lang: "java", severity: "critical", title: "SQL query includes Kotlin request input", detail: "Request input is interpolated into SQL text. Keep SQL static and bind input through prepared-statement parameters." }, line: i + 1, evidence: raw.trim().slice(0, 160), tainted: true })
  }
  return hits
}
