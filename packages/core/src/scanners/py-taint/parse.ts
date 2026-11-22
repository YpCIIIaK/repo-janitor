/**
 * A small Python parser for the py-taint engine: tokens (with INDENT/DEDENT),
 * statements and expressions, enough of the grammar for data flow. It recovers
 * from what it does not understand by skipping the statement (and its block),
 * so a new syntax feature costs one statement, not the file.
 */

export interface PyNode {
  type: string
  line: number
  [k: string]: unknown
}
export type Expr = PyNode
export type Stmt = PyNode

interface Tok { t: "name" | "num" | "str" | "op" | "nl" | "indent" | "dedent" | "eof"; v: string; line: number; prefix?: string }

const OPS = [
  "**=", "//=", ">>=", "<<=", "...", "->", ":=",
  "**", "//", ">>", "<<", "<=", ">=", "==", "!=", "+=", "-=", "*=", "/=", "%=", "&=", "|=", "^=", "@=",
  "+", "-", "*", "/", "%", "@", "&", "|", "^", "~", "<", ">", "(", ")", "[", "]", "{", "}", ",", ":", ".", ";", "=",
]

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  const indents = [0]
  let i = 0
  let line = 1
  let depth = 0
  let atLineStart = true
  const n = src.length
  while (i < n) {
    if (atLineStart && depth === 0) {
      let col = 0
      let j = i
      while (j < n && (src[j] === " " || src[j] === "\t" || src[j] === "\f")) { col += src[j] === "\t" ? 8 - (col % 8) : 1; j++ }
      // Blank and comment-only lines do not change indentation.
      if (j >= n || src[j] === "\n" || src[j] === "\r" || src[j] === "#") {
        while (j < n && src[j] !== "\n") j++
        if (j < n) { j++; line++ }
        i = j
        continue
      }
      i = j
      atLineStart = false
      if (col > indents[indents.length - 1]) { indents.push(col); out.push({ t: "indent", v: "", line }) }
      else while (col < indents[indents.length - 1]) { indents.pop(); out.push({ t: "dedent", v: "", line }) }
    }
    const c = src[i]
    if (c === "\n") {
      if (depth === 0) { out.push({ t: "nl", v: "", line }); atLineStart = true }
      line++; i++
      continue
    }
    if (c === " " || c === "\t" || c === "\r" || c === "\f") { i++; continue }
    if (c === "#") { while (i < n && src[i] !== "\n") i++; continue }
    if (c === "\\" && (src[i + 1] === "\n" || (src[i + 1] === "\r" && src[i + 2] === "\n"))) { i += src[i + 1] === "\r" ? 3 : 2; line++; continue }
    // Strings, with any prefix (r, b, f, u, rb, fr…).
    const pm = /^([rRbBuUfF]{0,2})(['"])/.exec(src.slice(i, i + 3))
    if (pm && (pm[1] === "" || /^[a-zA-Z]/.test(c))) {
      const prefix = pm[1].toLowerCase()
      const q = pm[2]
      let j = i + pm[1].length
      const triple = src.startsWith(q + q + q, j)
      const close = triple ? q + q + q : q
      j += close.length
      const start = j
      const startLine = line
      const raw = prefix.includes("r")
      while (j < n && !src.startsWith(close, j)) {
        if (src[j] === "\\" && !raw) { if (src[j + 1] === "\n") line++; j += 2; continue }
        if (src[j] === "\\" && raw) { j += 2; continue }
        if (src[j] === "\n") { if (!triple) break; line++ }
        j++
      }
      const body = src.slice(start, Math.min(j, n))
      out.push({ t: "str", v: body, line: startLine, prefix })
      i = Math.min(n, j + (src.startsWith(close, j) ? close.length : 0))
      continue
    }
    if (/[A-Za-z_À-￿]/.test(c)) {
      let j = i + 1
      while (j < n && /[\wÀ-￿]/.test(src[j])) j++
      out.push({ t: "name", v: src.slice(i, j), line })
      i = j
      continue
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const m = /^(?:0[xXoObB][\da-fA-F_]+|(?:\d[\d_]*\.?[\d_]*|\.\d[\d_]*)(?:[eE][+-]?\d+)?[jJlL]?)/.exec(src.slice(i, i + 64))
      const len = m ? m[0].length : 1
      out.push({ t: "num", v: src.slice(i, i + len), line })
      i += len
      continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (op) {
      if (op === "(" || op === "[" || op === "{") depth++
      if ((op === ")" || op === "]" || op === "}") && depth > 0) depth--
      out.push({ t: "op", v: op, line })
      i += op.length
      continue
    }
    i++ // stray character ($, ?, backtick): ignore
  }
  if (out.length && out[out.length - 1].t !== "nl") out.push({ t: "nl", v: "", line })
  while (indents.length > 1) { indents.pop(); out.push({ t: "dedent", v: "", line }) }
  out.push({ t: "eof", v: "", line })
  return out
}

class ParseError extends Error {}

const COMPARE = new Set(["<", ">", "==", ">=", "<=", "!=", "in", "not", "is"])
const BIN_PREC: Record<string, number> = { "|": 1, "^": 2, "&": 3, "<<": 4, ">>": 4, "+": 5, "-": 5, "*": 6, "/": 6, "//": 6, "%": 6, "@": 6 }
const KEYWORDS = new Set(["def", "class", "if", "elif", "else", "for", "while", "try", "except", "finally", "with", "return", "import", "from", "pass", "break", "continue", "raise", "global", "nonlocal", "del", "assert", "lambda", "yield", "async", "await", "and", "or", "not", "in", "is", "None", "True", "False"])

export class Parser {
  private p = 0
  constructor(private toks: Tok[], private src = "") {}

  private get tok(): Tok { return this.toks[this.p] }
  private tt(): Tok["t"] { return this.toks[this.p].t }
  private peek(k = 1): Tok { return this.toks[Math.min(this.p + k, this.toks.length - 1)] }
  private next(): Tok { return this.toks[this.p++ < this.toks.length - 1 ? this.p - 1 : this.toks.length - 1] }
  private is(v: string, t: Tok["t"] = "op"): boolean { return this.tt() === t && this.tok.v === v }
  private isKw(v: string): boolean { return this.tt() === "name" && this.tok.v === v }
  private eat(v: string, t: Tok["t"] = "op"): boolean { if (this.is(v, t)) { this.p++; return true } return false }
  private expect(v: string, t: Tok["t"] = "op"): Tok {
    if (!this.is(v, t)) throw new ParseError(`expected ${v} at line ${this.tok.line}, got ${this.tok.v || this.tt()}`)
    return this.next()
  }

  module(): Stmt[] {
    const body: Stmt[] = []
    while (this.tt() !== "eof") {
      if (this.tt() === "nl" || this.tt() === "dedent" || this.tt() === "indent") { this.p++; continue }
      body.push(...this.statementSafe())
    }
    return body
  }

  /** One statement; on a parse error skip to the end of it, and its block. */
  private statementSafe(): Stmt[] {
    const start = this.p
    try {
      return this.statement()
    } catch (e) {
      if (!(e instanceof ParseError)) throw e
      this.p = Math.max(this.p, start + 1)
      while (this.tt() !== "nl" && this.tt() !== "eof") this.p++
      this.eat("", "nl")
      if (this.tt() === "indent") {
        let d = 0
        do {
          if (this.tt() === "indent") d++
          else if (this.tt() === "dedent") d--
          this.p++
        } while (d > 0 && this.tt() !== "eof")
      }
      return [{ type: "Error", line: this.toks[start].line }]
    }
  }

  private block(): Stmt[] {
    this.expect(":")
    if (this.tt() !== "nl") return this.simpleLine()
    this.next()
    if (this.tt() !== "indent") return []
    this.next()
    const body: Stmt[] = []
    while (this.tt() !== "dedent" && this.tt() !== "eof") {
      if (this.tt() === "nl") { this.p++; continue }
      body.push(...this.statementSafe())
    }
    this.eat("", "dedent")
    return body
  }

  private statement(): Stmt[] {
    const t = this.tok
    if (t.t === "op" && t.v === "@") {
      const decorators: Expr[] = []
      while (this.eat("@")) { decorators.push(this.expr()); this.eat("", "nl") }
      const s = this.statement()
      if (s[0]) s[0].decorators = decorators
      return s
    }
    if (t.t === "name") {
      switch (t.v) {
        case "def": return [this.funcDef(false)]
        case "async":
          if (this.peek().v === "def") { this.next(); return [this.funcDef(true)] }
          if (this.peek().v === "for" || this.peek().v === "with") { this.next(); return this.statement() }
          break
        case "class": return [this.classDef()]
        case "if": return [this.ifStmt()]
        case "for": return [this.forStmt()]
        case "while": {
          this.next()
          const test = this.namedExpr()
          const body = this.block()
          const orelse = this.isKw("else") ? (this.next(), this.block()) : []
          return [{ type: "While", line: t.line, test, body, orelse }]
        }
        case "try": return [this.tryStmt()]
        case "with": return [this.withStmt()]
        case "match":
          // Soft keyword: `match x:` opens a block of `case …:` blocks.
          if (this.looksLikeMatch()) return [this.matchStmt()]
          break
      }
    }
    return this.simpleLine()
  }

  private looksLikeMatch(): boolean {
    const nx = this.peek()
    if (nx.t === "op" && /^[=.([,)]$|^[-+*/%]=?$/.test(nx.v) && nx.v !== "(" && nx.v !== "[") return false
    for (let k = this.p + 1; k < this.toks.length; k++) {
      const tk = this.toks[k]
      if (tk.t === "nl" || tk.t === "eof") return this.toks[k - 1]?.v === ":" && this.toks[k + 1]?.t === "indent"
    }
    return false
  }

  private matchStmt(): Stmt {
    const line = this.next().line
    const subject = this.exprList()
    this.expect(":")
    this.expect("", "nl")
    this.expect("", "indent")
    const cases: Stmt[][] = []
    while (this.tt() !== "dedent" && this.tt() !== "eof") {
      if (this.tt() === "nl") { this.p++; continue }
      // case <pattern> [if guard]: block — the pattern is skipped, the body analysed.
      while (!this.is(":") && this.tt() !== "nl" && this.tt() !== "eof") {
        if (this.is("(") || this.is("[") || this.is("{")) this.skipBrackets()
        else this.p++
      }
      cases.push(this.block())
    }
    this.eat("", "dedent")
    return { type: "Match", line, subject, cases }
  }

  private skipBrackets() {
    let d = 0
    do {
      if (this.is("(") || this.is("[") || this.is("{")) d++
      else if (this.is(")") || this.is("]") || this.is("}")) d--
      this.p++
    } while (d > 0 && this.tt() !== "eof")
  }

  private funcDef(isAsync: boolean): Stmt {
    const line = this.next().line
    const name = this.next().v
    if (this.is("[")) this.skipBrackets() // PEP 695 type params
    this.expect("(")
    const params: PyNode[] = []
    let kind = "pos"
    while (!this.is(")")) {
      if (this.eat("/")) { this.eat(","); continue }
      if (this.eat("**")) kind = "kwargs"
      else if (this.eat("*")) { kind = "varargs"; if (this.is(",") || this.is(")")) { this.eat(","); kind = "kwonly"; continue } }
      const pt = this.next()
      if (pt.t !== "name") throw new ParseError("param")
      const annotation = this.eat(":") ? this.expr() : undefined
      const dflt = this.eat("=") ? this.expr() : undefined
      params.push({ type: "Param", line: pt.line, name: pt.v, annotation, default: dflt, kind })
      if (kind === "varargs") kind = "kwonly"
      if (!this.eat(",")) break
    }
    this.expect(")")
    const returns = this.eat("->") ? this.expr() : undefined
    const body = this.block()
    return { type: "FunctionDef", line, name, params, body, returns, async: isAsync, decorators: [] }
  }

  private classDef(): Stmt {
    const line = this.next().line
    const name = this.next().v
    if (this.is("[")) this.skipBrackets()
    const bases = this.eat("(") ? this.callArgs() : []
    const body = this.block()
    return { type: "ClassDef", line, name, bases, body, decorators: [] }
  }

  private ifStmt(): Stmt {
    const line = this.next().line
    const test = this.namedExpr()
    const body = this.block()
    let orelse: Stmt[] = []
    if (this.isKw("elif")) orelse = [this.ifStmt()]
    else if (this.isKw("else")) { this.next(); orelse = this.block() }
    return { type: "If", line, test, body, orelse }
  }

  private forStmt(): Stmt {
    const line = this.next().line
    const target = this.targetList()
    if (!this.isKw("in")) throw new ParseError("for without in")
    this.next()
    const iter = this.exprList()
    const body = this.block()
    const orelse = this.isKw("else") ? (this.next(), this.block()) : []
    return { type: "For", line, target, iter, body, orelse }
  }

  private tryStmt(): Stmt {
    const line = this.next().line
    const body = this.block()
    const handlers: PyNode[] = []
    while (this.isKw("except")) {
      const hl = this.next().line
      this.eat("*")
      let etype: Expr | undefined
      let name: string | undefined
      if (!this.is(":")) {
        etype = this.expr()
        if (this.eat(",")) this.expr()
        if (this.isKw("as")) { this.next(); name = this.next().v }
      }
      handlers.push({ type: "Handler", line: hl, etype, name, body: this.block() })
    }
    const orelse = this.isKw("else") ? (this.next(), this.block()) : []
    const final = this.isKw("finally") ? (this.next(), this.block()) : []
    return { type: "Try", line, body, handlers, orelse, final }
  }

  private withStmt(): Stmt {
    const line = this.next().line
    const items: PyNode[] = []
    const paren = this.is("(") && this.parenthesizedWith()
    if (paren) this.next()
    do {
      if (paren && this.is(")")) break
      const e = this.expr()
      const as = this.isKw("as") ? (this.next(), this.target()) : undefined
      items.push({ type: "WithItem", line: e.line, expr: e, as })
    } while (this.eat(","))
    if (paren) this.expect(")")
    return { type: "With", line, items, body: this.block() }
  }

  /** `with (open(a) as f, open(b) as g):` — a parenthesised item list, not a tuple expression. */
  private parenthesizedWith(): boolean {
    let d = 0
    for (let k = this.p; k < this.toks.length; k++) {
      const tk = this.toks[k]
      if (tk.t === "op" && (tk.v === "(" || tk.v === "[" || tk.v === "{")) d++
      else if (tk.t === "op" && (tk.v === ")" || tk.v === "]" || tk.v === "}")) { d--; if (d === 0) return this.toks[k + 1]?.v === ":" && this.toks.slice(this.p, k).some((x) => x.t === "name" && x.v === "as") }
      else if (tk.t === "nl" || tk.t === "eof") return false
    }
    return false
  }

  private simpleLine(): Stmt[] {
    const out: Stmt[] = [this.simple()]
    while (this.eat(";")) {
      if (this.tt() === "nl" || this.tt() === "eof") break
      out.push(this.simple())
    }
    if (this.tt() !== "nl" && this.tt() !== "eof" && this.tt() !== "dedent") throw new ParseError(`junk after statement at line ${this.tok.line}: ${this.tok.v}`)
    this.eat("", "nl")
    return out
  }

  private simple(): Stmt {
    const t = this.tok
    const line = t.line
    if (t.t === "name") {
      switch (t.v) {
        case "pass": case "break": case "continue": this.next(); return { type: "Pass", line }
        case "return": {
          this.next()
          const value = this.atEndOfSimple() ? undefined : this.exprList()
          return { type: "Return", line, value }
        }
        case "raise": {
          this.next()
          const exc = this.atEndOfSimple() ? undefined : this.expr()
          if (this.isKw("from")) { this.next(); this.expr() }
          return { type: "Raise", line, exc }
        }
        case "global": case "nonlocal": {
          this.next()
          const names = [this.next().v]
          while (this.eat(",")) names.push(this.next().v)
          return { type: "Global", line, names }
        }
        case "del": this.next(); return { type: "Del", line, targets: this.exprList() }
        case "assert": {
          this.next()
          const test = this.expr()
          if (this.eat(",")) this.expr()
          return { type: "Assert", line, test }
        }
        case "import": {
          this.next()
          const names: PyNode[] = []
          do {
            const mod = this.dotted()
            const as = this.isKw("as") ? (this.next(), this.next().v) : undefined
            names.push({ type: "Alias", line, name: mod, as })
          } while (this.eat(","))
          return { type: "Import", line, names }
        }
        case "from": {
          this.next()
          let mod = ""
          while (this.is(".") || this.is("...")) mod += this.next().v
          if (!this.isKw("import")) mod += this.dotted()
          if (!this.isKw("import")) throw new ParseError("from without import")
          this.next()
          const paren = this.eat("(")
          const names: PyNode[] = []
          do {
            if (paren && this.is(")")) break
            const name = this.eat("*") ? "*" : this.next().v
            const as = this.isKw("as") ? (this.next(), this.next().v) : undefined
            names.push({ type: "Alias", line, name, as })
          } while (this.eat(","))
          if (paren) this.expect(")")
          return { type: "ImportFrom", line, module: mod, names }
        }
        case "type":
          // PEP 695 `type X = …`
          if (this.peek().t === "name" && (this.peek(2).v === "=" || this.peek(2).v === "[")) {
            while (!this.atEndOfSimple()) this.p++
            return { type: "Pass", line }
          }
          break
      }
    }
    const first = this.exprList(true)
    if (this.is("=")) {
      const targets = [first]
      let value: Expr = first
      while (this.eat("=")) {
        value = this.isKw("yield") ? this.yieldExpr() : this.exprList(true)
        targets.push(value)
      }
      targets.pop()
      return { type: "Assign", line, targets, value }
    }
    if (this.tt() === "op" && /^(?:\+|-|\*|\/|\/\/|%|\*\*|>>|<<|&|\^|\||@)=$/.test(this.tok.v)) {
      const op = this.next().v.slice(0, -1)
      const value = this.isKw("yield") ? this.yieldExpr() : this.exprList()
      return { type: "AugAssign", line, target: first, op, value }
    }
    if (this.eat(":")) {
      const annotation = this.expr()
      const value = this.eat("=") ? (this.isKw("yield") ? this.yieldExpr() : this.exprList(true)) : undefined
      return value ? { type: "Assign", line, targets: [first], value, annotation } : { type: "AnnAssign", line, target: first, annotation }
    }
    return { type: "ExprStmt", line, value: first }
  }

  private atEndOfSimple(): boolean {
    return this.tt() === "nl" || this.tt() === "eof" || this.is(";") || this.tt() === "dedent"
  }

  private dotted(): string {
    let s = this.next().v
    while (this.eat(".")) s += "." + this.next().v
    return s
  }

  // ---- expressions

  /** `a, b = …` and `return a, b`: a bare comma makes a tuple. */
  private exprList(allowStar = false): Expr {
    const line = this.tok.line
    if (this.isKw("yield")) return this.yieldExpr()
    const first = allowStar && this.is("*") ? this.starred() : this.namedExpr()
    if (!this.is(",")) return first
    const elts = [first]
    while (this.eat(",")) {
      if (this.atEndOfSimple() || this.is("=") || this.is(")") || this.is(":") || (this.tt() === "op" && /=$/.test(this.tok.v) && this.tok.v !== "==")) break
      elts.push(this.is("*") ? this.starred() : this.namedExpr())
    }
    return { type: "Tuple", line, elts }
  }

  private targetList(): Expr {
    const line = this.tok.line
    const first = this.target()
    if (!this.is(",")) return first
    const elts = [first]
    while (this.eat(",")) { if (this.isKw("in")) break; elts.push(this.target()) }
    return { type: "Tuple", line, elts }
  }

  /** A for-loop / comprehension target: stops before `in`. */
  private target(): Expr {
    if (this.is("*")) return this.starred()
    return this.binary(1)
  }

  private starred(): Expr {
    const line = this.next().line
    return { type: "Starred", line, value: this.binary(1) }
  }

  private yieldExpr(): Expr {
    const line = this.next().line
    if (this.isKw("from")) { this.next(); return { type: "Yield", line, value: this.expr() } }
    return { type: "Yield", line, value: this.atEndOfSimple() || this.is(")") ? undefined : this.exprList() }
  }

  private namedExpr(): Expr {
    const e = this.expr()
    if (this.is(":=")) {
      this.next()
      return { type: "NamedExpr", line: e.line, target: e, value: this.expr() }
    }
    return e
  }

  expr(): Expr {
    if (this.isKw("lambda")) {
      const line = this.next().line
      const params: PyNode[] = []
      while (!this.is(":")) {
        this.eat("*"); this.eat("**")
        if (this.is(",")) { this.next(); continue }
        const pt = this.next()
        const dflt = this.eat("=") ? this.expr() : undefined
        params.push({ type: "Param", line: pt.line, name: pt.v, default: dflt, kind: "pos" })
        if (!this.eat(",")) break
      }
      this.expect(":")
      return { type: "Lambda", line, params, body: this.expr() }
    }
    const e = this.orExpr()
    if (this.isKw("if") ) {
      const save = this.p
      this.next()
      const test = this.orExpr()
      if (!this.isKw("else")) { this.p = save; return e }
      this.next()
      return { type: "IfExp", line: e.line, test, body: e, orelse: this.expr() }
    }
    return e
  }

  private orExpr(): Expr {
    let l = this.andExpr()
    while (this.isKw("or")) { this.next(); l = { type: "BoolOp", line: l.line, op: "or", values: [l, this.andExpr()] } }
    return l
  }

  private andExpr(): Expr {
    let l = this.notExpr()
    while (this.isKw("and")) { this.next(); l = { type: "BoolOp", line: l.line, op: "and", values: [l, this.notExpr()] } }
    return l
  }

  private notExpr(): Expr {
    if (this.isKw("not")) { const line = this.next().line; return { type: "UnaryOp", line, op: "not", operand: this.notExpr() } }
    return this.comparison()
  }

  private comparison(): Expr {
    const l = this.binary(1)
    const ops: string[] = []
    const comparators: Expr[] = []
    while ((this.tt() === "op" || this.tt() === "name") && COMPARE.has(this.tok.v)) {
      let op = this.next().v
      if (op === "not") { if (!this.isKw("in")) throw new ParseError("not without in"); this.next(); op = "not in" }
      else if (op === "is" && this.isKw("not")) { this.next(); op = "is not" }
      ops.push(op)
      comparators.push(this.binary(1))
    }
    return ops.length ? { type: "Compare", line: l.line, left: l, ops, comparators } : l
  }

  private binary(min: number): Expr {
    let l = this.unary()
    for (;;) {
      const t = this.tok
      const prec = t.t === "op" ? BIN_PREC[t.v] : undefined
      if (prec === undefined || prec < min) return l
      this.next()
      const r = this.binary(prec + 1)
      l = { type: "BinOp", line: l.line, op: t.v, left: l, right: r }
    }
  }

  private unary(): Expr {
    if (this.tt() === "op" && (this.tok.v === "-" || this.tok.v === "+" || this.tok.v === "~")) {
      const t = this.next()
      return { type: "UnaryOp", line: t.line, op: t.v, operand: this.unary() }
    }
    return this.power()
  }

  private power(): Expr {
    let base: Expr
    if (this.isKw("await")) { const line = this.next().line; base = { type: "Await", line, value: this.primary() } }
    else base = this.primary()
    if (this.eat("**")) return { type: "BinOp", line: base.line, op: "**", left: base, right: this.unary() }
    return base
  }

  private primary(): Expr {
    let e = this.atom()
    for (;;) {
      if (this.is(".")) {
        this.next()
        const name = this.next()
        e = { type: "Attribute", line: name.line, value: e, attr: name.v }
      } else if (this.is("(")) {
        const line = this.next().line
        e = { type: "Call", line: e.line || line, func: e, args: this.callArgs() }
      } else if (this.is("[")) {
        this.next()
        const index = this.subscriptList()
        this.expect("]")
        e = { type: "Subscript", line: e.line, value: e, index }
      } else return e
    }
  }

  private subscriptList(): Expr {
    const line = this.tok.line
    const items: Expr[] = []
    do {
      if (this.is("]")) break
      items.push(this.sliceItem())
    } while (this.eat(","))
    return items.length === 1 ? items[0] : { type: "Tuple", line, elts: items }
  }

  private sliceItem(): Expr {
    const line = this.tok.line
    let lower: Expr | undefined
    if (!this.is(":")) {
      lower = this.is("*") ? this.starred() : this.namedExpr()
      if (!this.is(":")) return lower
    }
    this.next()
    const upper = this.is(":") || this.is("]") || this.is(",") ? undefined : this.expr()
    let step: Expr | undefined
    if (this.eat(":")) step = this.is("]") || this.is(",") ? undefined : this.expr()
    return { type: "Slice", line, lower, upper, step }
  }

  /** After `(`: positional, keyword, *args, **kwargs, and a bare generator argument. */
  private callArgs(): PyNode[] {
    const args: PyNode[] = []
    while (!this.is(")")) {
      const line = this.tok.line
      if (this.eat("**")) args.push({ type: "Arg", line, value: this.expr(), star: 2 })
      else if (this.eat("*")) args.push({ type: "Arg", line, value: this.expr(), star: 1 })
      else if (this.tt() === "name" && this.peek().t === "op" && this.peek().v === "=") {
        const name = this.next().v
        this.next()
        args.push({ type: "Arg", line, name, value: this.expr() })
      } else {
        let v = this.namedExpr()
        if (this.isKw("for") || (this.isKw("async") && this.peek().v === "for")) v = this.comprehension("GeneratorExp", v)
        args.push({ type: "Arg", line, value: v })
      }
      if (!this.eat(",")) break
    }
    this.expect(")")
    return args
  }

  private comprehension(type: string, elt: Expr, value?: Expr): Expr {
    const gens: PyNode[] = []
    while (this.isKw("for") || (this.isKw("async") && this.peek().v === "for")) {
      if (this.isKw("async")) this.next()
      const line = this.next().line
      const target = this.targetList()
      if (!this.isKw("in")) throw new ParseError("comprehension without in")
      this.next()
      const iter = this.orExpr()
      const ifs: Expr[] = []
      while (this.isKw("if")) { this.next(); ifs.push(this.orExprNoCond()) }
      gens.push({ type: "Gen", line, target, iter, ifs })
    }
    return { type, line: elt.line, elt, value, gens }
  }

  private orExprNoCond(): Expr {
    return this.orExpr()
  }

  private atom(): Expr {
    const t = this.tok
    const line = t.line
    switch (t.t) {
      case "name":
        if (t.v === "yield") return this.yieldExpr()
        if (t.v === "lambda") return this.expr()
        if (KEYWORDS.has(t.v) && !/^(?:None|True|False|async|await|match|type|case)$/.test(t.v)) throw new ParseError(`keyword ${t.v} at line ${t.line}`)
        this.next()
        if (t.v === "None" || t.v === "True" || t.v === "False") return { type: "Const", line, value: t.v }
        return { type: "Name", line, id: t.v }
      case "num": this.next(); return { type: "Num", line, value: t.v }
      case "str": return this.strings()
      case "op":
        if (t.v === "(") {
          this.next()
          if (this.eat(")")) return { type: "Tuple", line, elts: [] }
          const first = this.is("*") ? this.starred() : this.isKw("yield") ? this.yieldExpr() : this.namedExpr()
          if (this.isKw("for") || (this.isKw("async") && this.peek().v === "for")) {
            const g = this.comprehension("GeneratorExp", first)
            this.expect(")")
            return g
          }
          if (this.eat(")")) return { type: "Paren", line, value: first }
          const elts = [first]
          while (this.eat(",")) {
            if (this.is(")")) break
            elts.push(this.is("*") ? this.starred() : this.namedExpr())
          }
          this.expect(")")
          return { type: "Tuple", line, elts }
        }
        if (t.v === "[") {
          this.next()
          if (this.eat("]")) return { type: "List", line, elts: [] }
          const first = this.is("*") ? this.starred() : this.namedExpr()
          if (this.isKw("for") || (this.isKw("async") && this.peek().v === "for")) {
            const g = this.comprehension("ListComp", first)
            this.expect("]")
            return g
          }
          const elts = [first]
          while (this.eat(",")) {
            if (this.is("]")) break
            elts.push(this.is("*") ? this.starred() : this.namedExpr())
          }
          this.expect("]")
          return { type: "List", line, elts }
        }
        if (t.v === "{") {
          this.next()
          if (this.eat("}")) return { type: "Dict", line, keys: [], values: [] }
          const keys: (Expr | undefined)[] = []
          const values: Expr[] = []
          const elts: Expr[] = []
          let isDict = false
          let first = true
          do {
            if (this.is("}")) break
            if (this.eat("**")) { isDict = true; keys.push(undefined); values.push(this.binary(1)) }
            else {
              const k = this.is("*") ? this.starred() : this.namedExpr()
              if (this.eat(":")) {
                isDict = true
                const v = this.expr()
                if (first && (this.isKw("for") || (this.isKw("async") && this.peek().v === "for"))) {
                  const g = this.comprehension("DictComp", k, v)
                  this.expect("}")
                  return g
                }
                keys.push(k); values.push(v)
              } else {
                if (first && (this.isKw("for") || (this.isKw("async") && this.peek().v === "for"))) {
                  const g = this.comprehension("SetComp", k)
                  this.expect("}")
                  return g
                }
                elts.push(k)
              }
            }
            first = false
          } while (this.eat(","))
          this.expect("}")
          return isDict ? { type: "Dict", line, keys, values } : { type: "Set", line, elts }
        }
        if (t.v === "...") { this.next(); return { type: "Const", line, value: "..." } }
        if (t.v === "*") return this.starred()
        break
    }
    throw new ParseError(`unexpected ${t.v || t.t} at line ${t.line}`)
  }

  /** Adjacent string literals concatenate; f-strings carry their {expressions}. */
  private strings(): Expr {
    const line = this.tok.line
    let value = ""
    const parts: Expr[] = []
    let f = false
    let bytes = false
    while (this.tt() === "str") {
      const s = this.next()
      const prefix = s.prefix ?? ""
      if (prefix.includes("b")) bytes = true
      if (prefix.includes("f")) {
        f = true
        const { text, exprs } = fstringParts(s.v, s.line)
        value += text
        parts.push(...exprs)
      } else value += s.v
    }
    return { type: "Str", line, value, parts, f, bytes }
  }
}

/** Split an f-string body into its literal text and parsed {expressions}. */
function fstringParts(body: string, line: number): { text: string; exprs: Expr[] } {
  let text = ""
  const exprs: Expr[] = []
  let i = 0
  while (i < body.length) {
    const c = body[i]
    if (c === "{" && body[i + 1] === "{") { text += "{"; i += 2; continue }
    if (c === "}" && body[i + 1] === "}") { text += "}"; i += 2; continue }
    if (c === "{") {
      let d = 1
      let j = i + 1
      let quote = ""
      while (j < body.length && d > 0) {
        const ch = body[j]
        if (quote) { if (ch === quote) quote = "" }
        else if (ch === "'" || ch === '"') quote = ch
        else if (ch === "{" || ch === "[" || ch === "(") d++
        else if (ch === "}" || ch === "]" || ch === ")") d--
        j++
      }
      let inner = body.slice(i + 1, j - 1)
      // Drop the conversion and format spec: {x!r:>10}, and the self-documenting `=`.
      inner = cutTopLevel(inner)
      const lineOff = (body.slice(0, i).match(/\n/g) ?? []).length
      try {
        const p = new Parser(tokenize(inner.replace(/\n/g, " ")))
        const e = p.expr()
        shiftLines(e, line + lineOff - 1)
        exprs.push(e)
      } catch { /* unparseable: its value is unknown */ }
      text += "{}"
      i = j
      continue
    }
    text += c
    i++
  }
  return { text, exprs }
}

function cutTopLevel(s: string): string {
  let d = 0
  let quote = ""
  for (let k = 0; k < s.length; k++) {
    const ch = s[k]
    if (quote) { if (ch === quote) quote = ""; continue }
    if (ch === "'" || ch === '"') quote = ch
    else if (ch === "(" || ch === "[" || ch === "{") d++
    else if (ch === ")" || ch === "]" || ch === "}") d--
    else if (d === 0 && (ch === "!" && s[k + 1] !== "=" || ch === ":")) return s.slice(0, k)
    else if (d === 0 && ch === "=" && s[k + 1] !== "=" && !/[=!<>]/.test(s[k - 1] ?? "")) return s.slice(0, k)
  }
  return s
}

function shiftLines(n: unknown, by: number) {
  if (!n || typeof n !== "object") return
  if (Array.isArray(n)) { for (const c of n) shiftLines(c, by); return }
  const node = n as PyNode
  if (typeof node.line === "number") node.line += by
  for (const [k, v] of Object.entries(node)) if (k !== "line" && v && typeof v === "object") shiftLines(v, by)
}

export function parsePython(src: string): Stmt[] | null {
  try {
    return new Parser(tokenize(src), src).module()
  } catch {
    return null
  }
}
