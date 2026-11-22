import type { Scanner, ScanContext } from "../../scanner"
import type { FlowStep, Issue, Severity } from "../../schema"
import { parse } from "@babel/parser"
import { looksGenerated, type Node } from "../../ast"

/**
 * Deep JavaScript / TypeScript analysis (js-taint, beta, opt-in like php-taint).
 *
 * Follows request data — Express/Koa/Fastify/Next request objects, URL search
 * params, browser location and postMessage data — through variables, string
 * building, destructuring and calls into the project's own functions (analysed
 * at the call site with the caller's arguments, across files), to the call that
 * makes it dangerous: SQL text, a shell, eval and template compilers, file paths,
 * outgoing URLs, redirects and HTML.
 *
 * Deliberately not a sound analysis: unknown library calls return clean values,
 * so a value only stays tainted along operations we know carry it. Each finding
 * carries its path (Issue.flow) so it can be checked by reading.
 */

type Kind = "sql" | "nosql" | "cmd" | "code" | "file" | "ssrf" | "redirect" | "xss"

interface Step { line: number; text: string; file: string }
interface Fact {
  src: string
  safe: Set<Kind>
  steps: Step[]
  client: boolean
  /** Set while the value sits in a field of an object literal: reading another field does not get it. */
  field?: string
}
type Value = Fact[]
type Env = Map<string, Value>

interface Finding { kind: Kind; file: string; line: number; sink: string; fact: Fact; guarded: boolean }

const RULES: Record<Kind, { id: string; title: string; detail: string; severity: Severity }> = {
  sql: {
    id: "js-taint-sqli",
    title: "SQL injection: request input is built into SQL text",
    detail: "Request data is pasted into the text of a SQL query. Pass it as a bound parameter (`query('… WHERE id = ?', [id])`, a tagged `sql` template, or the ORM's where object).",
    severity: "critical",
  },
  nosql: {
    id: "js-taint-nosqli",
    title: "NoSQL injection: a request object is used as a query",
    detail: "A request value reaches a MongoDB query as an object or a `$where` script, so a client can send operators like `{ \"$ne\": null }`. Cast fields to strings or validate the shape first.",
    severity: "critical",
  },
  cmd: {
    id: "js-taint-cmdi",
    title: "Command injection: request input reaches a shell",
    detail: "Request data reaches `exec`/`execSync` (a shell) or chooses the program that runs. Use `execFile`/`spawn` with a fixed program and an argument array.",
    severity: "critical",
  },
  code: {
    id: "js-taint-code-injection",
    title: "Code injection: request input is evaluated",
    detail: "Request data reaches eval, `new Function`, the vm module, `require()` or a template compiler, which runs it as code. Never evaluate input; map it to a fixed set of operations.",
    severity: "critical",
  },
  file: {
    id: "js-taint-path-traversal",
    title: "Path traversal: request input chooses a file path",
    detail: "Request data becomes a file path, so `../` can reach files outside the intended directory. Resolve the path and check it still starts with the base directory, or use `path.basename`.",
    severity: "critical",
  },
  ssrf: {
    id: "js-taint-ssrf",
    title: "SSRF: request input chooses where the server connects",
    detail: "Request data decides the host the server fetches, so a client can reach internal services or cloud metadata. Allow only known hosts.",
    severity: "warning",
  },
  redirect: {
    id: "js-taint-open-redirect",
    title: "Open redirect: request input chooses the redirect target",
    detail: "Request data is used as a redirect URL, so a link on your domain can send users anywhere. Redirect to relative paths only, or check the host against an allowlist.",
    severity: "warning",
  },
  xss: {
    id: "js-taint-xss",
    title: "Cross-site scripting: request input is written as HTML",
    detail: "Request data is written into HTML (`innerHTML`, `dangerouslySetInnerHTML`, `document.write`, an HTML response) without escaping. Use `textContent`, let the framework escape it, or sanitise with DOMPurify.",
    severity: "critical",
  },
}

const WHOLE_URL = /(?:^|\.)(?:req|request|ctx|context|c|r|event)\.(?:url|originalUrl|path|nextUrl(?:\.searchParams)?|search|searchParams)$|location\.(?:href|search|hash|pathname)$|^searchParams$/

const JS_FILE = /\.(?:[cm]?[jt]sx?)$/i
const SKIP_PATH = /(?:^|\/)(?:node_modules|dist|build|out|coverage|\.next|\.nuxt|vendor|third[-_]?party|tests?|__tests__|specs?|e2e|cypress|fixtures?|__mocks__|mocks?|examples?|demos?|docs?|stories|storybook|benchmarks?|scripts)\/|\.(?:test|spec|stories|d|config)\.[cm]?[jt]sx?$|\.min\.js$/i
const MAX_FILES = 4000
const MAX_BYTES = 300_000
const MAX_DEPTH = 4
const MAX_FACTS = 6
const MAX_FINDINGS = 200
const MAX_WORK = 400_000

