/** Small, non-executing Erlang lexer and balanced-form reader.
 * Keeps source offsets; comments, strings and character literals cannot become
 * calls. This is deliberately not an Erlang compiler or macro expander.
 */
export interface ErlToken {
  value: string
  kind: "atom" | "variable" | "string" | "number" | "symbol" | "keyword"
  start: number
  end: number
}

const BLOCKS = new Set(["case", "if", "receive", "try", "begin", "maybe"])
const KEYWORDS = new Set([...BLOCKS, "fun", "end", "of", "catch", "after", "when", "else", "andalso", "orelse", "and", "or", "xor", "not", "div", "rem", "band", "bor", "bxor", "bsl", "bsr"])
const OPEN: Record<string, string> = { "(": ")", "[": "]", "{": "}", "<<": ">>" }

function escaped(source: string, start: number): { value: string; next: number } {
  const c = source[start]
  const named: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", e: "\x1b", s: " ", d: "\x7f" }
  if (named[c] !== undefined) return { value: named[c], next: start + 1 }
  if (c === "^") return { value: String.fromCharCode((source.charCodeAt(start + 1) || 64) & 31), next: start + 2 }
  const hex = c === "x" ? /^(?:x\{([\da-f]+)\}|x([\da-f]{2}))/i.exec(source.slice(start)) : null
  if (hex) {
    const code = parseInt(hex[1] ?? hex[2], 16)
    return { value: code <= 0x10ffff ? String.fromCodePoint(code) : "\ufffd", next: start + hex[0].length }
  }
  const oct = /^[0-7]{1,3}/.exec(source.slice(start))
  if (oct) return { value: String.fromCharCode(parseInt(oct[0], 8)), next: start + oct[0].length }
  return { value: c ?? "", next: Math.min(start + 1, source.length) }
}

export function erlangTokens(source: string): ErlToken[] {
  const out: ErlToken[] = []
  let i = source.startsWith("#!") ? source.indexOf("\n") : 0
  if (i < 0) return out
  const add = (start: number, kind: ErlToken["kind"], value = source.slice(start, i)) =>
    out.push({ start, end: i, kind, value })
  while (i < source.length) {
    const start = i, c = source[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === "%") { while (i < source.length && source[i] !== "\n") i++; continue }
    if (c === "$") {
      i++
      if (source[i] === "\\") {
        i++
        if (source.slice(i, i + 2) === "x{") {
          const end = source.indexOf("}", i + 2)
          i = end < 0 ? source.length : end + 1
        } else if (source[i] === "^") i += 2
        else if (/[0-7]/.test(source[i] ?? "")) {
          let n = 0
          while (n++ < 3 && /[0-7]/.test(source[i] ?? "")) i++
        } else if (source[i] === "x") i += 3
        else i++
      } else i += (source.codePointAt(i) ?? 0) > 0xffff ? 2 : 1
      i = Math.min(i, source.length)
      add(start, "number")
      continue
    }
    if (c === '"' || c === "'") {
      const triple = c === '"' && source.startsWith('"""', i)
      const quote = triple ? '"""' : c
      i += quote.length
      let value = "", closed = false
      while (i < source.length) {
        if (source.startsWith(quote, i)) { i += quote.length; closed = true; break }
        if (source[i] === "\\" && i + 1 < source.length) { const escape = escaped(source, i + 1); value += escape.value; i = escape.next }
        else value += source[i++]
      }
      // An unterminated literal cannot safely expose its contents as code.
      add(start, c === "'" && closed ? "atom" : "string", value)
      continue
    }
    if (/[A-Za-z_]/.test(c)) {
      i++
      while (i < source.length && /[A-Za-z0-9_@]/.test(source[i])) i++
      const value = source.slice(start, i)
      add(start, /[A-Z_]/.test(c) ? "variable" : KEYWORDS.has(value) ? "keyword" : "atom")
      continue
    }
    if (/\d/.test(c)) {
      const m = /^(?:\d+#[A-Za-z0-9_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/.exec(source.slice(i))
      i += m?.[0].length ?? 1
      add(start, "number")
      continue
    }
    const multi = ["<:-", "<:=", "=:=", "=/=", "->", "<-", "=>", ":=", "::", "<<", ">>", "++", "--", "==", "/=", "=<", ">=", "||", "&&", "<=", "?="].find(x => source.startsWith(x, i))
    i += multi?.length ?? 1
    add(start, "symbol")
  }
  return out
}

export function isErlangBlock(tokens: ErlToken[], i: number): boolean {
  const t = tokens[i]
  if (t?.kind !== "keyword") return false
  if (BLOCKS.has(t.value)) return true
  if (t.value !== "fun") return false
  // fun module:function/arity and fun local/arity are references, not blocks.
  return tokens[i + 1]?.value === "(" ||
    (tokens[i + 1]?.kind === "variable" && tokens[i + 2]?.value === "(")
}

export function erlangPairs(tokens: ErlToken[]): Map<number, number> {
  const pairs = new Map<number, number>(), stack: { i: number; close: string }[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind === "symbol" && OPEN[t.value]) stack.push({ i, close: OPEN[t.value] })
    else if (isErlangBlock(tokens, i)) stack.push({ i, close: "end" })
    else if ((t.kind === "symbol" && [")", "]", "}", ">>"].includes(t.value)) || (t.kind === "keyword" && t.value === "end")) {
      const top = stack.at(-1)
      if (top?.close === t.value) { stack.pop(); pairs.set(top.i, i); pairs.set(i, top.i) }
    }
  }
  return pairs
}

