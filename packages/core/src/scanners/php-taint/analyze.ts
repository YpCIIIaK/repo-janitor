/**
 * Taint analysis for PHP over a real AST (php-parser).
 *
 * A value is a list of facts. A fact is either request data (`src`) or, while a
 * function body is summarised, "whatever the caller passed as parameter i"
 * (`param`). Facts collect the sink kinds they were made safe for and a short
 * trace. Control flow: statements in order; both arms of if/switch/try are
 * analysed and merged; an arm that always exits does not reach the code after
 * it, so `if (!ctype_digit($id)) die();` validates `$id` afterwards. Loops run
 * twice. Functions and methods of the whole project get summaries: what their
 * parameters reach (sinks, return value) and which request data they return,
 * so wrappers like `function param($k) { return $_GET[$k]; }` are sources and
 * `function run($sql) { mysqli_query($c, $sql); }` is a sink.
 *
 * Calls to unknown functions and methods return clean values: precision first.
 */
import { Engine } from "php-parser"
/** Forward-slash path helpers (the core also runs in the browser: no node:path). */
const posix = {
  dirname(p: string): string {
    const i = p.lastIndexOf("/")
    return i < 0 ? "." : i === 0 ? "/" : p.slice(0, i)
  },
  normalize(p: string): string {
    const out: string[] = []
    for (const part of p.split("/")) {
      if (!part || part === ".") continue
      if (part === "..") {
        if (out.length && out[out.length - 1] !== "..") out.pop()
        else out.push("..")
      } else out.push(part)
    }
    return out.join("/") || "."
  },
  join(...parts: string[]): string {
    return posix.normalize(parts.filter(Boolean).join("/"))
  },
}
import {
  ALL_SAFE, CLEAN_FUNCTIONS, CLEAN_REQUEST_METHODS, DB_RECEIVER, FUNCTION_SINKS, PASSTHROUGH, REQUEST_RECEIVER, SANITIZERS, SOURCE_FUNCTIONS,
  SOURCE_METHODS, SQL_METHOD_NEEDS_DB, SQL_METHODS, SQL_TEXT, SUPERGLOBALS, TAINTED_SERVER, VALIDATORS,
  type SafeKind, type SinkKind,
} from "./model"

// php-parser has no bundled types worth using; the AST is walked structurally.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any

export interface Step {
  line: number
  text: string
  file?: string
}

interface Fact {
  src?: string
  param?: number
  safe: Set<SafeKind>
  steps: Step[]
  /** Evidence is weaker than a direct request→sink flow (escaping used outside quotes, heuristics). */
  weak: boolean
}

type Value = Fact[]
type Env = Map<string, Value>

export interface Finding {
  kind: SinkKind
  file: string
  line: number
  sink: string
  source: string
  steps: Step[]
  weak: boolean
  /** Other paths into the same sink, each from a different origin (at most MAX_ALT). */
  alt?: Finding[]
}

const MAX_ALT = 5
/**
 * A path's identity: its source and every located step. Long paths keep only their
 * last steps, which several origins share (DVWA's low/medium/high.php all end in
 * index.php → dvwaHtmlEcho), so the first located step alone cannot tell them apart.
 */
const originOf = (f: Finding) => `${f.source}|${f.steps.filter((x) => x.line).map((x) => `${x.file ?? f.file}:${x.line}`).join(">")}`

interface SinkUse {
  param: number
  kind: SinkKind
  line: number
  file: string
  sink: string
  steps: Step[]
  safe: Set<SafeKind>
  weak: boolean
}

interface Summary {
  /** Facts the function returns: request data, or `param` facts for pass-through. */
  returns: Value
  /** Parameters that reach a sink inside the function. */
  sinks: SinkUse[]
}

interface FnDef {
  node: Node
  cls: string
  /** Shortcode callback: its $atts / $content come from post authors (contributor and up). */
  shortcode?: boolean
  /** REST route callback: its first parameter is the request. */
  rest?: boolean
  file: string
  content: string
  params: string[]
  summary?: Summary
  busy?: boolean
}

const MAX_FACTS = 6
const MAX_STEPS = 8

const parser = new Engine({
  parser: { php8: true, suppressErrors: true, extractDoc: false },
  ast: { withPositions: true, withSource: false },
  lexer: { short_tags: true, asp_tags: false },
})

export function parsePhp(content: string, file: string): Node | null {
  try {
    return parser.parseCode(content, file)
  } catch {
    return null
  }
}

const lineOf = (n: Node): number => n?.loc?.start?.line ?? 0
const lower = (s: Node) => (typeof s === "string" ? s : typeof s?.name === "string" ? s.name : "").toLowerCase().replace(/^\\/, "")

function nameOf(n: Node): string {
  if (!n) return ""
  if (typeof n === "string") return n
  if (n.kind === "name" || n.kind === "identifier") return String(n.name ?? "")
  return ""
}

function merge(...vals: Value[]): Value {
  const out: Value = []
  const seen = new Set<string>()
  for (const v of vals) {
    for (const f of v) {
      // Safe for every sink: carries nothing, and would only take a slot from a live fact
      // (DVWA's guestbook: the escaped branch's rows crowded out medium.php's stored name).
      if (f.safe.size >= ALL_SAFE.length && ALL_SAFE.every((k) => f.safe.has(k))) continue
      // The file a path starts in is part of its identity: the same $_GET key read in
      // low.php and in high.php are two places to fix, not one (bounded by MAX_FACTS).
      // Steps inside the current file carry no file name, so the first steps themselves identify the start.
      const from = f.steps.slice(0, 2).map((x) => `${x.file ?? ""}:${x.line}:${x.text}`).join(">")
      const key = `${f.src ?? ""}|${f.param ?? ""}|${[...f.safe].sort().join(",")}|${f.weak}|${from}`
      if (seen.has(key)) continue
      seen.add(key)
      out.push(f)
      if (out.length >= MAX_FACTS) return out
    }
  }
  return out
}

function withStep(v: Value, step: Step): Value {
  return v.map((f) => (f.steps.length >= MAX_STEPS || f.steps.at(-1)?.text === step.text && f.steps.at(-1)?.line === step.line ? f : { ...f, steps: [...f.steps, step] }))
}

function makeSafe(v: Value, kinds: readonly SafeKind[]): Value {
  if (!kinds.length) return v
  return v.map((f) => ({ ...f, safe: new Set([...f.safe, ...kinds]) }))
}

/** Env key for `$a`, `$a['k']`, `$a[0]`, `$this->p`; null when the key is not literal. */
function keyOf(n: Node): string | null {
  if (!n) return null
  if (n.kind === "variable" && typeof n.name === "string") return n.name.toLowerCase()
  if (n.kind === "offsetlookup" && (n.offset?.kind === "string" || n.offset?.kind === "number")) {
    const base = keyOf(n.what)
    return base ? `${base}[${String(n.offset.value).toLowerCase()}]` : null
  }
  if (n.kind === "propertylookup" && (n.offset?.kind === "identifier" || n.offset?.kind === "name")) {
    const base = keyOf(n.what)
    return base ? `${base}->${String(n.offset.name).toLowerCase()}` : null
  }
  return null
}

/** Parts of a `.` chain, left to right, iteratively. */
function flattenConcat(n: Node): Node[] {
  const out: Node[] = []
  const stack: Node[] = [n]
  while (stack.length) {
    const cur = stack.pop()
    if (cur?.kind === "bin" && cur.type === ".") {
      stack.push(cur.right)
      stack.push(cur.left)
    } else out.push(cur)
  }
  return out
}

function cloneEnv(env: Env): Env {
  return new Map(env)
}

function mergeEnvs(envs: Env[]): Env {
  const live = envs.filter(Boolean)
  if (!live.length) return new Map()
  // Branches share every value they did not assign: only the keys that differ need merging.
  // Merging all of them made each if/else cost the whole env (Dolibarr: thousands of keys
  // from main.inc.php × hundreds of branches per page, past the 15-minute limit).
  const out = new Map<string, Value>(live[0])
  for (const env of live.slice(1)) {
    for (const [k, v] of env) {
      const cur = out.get(k)
      if (cur === v || !v.length) continue
      out.set(k, cur?.length ? merge(cur, v) : v)
    }
  }
  return out
}

/** Stable text for a receiver such as `$this->db` or `DB` (for heuristics only). */
function exprText(n: Node): string {
  if (!n) return ""
  switch (n.kind) {
    case "variable":
      return typeof n.name === "string" ? `$${n.name}` : "$$"
    case "propertylookup":
    case "nullsafepropertylookup":
      return `${exprText(n.what)}->${nameOf(n.offset) || "?"}`
    case "staticlookup":
      return `${exprText(n.what)}::${nameOf(n.offset) || (n.offset?.kind === "variable" ? `$${n.offset.name}` : "?")}`
    case "name":
      return String(n.name)
    case "selfreference":
      return "self"
    case "staticreference":
      return "static"
    case "parentreference":
      return "parent"
    case "call":
      return `${exprText(n.what)}()`
    case "offsetlookup":
      return `${exprText(n.what)}[]`
    default:
      return n.kind
  }
}

/** Literal text of a string expression, with request parts left out. */
function literalText(n: Node): string {
  if (!n) return ""
  if (n.kind === "string") return String(n.value)
  if (n.kind === "encapsed") return (n.value ?? []).map((p: Node) => (p.expression?.kind === "string" ? p.expression.value : " ")).join("")
  if (n.kind === "bin" && n.type === ".") return literalText(n.left) + " " + literalText(n.right)
  return ""
}

/** Literal text a string expression starts with. */
function leadingLiteral(n: Node): string {
  if (!n) return ""
  if (n.kind === "string") return String(n.value)
  if (n.kind === "encapsed") {
    const first = n.value?.[0]
    return first?.expression?.kind === "string" ? String(first.expression.value) : ""
  }
  if (n.kind === "bin" && n.type === ".") return leadingLiteral(n.left)
  return ""
}