/** Request objects by name, and the members that carry client data. */
const REQ_NAME = /^(?:req|request|ctx|context|c|event|evt|r)$/
const REQ_MEMBER = /^(?:query|body|params|headers|cookies|signedCookies|url|originalUrl|path|files|file|rawBody|search|searchParams|hash|pathParameters|queryStringParameters|multiValueQueryStringParameters)$/
/** Browser-side sources: whatever the URL or another window says. */
const CLIENT_SOURCE = /^(?:window\.|document\.)?location\.(?:search|hash|href)$|^document\.(?:URL|documentURI|referrer|baseURI)$|^window\.name$/
const STRING_METHODS = new Set([
  "trim", "trimStart", "trimEnd", "toLowerCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase", "split", "join",
  "slice", "substring", "substr", "replace", "replaceAll", "concat", "toString", "padStart", "padEnd", "at", "normalize",
  "repeat", "valueOf", "flat", "map", "filter", "reduce", "find", "pop", "shift", "get", "getAll", "values", "entries", "keys",
])
const PASS_FUNCS = new Set([
  "String", "decodeURIComponent", "decodeURI", "unescape", "JSON.parse", "JSON.stringify", "Buffer.from", "path.join",
  "path.resolve", "path.normalize", "util.format", "Object.values", "Object.keys", "Object.entries", "Array.from", "Object.assign",
  "atob", "Buffer.concat", "querystring.parse", "qs.parse", "URLSearchParams", "URL", "url.parse", "format",
])
const CLEAN_FUNCS = /^(?:parseInt|parseFloat|Number|Boolean|isNaN|Math\.\w+|Date\.\w+|crypto\.\w+|bcrypt\.\w+|uuid\w*|validator\.is\w+|Number\.\w+|\w+\.length)$/
const SANITIZE: [RegExp, Kind[]][] = [
  [/^(?:encodeURIComponent|encodeURI|escape|querystring\.escape)$/, ["xss", "redirect", "cmd", "sql", "file"]],
  [/(?:^|\.)(?:escapeHtml|escapeHTML|htmlEscape|encodeHTML|sanitizeHtml|sanitize|purify|xss|filterXSS|he\.encode|he\.escape|_\.escape|validator\.escape|DOMPurify\.sanitize|escape_html)$/, ["xss"]],
  [/^path\.basename$/, ["file"]],
  [/(?:^|\.)(?:escape|escapeId|escapeLiteral|escapeIdentifier|format)$/, ["sql"]],
  [/^(?:shellEscape|shellescape|shellQuote\.quote|quote)$/, ["cmd"]],
]

const DB_WORDS = /(?:^|\.)(?:db|database|conn|connection|pool|client|knex|sequelize|prisma|sql|sqlite|mysql|pg|tx|trx|query|models\.sequelize|this\.db|dataSource|manager|repository|em)$/i
const SQL_TEXT = /\b(?:select\s[\s\S]*\bfrom|insert\s+into|update\s+\S+\s+set|delete\s+from|where\s|order\s+by|union\s+select)\b/i

/**
 * The shared parseFile() has no decorator support, and Angular / NestJS sources
 * (`@Component`, `@Controller`) are exactly the framework code this engine reads.
 */
function parseSource(content: string, file: string): Node | null {
  if (looksGenerated(content, file)) return null
  const ts = /\.[cm]?tsx?$/i.test(file)
  const plugins = [...(ts ? ["typescript"] : []), ...(/x$/i.test(file) || !ts ? ["jsx"] : []), "decorators-legacy"] as ("typescript" | "jsx" | "decorators-legacy")[]
  try {
    return parse(content, { sourceType: "unambiguous", plugins, errorRecovery: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowUndeclaredExports: true }) as unknown as Node
  } catch {
    return null
  }
}

function text(n: Node | undefined, depth = 0): string {
  if (!n || depth > 8) return ""
  switch (n.type) {
    case "Identifier": return String(n.name)
    case "ThisExpression": return "this"
    case "Super": return "super"
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const obj = text(n.object as Node, depth + 1)
      const prop = n.computed ? (((n.property as Node)?.type === "StringLiteral") ? String((n.property as Node).value) : "[]") : text(n.property as Node, depth + 1)
      return `${obj}.${prop}`
    }
    case "CallExpression":
    case "OptionalCallExpression": return `${text(n.callee as Node, depth + 1)}()`
    case "AwaitExpression": return text(n.argument as Node, depth + 1)
    case "TSNonNullExpression":
    case "TSAsExpression":
    case "ParenthesizedExpression": return text(n.expression as Node, depth + 1)
    case "StringLiteral": return JSON.stringify(n.value)
    default: return n.type ?? ""
  }
}