/** Split only at the current nesting level, including case/fun/receive blocks. */
export function erlangSplit(tokens: ErlToken[], separator: string, pairs = erlangPairs(tokens)): ErlToken[][] {
  const parts: ErlToken[][] = []
  let start = 0
  for (let i = 0; i < tokens.length; i++) {
    const close = pairs.get(i)
    if (close !== undefined && close > i) { i = close; continue }
    if (["symbol", "keyword"].includes(tokens[i].kind) && tokens[i].value === separator) {
      parts.push(tokens.slice(start, i)); start = i + 1
    }
  }
  parts.push(tokens.slice(start))
  return parts
}

export function erlangForms(tokens: ErlToken[]): ErlToken[][] {
  const pairs = erlangPairs(tokens), out: ErlToken[][] = []
  let start = 0
  for (let i = 0; i < tokens.length; i++) {
    const close = pairs.get(i)
    if (close !== undefined && close > i) { i = close; continue }
    // State#record.field is not the end of a form.
    const recordAccess = tokens[i - 2]?.value === "#" && tokens[i - 1]?.kind === "atom"
    if (tokens[i].value === "." && !recordAccess) { out.push(tokens.slice(start, i)); start = i + 1 }
  }
  return out
}

/** A guard's semicolon is OR, not a boundary between function clauses. */
export function erlangClauses(tokens: ErlToken[]): ErlToken[][] {
  const pairs = erlangPairs(tokens), out: ErlToken[][] = []
  let start = 0, body = false
  for (let i = 0; i < tokens.length; i++) {
    const close = pairs.get(i)
    if (close !== undefined && close > i) { i = close; continue }
    if (tokens[i].value === "->") body = true
    if (tokens[i].value === ";" && body) { out.push(tokens.slice(start, i)); start = i + 1; body = false }
  }
  out.push(tokens.slice(start))
  return out
}

export interface ErlCall {
  module?: string
  name: string
  args: ErlToken[][]
  start: number
  end: number
  next: number
}

export function erlangCall(tokens: ErlToken[], i: number, pairs = erlangPairs(tokens)): ErlCall | null {
  if (tokens[i]?.kind !== "atom") return null
  let name = tokens[i].value, module: string | undefined, open = i + 1
  if (tokens[i + 1]?.value === ":" && tokens[i + 2]?.kind === "atom") {
    module = name; name = tokens[i + 2].value; open = i + 3
  } else if ([":", "?", "#"].includes(tokens[i - 1]?.value ?? "")) return null
  if (tokens[open]?.value !== "(") return null
  const close = pairs.get(open)
  if (close === undefined || close < open) return null
  const args = close === open + 1 ? [] : erlangSplit(tokens.slice(open + 1, close), ",")
  return { module, name, args, start: tokens[i].start, end: tokens[close].end, next: close + 1 }
}

export function erlangContainer(tokens: ErlToken[], open: "[" | "{" | "<<"): ErlToken[][] | null {
  const pairs = erlangPairs(tokens)
  if (tokens[0]?.value !== open || pairs.get(0) !== tokens.length - 1) return null
  return tokens.length === 2 ? [] : erlangSplit(tokens.slice(1, -1), ",")
}

export function erlangAtom(tokens: ErlToken[]): string | null {
  return tokens.length === 1 && tokens[0].kind === "atom" ? tokens[0].value : null
}

export function erlangLine(source: string, offset: number): number {
  let line = 1
  for (let i = 0; i < offset; i++) if (source[i] === "\n") line++
  return line
}

export function erlangNonProductPath(file: string): boolean {
  return /(^|\/)(?:_build|deps|vendor|third_party|node_modules|tests?|fixtures?|examples?|samples?|docs?)\//i.test(file) ||
    /(?:_SUITE|_tests?)\.erl$/i.test(file)
}