export class Project {
  /** Request data written to a table: table → the facts that reached the INSERT/UPDATE (pass 1). */
  readonly storedWrites = new Map<string, Fact[]>()
  /** Seeded for pass 2: reading these tables yields what pass 1 saw written into them. */
  storedSources?: Map<string, Fact[]>
  private fns = new Map<string, FnDef[]>()
  private methods = new Map<string, FnDef[]>()
  readonly findings: Finding[] = []
  private reported = new Map<string, number>()
  private files: { file: string; content: string; ast: Node }[] = []
  private byPath = new Map<string, { file: string; content: string; ast: Node }>()
  private sessionKeys = new Map<string, { src: string; safe: Set<SafeKind>; weak: boolean; file: string; line: number }>()

  private constants = new Map<string, Fact>()
  private fields = new Map<string, Fact>()

  /** define('NAME', <request data>) anywhere in the project. */
  taintConstant(name: string, f: Fact) {
    if (!this.constants.has(name)) this.constants.set(name, f)
  }

  private defineSites = new Map<string, number>()

  /** A constant is request data project-wide only when it is defined in exactly one place. */
  constant(name: string): Fact | undefined {
    const f = this.constants.get(name)
    if (!f) return undefined
    let n = this.defineSites.get(name)
    if (n === undefined) {
      const re = new RegExp(`\\bdefine\\s*\\(\\s*['"]${name.replace(/[^\w]/g, "")}['"]`, "g")
      n = this.files.reduce((sum, f) => sum + (f.content.match(re)?.length ?? 0), 0)
      this.defineSites.set(name, n)
    }
    return n === 1 ? f : undefined
  }

  /** `$this->p = <request data>` / `self::$p = ...` in any method of the class. */
  taintField(cls: string, prop: string, f: Fact) {
    const key = `${cls}::${prop}`
    if (!this.fields.has(key)) this.fields.set(key, f)
  }

  field(cls: string, prop: string): Fact | undefined {
    return this.fields.get(`${cls}::${prop}`)
  }

  /** Whether another pass is needed because cross-scope stores changed. */
  storesSize() {
    return this.sessionKeys.size + this.constants.size + this.fields.size
  }

  taintSession(key: string, f: Fact, file: string, line: number) {
    if (!this.sessionKeys.has(key)) this.sessionKeys.set(key, { src: f.src!, safe: f.safe, weak: f.weak, file, line })
  }

  session(key: string) {
    return this.sessionKeys.get(key)
  }