const lineOf = (n: Node | undefined) => ((n?.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 0)

function literalLead(n: Node | undefined): string {
  if (!n) return ""
  if (n.type === "StringLiteral") return String(n.value)
  if (n.type === "TemplateLiteral") return String(((n.quasis as Node[])[0]?.value as { cooked?: string })?.cooked ?? "")
  if (n.type === "BinaryExpression" && n.operator === "+") return literalLead(n.left as Node)
  return ""
}

function literalAll(n: Node | undefined): string {
  if (!n) return ""
  if (n.type === "StringLiteral") return String(n.value)
  if (n.type === "TemplateLiteral") return (n.quasis as Node[]).map((q) => (q.value as { cooked?: string })?.cooked ?? "").join(" ")
  if (n.type === "BinaryExpression" && n.operator === "+") return `${literalAll(n.left as Node)} ${literalAll(n.right as Node)}`
  return ""
}

function merge(...vals: Value[]): Value {
  const out: Value = []
  const seen = new Set<string>()
  for (const v of vals) for (const f of v) {
    const key = `${f.src}|${[...f.safe].sort().join(",")}|${f.steps[0]?.file}:${f.steps[0]?.line}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
    if (out.length >= MAX_FACTS) return out
  }
  return out
}

/** Reading `.prop` of a value: facts held in other fields of an object literal stay behind. */
const pick = (v: Value, prop: string | undefined): Value =>
  v.filter((f) => f.field === undefined || prop === undefined || f.field === prop).map((f) => (f.field === undefined ? f : { ...f, field: undefined }))

const withStep = (v: Value, s: Step): Value => v.map((f) => ({ ...f, steps: f.steps.length > 12 ? [...f.steps.slice(0, 4), ...f.steps.slice(-7), s] : [...f.steps, s] }))
const makeSafe = (v: Value, kinds: Kind[]): Value => v.map((f) => ({ ...f, safe: new Set([...f.safe, ...kinds]) }))

interface FnDef { name: string; node: Node; file: string; content: string }

/** Names too common to tie a call to one definition. */
const GENERIC = new Set(["get", "set", "run", "main", "init", "handler", "handle", "render", "load", "save", "find", "create", "update", "delete", "remove", "add", "call", "apply", "bind", "exec", "query", "send", "fetch", "request", "start", "stop", "next", "then", "catch", "default", "index", "constructor", "toString", "map", "filter", "use", "listen", "close", "open", "write", "read", "parse"])

class Project {
  readonly fns = new Map<string, FnDef[]>()
  readonly findings: Finding[] = []
  private reported = new Set<string>()
  work = 0
  /** Function nodes analysed at least once (in context or as a root). */
  readonly analysed = new WeakSet<object>()

  define(name: string, node: Node, file: string, content: string) {
    if (!name || GENERIC.has(name) || name.length < 3) return
    const list = this.fns.get(name) ?? []
    if (list.length < 4) list.push({ name, node, file, content })
    this.fns.set(name, list)
  }

  lookup(name: string): FnDef | undefined {
    const list = this.fns.get(name)
    return list && list.length <= 2 ? list[0] : undefined
  }

  report(f: Finding) {
    const key = `${f.kind}|${f.file}|${f.line}|${f.fact.src}|${f.fact.steps[0]?.file}:${f.fact.steps[0]?.line}`
    if (this.reported.has(key) || this.findings.length >= MAX_FINDINGS * 4) return
    this.reported.add(key)
    this.findings.push(f)
  }
}

/** Collect named functions (declarations, `const f = () =>`, methods, exports) for call resolution. */
function index(project: Project, ast: Node, file: string, content: string) {
  const visit = (n: Node | undefined, depth: number) => {
    if (!n || typeof n !== "object" || depth > 60) return
    if (n.type === "FunctionDeclaration" && (n.id as Node)?.name) project.define(String((n.id as Node).name), n, file, content)
    if (n.type === "VariableDeclarator" && (n.id as Node)?.type === "Identifier" && /Function|Arrow/.test(String((n.init as Node)?.type ?? "")))
      project.define(String((n.id as Node).name), n.init as Node, file, content)
    if ((n.type === "ClassMethod" || n.type === "ObjectMethod") && (n.key as Node)?.type === "Identifier") project.define(String((n.key as Node).name), n, file, content)
    if (n.type === "ObjectProperty" && (n.key as Node)?.type === "Identifier" && /Function|Arrow/.test(String((n.value as Node)?.type ?? "")))
      project.define(String((n.key as Node).name), n.value as Node, file, content)
    if (n.type === "AssignmentExpression" && /Function|Arrow/.test(String((n.right as Node)?.type ?? ""))) {
      const t = text(n.left as Node)
      const name = t.split(".").pop() ?? ""
      if (name !== "exports") project.define(name, n.right as Node, file, content)
    }
    for (const [k, v] of Object.entries(n)) {
      if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments" || k === "extra") continue
      if (Array.isArray(v)) for (const c of v) visit(c as Node, depth + 1)
      else if (v && typeof v === "object" && (v as Node).type) visit(v as Node, depth + 1)
    }
  }
  visit(ast, 0)
}

class Ctx {
  private returns: Value = []
  constructor(private project: Project, private file: string, private content: string, private depth: number, private callStack: Set<object>) {}

  private step(n: Node | undefined, t: string): Step {
    return { line: lineOf(n), text: t.length > 80 ? `${t.slice(0, 77)}…` : t, file: this.file }
  }

  /** Analyse a function body with `args` bound to its parameters; returns what it returns. */
  fn(node: Node, args: Value[], closure: Env): Value {
    this.project.analysed.add(node)
    const env: Env = new Map(closure)
    const params = (node.params as Node[] | undefined) ?? []
    params.forEach((p, i) => this.bind(p, args[i] ?? [], env, node))
    const body = node.body as Node
    if (!body) return []
    if (body.type === "BlockStatement") this.block(body.body as Node[], env)
    else this.returns = merge(this.returns, this.expr(body, env))
    return this.returns
  }

  private bind(pattern: Node | undefined, v: Value, env: Env, at: Node) {
    if (!pattern) return
    switch (pattern.type) {
      case "Identifier": env.set(String(pattern.name), v.length ? withStep(v, this.step(pattern, String(pattern.name))) : []); return
      case "AssignmentPattern": this.bind(pattern.left as Node, merge(v, this.expr(pattern.right as Node, env)), env, at); return
      case "ObjectPattern":
        for (const p of (pattern.properties as Node[]) ?? []) {
          if (p.type === "RestElement") this.bind(p.argument as Node, v, env, at)
          else {
            const key = (p.key as Node)?.type === "Identifier" && !p.computed ? String((p.key as Node).name) : undefined
            this.bind((p.value as Node) ?? (p.key as Node), pick(v, key), env, at)
          }
        }
        return
      case "ArrayPattern":
        for (const e of (pattern.elements as Node[]) ?? []) this.bind(e, v, env, at)
        return
      case "RestElement": this.bind(pattern.argument as Node, v, env, at); return
      case "TSParameterProperty": this.bind(pattern.parameter as Node, v, env, at); return
    }
  }

  private block(stmts: Node[], env: Env) {
    for (const s of stmts ?? []) this.stmt(s, env)
  }

  private branch(nodes: (Node | undefined)[], env: Env) {
    const outs: Env[] = []
    for (const n of nodes) {
      const e: Env = new Map(env)
      if (n) this.stmt(n, e)
      outs.push(e)
    }
    for (const e of outs) for (const [k, v] of e) env.set(k, merge(env.get(k) ?? [], v))
  }

  private stmt(s: Node | undefined, env: Env) {
    if (!s || ++this.project.work > MAX_WORK) return
    switch (s.type) {
      case "BlockStatement": this.block(s.body as Node[], env); return
      case "ExpressionStatement": this.expr(s.expression as Node, env); return
      case "VariableDeclaration":
        for (const d of (s.declarations as Node[]) ?? []) {
          const init = d.init as Node | undefined
          this.bind(d.id as Node, init ? this.expr(init, env) : [], env, d)
        }
        return
      case "ReturnStatement": if (s.argument) this.returns = merge(this.returns, this.expr(s.argument as Node, env)); return
      case "IfStatement": this.expr(s.test as Node, env); this.branch([s.consequent as Node, s.alternate as Node], env); return
      case "ForStatement":
        if (s.init && (s.init as Node).type === "VariableDeclaration") this.stmt(s.init as Node, env)
        else if (s.init) this.expr(s.init as Node, env)
        this.stmt(s.body as Node, env)
        return
      case "ForInStatement":
      case "ForOfStatement": {
        const right = this.expr(s.right as Node, env)
        const left = s.left as Node
        if (left.type === "VariableDeclaration") for (const d of (left.declarations as Node[]) ?? []) this.bind(d.id as Node, right, env, d)
        else this.assign(left, right, env)
        this.stmt(s.body as Node, env)
        return
      }
      case "WhileStatement":
      case "DoWhileStatement": this.expr(s.test as Node, env); this.stmt(s.body as Node, env); return
      case "TryStatement": this.stmt(s.block as Node, env); if (s.handler) this.stmt((s.handler as Node).body as Node, env); if (s.finalizer) this.stmt(s.finalizer as Node, env); return
      case "SwitchStatement": this.expr(s.discriminant as Node, env); for (const c of (s.cases as Node[]) ?? []) this.block(c.consequent as Node[], env); return
      case "LabeledStatement": this.stmt(s.body as Node, env); return
      case "ThrowStatement": this.expr(s.argument as Node, env); return
      case "FunctionDeclaration": this.closure(s, env); return
      case "ExportNamedDeclaration":
      case "ExportDefaultDeclaration": {
        const d = s.declaration as Node | undefined
        if (d && /Statement|Declaration/.test(String(d.type)) && d.type !== "ClassDeclaration") this.stmt(d, env)
        else if (d) this.expr(d, env)
        return
      }
      case "ClassDeclaration": this.expr(s, env); return
    }
  }

  /** A nested function seen during analysis: analysed now, with the enclosing variables in scope. */
  private closure(fn: Node, env: Env, args: Value[] = []): Value {
    if (this.depth >= MAX_DEPTH || this.callStack.has(fn)) return []
    const stack = new Set(this.callStack).add(fn)
    return new Ctx(this.project, this.file, this.content, this.depth + 1, stack).fn(fn, args, env)
  }

  private assign(left: Node, v: Value, env: Env) {
    if (left.type === "Identifier") { env.set(String(left.name), v.length ? withStep(v, this.step(left, String(left.name))) : []); return }
    if (left.type === "ObjectPattern" || left.type === "ArrayPattern") { this.bind(left, v, env, left); return }
    if (left.type === "MemberExpression") {
      const prop = (left.property as Node)
      const name = !left.computed && prop?.type === "Identifier" ? String(prop.name) : ""
      if (/^(?:innerHTML|outerHTML)$/.test(name)) this.sink("xss", v, left, `.${name} =`)
      if (/^(?:href)$/.test(name) && /location$/.test(text(left.object as Node))) this.sink("redirect", v, left, "location.href =")
      if (text(left) === "window.location" || text(left) === "document.location" || text(left) === "location") this.sink("redirect", v, left, `${text(left)} =`)
      // obj.field = tainted: the object (by its root name) now carries it.
      let root: Node = left
      while (root.type === "MemberExpression") root = root.object as Node
      if (root.type === "Identifier" && v.length) {
        const k = String(root.name)
        env.set(k, merge(env.get(k) ?? [], withStep(v, this.step(left, text(left)))))
      }
    }
  }

  private source(n: Node): Value {
    const t = text(n)
    const parts = t.split(".")
    // req.query, req.body.x, ctx.request.body, request.nextUrl.searchParams, event.queryStringParameters
    const reqIdx = parts.findIndex((p, i) => REQ_NAME.test(p) && i <= 1)
    if (reqIdx >= 0) {
      const rest = parts.slice(reqIdx + 1).filter((p) => p !== "request" && p !== "nextUrl" && p !== "req")
      if (rest.length && REQ_MEMBER.test(rest[0])) {
        // A bare `c.` or `r.` is too short a name to trust without a request-shaped member after it.
        return [{ src: t, safe: new Set(), steps: [this.step(n, t)], client: false }]
      }
    }
    if (CLIENT_SOURCE.test(t)) return [{ src: t, safe: new Set(), steps: [this.step(n, t)], client: true }]
    // Angular's router: this.route.snapshot.queryParams.q, activatedRoute.snapshot.params.id.
    if (/(?:^|\.)(?:route|activatedRoute|router\.routerState)\.snapshot\.(?:queryParams|params|fragment|queryParamMap|paramMap)(?:\.|$)/.test(t))
      return [{ src: t, safe: new Set(), steps: [this.step(n, t)], client: true }]
    if (/^(?:event|e|evt|msg|message)\.data$/.test(t) && /addEventListener\s*\(\s*['"]message['"]|onmessage/.test(this.content))
      return [{ src: t, safe: new Set(), steps: [this.step(n, t)], client: true }]
    return []
  }

  expr(n: Node | undefined, env: Env): Value {
    if (!n || ++this.project.work > MAX_WORK) return []
    switch (n.type) {
      case "Identifier": return env.get(String(n.name)) ?? []
      case "MemberExpression":
      case "OptionalMemberExpression": {
        const src = this.source(n)
        if (src.length) return src
        if (n.computed) this.expr(n.property as Node, env)
        const obj = this.expr(n.object as Node, env)
        // `.length` and friends carry no text.
        const prop = !n.computed ? String((n.property as Node)?.name ?? "") : ""
        if (/^(?:length|size|byteLength)$/.test(prop)) return []
        return pick(obj, prop || undefined)
      }
      case "TemplateLiteral": return withStep(pick(merge(...((n.expressions as Node[]) ?? []).map((e) => this.expr(e, env))), undefined), this.step(n, "`…${}`"))
      case "TaggedTemplateExpression": {
        // sql`…${x}` and Prisma.sql bind their values: safe for SQL.
        const tag = text(n.tag as Node)
        const v = this.expr(n.quasi as Node, env)
        return /(?:^|\.)(?:sql|SQL|Prisma\.sql|raw)$/.test(tag) && tag !== "raw" ? makeSafe(v, ["sql"]) : v
      }
      case "BinaryExpression": {
        const l = this.expr(n.left as Node, env)
        const r = this.expr(n.right as Node, env)
        return n.operator === "+" ? merge(l, r) : []
      }
      case "LogicalExpression": return merge(this.expr(n.left as Node, env), this.expr(n.right as Node, env))
      case "ConditionalExpression": this.expr(n.test as Node, env); return merge(this.expr(n.consequent as Node, env), this.expr(n.alternate as Node, env))
      case "AwaitExpression":
      case "TSAsExpression":
      case "TSNonNullExpression":
      case "TSSatisfiesExpression":
      case "TSTypeAssertion":
      case "ParenthesizedExpression":
      case "TypeCastExpression":
      case "SpreadElement":
      case "UnaryExpression": {
        const inner = this.expr((n.argument ?? n.expression) as Node, env)
        return n.type === "UnaryExpression" && n.operator !== "void" ? [] : inner
      }
      case "SequenceExpression": { let last: Value = []; for (const e of (n.expressions as Node[]) ?? []) last = this.expr(e, env); return last }
      case "AssignmentExpression": {
        const v = n.operator === "+=" ? merge(this.expr(n.left as Node, env), this.expr(n.right as Node, env)) : this.expr(n.right as Node, env)
        this.assign(n.left as Node, v, env)
        return v
      }
      case "ObjectExpression": {
        const vals: Value[] = []
        for (const p of (n.properties as Node[]) ?? []) {
          if (p.type === "ObjectProperty") {
            const v = this.expr(p.value as Node, env)
            const key = (p.key as Node)?.type === "Identifier" ? String((p.key as Node).name) : (p.key as Node)?.type === "StringLiteral" ? String((p.key as Node).value) : undefined
            vals.push(key && !p.computed ? v.map((f) => ({ ...f, field: key })) : v)
            if ((p.key as Node)?.type === "Identifier" && (p.key as Node).name === "__html") this.sink("xss", v, p, "dangerouslySetInnerHTML")
            if (((p.key as Node)?.name === "$where" || (p.key as Node)?.value === "$where")) this.sink("nosql", v, p, "$where")
          } else if (p.type === "SpreadElement") vals.push(this.expr(p.argument as Node, env))
          else if (p.type === "ObjectMethod") this.closure(p, env)
        }
        return merge(...vals)
      }
      case "ArrayExpression": return merge(...((n.elements as Node[]) ?? []).map((e) => this.expr(e, env)))
      case "ArrowFunctionExpression":
      case "FunctionExpression": this.closure(n, env); return []
      case "ClassDeclaration":
      case "ClassExpression":
        for (const m of (((n.body as Node)?.body as Node[]) ?? [])) {
          if (m.type === "ClassMethod" || m.type === "ClassPrivateMethod") this.closure(m, env)
          else if (m.type === "ClassProperty" && /Function|Arrow/.test(String((m.value as Node)?.type))) this.closure(m.value as Node, env)
        }
        return []
      case "NewExpression": return this.call(n, env, true)
      case "CallExpression":
      case "OptionalCallExpression": return this.call(n, env, false)
      case "JSXElement":
      case "JSXFragment": this.jsx(n, env); return []
      default: return []
    }
  }

  private jsx(n: Node, env: Env) {
    const open = n.openingElement as Node | undefined
    for (const a of ((open?.attributes as Node[]) ?? [])) {
      if (a.type === "JSXAttribute") {
        const v = a.value as Node | undefined
        if (v?.type === "JSXExpressionContainer") this.expr(v.expression as Node, env)
      } else if (a.type === "JSXSpreadAttribute") this.expr(a.argument as Node, env)
    }
    for (const c of ((n.children as Node[]) ?? [])) {
      if (c.type === "JSXExpressionContainer") this.expr(c.expression as Node, env)
      else if (c.type === "JSXElement" || c.type === "JSXFragment") this.jsx(c, env)
    }
  }

  private call(n: Node, env: Env, isNew: boolean): Value {
    const callee = n.callee as Node
    const argNodes = (n.arguments as Node[]) ?? []
    const fnArgs = argNodes.map((a) => (/Function|Arrow/.test(String(a.type)) ? null : a))
    const args = fnArgs.map((a) => (a ? this.expr(a, env) : []))
    const ct = text(callee)
    const method = ct.split(".").pop() ?? ""
    const recvNode = callee?.type === "MemberExpression" || callee?.type === "OptionalMemberExpression" ? (callee.object as Node) : undefined
    const recv = recvNode ? text(recvNode) : ""
    const recvVal = recvNode ? this.expr(recvNode, env) : []
    const label = `${ct.length > 50 ? method : ct}()`
    const line = this.step(n, label)

    this.sinks(n, ct, method, recv, args, argNodes, isNew)

    // Callbacks: route handlers, promise chains, array callbacks. Element callbacks get the receiver's facts.
    for (const [i, a] of argNodes.entries()) {
      if (fnArgs[i]) continue
      const elementCb = /^(?:map|forEach|filter|find|some|every|reduce|flatMap|then)$/.test(method)
      this.closure(a, env, elementCb ? [recvVal, recvVal] : [])
    }

    // Request sources that are calls: req.get('x'), req.header('x'), req.param('x'), await req.json(), searchParams.get().
    if (recvNode && /^(?:req|request|ctx)$/.test(recv.split(".").pop() ?? "") && /^(?:get|header|param|json|formData|text|cookies|query)$/.test(method))
      return [{ src: `${recv}.${method}(${argNodes[0]?.type === "StringLiteral" ? `'${argNodes[0].value}'` : ""})`, safe: new Set(), steps: [line], client: false }]
    if (/(?:^|\.)useSearchParams$/.test(ct) || /(?:^|\.)useParams$/.test(ct)) return [{ src: `${ct}()`, safe: new Set(), steps: [line], client: true }]

    if (CLEAN_FUNCS.test(ct)) return []
    // The project's own confining helpers: slugify(), safeJoin(), resolveWithin(), sanitizeFilename().
    if (/(?:^|\.)(?:slugify|slug|\w*[sS]afe\w*|\w*Within\w*|\w*[sS]anitiz\w*|normali[sz]e\w*Name|clean\w*|\w*[vV]alidat\w*)$/.test(ct))
      return withStep(makeSafe(merge(...args, recvVal), ["file", "cmd", "xss", "redirect"]), line)
    for (const [re, kinds] of SANITIZE) {
      if (re.test(ct)) {
        // `.format()` is only a SQL escaper on a SQL helper; `escape()` only when it is a global or a DB/SqlString.
        if (kinds[0] === "sql" && !/(?:SqlString|mysql|connection|conn|pool|db|pg|sqlstring|format)\b/i.test(ct)) continue
        return withStep(makeSafe(merge(...args, recvVal), kinds), line)
      }
    }
    // new URL('/login', request.url): the base only supplies our own origin.
    if (isNew && ct === "URL") return withStep(argNodes[0]?.type === "StringLiteral" || argNodes[0]?.type === "TemplateLiteral" && literalLead(argNodes[0]).startsWith("/") ? [] : args[0] ?? [], line)
    if (isNew && /^(?:URLSearchParams|String|Buffer)$/.test(ct)) return withStep(merge(...args), line)
    if (PASS_FUNCS.has(ct) || PASS_FUNCS.has(method) && /^(?:path|util|JSON|Buffer|Object|Array|querystring|qs|url)$/.test(recv)) return withStep(merge(...args), line)

    // An argument checked against an allowlist just before the call (`if (CLIENT_FILES.has(f)) serve(f)`).
    const lines = this.content.split(/\r?\n/).slice(Math.max(0, lineOf(n) - 9), lineOf(n)).join("\n")
    for (const [i, a] of argNodes.entries()) {
      if (a?.type !== "Identifier" || !args[i]?.length) continue
      const id = String(a.name).replace(/[^\w$]/g, "")
      if (new RegExp(`\\.(?:has|includes)\\(\\s*${id}\\s*\\)|\\b${id}\\s*===?\\s*['"\`]`).test(lines)) args[i] = makeSafe(args[i], ["file", "redirect", "ssrf", "cmd", "code", "sql", "xss", "nosql"])
    }
    // The project's own functions: analysed with these arguments.
    const def = !isNew && !recvVal.length ? this.project.lookup(method) : undefined
    if (def && this.depth < MAX_DEPTH && !this.callStack.has(def.node) && args.some((a) => a.length)) {
      const fnNode = def.node.type === "VariableDeclarator" ? (def.node.init as Node) : def.node
      const stack = new Set(this.callStack).add(fnNode)
      const ret = new Ctx(this.project, def.file, def.content, this.depth + 1, stack).fn(fnNode, args.map((a) => withStep(a, line)), new Map())
      return withStep(ret, line)
    }

    // Methods on a tainted value that hand its text on.
    if (recvVal.length && (STRING_METHODS.has(method) || /^(?:then)$/.test(method))) return withStep(merge(recvVal, method === "concat" || method === "replace" || method === "join" ? merge(...args) : []), line)
    return []
  }

  private sinks(n: Node, ct: string, method: string, recv: string, args: Value[], argNodes: Node[], isNew: boolean) {
    const a0 = args[0] ?? []
    const any = args.some((a) => a.length)
    if (!any) return
    const node0 = argNodes[0]

    // SQL text
    if (/^(?:query|execute|raw|exec|run|all|get|prepare|each|unsafe|\$queryRawUnsafe|\$executeRawUnsafe|whereRaw|orWhereRaw|havingRaw|orderByRaw|joinRaw|fromRaw|selectRaw|literal)$/.test(method) && a0.length) {
      const generic = /^(?:exec|run|all|get|prepare|each|execute|query|raw)$/.test(method)
      const sqlLike = SQL_TEXT.test(literalAll(node0))
      const dbLike = DB_WORDS.test(recv) || /^(?:Sequelize|sequelize)$/.test(recv)
      // A generic name (execute, query, run) on a DB-looking receiver still needs SQL in sight: a worker
      // pool's execute(key) is not a query. The text is the literal, or the literal the variable was built from.
      const builtSql = sqlLike || (node0?.type === "Identifier" && new RegExp(`\\b${String(node0.name).replace(/[^\w$]/g, "")}\\s*\\+?=\\s*[\`'"][^\\n]*\\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE)\\b`, "i").test(this.content))
      if ((!generic || builtSql) && node0 && node0.type !== "ObjectExpression" && node0.type !== "ArrayExpression") {
        // A plain variable is SQL text only if it was built by pasting: the facts saw a template or a +.
        this.sink("sql", a0, n, `${recv ? `${recv}.` : ""}${method}()`)
      }
    }
    // NoSQL: the whole request object as the filter
    if (/^(?:find|findOne|findOneAndUpdate|findOneAndDelete|updateOne|updateMany|deleteOne|deleteMany|countDocuments|exists|where)$/.test(method) &&
      node0 && (node0.type === "MemberExpression" || node0.type === "Identifier") && a0.some((f) => /\.(?:body|query)$/.test(f.src)) &&
      /(?:collection|Collection|model|Model|db\.|^[A-Z]\w*$)/.test(recv))
      this.sink("nosql", a0, n, `${method}()`)
    // A filter object whose field is a raw request value: the client can send { "$ne": null } in its place.
    if (/^(?:find|findOne|findOneAndUpdate|findOneAndDelete|update|updateOne|updateMany|deleteOne|deleteMany|remove|countDocuments|exists)$/.test(method) &&
      node0?.type === "ObjectExpression" && /(?:collection|Collection|model|Model|db\.|\bUser|\bProduct|\bReview)/.test(recv) &&
      ((node0.properties as Node[]) ?? []).some((p) => /^(?:MemberExpression|Identifier)$/.test(String((p.value as Node)?.type)) && /\.(?:body|query)\./.test(text(p.value as Node))))
      this.sink("nosql", a0.filter((f) => /\.(?:body|query)\./.test(f.src)), n, `${recv}.${method}({ field: request value })`)

    // Shell
    if (/^(?:exec|execSync)$/.test(method) && (/child_process|\bcp\b|childProcess/.test(recv) || (!recv && /child_process/.test(this.content))) && a0.length)
      this.sink("cmd", a0, n, `${method}()`)
    if (/^(?:spawn|spawnSync|execFile|execFileSync|fork)$/.test(method) && (/child_process|\bcp\b|childProcess/.test(recv) || (!recv && /child_process/.test(this.content)))) {
      if (a0.length) this.sink("cmd", a0, n, `${method}() program`)
      const opts = argNodes.find((a) => a.type === "ObjectExpression")
      if (opts && /shell/.test(JSON.stringify(opts).slice(0, 2000)) && (args[1]?.length)) this.sink("cmd", args[1], n, `${method}({ shell })`)
    }
    if (/^(?:shell\.exec|shelljs\.exec|execa|execaCommand|execaCommandSync)$/.test(ct) && a0.length) this.sink("cmd", a0, n, ct)

    // Code
    if ((ct === "eval" || ((ct === "Function" || ct === "window.Function") && !isNew) || (isNew && ct === "Function")) && any) this.sink("code", merge(...args), n, `${ct}()`)
    if (/^(?:setTimeout|setInterval|setImmediate)$/.test(ct) && a0.length && node0 && !/Function|Arrow/.test(String(node0.type))) this.sink("code", a0, n, `${ct}(string)`)
    if (/^vm\.(?:runInNewContext|runInThisContext|runInContext|compileFunction)$|^vm\.Script$/.test(ct) && a0.length) this.sink("code", a0, n, ct)
    if ((ct === "require" || n.type === "ImportExpression") && a0.length) this.sink("code", a0, n, `${ct}()`)
    if (/^(?:ejs\.render|ejs\.compile|pug\.render|pug\.compile|jade\.render|jade\.compile|Handlebars\.compile|handlebars\.compile|_\.template|lodash\.template|nunjucks\.renderString|doT\.template|Mustache\.render|mustache\.render|vm2\.run|safeEval|staticEval)$/.test(ct) && a0.length)
      this.sink("code", a0, n, ct)

    // Files
    if (/^(?:fs|fsp|fse|fs\.promises|promises|fsExtra|fs-extra)$/.test(recv) && /^(?:readFile|readFileSync|createReadStream|createWriteStream|writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rm|rmSync|rmdir|readdir|readdirSync|open|openSync|copyFile|rename|renameSync|access|stat|readJson|readJSON|outputFile|remove|move|copy)$/.test(method) && a0.length)
      this.sink("file", a0, n, `${recv}.${method}()`)
    if (/^(?:sendFile|download|sendfile|attachment)$/.test(method) && /^(?:res|response|reply|ctx|this\.res)$/.test(recv) && a0.length) this.sink("file", a0, n, `${recv}.${method}()`)
    if (/^(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink|unlinkSync)$/.test(ct) && /from\s+['"](?:node:)?fs(?:\/promises)?['"]|require\(\s*['"](?:node:)?fs/.test(this.content) && a0.length)
      this.sink("file", a0, n, `${ct}()`)

    // Outgoing requests
    const urlCall = /^(?:fetch|axios|got|request|needle|superagent|ky|undici\.request|nodeFetch)$/.test(ct) ||
      (/^(?:axios|got|http|https|request|superagent|needle|ky|undici|client|httpClient|this\.http|this\.httpService)$/.test(recv) && /^(?:get|post|put|patch|delete|head|request|options)$/.test(method))
    if (urlCall && a0.length && this.hostFromInput(node0)) this.sink("ssrf", a0, n, `${ct}()`)

    // Redirects
    if (/^(?:redirect|permanentRedirect)$/.test(method) && /^(?:res|response|reply|ctx|this\.res|NextResponse|Response|h)$|^$/.test(recv)) {
      const i = argNodes.length > 1 && /^(?:NumericLiteral|Identifier)$/.test(String(argNodes[0]?.type)) && !args[0]?.length ? 1 : 0
      if (args[i]?.length && this.leavesSite(argNodes[i])) this.sink("redirect", args[i], n, `${recv ? `${recv}.` : ""}${method}()`)
    }
    if (/^(?:location\.assign|location\.replace|window\.location\.assign|window\.location\.replace|window\.open)$/.test(ct) && a0.length && this.leavesSite(node0))
      this.sink("redirect", a0, n, `${ct}()`)

    // HTML
    // Angular: marking a value as trusted HTML/script/URL turns off its sanitiser.
    if (/^bypassSecurityTrust(?:Html|Script|Url|ResourceUrl|Style)$/.test(method) && a0.length) this.sink("xss", a0, n, `${method}()`)
    if (/^(?:document\.write|document\.writeln)$/.test(ct) && any) this.sink("xss", merge(...args), n, ct)
    if (method === "insertAdjacentHTML" && args[1]?.length) this.sink("xss", args[1], n, "insertAdjacentHTML()")
    if (/^(?:html|append|prepend|after|before|replaceWith)$/.test(method) && /^\$|jQuery/.test(recv) && a0.length && method === "html") this.sink("xss", a0, n, `$().${method}()`)
    if (/^(?:send|write|end)$/.test(method) && /^(?:res|response|reply|ctx\.res|this\.res)$/.test(recv) && a0.length && /<[a-zA-Z!/]/.test(literalAll(node0)))
      this.sink("xss", a0, n, `${recv}.${method}(html)`)
  }

  /** The URL's host is chosen by the input: it starts with the value, or with only a scheme. */
  private hostFromInput(n: Node | undefined): boolean {
    if (!n) return false
    const lead = literalLead(n)
    if (n.type === "StringLiteral") return false
    if (!lead) return true
    return /^(?:https?:)?\/\/$|^https?:\/\/$/i.test(lead.trim())
  }

  /** A redirect target that can leave the site: not a path on our own origin. */
  private leavesSite(n: Node | undefined): boolean {
    if (!n) return false
    const lead = literalLead(n)
    if (!lead) return true
    return !(lead.startsWith("/") && !lead.startsWith("//") && !lead.startsWith("/\\")) && !/^\?|^#/.test(lead) && !/^https?:\/\/[^/$]/.test(lead)
  }

  sink(kind: Kind, v: Value, at: Node, label: string) {
    const line = lineOf(at)
    for (const f of v) {
      if (f.safe.has(kind)) continue
      // A browser source only matters for browser sinks; the server never sees location.hash.
      if (f.client && !(kind === "xss" || kind === "redirect" || kind === "code")) continue
      // The page's own URL, whole (request.url, location.href, req.path): forwarding or rebuilding it
      // stays on our site / our upstream. Only a parameter taken out of it chooses a target.
      if ((kind === "redirect" || kind === "ssrf") && WHOLE_URL.test(f.src) && !f.steps.some((s) => /\.get\(\)$|\.getAll\(\)$|\[\]$/.test(s.text))) continue
      this.project.report({ kind, file: this.file, line, sink: label, fact: { ...f, steps: [...f.steps, { line, text: label, file: this.file }] }, guarded: guardedNear(this.content, line, f.src, kind, f.steps[0]?.file === this.file ? f.steps[0].line : undefined) })
    }
  }
}

/** A check just above the sink on the same value: allowlist, prefix check, path containment, host check. */
export function guardedNear(content: string, line: number, src: string, kind: Kind, from?: number): boolean {
  // Up to 40 lines: handlers validate first and use the value further down (thelounge's name regex).
  // From where the value was read (same file, up to 200 lines), else the 40 lines above.
  const start = from && from <= line && line - from <= 200 ? from - 1 : Math.max(0, line - 41)
  const window = content.split(/\r?\n/).slice(start, line).join("\n")
  const key = src.split(".").pop()?.replace(/\(.*$/, "") ?? ""
  // `if (typeof req.body.id !== 'string')`: an operator object cannot get past a type check.
  if (kind === "nosql" && key && new RegExp(`typeof\\s+[\\w.]*\\b${key.replace(/[^\w]/g, "")}\\b\\s*!==?\\s*['"]string`).test(window)) return true
  if ((kind === "file") && /\.startsWith\s*\(|path\.relative\s*\(|includes\s*\(\s*['"]\.\.['"]|isPathInside|isSubPath|realpath/.test(window)) return true
  if (kind === "redirect" && /\.startsWith\s*\(\s*['"]\/|allowed\w*\.(?:includes|has)\s*\(|new URL\([^)]*\)\.(?:host|origin)\s*[!=]==/.test(window)) return true
  // A lookup in a known list: games.find((g) => g.filename === remixId).
  if (key && key.length > 2 && new RegExp(`\\.(?:find|some|findIndex|filter)\\([^)]*===\\s*${key.replace(/[^\w]/g, "")}\\b`).test(window)) return true
  if (key && key.length > 2 && new RegExp(`(?:includes|has|indexOf)\\s*\\(\\s*[\\w.]*\\b${key.replace(/[^\w]/g, "")}\\b|\\b${key.replace(/[^\w]/g, "")}\\b[^\\n]*\\.test\\(|\\.test\\([^)]*\\b${key.replace(/[^\w]/g, "")}\\b`).test(window)) return true
  return false
}

function flowOf(f: Finding): FlowStep[] {
  const steps = f.fact.steps
  return steps.map((s, i) => ({
    role: i === 0 ? "source" : i === steps.length - 1 ? "sink" : "step",
    text: s.text,
    ...(s.file ? { file: s.file } : {}),
    ...(s.line ? { line: s.line } : {}),
  }))
}

export const jsTaintScanner: Scanner = {
  id: "js-taint",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const project = new Project()
    const files: { file: string; content: string; ast: Node }[] = []
    for (const file of ctx.files) {
      const norm = file.replace(/\\/g, "/")
      if (!JS_FILE.test(norm) || SKIP_PATH.test(norm)) continue
      if (files.length >= MAX_FILES) break
      const size = await ctx.fileSize?.(file)
      if (size != null && size > MAX_BYTES) continue
      const content = await ctx.readFile(file)
      if (!content || content.length > MAX_BYTES) continue
      // Only files that can see a request, a URL or a message are roots; the rest are indexed for calls.
      const ast = parseSource(content, norm)
      if (!ast) continue
      index(project, ast, norm, content)
      files.push({ file: norm, content, ast })
    }
    const ROOT = /\b(?:req|request|ctx|event)\b|location\.|document\.(?:URL|referrer|write)|searchParams|useSearchParams|addEventListener\s*\(\s*['"]message|innerHTML|dangerouslySetInnerHTML|\.snapshot\.|bypassSecurityTrust/
    for (const f of files) {
      if (project.work > MAX_WORK) break
      if (!ROOT.test(f.content)) continue
      const program = f.ast.program as Node
      const c = new Ctx(project, f.file, f.content, 0, new Set())
      c.fn({ type: "Program", params: [], body: { type: "BlockStatement", body: program?.body ?? [] } } as Node, [], new Map())
    }

    const issues: Issue[] = []
    const byId = new Map<string, Issue>()
    for (const f of project.findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      const rule = RULES[f.kind]
      const id = `${rule.id}-${f.file}:${f.line}`
      const flow = flowOf(f)
      const existing = byId.get(id)
      if (existing) {
        const key = (fl: FlowStep[]) => fl.map((x) => `${x.file}:${x.line}`).join(">")
        if (key(flow) !== key(existing.flow ?? []) && (existing.altFlows?.length ?? 0) < 5 && !(existing.altFlows ?? []).some((a) => key(a) === key(flow)))
          existing.altFlows = [...(existing.altFlows ?? []), flow]
        continue
      }
      if (issues.length >= MAX_FINDINGS) break
      const crossFile = f.fact.steps.some((s) => s.file !== f.file)
      let confidence: Issue["confidence"] = f.guarded ? "low" : crossFile ? "medium" : "high"
      // Headers and cookies are set by the attacker in their own request: reflected XSS or a redirect from them needs another bug.
      if ((f.kind === "xss" || f.kind === "redirect") && /\.(?:headers|cookies|signedCookies)\b|\.(?:get|header)\(/.test(f.fact.src) && confidence !== "low") confidence = "low"
      let ageDays = 0
      try { ageDays = await ctx.git.blameAgeDays(f.file, f.line) } catch { /* blame unavailable */ }
      const line = files.find((x) => x.file === f.file)?.content.split(/\r?\n/)[f.line - 1]?.trim().slice(0, 200)
      const trace = f.fact.steps.map((s) => `${s.text} (${s.file === f.file ? `line ${s.line}` : `${s.file}:${s.line}`})`).join(" → ")
      const issue: Issue = {
        id, category: "security", severity: rule.severity, title: rule.title, location: `${f.file}:${f.line}`, ageDays,
        detail: `${rule.detail} Data flow: ${trace}.`, ...(line ? { evidence: line } : {}), rule: rule.id, confidence, flow,
      }
      byId.set(id, issue)
      issues.push(issue)
    }
    return issues
  },
}