  /** Project files an include target can name (literal parts, wildcard elsewhere). */
  resolveInclude(from: string, target: Node): { file: string; content: string; ast: Node }[] {
    const dir = posix.dirname(from)
    const parts: (string | null)[] = []
    const walk = (n: Node) => {
      if (!n) return parts.push(null)
      if (n.kind === "string") parts.push(String(n.value))
      else if (n.kind === "bin" && n.type === ".") { walk(n.left); walk(n.right) }
      else if (n.kind === "encapsed") for (const p of n.value ?? []) walk(p.expression ?? p)
      else if (n.kind === "magic" && /__DIR__/i.test(String(n.value ?? n.raw))) parts.push(`${dir}/`)
      else if (n.kind === "call" && lower(nameOf(n.what)) === "dirname" && n.arguments?.[0]?.kind === "magic") parts.push(`${dir}/`)
      else if (n.kind === "parenthesis") walk(n.inner)
      else parts.push(null)
    }
    walk(target)
    const lits = parts.filter((p): p is string => p !== null).join("")
    if (lits.replace(/[./\\]/g, "").length < 3) return []
    // Fully literal: resolve against the including file's directory, then the root.
    if (parts.every((p) => p !== null)) {
      const raw = parts.join("").replace(/\\/g, "/")
      for (const c of [posix.normalize(raw.startsWith("/") ? raw.slice(1) : posix.join(dir, raw)), posix.normalize(raw.replace(/^\.?\//, ""))]) {
        const hit = this.byPath.get(c)
        if (hit) return [hit]
      }
      const tail = raw.replace(/^(?:\.\.?\/)+/, "")
      const hits = [...this.byPath.values()].filter((f) => f.file === tail || f.file.endsWith(`/${tail}`))
      return hits.length === 1 ? hits : []
    }
    const esc = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const re = new RegExp(`(?:^|/)${parts.map((p) => (p === null ? "[^]*" : esc(p.replace(/\\/g, "/").replace(/^(?:\.\.?\/)+/, "")))).join("")}$`)
    const hits = [...this.byPath.values()].filter((f) => re.test(f.file))
    return hits.length >= 1 && hits.length <= 6 ? hits : []
  }

  add(file: string, content: string): boolean {
    const ast = parsePhp(content, file)
    if (!ast) return false
    this.files.push({ file, content, ast })
    this.byPath.set(file, { file, content, ast })
    this.index(ast, file, content, "")
    return true
  }

  private index(node: Node, file: string, content: string, cls: string) {
    if (!node || typeof node !== "object") return
    if (Array.isArray(node)) {
      for (const c of node) this.index(c, file, content, cls)
      return
    }
    if (node.kind === "function") {
      const def: FnDef = { node, cls: "", file, content, params: (node.arguments ?? []).map((p: Node) => lower(p.name)) }
      const key = lower(node.name)
      this.fns.set(key, [...(this.fns.get(key) ?? []), def])
    } else if (node.kind === "method") {
      const def: FnDef = { node, cls, file, content, params: (node.arguments ?? []).map((p: Node) => lower(p.name)) }
      const key = lower(node.name)
      this.methods.set(key, [...(this.methods.get(key) ?? []), def])
    }
    for (const k of ["children", "body"]) {
      const c = node[k]
      if (c && typeof c === "object") this.index(c, file, content, node.kind === "class" ? lower(node.name) : cls)
    }
  }

  /** Marks add_shortcode callbacks so their attributes count as (author-level) input. */
  private markShortcodes() {
    for (const { file, content, ast } of this.files) {
      if (!content.includes("add_shortcode") && !content.includes("register_rest_route")) continue
      const stack: Node[] = [ast]
      while (stack.length) {
        const n = stack.pop()
        if (!n || typeof n !== "object") continue
        if (Array.isArray(n)) { stack.push(...n); continue }
        if (n.kind === "call" && n.what?.kind === "name" && lower(n.what.name) === "add_shortcode") {
          for (const h of this.resolveCallback(n.arguments?.[1], file)) {
            for (const defs of [...this.fns.values(), ...this.methods.values()]) for (const d of defs) if (d.node === h.node) d.shortcode = true
          }
        }
        if (n.kind === "call" && n.what?.kind === "name" && lower(n.what.name) === "register_rest_route") {
          const opts = n.arguments?.[2]
          const routes: Node[] = opts?.kind === "array" && opts.items?.[0]?.kind === "entry" && opts.items[0].key == null ? opts.items.map((i: Node) => i.value) : [opts]
          for (const r of routes) {
            const cb = r?.kind === "array" ? r.items?.find((i: Node) => i?.kind === "entry" && i.key?.kind === "string" && i.key.value === "callback")?.value : null
            for (const h of this.resolveCallback(cb, file)) {
              for (const defs of [...this.fns.values(), ...this.methods.values()]) for (const d of defs) if (d.node === h.node) d.rest = true
            }
          }
        }
        for (const k of Object.keys(n)) if (k !== "loc" && n[k] && typeof n[k] === "object") stack.push(n[k])
      }
    }
  }

  run() {
    this.markShortcodes()
    // Request data stored in the session, a constant or an object field is read back
    // elsewhere: run again while those stores keep growing (at most three passes).
    let before = -1
    for (let i = 0; i < 3 && this.storesSize() !== before; i++) {
      before = this.storesSize()
      if (i) for (const defs of [...this.fns.values(), ...this.methods.values()]) for (const d of defs) d.summary = undefined
      this.pass()
    }
  }

  /** Files the analysis gave up on (too deep / malformed). */
  readonly failed = new Set<string>()

  private pass() {
    for (const { file, content, ast } of this.files) {
      try {
        const ctx = new Ctx(this, file, content, null)
        ctx.block(ast.children ?? [], new Map())
      } catch {
        this.failed.add(file)
      }
    }
    // Function bodies run with request data in their parameters only via callers;
    // still analyse each body once for request data it reads itself.
    for (const defs of [...this.fns.values(), ...this.methods.values()]) {
      for (const d of defs) {
        try {
          this.summary(d)
        } catch {
          d.busy = false
          d.summary = { returns: [], sinks: [] }
          this.failed.add(d.file)
        }
      }
    }
  }

  report(f: Finding) {
    const key = `${f.kind}|${f.file}|${f.line}`
    const at = this.reported.get(key)
    if (at !== undefined) {
      const kept = this.findings[at]
      // Keep the strongest evidence for a place: a direct request flow beats a header/cookie one.
      if (kept.weak && !f.weak) { this.findings[at] = { ...f, alt: kept.alt }; return }
      // Other origins into the same sink are separate places to fix (DVWA's low/medium/high.php).
      const seen = [kept, ...(kept.alt ?? [])].map(originOf)
      if (!seen.includes(originOf(f)) && (kept.alt?.length ?? 0) < MAX_ALT) kept.alt = [...(kept.alt ?? []), { ...f, alt: undefined }]
      return
    }
    this.reported.set(key, this.findings.length)
    this.findings.push(f)
  }

  allFiles() {
    return this.files
  }

  /** Every project function/method, for reachability. */
  allDefs(): FnDef[] {
    return [...this.fns.values(), ...this.methods.values()].flat()
  }

  /** The innermost function or method containing file:line. */
  defAt(file: string, line: number): FnDef | null {
    let best: FnDef | null = null
    for (const d of this.allDefs()) {
      if (d.file !== file) continue
      const a = d.node?.loc?.start?.line ?? 0, b = d.node?.loc?.end?.line ?? 0
      if (line >= a && line <= b && (!best || a >= (best.node.loc.start.line ?? 0))) best = d
    }
    return best
  }

  lookupDef(name: string, method: boolean): FnDef | null {
    return this.lookup(name, method)
  }

  /** Handlers named by a hook callback: 'fn', 'Cls::m', [$this, 'm'], [Cls::class, 'm'], closures. */
  resolveCallback(cb: Node, file: string): { node: Node; file: string; content: string; label: string }[] {
    if (!cb) return []
    const at = this.byPath.get(file)
    if (cb.kind === "closure" || cb.kind === "arrowfunc") return at ? [{ node: cb, file, content: at.content, label: "closure" }] : []
    const pick = (defs: FnDef[] | undefined, cls: string, label: string) => {
      if (!defs?.length) return []
      let chosen = defs.length === 1 ? defs : defs.filter((d) => cls && d.cls === cls)
      if (!chosen.length) chosen = defs.filter((d) => d.file === file)
      return chosen.map((d) => ({ node: d.node, file: d.file, content: d.content, label }))
    }
    if (cb.kind === "string") {
      const v = String(cb.value)
      if (v.includes("::")) {
        const [c, m] = v.split("::")
        return pick(this.methods.get(m.toLowerCase()), c.split("\\").pop()!.toLowerCase(), v)
      }
      return pick(this.fns.get(v.toLowerCase().replace(/^\\/, "")), "", v)
    }
    if (cb.kind === "array" && cb.items?.length === 2) {
      const [o, m] = cb.items.map((i: Node) => (i?.kind === "entry" ? i.value : i))
      if (m?.kind !== "string") return []
      const cls = o?.kind === "string" ? String(o.value) : o?.kind === "staticlookup" ? String(o.what?.name ?? "") : o?.kind === "new" ? String(o.what?.name ?? "") : ""
      return pick(this.methods.get(String(m.value).toLowerCase()), cls.split("\\").pop()!.toLowerCase(), `${cls || exprText(o)}::${m.value}`)
    }
    return []
  }

  /** Callee for a plain function call or a method call by name; null when unknown or ambiguous. */
  lookup(name: string, method: boolean): FnDef | null {
    const defs = (method ? this.methods : this.fns).get(name)
    if (!defs || defs.length !== 1) return null
    return defs[0]
  }

  summary(def: FnDef): Summary | null {
    if (def.summary) return def.summary
    if (def.busy) return null
    def.busy = true
    const ctx = new Ctx(this, def.file, def.content, { returns: [], sinks: [] })
    ctx.cls = def.cls
    const env: Env = new Map()
    def.params.forEach((p, i) => {
      const param: Fact = { param: i, safe: new Set(), steps: [{ line: lineOf(def.node), text: `$${p}`, file: def.file }], weak: false }
      const author: Fact[] = def.shortcode && i < 2 ? [{ src: `shortcode ${i ? "content" : "attributes"} ($${p})`, safe: new Set(), steps: [{ line: lineOf(def.node), text: `$${p}`, file: def.file }], weak: true }]
        : def.rest && i === 0 ? [{ src: `REST request ($${p})`, safe: new Set(), steps: [{ line: lineOf(def.node), text: `$${p}`, file: def.file }], weak: false }] : []
      env.set(p, [param, ...author])
    })
    ctx.block(def.node.body?.children ?? (def.node.body ? [def.node.body] : []), env)
    def.summary = ctx.summary!
    def.busy = false
    return def.summary
  }
}

class Ctx {
  /** Set when the file declares a JSON/non-HTML response: echo is not an HTML sink there. */
  private jsonResponse: boolean
  /** A capability or reset-key check ran earlier in this flow. */
  private guarded = false
  /** Class whose method is being analysed ("" outside classes). */
  cls = ""
  /** `$real = realpath($path)`: validating $real validates $path (canonical form of the same value). */
  private aliases = new Map<string, string>()
  /** Variables last assigned a string with a literal prefix. */
  private prefixedVars = new Map<string, boolean>()

  constructor(
    private project: Project,
    private file: string,
    private content: string,
    public summary: Summary | null,
    private includeDepth = 0,
    private including: Set<string> = new Set(),
  ) {
    this.jsonResponse = /content-type\s*:\s*(?:application\/(?:json|xml|octet-stream)|text\/(?:plain|csv|xml))/i.test(content) ||
      /->json\s*\(|wp_send_json|JsonResponse/.test(content)
  }

  /** Runs statements; returns the env after them, or null when every path exits. */
  block(nodes: Node[], env: Env): Env | null {
    let cur: Env | null = env
    for (const n of nodes) {
      if (!cur) return null
      cur = this.stmt(n, cur)
    }
    return cur
  }

  private body(n: Node, env: Env): Env | null {
    if (!n) return env
    if (n.kind === "block") return this.block(n.children ?? [], env)
    return this.stmt(n, env)
  }

  private stmt(n: Node, env: Env): Env | null {
    if (!n) return env
    switch (n.kind) {
      case "expressionstatement":
        this.expr(n.expression, env)
        return this.exits(n.expression) ? null : env
      case "echo":
      case "print":
        for (const e of n.expressions ?? (n.expression ? [n.expression] : [])) this.sink("xss", this.expr(e, env), e, n, "echo")
        return env
      case "inline":
        return env
      case "block":
        return this.block(n.children ?? [], env)
      case "if":
        return this.ifStmt(n, env)
      case "switch": {
        this.expr(n.test, env)
        const arms: (Env | null)[] = []
        let fall: Env | null = null
        for (const c of n.body?.children ?? []) {
          const start: Env = fall ? mergeEnvs([fall, env]) : cloneEnv(env)
          fall = this.body(c.body, start)
          arms.push(fall)
        }
        const hasDefault = (n.body?.children ?? []).some((c: Node) => c.test == null)
        const out = arms.filter((e): e is Env => !!e)
        if (!hasDefault) out.push(env)
        return out.length ? mergeEnvs(out) : null
      }
      case "match":
        this.expr(n, env)
        return env
      case "for":
      case "while":
      case "do": {
        for (const e of [n.init, n.test, n.increment].flat().filter(Boolean)) this.expr(e, env)
        if (n.test && !Array.isArray(n.test)) this.expr(n.test, env)
        let cur = cloneEnv(env)
        for (let i = 0; i < 2; i++) {
          const after = this.body(n.body, cloneEnv(cur))
          cur = mergeEnvs([cur, after ?? cur])
        }
        return cur
      }
      case "foreach": {
        const src = this.expr(n.source, env)
        let cur = cloneEnv(env)
        const line = lineOf(n)
        if (n.key) this.assignTo(n.key, withStep(src, { line, text: `foreach key`, file: this.file }), cur)
        if (n.value) this.assignTo(n.value, withStep(src, { line, text: `foreach value`, file: this.file }), cur)
        for (let i = 0; i < 2; i++) {
          const after = this.body(n.body, cloneEnv(cur))
          cur = mergeEnvs([cur, after ?? cur])
        }
        return cur
      }
      case "try": {
        const after = this.body(n.body, cloneEnv(env))
        const arms: Env[] = after ? [after] : []
        for (const c of n.catches ?? []) {
          const e = this.body(c.body, mergeEnvs([env, after ?? env]))
          if (e) arms.push(e)
        }
        let out: Env | null = arms.length ? mergeEnvs(arms) : null
        if (n.always) out = this.body(n.always, out ?? cloneEnv(env))
        return out
      }
      case "return": {
        const v = n.expr ? this.expr(n.expr, env) : []
        if (this.summary && v.length) this.summary.returns = merge(this.summary.returns, withStep(v, { line: lineOf(n), text: "return", file: this.file }))
        return null
      }
      case "throw":
        this.expr(n.what, env)
        return null
      case "global":
      case "static":
        for (const item of n.items ?? n.variables ?? []) if (item?.kind === "staticvariable" && item.defaultValue) this.assignTo(item.variable, this.expr(item.defaultValue, env), env)
        return env
      case "unset":
        for (const v of n.variables ?? []) if (v.kind === "variable" && typeof v.name === "string") env.delete(v.name.toLowerCase())
        return env
      case "function":
      case "class":
      case "interface":
      case "trait":
      case "enum":
      case "namespace":
        if (n.kind === "namespace") return this.block(n.children ?? [], env)
        return env
      case "declare":
        return this.block(n.children ?? [], env)
      case "label":
      case "goto":
      case "break":
      case "continue":
      case "noop":
      case "usegroup":
      case "constantstatement":
      case "classconstant":
        return env
      default:
        if (n.kind === "exit") {
          this.expr(n, env)
          return null
        }
        if (n.expression) this.expr(n.expression, env)
        return env
    }
  }

  private exits(e: Node): boolean {
    return e?.kind === "exit" || e?.kind === "throw" || (e?.kind === "call" && ["die", "exit", "wp_die", "abort", "trigger_error"].includes(lower(nameOf(e.what))) && lower(nameOf(e.what)) !== "trigger_error")
  }

  private ifStmt(n: Node, env: Env): Env | null {
    this.expr(n.test, env)
    const { whenTrue, whenFalse } = this.guards(n.test)
    const thenEnv = this.validate(cloneEnv(env), whenTrue)
    const elseEnv = this.validate(cloneEnv(env), whenFalse)
    const a = this.body(n.body, thenEnv)
    const b = n.alternate ? this.body(n.alternate, elseEnv) : elseEnv
    if (!a && !b) return null
    if (!a) return b
    if (!b) return a
    return mergeEnvs([a, b])
  }

  /** Variables a condition proves safe when it holds (and when it fails). */
  private guards(test: Node): { whenTrue: string[]; whenFalse: string[] } {
    if (!test) return { whenTrue: [], whenFalse: [] }
    if (test.kind === "unary" && test.type === "!") {
      const g = this.guards(test.what)
      return { whenTrue: g.whenFalse, whenFalse: g.whenTrue }
    }
    if (test.kind === "bin" && (test.type === "&&" || test.type === "and")) {
      const l = this.guards(test.left), r = this.guards(test.right)
      // `$x !== 'a' && $x !== 'b'` is false only when $x is one of them.
      return { whenTrue: [...l.whenTrue, ...r.whenTrue], whenFalse: l.whenFalse.filter((k) => r.whenFalse.includes(k)) }
    }
    if (test.kind === "bin" && (test.type === "||" || test.type === "or")) {
      const l = this.guards(test.left), r = this.guards(test.right)
      // `$ext == 'jpg' || $ext == 'png'`: pinned whichever side holds.
      return { whenTrue: l.whenTrue.filter((k) => r.whenTrue.includes(k)), whenFalse: [...l.whenFalse, ...r.whenFalse] }
    }
    if (test.kind === "bin" && ["===", "==", "!==", "!=", "<>"].includes(test.type)) {
      const negated = test.type.startsWith("!") || test.type === "<>"
      const [call, other] = test.left?.kind === "call" ? [test.left, test.right] : [test.right, test.left]
      const isLit = (s: Node) => ["string", "number", "boolean", "nullkeyword"].includes(s?.kind)
      const pinned = isLit(test.left) ? keyOf(this.unwrap(test.right)) : isLit(test.right) ? keyOf(this.unwrap(test.left)) : null
      const pinnedLit = isLit(test.left) ? test.left : test.right
      if (pinned && !(pinnedLit?.kind === "boolean" || pinnedLit?.kind === "nullkeyword" || (pinnedLit?.kind === "string" && pinnedLit.value === ""))) {
        return negated ? { whenTrue: [], whenFalse: [pinned] } : { whenTrue: [pinned], whenFalse: [] }
      }
      // Path containment: strpos(realpath($p), $base) === 0 keeps $p inside $base.
      if (call?.kind === "call" && /^(?:strpos|stripos|mb_strpos)$/.test(lower(nameOf(call.what))) && other?.kind === "number" && Number(other.value) === 0) {
        const k = keyOf(this.unwrap(call.arguments?.[0]))
        if (k) return negated ? { whenTrue: [], whenFalse: [k] } : { whenTrue: [k], whenFalse: [] }
      }
      if (call?.kind === "call") {
        const g = this.guards(call)
        const falsy = other?.kind === "boolean" ? !other.value : other?.kind === "number" ? Number(other.value) === 0 : other?.kind === "nullkeyword"
        const positive = falsy ? negated : !negated
        return positive ? g : { whenTrue: g.whenFalse, whenFalse: g.whenTrue }
      }
      // `$x === 'literal'` pins the value.
      const v = [test.left, test.right].find((s: Node) => s?.kind === "variable")
      const lit = [test.left, test.right].find((s: Node) => ["string", "number", "boolean"].includes(s?.kind))
      if (v && lit && typeof v.name === "string") return negated ? { whenTrue: [], whenFalse: [v.name.toLowerCase()] } : { whenTrue: [v.name.toLowerCase()], whenFalse: [] }
      return { whenTrue: [], whenFalse: [] }
    }
    if (test.kind === "call" && /^(?:str_starts_with|wp_is_stream|validate_file)$/.test(lower(nameOf(test.what)))) {
      const fn = lower(nameOf(test.what))
      const k = keyOf(this.unwrap(test.arguments?.[0]))
      // validate_file() returns 0 when the path is fine: `if (validate_file($p) !== 0) die` / `if (0 === validate_file($p))`.
      if (!k) return { whenTrue: [], whenFalse: [] }
      return fn === "validate_file" ? { whenTrue: [], whenFalse: [k] } : { whenTrue: [k], whenFalse: [] }
    }
    if (test.kind === "call") {
      const fn = lower(nameOf(test.what))
      if (!VALIDATORS.has(fn)) return { whenTrue: [], whenFalse: [] }
      const arg = fn === "preg_match" ? test.arguments?.[1] : test.arguments?.[0]
      if (fn === "preg_match") {
        const pattern = literalText(test.arguments?.[0])
        // Only anchored patterns without a catch-all validate the whole value.
        if (!/^.\^/.test(pattern) || !/\$.?[a-zA-Z]*$/.test(pattern) || /\.\*|\.\+|\\S|\[\^/.test(pattern)) return { whenTrue: [], whenFalse: [] }
      }
      if (fn === "filter_var" && !/FILTER_VALIDATE_(?:INT|FLOAT|BOOL|BOOLEAN|IP)/i.test(exprText(test.arguments?.[1]) + nameOf(test.arguments?.[1]))) return { whenTrue: [], whenFalse: [] }
      const name = keyOf(this.unwrap(arg))
      return name ? { whenTrue: [name], whenFalse: [] } : { whenTrue: [], whenFalse: [] }
    }
    return { whenTrue: [], whenFalse: [] }
  }

  private validate(env: Env, names: string[]): Env {
    // A check on the canonical form ($real = realpath($path)) covers the original too.
    const all = [...names]
    for (const n of names) {
      let a = this.aliases.get(n)
      for (let i = 0; a && i < 3; i++, a = this.aliases.get(a)) all.push(a)
    }
    for (const n of all) {
      // An element is validated on its own; read it from its base when not yet tracked.
      const base = n.replace(/\[[^\]]*\]$|->[^>]*$/, "")
      const v = env.get(n) ?? (base !== n ? env.get(base) : undefined)
      if (v) env.set(n, makeSafe(v, ALL_SAFE))
      // Values derived only from the validated variable are covered too ($name = $ext . '.jpg').
      const mark = `$${n}`
      for (const [k, val] of env) {
        if (k === n || !val.length) continue
        if (val.every((f) => f.steps.some((st) => st.text.toLowerCase() === mark))) env.set(k, makeSafe(val, ALL_SAFE))
      }
    }
    return env
  }

  /** `strtolower($x)`, `trim($x)`, `(string)$x` → `$x` for guard purposes. */
  private unwrap(n: Node): Node {
    while (n) {
      if (n.kind === "call" && PASSTHROUGH.has(lower(nameOf(n.what))) && n.arguments?.length === 1) n = n.arguments[0]
      else if (n.kind === "cast" || n.kind === "parenthesis") n = n.expr ?? n.what ?? n.inner
      else break
    }
    return n
  }

  /** SQL text of a query argument: the literal itself, or the last literal assigned to the variable. */
  private sqlText(argNode: Node, at: Node): string {
    const lit = literalText(argNode)
    if (lit.trim()) return lit
    if (argNode?.kind !== "variable" || typeof argNode.name !== "string") return ""
    const end = at?.loc?.start?.offset ?? 0
    const before = this.content.slice(Math.max(0, end - 4000), end)
    const name = argNode.name.replace(/[^\w]/g, "")
    const all = [...before.matchAll(new RegExp(`\\$${name}\\s*\\.?=\\s*(["'])([\\s\\S]*?)\\1\\s*;`, "g"))]
    return all.length ? all[all.length - 1][2] : ""
  }

  /** Stored XSS, write side: request data not escaped for HTML going into a table. */
  private recordStoredWrite(v: Value, argNode: Node, at: Node) {
    const table = this.sqlText(argNode, at).match(/^\s*(?:INSERT\s+(?:IGNORE\s+)?INTO|REPLACE\s+INTO|UPDATE)\s+[`"]?(\w+)/i)?.[1]?.toLowerCase()
    if (!table) return
    for (const f of v) {
      if (!f.src || f.safe.has("xss")) continue
      const list = this.project.storedWrites.get(table) ?? []
      const put = this.step(at, `INSERT INTO ${table}`)
      // The same write is seen once per analysed call context; keep one fact per source and write site.
      const key = (x: Fact) => `${x.src}|${x.steps[x.steps.length - 1]?.file}:${x.steps[x.steps.length - 1]?.line}`
      const fact = { ...f, steps: [...f.steps, put] }
      if (list.some((x) => key(x) === key(fact))) continue
      if (list.length >= 12) return
      list.push(fact)
      this.project.storedWrites.set(table, list)
    }
  }

  /** Stored XSS, read side (pass 2): a SELECT from a table request data was written into. */
  private storedRead(argNode: Node, at: Node): Value {
    const stored = this.project.storedSources
    if (!stored?.size) return []
    const table = this.sqlText(argNode, at).match(/\bSELECT\b[\s\S]*?\bFROM\s+[`"]?(\w+)/i)?.[1]?.toLowerCase()
    const writes = table ? stored.get(table) : undefined
    if (!writes) return []
    // Only HTML output can be hurt by what comes back: every other sink treats it as clean.
    const notXss = ALL_SAFE.filter((k) => k !== "xss")
    // The source names its write site: DVWA's low, medium and high.php all store $_POST['txtName'],
    // and facts with one src collapse into one, losing two places to fix.
    return writes.map((w) => {
      const put = w.steps[w.steps.length - 1]
      return { ...w, src: `${w.src} stored in ${table} at ${put?.file ?? this.file}:${put?.line ?? 0}`, safe: new Set([...w.safe, ...notXss]), steps: [...w.steps, this.step(at, `SELECT … FROM ${table}`)] }
    })
  }

  private step(n: Node, text: string): Step {
    return { line: lineOf(n), text, file: this.file }
  }

  private assignTo(target: Node, v: Value, env: Env, append = false) {
    if (!target) return
    if (target.kind === "variable" && typeof target.name === "string") {
      const key = target.name.toLowerCase()
      this.prefixedVars.set(key, false)
      const val = withStep(v, this.step(target, `$${target.name}`))
      env.set(key, append ? merge(env.get(key) ?? [], val) : val)
    } else if (target.kind === "offsetlookup" && target.what?.kind === "variable" && String(target.what.name).toLowerCase() === "_session" && target.offset?.kind === "string") {
      const src = v.find((f) => f.src)
      if (src) this.project.taintSession(String(target.offset.value), src, this.file, lineOf(target))
    } else if (target.kind === "offsetlookup") {
      // `$a['k'] = x` keeps what $a had and adds x; `$a['k']` itself is exactly x.
      const elem = keyOf(target)
      if (elem) env.set(elem, withStep(v, this.step(target, exprText(target))))
      let base = target.what
      while (base?.kind === "offsetlookup") base = base.what
      if (base?.kind === "variable" && typeof base.name === "string") {
        const key = base.name.toLowerCase()
        env.set(key, merge(env.get(key) ?? [], withStep(v, this.step(target, `$${base.name}[]`))))
      } else if (base) this.assignTo(base, v, env, true)
    } else if (target.kind === "propertylookup" || target.kind === "nullsafepropertylookup" || target.kind === "staticlookup") {
      const owner = this.fieldOwner(target)
      const src = v.find((f) => f.src)
      if (owner && src) this.project.taintField(owner.cls, owner.prop, { ...src, steps: [...src.steps, this.step(target, exprText(target))].slice(-MAX_STEPS) })
      const key = exprText(target).toLowerCase()
      const val = withStep(v, this.step(target, exprText(target)))
      env.set(key, append ? merge(env.get(key) ?? [], val) : val)
    } else if (target.kind === "list" || target.kind === "array") {
      for (const item of target.items ?? []) this.assignTo(item?.kind === "entry" ? item.value : item, v, env)
    }
  }

  /** Request data in `n`, after evaluating any sinks inside it. */
  expr(n: Node, env: Env): Value {
    if (!n || typeof n !== "object") return []
    switch (n.kind) {
      case "variable": {
        if (typeof n.name !== "string") return this.expr(n.name, env)
        const name = n.name.toLowerCase()
        if (SUPERGLOBALS.has(name)) return [{ src: `$${n.name}`, safe: new Set(), steps: [this.step(n, `$${n.name}`)], weak: false }]
        if (name === "_server") return [{ src: "$_SERVER", safe: new Set(), steps: [this.step(n, "$_SERVER")], weak: true }]
        return env.get(name) ?? []
      }
      case "offsetlookup": {
        const base = n.what
        // $_SERVER: only the keys a client controls.
        if (base?.kind === "variable" && typeof base.name === "string" && base.name.toLowerCase() === "_server") {
          const key = n.offset?.kind === "string" ? String(n.offset.value) : ""
          return TAINTED_SERVER.test(key) ? [{ src: `$_SERVER['${key}']`, safe: new Set(), steps: [this.step(n, `$_SERVER['${key}']`)], weak: key === "HTTP_HOST" }] : []
        }
        // $_SESSION values a request stored elsewhere (second-order).
        if (base?.kind === "variable" && String(base.name).toLowerCase() === "_session" && n.offset?.kind === "string") {
          const stored = this.project.session(String(n.offset.value))
          if (stored) return [{ src: `$_SESSION['${n.offset.value}'] ← ${stored.src}`, safe: new Set(stored.safe), steps: [{ line: stored.line, text: `${stored.src} → $_SESSION['${n.offset.value}']`, file: stored.file }, this.step(n, `$_SESSION['${n.offset.value}']`)], weak: stored.weak }]
          return []
        }
        // $_FILES[...]['tmp_name'] is a server path, ['size'] / ['error'] are numbers.
        if (n.offset?.kind === "string" && /^(?:tmp_name|size|error)$/.test(String(n.offset.value)) && exprText(base).toLowerCase().startsWith("$_files")) return []
        if (base?.kind === "variable" && /^(?:request|req|wp_rest_request)$/i.test(String(base.name)) && !env.has(String(base.name).toLowerCase())) {
          const label = `$${base.name}[${n.offset?.kind === "string" ? `'${n.offset.value}'` : "…"}]`
          return [{ src: label, safe: new Set(), steps: [this.step(n, label)], weak: false }]
        }
        this.expr(n.offset, env)
        const elem = keyOf(n)
        if (elem && env.has(elem)) return env.get(elem)!
        const v = this.expr(base, env)
        if (base?.kind === "variable" && SUPERGLOBALS.has(String(base.name).toLowerCase()) && n.offset?.kind === "string") {
          const label = `$${base.name}['${n.offset.value}']`
          return v.map((f) => ({ ...f, src: label, steps: [this.step(n, label)] }))
        }
        return v
      }
      case "propertylookup":
      case "nullsafepropertylookup":
      case "staticlookup": {
        const key = exprText(n).toLowerCase()
        if (env.has(key)) return env.get(key)!
        const owner = this.fieldOwner(n)
        if (owner) {
          const stored = this.project.field(owner.cls, owner.prop)
          if (stored) return [{ ...stored, steps: [...stored.steps, this.step(n, exprText(n))].slice(-MAX_STEPS) }]
        }
        // `$obj->a` of a tainted object (`$data = (object) $_POST; $data->name`).
        if (n.kind !== "staticlookup" && n.what?.kind !== "variable" || (n.what?.kind === "variable" && n.what.name !== "this")) {
          const inner = this.expr(n.what, env)
          if (inner.length) return withStep(inner, this.step(n, exprText(n)))
        }
        // `$request->name` on a Laravel/Symfony request is input too.
        if (n.kind === "propertylookup" && /^\$(?:request|req)$/i.test(exprText(n.what)) && !/^(?:query|request|attributes|cookies|headers|files|server)$/i.test(nameOf(n.offset))) {
          return [{ src: exprText(n), safe: new Set(), steps: [this.step(n, exprText(n))], weak: true }]
        }
        return []
      }
      case "name": {
        const cname = String(n.name).replace(/^\\/, "")
        if (env.has(`#${cname}`)) return env.get(`#${cname}`)!
        const c = this.project.constant(cname)
        return c ? [{ ...c, steps: [...c.steps, this.step(n, String(n.name))].slice(-MAX_STEPS) }] : []
      }
      case "string":
      case "number":
      case "boolean":
      case "nullkeyword":
      case "magic":
      case "constref":
      case "inline":
        return []
      case "encapsed":
        return this.concat(n.value.map((p: Node) => p.expression ?? p), env, n)
      case "encapsedpart":
        return this.expr(n.expression, env)
      case "bin": {
        if (n.type === ".") return this.concat(flattenConcat(n), env, n)
        const l = this.expr(n.left, env), r = this.expr(n.right, env)
        // Arithmetic and comparisons produce numbers/booleans.
        if (["??", "?:"].includes(n.type)) return merge(l, r)
        return []
      }
      case "unary":
      case "pre":
      case "post":
        this.expr(n.what, env)
        return []
      case "cast":
        return ["string", "array", "object"].includes(n.type) ? this.expr(n.expr ?? n.what, env) : (this.expr(n.expr ?? n.what, env), [])
      case "silent":
      case "parenthesis":
        return this.expr(n.expr ?? n.inner, env)
      case "clone":
        return this.expr(n.what, env)
      case "retif":
      case "ternary": {
        this.expr(n.test, env)
        return merge(n.trueExpr ? this.expr(n.trueExpr, env) : this.expr(n.test, env), this.expr(n.falseExpr, env))
      }
      case "isset":
      case "empty":
        for (const v of n.variables ?? (n.expression ? [n.expression] : [])) this.expr(v, env)
        return []
      case "assign": {
        const v = this.expr(n.right, env)
        if (n.operator === "=" || n.operator === "??=") this.assignTo(n.left, v, env, n.operator === "??=")
        if (n.operator === "=" && n.left?.kind === "variable" && typeof n.left.name === "string" && leadingLiteral(n.right)) this.prefixedVars.set(n.left.name.toLowerCase(), true)
        if (n.operator === "=" && n.left?.kind === "variable" && typeof n.left.name === "string") {
          const r = n.right?.kind === "call" && /^(?:realpath|wp_normalize_path|trim|rtrim|untrailingslashit|trailingslashit|str_replace|wp_unslash|stripslashes|urldecode|rawurldecode)$/.test(lower(nameOf(n.right.what))) ? n.right.arguments?.[n.right.what && lower(nameOf(n.right.what)) === "str_replace" ? 2 : 0] : null
          const src = r?.kind === "variable" && typeof r.name === "string" ? r.name.toLowerCase() : null
          if (src) this.aliases.set(n.left.name.toLowerCase(), src)
          else this.aliases.delete(n.left.name.toLowerCase())
        }
        // `$x = ['type' => 'a', 'text' => $input]`: remember each literal key.
        const target = keyOf(n.left)
        if (n.operator === "=" && target && n.right?.kind === "array") {
          for (const [k] of env) if (k.startsWith(`${target}[`) || k.startsWith(`${target}->`)) env.delete(k)
          for (const item of n.right.items ?? []) {
            if (item?.kind === "entry" && (item.key?.kind === "string" || item.key?.kind === "number")) {
              env.set(`${target}[${String(item.key.value).toLowerCase()}]`, this.expr(item.value, env))
            }
          }
        } else if (n.operator === "=" && target) {
          for (const [k] of env) if (k.startsWith(`${target}[`)) env.delete(k)
        }
        else if (n.operator === ".=") {
          this.assignTo(n.left, this.concat([n.left, n.right], env, n), env)
        } else this.assignTo(n.left, [], env)
        return v
      }
      case "assignref":
        return this.expr({ kind: "assign", left: n.left, right: n.right, operator: "=" }, env)
      case "array": {
        let out: Value = []
        for (const item of n.items ?? []) {
          if (!item) continue
          if (item.kind === "entry") {
            this.expr(item.key, env)
            out = merge(out, this.expr(item.value, env))
          } else out = merge(out, this.expr(item, env))
        }
        return out
      }
      case "include": {
        const v = this.expr(n.target, env)
        this.sink("include", v, n.target, n, n.require ? "require" : "include")
        // Run the included code here, in this scope: legacy apps pass request data
        // between files through plain variables ($html set in one file, echoed in another).
        if (this.includeDepth < 3) {
          const hits = this.project.resolveInclude(this.file, n.target).filter((h) => !this.including.has(h.file))
          if (hits.length) {
            const outs: Env[] = []
            for (const h of hits) {
              const ctx = new Ctx(this.project, h.file, h.content, this.summary, this.includeDepth + 1, new Set([...this.including, this.file, h.file]))
              ctx.cls = this.cls
              const out = ctx.block(h.ast.children ?? [], cloneEnv(env))
              if (out) outs.push(out)
            }
            if (outs.length) {
              const merged = mergeEnvs(hits.length === 1 && outs.length === 1 ? outs : [...outs])
              env.clear()
              for (const [k, val] of merged) env.set(k, val)
            }
          }
        }
        return []
      }
      case "eval": {
        const v = this.expr(n.source, env)
        this.sink("code", v, n.source, n, "eval")
        return []
      }
      case "shell": {
        const v = this.concat((n.value?.value ?? []).map((p: Node) => p.expression ?? p), env, n)
        this.sink("cmd", v, n, n, "`backticks`")
        return v
      }
      case "print": {
        const v = this.expr(n.expression, env)
        this.sink("xss", v, n.expression, n, "print")
        return []
      }
      case "exit": {
        const v = this.expr(n.expression ?? n.status, env)
        if (n.expression && n.expression.kind !== "number") this.sink("xss", v, n.expression, n, n.useDie ? "die" : "exit")
        return []
      }
      case "closure":
      case "arrowfunc": {
        // Captured variables carry their data into the closure body.
        const inner: Env = new Map()
        for (const u of n.uses ?? []) if (typeof u.name === "string") inner.set(u.name.toLowerCase(), env.get(u.name.toLowerCase()) ?? [])
        if (n.kind === "arrowfunc") for (const [k, v] of env) inner.set(k, v)
        const ctx = new Ctx(this.project, this.file, this.content, null)
        if (n.kind === "arrowfunc") ctx.expr(n.body, inner)
        else ctx.block(n.body?.children ?? [], inner)
        return []
      }
      case "match": {
        this.expr(n.cond, env)
        let out: Value = []
        for (const arm of n.arms ?? []) out = merge(out, this.expr(arm.body, env))
        return out
      }
      case "new":
        return this.newExpr(n, env)
      case "call":
        return this.call(n, env)
      case "yield":
      case "yieldfrom":
        return this.expr(n.value ?? n.expression, env)
      default:
        return []
    }
  }

  /** String building. Escaping for a quoted SQL literal only counts when the part sits between quotes. */
  private concat(parts: Node[], env: Env, at: Node): Value {
    let out: Value = []
    // All literal SQL text so far; a value sits inside an SQL string literal when an odd
    // number of unescaped quotes precede it ('…%{$x}%…' included).
    let sqlSoFar = ""
    const open = (text: string, q: string) => (text.replace(/\\./g, "").split(q).length - 1) % 2 === 1
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (p?.kind === "string") {
        sqlSoFar += String(p.value)
        continue
      }
      let v = this.expr(p, env)
      if (v.length) {
        const quoted = open(sqlSoFar, "'") || open(sqlSoFar, '"')
        if (!quoted) v = v.map((f) => (f.safe.has("sqlq") && !f.safe.has("sql") ? { ...f, safe: new Set([...f.safe].filter((k) => k !== "sqlq")), weak: true } : f))
        out = merge(out, v)
      }
      sqlSoFar += literalText(p) || "0"
    }
    return withStep(out, this.step(at, "string"))
  }

  /** `$this->p` → (current class, p); `self::$p` / `Cls::$p` → (class, p). */
  private fieldOwner(n: Node): { cls: string; prop: string } | null {
    if ((n.kind === "propertylookup" || n.kind === "nullsafepropertylookup") && n.what?.kind === "variable" && n.what.name === "this") {
      const prop = nameOf(n.offset)
      return prop && this.cls ? { cls: this.cls, prop: prop.toLowerCase() } : null
    }
    if (n.kind === "staticlookup" && n.offset?.kind === "variable" && typeof n.offset.name === "string") {
      const w = n.what
      const cls = w?.kind === "selfreference" || w?.kind === "staticreference" ? this.cls : w?.kind === "name" ? String(w.name).split("\\").pop()!.toLowerCase() : ""
      return cls ? { cls, prop: n.offset.name.toLowerCase() } : null
    }
    return null
  }

  /** Name built with a literal prefix (`'block' . $type`): only a fixed family of callables is reachable. */
  private prefixed(n: Node, _env: Env): boolean {
    if (leadingLiteral(n)) return true
    // [$this, "display_view_{$mode}"] / [$obj, 'prefix_' . $x]
    if (n?.kind === "array" && n.items?.length === 2) {
      const m = n.items[1]?.kind === "entry" ? n.items[1].value : n.items[1]
      if (m && (m.kind === "string" || leadingLiteral(m))) return true
    }
    const k = n?.kind === "variable" && typeof n.name === "string" ? n.name.toLowerCase() : null
    return !!k && (this.prefixedVars.get(k) ?? false)
  }

  /** Env of the expression being evaluated (for sink-side checks). */
  private currentEnv: Env | null = null

  private args(n: Node, env: Env): Value[] {
    this.currentEnv = env
    return (n.arguments ?? []).map((a: Node) => this.expr(a?.kind === "variadic" ? a.what : a, env))
  }

  private newExpr(n: Node, env: Env): Value {
    const cls = lower(nameOf(n.what))
    const args = this.args(n, env)
    if (n.what?.kind === "variable") this.sink("code", this.expr(n.what, env), n.what, n, "new $class")
    if (/(?:^|\\)(?:redirectresponse|redirect)$/.test(cls)) this.sink("redirect", args[0] ?? [], n.arguments?.[0], n, `new ${nameOf(n.what)}`)
    if (/(?:^|\\)(?:splfileobject|splfileinfo|directoryiterator|ziparchive)$/.test(cls)) this.sink("file", args[0] ?? [], n.arguments?.[0], n, `new ${nameOf(n.what)}`)
    if (/(?:^|\\)(?:soapclient)$/.test(cls)) this.sink("ssrf", args[0] ?? [], n.arguments?.[0], n, `new ${nameOf(n.what)}`)
    if (/(?:^|\\)pdo$/.test(cls)) return []
    return []
  }

  private call(n: Node, env: Env): Value {
    const what = n.what
    const args = this.args(n, env)
    const line = lineOf(n)
    const argNodes: Node[] = n.arguments ?? []

    // Method calls: $obj->m(), Cls::m()
    if (what?.kind === "propertylookup" || what?.kind === "nullsafepropertylookup" || what?.kind === "staticlookup") {
      const method = lower(nameOf(what.offset))
      const recv = exprText(what.what)
      this.expr(what.what, env)
      if (!method) {
        if (!this.prefixed(what.offset, env)) this.sink("code", this.expr(what.offset, env), what.offset, n, "$obj->$method()")
        return []
      }
      if (CLEAN_REQUEST_METHODS.has(method) && REQUEST_RECEIVER.test(recv)) return []
      // Request input
      if (SOURCE_METHODS.has(method) && REQUEST_RECEIVER.test(recv)) {
        const label = `${recv}->${nameOf(what.offset)}(${argNodes[0]?.kind === "string" ? `'${argNodes[0].value}'` : ""})`
        return [{ src: label, safe: new Set(), steps: [{ line, text: label, file: this.file }], weak: false }]
      }
      if (SOURCE_METHODS.has(method) && /->(?:query|request|attributes|cookies|headers)$/i.test(recv) && /request/i.test(recv)) {
        const label = `${recv}->${nameOf(what.offset)}()`
        return [{ src: label, safe: new Set(), steps: [{ line, text: label, file: this.file }], weak: false }]
      }
      // Sanitizers as methods: $pdo->quote(), $db->escape(), $wpdb->prepare(), $mysqli->real_escape_string()
      // esc_like() only escapes % _ and \: the result still needs prepare() / esc_sql().
      if (method === "esc_like" || method === "escape_like_str") return withStep(merge(...args), { line, text: `${recv}->${method}()`, file: this.file })
      if (["quote", "escape", "escape_string", "real_escape_string", "escape_str", "prepare"].includes(method) && DB_RECEIVER.test(recv)) {
        if (method === "prepare" && /wpdb/i.test(recv)) {
          const first = argNodes[0]
          if (args[0]?.length) this.sink("sql", args[0], first, n, "$wpdb->prepare")
          return makeSafe(merge(...args.slice(1)), ["sql"])
        }
        if (method === "prepare") {
          this.sink("sql", args[0] ?? [], argNodes[0], n, `${recv}->prepare`)
          return []
        }
        return makeSafe(merge(...args), SANITIZERS[method] ?? ["sqlq"])
      }
      // Query builders given one raw SQL fragment: $query->where("id = " . $x) (Joomla, Doctrine DBAL, CI).
      if (/^(?:where|orwhere|andwhere|having|orhaving|order|orderby|group|groupby|set|join|innerjoin|leftjoin|rightjoin|outerjoin|select|from)$/.test(method) &&
        argNodes.length === 1 && (argNodes[0]?.kind === "bin" || argNodes[0]?.kind === "encapsed") && /query|qb|builder|db/i.test(recv)) {
        this.sink("sql", args[0] ?? [], argNodes[0], n, `${recv}->${nameOf(what.offset)}()`)
        return []
      }
      // SQL
      // An ORM call handed an array ($repo->update(['units' => $units], $id)): values are bound, not SQL text.
      if (SQL_METHODS.has(method) && argNodes[0]?.kind === "array") return []
      if (SQL_METHODS.has(method)) {
        const sqlLike = SQL_TEXT.test(literalText(argNodes[0]))
        const dbLike = DB_RECEIVER.test(recv) || /^(?:DB|\\?Illuminate\\Support\\Facades\\DB)$/i.test(recv)
        if ((sqlLike || dbLike) && (!SQL_METHOD_NEEDS_DB.has(method) || dbLike || sqlLike)) {
          this.sink("sql", args[0] ?? [], argNodes[0], n, `${recv}->${nameOf(what.offset)}()`)
          return this.storedRead(argNodes[0], n)
        }
      }
      // WP_Filesystem: the WordPress way to read and write files.
      if (/filesystem|wp_fs|\$fs$/i.test(recv)) {
        const fsArg: Record<string, number[]> = { get_contents: [0], get_contents_array: [0], put_contents: [0], delete: [0], move: [0, 1], copy: [0, 1], mkdir: [0], rmdir: [0], chmod: [0], touch: [0] }
        for (const i of fsArg[method] ?? []) this.sink("file", args[i] ?? [], argNodes[i], n, `${recv}->${method}()`)
        if (method === "get_contents" || method === "get_contents_array") return []
      }
      // A result set hands out the rows it was read with ($result->fetch_assoc()).
      if (/^fetch(?:_?(?:assoc|array|row|object|all|column|one))?$|^fetchall(?:associative)?$|^row_array$|^result_array$/i.test(method)) {
        const recvVal = this.expr(what.what, env).filter((f) => f.src)
        if (recvVal.length) return withStep(recvVal, { line, text: `${recv}->${method}()`, file: this.file })
      }
      // Any object that carries request data hands it out through its getters ($data->get_param('x')).
      if (SOURCE_METHODS.has(method)) {
        const recvVal = this.expr(what.what, env).filter((f) => f.src)
        if (recvVal.length) return withStep(recvVal, { line, text: `${recv}->${nameOf(what.offset)}()`, file: this.file })
      }
      if (method === "set_role" || method === "add_role" || method === "add_cap") {
        this.sink("privesc", args[0] ?? [], argNodes[0], n, `${recv}->${method}()`)
        return []
      }
      // setUrl() is a fetch only on an HTTP client; on a bookmark or an entry it stores a link (wallabag, shaarli).
      if (method === "setopt" || (method === "seturl" && /curl|http|client|request|fetch|guzzle/i.test(recv))) this.sink("ssrf", args[method === "setopt" ? 1 : 0] ?? [], argNodes[method === "setopt" ? 1 : 0], n, `${recv}->${method}()`)
      if (/^(?:request|get|post|put|delete|head|patch)$/.test(method) && /(?:client|guzzle|http)$/i.test(recv)) {
        const urlArg = method === "request" ? 1 : 0
        this.sink("ssrf", args[urlArg] ?? [], argNodes[urlArg], n, `${recv}->${method}()`)
        return []
      }
      if (/^(?:redirect|redirectto|to|away)$/.test(method) && /redirect|response|\$this$/i.test(recv)) this.sink("redirect", args[0] ?? [], argNodes[0], n, `${recv}->${method}()`)
      if (method === "loadxml" || method === "load") return []
      // Project method with a unique name
      const def = this.project.lookup(method, true)
      if (def) return this.applyCallee(def, args, n, `${recv}->${nameOf(what.offset)}()`)
      return []
    }

    // Variable function: $f(...)
    if (what?.kind === "variable" || what?.kind === "offsetlookup" || what?.kind === "encapsed" || what?.kind === "bin") {
      if (!this.prefixed(what, env)) this.sink("code", this.expr(what, env), what, n, "$function()")
      return []
    }

    const fn = lower(nameOf(what))
    const label = `${nameOf(what)}()`
    if (["current_user_can", "user_can", "is_super_admin", "check_password_reset_key", "wp_check_password", "current_user_can_for_blog"].includes(fn)) this.guarded = true

    // Sources
    if (fn === "file_get_contents" && literalText(argNodes[0]) === "php://input") return [{ src: "php://input", safe: new Set(), steps: [{ line, text: "php://input", file: this.file }], weak: false }]
    if (fn === "filter_input") {
      const filter = exprText(argNodes[2]) + nameOf(argNodes[2])
      if (/FILTER_VALIDATE_(?:INT|FLOAT|BOOL|BOOLEAN|IP|EMAIL)|FILTER_SANITIZE_NUMBER/i.test(filter)) return []
      const safe = /FILTER_SANITIZE_(?:SPECIAL_CHARS|FULL_SPECIAL_CHARS|ENCODED)/i.test(filter) ? ["xss" as const] : []
      return [{ src: `filter_input(${nameOf(argNodes[0])}, ${argNodes[1]?.kind === "string" ? `'${argNodes[1].value}'` : "…"})`, safe: new Set(safe), steps: [{ line, text: label, file: this.file }], weak: false }]
    }
    if (SOURCE_FUNCTIONS.has(fn) && (!this.project.lookup(fn, false) || ["getallheaders", "apache_request_headers"].includes(fn))) {
      if ((fn === "request" || fn === "input") && !argNodes.length) return []
      return [{ src: label, safe: new Set(), steps: [{ line, text: label, file: this.file }], weak: fn === "get_query_var" }]
    }
    if ((fn === "wp_insert_user" || fn === "wp_update_user" || fn === "wp_insert_post" || fn === "wp_update_post") && argNodes[0]) {
      // The whole request array as the object's fields: the client picks role / post_author / ID.
      const whole = (args[0] ?? []).filter((f) => f.src && /^\$_(?:POST|GET|REQUEST)$|->(?:get_params|get_json_params|get_body_params|all|input)\(\)$/i.test(f.src))
      if (whole.length) this.sink("privesc", whole, argNodes[0], n, `${label} with the whole request`)
      // A role entry chosen by the request.
      const target = keyOf(argNodes[0])
      const roleNode = argNodes[0].kind === "array" ? argNodes[0].items?.find((i: Node) => i?.kind === "entry" && i.key?.kind === "string" && /^(?:role|user_level|wp_capabilities)$/.test(i.key.value))?.value : null
      const role = roleNode ? this.expr(roleNode, env) : target ? env.get(`${target}[role]`) ?? [] : []
      if (role.length && fn.includes("user")) this.sink("privesc", role, roleNode ?? argNodes[0], n, `${label} role`)
    }
    if (fn === "define" && argNodes[0]?.kind === "string") {
      // Visible to the rest of this flow exactly as defined here.
      env.set(`#${String(argNodes[0].value)}`, args[1] ?? [])
      const src = args[1]?.find((f) => f.src)
      if (src) this.project.taintConstant(String(argNodes[0].value), { ...src, steps: [...src.steps, { line, text: `define('${argNodes[0].value}')`, file: this.file }].slice(-MAX_STEPS) })
      return []
    }
    // extract($_GET) / parse_str($x) overwrite arbitrary variables.
    if (fn === "extract" || (fn === "parse_str" && argNodes.length === 1)) {
      // extract($_POST) lets the client set any local variable ($is_admin, $user_id...). extract() of
      // shortcode_atts() or of a template's own args only sets known keys.
      const direct = argNodes[0]?.kind === "variable" && /^_(?:GET|POST|REQUEST|COOKIE|SERVER)$/i.test(String(argNodes[0].name)) ||
        (fn === "parse_str" && args[0]?.some((f) => f.src))
      if (direct && args[0]?.length) this.sink("code", args[0], argNodes[0], n, label)
      return []
    }

    // Sinks
    const sinks = FUNCTION_SINKS[fn]
    if (sinks && !this.project.lookup(fn, false)) {
      for (const s of sinks) {
        const i = s.arg === "last" ? args.length - 1 : s.arg
        if (i < 0 || i >= args.length) continue
        let kind = s.kind
        // A tainted callback in array_map/usort only matters as the callable.
        if ((fn === "array_map" || fn === "usort") && argNodes[i]?.kind !== "variable") continue
        if (fn === "unserialize" && argNodes[1] && /allowed_classes/.test(literalText(argNodes[1]) + JSON.stringify(argNodes[1]).slice(0, 400))) continue
        if (fn === "mail" && i === 4) kind = "cmd"
        // Opening a URL chosen by the request is SSRF rather than path traversal.
        if (kind === "file" && /^(?:https?|ftp):\/\//i.test(leadingLiteral(argNodes[i]))) kind = "ssrf"
        if (fn === "fopen" && argNodes[0] && literalText(argNodes[0]) === "php://input") continue
        if (fn === "redirect" && i === 0 && !argNodes.length) continue
        if (kind === "privesc" && (leadingLiteral(argNodes[i]) || argNodes[i]?.kind === "bin" || argNodes[i]?.kind === "encapsed")) continue
        this.sink(kind, args[i], argNodes[i], n, label)
      }
      if (fn === "file_get_contents" || fn === "fread" || fn === "file") return []
      if (fn === "shell_exec" || fn === "exec" || fn === "system" || fn === "passthru") return []
      const sqlArg = sinks.find((s) => s.kind === "sql")
      if (sqlArg) {
        const i = sqlArg.arg === "last" ? args.length - 1 : sqlArg.arg
        const st = this.storedRead(argNodes[i], n)
        if (st.length) return st
      }
    }
    if (fn === "header") {
      const lead = leadingLiteral(argNodes[0])
      if (/^\s*location\s*:/i.test(lead) || (argNodes[0]?.kind !== "string" && !lead && args[0]?.length)) {
        if (/^\s*location\s*:\s*$/i.test(lead) || !lead) this.sink("redirect", args[0] ?? [], argNodes[0], n, "header('Location: …')")
      }
      return []
    }
    if (fn === "curl_setopt" || fn === "curl_setopt_array") {
      if (fn === "curl_setopt" && /CURLOPT_URL/i.test(nameOf(argNodes[1]) || exprText(argNodes[1]))) this.sink("ssrf", args[2] ?? [], argNodes[2], n, "curl_setopt(CURLOPT_URL)")
      return []
    }
    if (fn === "preg_replace" && /\/[a-z]*e[a-z]*$/i.test(literalText(argNodes[0]))) this.sink("code", args[1] ?? [], argNodes[1], n, "preg_replace /e")
    // preg_replace('/[^a-zA-Z0-9]/', '', $x): a character allowlist leaves nothing dangerous (raspap, freescout).
    if (fn === "preg_replace" && /^\/\[\^[\w\\.\- ]+\]\+?\/[a-z]*$/i.test(literalText(argNodes[0])) && literalText(argNodes[1]) === "") return []

    // The project's own cleaners: sanitize_resolved_theme(), resolve_language(), clean_path().
    if (/^(?:sanitize|resolve|clean|validate|normali[sz]e|whitelist|allowlist)_/i.test(fn)) return withStep(makeSafe(merge(...args), ["xss", "file", "include", "redirect"]), { line, text: label, file: this.file })
    // Project function
    const def = this.project.lookup(fn, false)
    if (def) return this.applyCallee(def, args, n, label)

    if (fn === "filter_var") {
      const filter = exprText(argNodes[1]) + nameOf(argNodes[1])
      if (/FILTER_VALIDATE_(?:INT|FLOAT|BOOL|BOOLEAN|IP)|FILTER_SANITIZE_NUMBER/i.test(filter)) return []
      if (/FILTER_SANITIZE_(?:SPECIAL_CHARS|FULL_SPECIAL_CHARS|ENCODED)/i.test(filter)) return makeSafe(args[0] ?? [], ["xss"])
      return withStep(args[0] ?? [], { line, text: label, file: this.file })
    }
    if (fn === "pathinfo" && /PATHINFO_(?:FILENAME|EXTENSION)/.test(nameOf(argNodes[1]))) return makeSafe(args[0] ?? [], ["file", "include"])
    // Filters return the (possibly changed) value they were given: arg 1. Same for parse-args style helpers: arg 0.
    if (/^(?:apply_filters|apply_filters_ref_array|apply_filters_deprecated)$/.test(fn)) return withStep(args[1] ?? [], { line, text: label, file: this.file })
    if (/^(?:wp_parse_args|shortcode_atts|map_deep|wc_clean|wc_sanitize_textarea|stripslashes_deep|wp_slash|wp_unslash|maybe_serialize|wp_json_encode|array_merge_recursive|wp_list_pluck)$/.test(fn)) {
      const v = fn === "shortcode_atts" ? args[1] ?? [] : fn === "wp_list_pluck" ? args[0] ?? [] : merge(...args)
      return withStep(fn === "wc_clean" ? makeSafe(v, ["xss"]) : fn === "wp_json_encode" ? makeSafe(v, ["xss"]) : v, { line, text: label, file: this.file })
    }
    if (CLEAN_FUNCTIONS.has(fn)) return []
    if (fn in SANITIZERS) return withStep(makeSafe(merge(...args), SANITIZERS[fn]), { line, text: label, file: this.file })
    if (PASSTHROUGH.has(fn)) return withStep(merge(...args), { line, text: label, file: this.file })
    return []
  }

  /** Apply a project function's summary at a call site. */
  private applyCallee(def: FnDef, args: Value[], call: Node, label: string): Value {
    const s = this.project.summary(def)
    if (!s) return []
    const callStep: Step = { line: lineOf(call), text: label, file: this.file }
    // Parameters that reach sinks inside the callee.
    for (const use of s.sinks) {
      if ((use.kind === "account" || use.kind === "privesc") && this.guarded) continue
      const arg = args[use.param]
      if (!arg?.length) continue
      for (const f of arg) {
        if (f.safe.has(use.kind) || use.safe.has(use.kind)) continue
        if (use.kind === "sql" && use.safe.has("sqlq") && !use.weak) continue
        const fact: Fact = { ...f, safe: new Set([...f.safe, ...use.safe]), steps: [...f.steps, callStep, ...use.steps].slice(-MAX_STEPS), weak: f.weak || use.weak }
        if (f.param !== undefined) {
          this.summary?.sinks.push({ param: f.param, kind: use.kind, line: use.line, file: use.file, sink: use.sink, steps: fact.steps, safe: fact.safe, weak: fact.weak })
        } else if (f.src) {
          // Report where request data enters the project function; the sink inside it is in the trace.
          const inner: Step = { line: use.line, text: use.sink, file: use.file }
          this.emit(use.kind, { ...fact, steps: [...fact.steps, inner].slice(-MAX_STEPS) }, this.file, lineOf(call), label)
        }
      }
    }
    // Return value: request data the callee reads itself, plus parameters it passes through.
    let out: Value = []
    for (const r of s.returns) {
      if (r.src) out = merge(out, [{ ...r, steps: [...r.steps, callStep].slice(-MAX_STEPS) }])
      else if (r.param !== undefined && args[r.param]?.length) {
        out = merge(out, args[r.param].map((f) => ({ ...f, safe: new Set([...f.safe, ...r.safe]), steps: [...f.steps, callStep].slice(-MAX_STEPS), weak: f.weak || r.weak })))
      }
    }
    return out
  }

  /** Reach a sink: report request data, or record a parameter use for the summary. */
  private sink(kind: SinkKind, v: Value, argNode: Node, at: Node, sink: string) {
    if (!v.length) return
    if (kind === "sql") this.recordStoredWrite(v, argNode, at)
    if (kind === "upload") {
      // An extension / type check shortly before the move (WordPress or by hand) is the fix for this rule.
      // From the start of the enclosing function to the move itself.
      const end = at?.loc?.start?.offset ?? 0
      const start = Math.max(this.content.lastIndexOf("function", end), end - 12000, 0)
      const window = this.content.slice(start, end)
      // Only a check of the stored name's EXTENSION protects: content checks (getimagesize, finfo,
      // mime_content_type) pass an image/PHP polyglot named x.php, and $_FILES[...]['type'] is sent by the client.
      const extVars = new Set([...window.matchAll(/\$(\w+)\s*=\s*[^;]*(?:PATHINFO_EXTENSION|explode\s*\(\s*['"]\.['"]|strrchr\s*\([^)]*['"]\.['"]|strrpos\s*\([^)]*['"]\.['"])/g)].map((m) => m[1]))
      const inArrayExt = [...window.matchAll(/in_array\s*\(\s*([^,]+),/g)].some((m) => /ext/i.test(m[1]) || [...extVars].some((v) => m[1].includes(`$${v}`)))
      const nameRegex = /preg_match\s*\(\s*['"][^'"]*\\\.\s*\(?[^'"]*(?:jpe?g|png|gif|pdf|docx?)[^'"]*\$/i.test(window)
      if (inArrayExt || nameRegex || /wp_check_filetype(?:_and_ext)?\s*\(|PATHINFO_EXTENSION[^;]*\)\s*[;,)]?[^;]*(?:===|!==|==|!=)\s*['"]|wp_handle_upload\s*\(|wp_handle_sideload\s*\(|media_handle_upload\s*\(/i.test(window)) return
    }
    const dynamicCall = kind === "code" && /^(?:\$obj->\$method\(\)|\$function\(\)|new \$class|call_user_func(?:_array)?\(\)|forward_static_call\(\)|usort\(\)|array_map\(\)|register_shutdown_function\(\))$/.test(sink)
    if (dynamicCall) {
      // $args['fname']() where only $args as a whole is known to hold request data: not a chosen name.
      if (argNode?.kind === "offsetlookup") {
        const k = keyOf(argNode)
        if (!k || !this.currentEnv?.has(k)) return
      }
      v = v.filter((f) => f.src)
    }
    if ((kind === "account" || kind === "privesc") && this.guarded) return
    if (kind === "xss" && this.jsonResponse) return
    for (const f of v) {
      if (f.safe.has(kind)) continue
      // Escaped for a quoted literal and used between quotes: fine.
      if (kind === "sql" && f.safe.has("sqlq")) continue
      if (f.param !== undefined) {
        this.summary?.sinks.push({ param: f.param, kind, line: lineOf(at), file: this.file, sink, steps: f.steps, safe: f.safe, weak: f.weak })
        continue
      }
      this.emit(kind, f, this.file, lineOf(at), sink)
    }
    void argNode
  }

  private emit(kind: SinkKind, f: Fact, file: string, line: number, sink: string) {
    // Headers and cookies are set by the attacker in their own request: reflected
    // XSS or a redirect from them needs another bug (cache, header injection) to hit a victim.
    const selfOnly = (kind === "xss" || kind === "redirect") && /^\$_COOKIE|^\$_SERVER\['HTTP_|->(?:cookie|header)\(/i.test(f.src ?? "")
    this.project.report({ kind, file, line, sink, source: f.src ?? "request", steps: f.steps, weak: f.weak || selfOnly })
  }
}
