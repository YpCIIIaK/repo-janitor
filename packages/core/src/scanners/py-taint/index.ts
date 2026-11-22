import type { Scanner, ScanContext } from "../../scanner"
import type { FlowStep, Issue, Severity } from "../../schema"
import { parsePython, type PyNode, type Expr, type Stmt } from "./parse"

/**
 * Deep Python analysis (py-taint, beta, opt-in like php-taint and js-taint).
 *
 * Follows request data — Flask/Werkzeug, Django and DRF, FastAPI/Starlette,
 * Tornado, aiohttp, Bottle request objects, and route parameters — through
 * variables, string building (f-strings, %, .format, +), containers and calls
 * into the project's own functions (analysed at the call site with the caller's
 * arguments, across files), to the call that makes it dangerous: SQL text, a
 * shell, eval and template compilers, unpicklers, file paths, outgoing URLs,
 * redirects and HTML.
 *
 * Deliberately not a sound analysis: unknown library calls return clean values,
 * so a value only stays tainted along operations we know carry it. Each finding
 * carries its path (Issue.flow) so it can be checked by reading.
 */

type Kind = "sql" | "cmd" | "code" | "deser" | "file" | "ssrf" | "redirect" | "xss"
const ALL_KINDS: Kind[] = ["sql", "cmd", "code", "deser", "file", "ssrf", "redirect", "xss"]
/** What an uploaded file object (not its name) can hurt: only loaders of its bytes. */
const UPLOAD_SAFE: Kind[] = ["sql", "cmd", "code", "file", "ssrf", "redirect", "xss"]
/** Parts of a path that cannot hold a separator. */
const NAME_PART = /^(?:suffix|suffixes|stem|name|ext|extension)$/
const SCHEME_ONLY = /^(?:[a-z][\w+.-]*:)?\/\/$|^:\/\/$|^[a-z][\w+.-]*:\/\/$/i

interface Step { line: number; text: string; file: string }
interface Fact {
  src: string
  safe: Set<Kind>
  steps: Step[]
  /** Set while the value sits under a key of a dict literal: reading another key does not get it. */
  field?: string
  /** One URL path segment (`<name>`, `{name}`): it cannot hold a `/`, so it climbs one level at most. */
  segment?: boolean
  /** An uploaded file object: only its `.filename` is a name the client chose. */
  upload?: boolean
  /** A parameter of a library's public function (library mode): whoever calls it chooses the value. */
  lib?: boolean
}
type Value = Fact[]
type Env = Map<string, Value>

interface Finding { kind: Kind; file: string; line: number; sink: string; fact: Fact; guarded: boolean }

const RULES: Record<Kind, { id: string; title: string; detail: string; severity: Severity }> = {
  sql: {
    id: "py-taint-sqli",
    title: "SQL injection: request input is built into SQL text",
    detail: "Request data is pasted into the text of a SQL query (f-string, %, .format or +). Pass it as a bound parameter (`cursor.execute('… WHERE id = %s', (id,))`, `text('… = :id')` with params, or the ORM's filter).",
    severity: "critical",
  },
  cmd: {
    id: "py-taint-cmdi",
    title: "Command injection: request input reaches a shell",
    detail: "Request data reaches `os.system`/`os.popen`, a `subprocess` call with `shell=True`, or chooses the program that runs. Use `subprocess.run([...])` with a fixed program and an argument list; quote with `shlex.quote` only as a last resort.",
    severity: "critical",
  },
  code: {
    id: "py-taint-code-injection",
    title: "Code injection: request input is evaluated",
    detail: "Request data reaches `eval`/`exec`/`compile`, an import, or a template compiled from a string (`render_template_string`, `jinja2.Template`), which runs it as code. Never evaluate input; render fixed templates and pass the input as a variable.",
    severity: "critical",
  },
  deser: {
    id: "py-taint-deserialization",
    title: "Unsafe deserialization of request data",
    detail: "Request data is unpickled or loaded with a loader that builds arbitrary objects (`pickle`, `yaml.load` without SafeLoader, `marshal`, `dill`, `jsonpickle`), which runs code chosen by the sender. Use JSON or `yaml.safe_load`.",
    severity: "critical",
  },
  file: {
    id: "py-taint-path-traversal",
    title: "Path traversal: request input chooses a file path",
    detail: "Request data becomes a file path, so `../` can reach files outside the intended directory. Use `werkzeug.utils.secure_filename`/`os.path.basename`, or resolve the path and check it stays under the base directory.",
    severity: "critical",
  },
  ssrf: {
    id: "py-taint-ssrf",
    title: "SSRF: request input chooses where the server connects",
    detail: "Request data decides the host the server fetches (`requests`, `httpx`, `urllib`), so a client can reach internal services or cloud metadata. Allow only known hosts.",
    severity: "warning",
  },
  redirect: {
    id: "py-taint-open-redirect",
    title: "Open redirect: request input chooses the redirect target",
    detail: "Request data is used as a redirect URL, so a link on your domain can send users anywhere. Check it with `url_has_allowed_host_and_scheme` (Django) or allow only relative paths.",
    severity: "warning",
  },
  xss: {
    id: "py-taint-xss",
    title: "Cross-site scripting: request input is written as HTML",
    detail: "Request data is written into an HTML response, or marked safe (`Markup`, `mark_safe`), without escaping. Render it through a template with autoescaping, or escape it with `html.escape`/`markupsafe.escape`.",
    severity: "critical",
  },
}

const PY_FILE = /\.py$/i
const SKIP_PATH = /(?:^|\/)(?:contract[-_]?tests?|site-packages|dist-packages|\.?venv\d*|env|\.tox|\.eggs|build|dist|node_modules|vendor|third[-_]?party|tests?|testing|__tests__|fixtures?|examples?|demos?|docs?|benchmarks?|migrations|scripts|tools)\/|(?:^|\/)(?:test_[^/]*|[^/]*_tests?|conftest|setup|noxfile|fabfile)\.py$/i
const MAX_FILES = 4000
const MAX_BYTES = 300_000
const MAX_DEPTH = 4
const MAX_FACTS = 6
const MAX_FINDINGS = 200
const MAX_WORK = 600_000

/** request.<member> that carries client data (Flask, Django, DRF, Starlette, aiohttp, Bottle, Tornado). */
const REQ_MEMBER = /^(?:args|form|values|json|data|files|cookies|headers|view_args|stream|GET|POST|FILES|COOKIES|META|body|query_params|path_params|query|match_info|forms|params|query_string|url|full_path|path|raw_post_data|content|text|POST_data)$/
const REQ_NAME = /^(?:request|req|self\.request|flask\.request|bottle\.request|r)$/
const REQ_CALL = /^(?:get_json|get_data|json|form|body|text|post|read|content|getlist)$/
/** Tornado handler methods that read the request. */
const TORNADO_GET = /^(?:get_argument|get_arguments|get_query_argument|get_query_arguments|get_body_argument|get_body_arguments|get_cookie|get_secure_cookie)$/

const STRING_METHODS = new Set([
  "strip", "lstrip", "rstrip", "lower", "upper", "title", "capitalize", "casefold", "swapcase", "split", "rsplit", "splitlines",
  "partition", "rpartition", "join", "replace", "encode", "decode", "removeprefix", "removesuffix", "ljust", "rjust", "center",
  "zfill", "expandtabs", "translate", "format", "format_map", "get", "getlist", "getall", "getone", "to_dict", "dict", "items",
  "values", "keys", "copy", "pop", "popitem", "setdefault", "read", "readline", "readlines", "decode", "get_json", "json",
  "lists", "urlencode", "group", "groups", "groupdict", "__getitem__", "model_dump", "dict", "data", "cleaned_data",
])
const PASS_FUNCS = new Set([
  "str", "repr", "bytes", "bytearray", "list", "tuple", "dict", "set", "frozenset", "sorted", "reversed", "next", "iter", "enumerate", "zip",
  "os.path.join", "os.path.normpath", "os.path.expanduser", "os.path.expandvars", "os.path.dirname", "os.path.splitext", "os.path.abspath",
  "posixpath.join", "ntpath.join", "Path", "PurePath", "pathlib.Path", "PurePosixPath", "unquote", "unquote_plus", "urllib.parse.unquote",
  "urllib.parse.unquote_plus", "parse.unquote", "base64.b64decode", "base64.urlsafe_b64decode", "b64decode", "binascii.unhexlify",
  "bytes.fromhex", "json.loads", "json.load", "loads", "ujson.loads", "orjson.loads", "simplejson.loads", "urljoin", "urllib.parse.urljoin",
  "parse.urljoin", "str.format", "textwrap.dedent", "codecs.decode", "unicodedata.normalize", "html.unescape", "urlparse", "urlsplit",
  "urllib.parse.urlparse", "urllib.parse.urlsplit", "urlunparse", "urllib.parse.urlunparse", "parse_qs", "urllib.parse.parse_qs",
  "map", "filter", "getattr", "unquote_to_bytes", "urllib.parse.unquote_to_bytes", "parse.unquote_to_bytes",  "dict.get", "copy.copy", "copy.deepcopy", "MultiDict", "ImmutableMultiDict", "QueryDict",
])
/** Calls whose result carries no text a client chose. */
const CLEAN_FUNCS = /^(?:int|float|bool|len|abs|round|min|max|sum|hash|id|ord|isinstance|issubclass|callable|hasattr|type|range|uuid\.UUID|UUID|Decimal|datetime\.\w+|date\.\w+|time\.\w+|math\.\w+|hashlib\.\w+|hmac\.\w+|secrets\.\w+|random\.\w+|re\.(?:escape|compile)|url_for|reverse|reverse_lazy|get_object_or_404|get_list_or_404|os\.path\.(?:exists|isfile|isdir|getsize|islink)|uuid\.uuid\d|ObjectId|bson\.ObjectId|ipaddress\.\w+)$/
const SANITIZE: [RegExp, Kind[]][] = [
  [/(?:^|\.)(?:escape|html\.escape|cgi\.escape|markupsafe\.escape|conditional_escape|escape_html|bleach\.clean|clean_html|sanitize_html|strip_tags|nh3\.clean|format_html|escapejs|xhtml_escape|html_escape|quoteattr)$/, ["xss"]],
  [/(?:^|\.)(?:quote|quote_plus|urlencode|urllib\.parse\.quote|parse\.quote|urllib\.quote|url_escape)$/, ["xss", "redirect", "cmd", "sql", "file", "code", "ssrf"]],
  [/(?:^|\.)(?:secure_filename|basename|os\.path\.basename|get_valid_filename|safe_join|werkzeug\.utils\.safe_join|werkzeug\.security\.safe_join|sanitize_filename|slugify)$/, ["file", "cmd", "xss", "redirect", "code"]],
  [/(?:^|\.)(?:shlex\.quote|pipes\.quote|quote_cmd|shellquote)$/, ["cmd"]],
  [/(?:^|\.)(?:escape_string|escape_like|literal|mogrify|sql\.Identifier|sql\.Literal|Identifier|quote_ident|quote_identifier)$/, ["sql"]],
]

const DB_RECV = /(?:^|\.|_)(?:cursor|cur|curs|c|conn|connection|con|db|database|session|engine|sess|tx|txn|transaction|client|pool|sqlite|sqlite3|mysql|pg|psycopg2?|duckdb|dbapi|connection\.cursor\(\)|cursor\(\)|db\.session|self\.db|self\.conn|self\.cursor|self\.cur|self\.session|db_session)$/i
const SQL_TEXT = /\b(?:select\s[\s\S]*\bfrom|insert\s+into|update\s+\S+\s+set|delete\s+from|where\s|order\s+by|union\s+select|create\s+table|drop\s+table|alter\s+table|pragma\s|describe\s+\S|truncate\s+(?:table\s+)?\S)\b/i

// ---- helpers

function text(n: Expr | undefined, depth = 0): string {
  if (!n || depth > 8) return ""
  switch (n.type) {
    case "Name": return String(n.id)
    case "Attribute": return `${text(n.value as Expr, depth + 1)}.${n.attr}`
    case "Call": return `${text(n.func as Expr, depth + 1)}()`
    case "Subscript": {
      const idx = n.index as Expr
      return `${text(n.value as Expr, depth + 1)}[${idx?.type === "Str" ? JSON.stringify(idx.value) : ""}]`
    }
    case "Await": case "Paren": return text(n.value as Expr, depth + 1)
    case "Str": return JSON.stringify(String(n.value).slice(0, 40))
    default: return n.type
  }
}

/** The literal text of a string expression (f-string holes as {}), with + and % pieces. */
function literalAll(n: Expr | undefined): string {
  if (!n) return ""
  if (n.type === "Str") return String(n.value)
  if (n.type === "Paren") return literalAll(n.value as Expr)
  if (n.type === "BinOp" && (n.op === "+" || n.op === "%")) return `${literalAll(n.left as Expr)} ${literalAll(n.right as Expr)}`
  if (n.type === "Call" && (n.func as Expr)?.type === "Attribute" && (n.func as Expr).attr === "format") return literalAll((n.func as Expr).value as Expr)
  if (n.type === "Call" && (n.func as Expr)?.type === "Attribute" && (n.func as Expr).attr === "join") return literalAll((n.func as Expr).value as Expr)
  return ""
}

/** The text before the first hole: f"https://{host}/x" → "https://". */
function literalLead(n: Expr | undefined): string {
  if (!n) return ""
  if (n.type === "Str") return String(n.value).split("{}")[0]
  if (n.type === "Paren") return literalLead(n.value as Expr)
  if (n.type === "BinOp" && n.op === "+") return literalLead(n.left as Expr)
  if (n.type === "BinOp" && n.op === "%") return literalLead(n.left as Expr).split("%")[0]
  if (n.type === "Call" && (n.func as Expr)?.type === "Attribute" && (n.func as Expr).attr === "format") return literalLead((n.func as Expr).value as Expr)
  return ""
}

function merge(...vals: Value[]): Value {
  const out: Value = []
  const seen = new Set<string>()
  for (const v of vals) for (const f of v) {
    // A fact safe for every sink can never be reported: do not let it crowd out the others.
    if (f.safe.size >= ALL_KINDS.length) continue
    const key = `${f.src}|${[...f.safe].sort().join(",")}|${f.steps[0]?.file}:${f.steps[0]?.line}|${f.field ?? ""}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(f)
    if (out.length >= MAX_FACTS) return out
  }
  return out
}

/** Read `key` of a value: facts under other dict keys stay behind. Tuple positions (`#0`) only
 * count for a positional read; a key or attribute read of a tuple-built container sees all of it. */
const pick = (v: Value, key: string | undefined): Value =>
  v.filter((f) => f.field === undefined || key === undefined || f.field === key || (f.field.startsWith("#") && !key.startsWith("#")))
    .map((f) => (f.field === undefined ? f : { ...f, field: undefined }))
const withStep = (v: Value, s: Step): Value => v.map((f) => ({ ...f, steps: f.steps.length > 24 ? [...f.steps.slice(0, 6), ...f.steps.slice(-15), s] : [...f.steps, s] }))
const makeSafe = (v: Value, kinds: Kind[]): Value => v.map((f) => ({ ...f, safe: new Set([...f.safe, ...kinds]) }))

interface FnDef { name: string; node: Stmt; file: string; content: string; cls?: string }

const GENERIC = new Set(["get", "set", "run", "main", "init", "handler", "handle", "render", "load", "save", "find", "create", "update", "delete", "remove", "add", "call", "apply", "exec", "execute", "query", "send", "fetch", "request", "start", "stop", "close", "open", "write", "read", "parse", "post", "put", "patch", "dispatch", "process", "validate", "clean", "__init__", "__call__", "setup", "list", "retrieve", "destroy", "perform_create", "get_queryset", "get_object", "form_valid", "get_context_data", "to_representation", "to_internal_value", "items", "keys", "values", "format", "join", "split", "strip", "replace", "lower", "upper", "encode", "decode", "copy", "pop", "append", "extend"])

class Project {
  readonly fns = new Map<string, FnDef[]>()
  readonly findings: Finding[] = []
  readonly contents = new Map<string, string>()
  private reported = new Set<string>()
  work = 0

  define(def: FnDef) {
    // Class.method is specific enough even for generic names (Student.create, self.get).
    if (def.cls && def.name) {
      const k = `${def.cls}.${def.name}`
      const l = this.fns.get(k) ?? []
      if (l.length < 2) l.push(def)
      this.fns.set(k, l)
    }
    if (!def.name || GENERIC.has(def.name) || def.name.length < 3) return
    const list = this.fns.get(def.name) ?? []
    if (list.length < 4) list.push(def)
    this.fns.set(def.name, list)
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

function index(project: Project, body: Stmt[], file: string, content: string, cls?: string) {
  for (const s of body) {
    if (s.type === "FunctionDef") {
      project.define({ name: String(s.name), node: s, file, content, cls })
      index(project, (s.body as Stmt[]) ?? [], file, content)
    } else if (s.type === "ClassDef") index(project, (s.body as Stmt[]) ?? [], file, content, String(s.name))
    else if (s.type === "If" || s.type === "Try" || s.type === "With") {
      for (const k of ["body", "orelse", "final"]) if (Array.isArray(s[k])) index(project, s[k] as Stmt[], file, content, cls)
    }
  }
}

/** The decorator of a route handler (Flask, FastAPI, Starlette, Sanic, Bottle, aiohttp), with its path text. */
function routeOf(fn: Stmt): { path: string } | undefined {
  for (const d of (fn.decorators as Expr[]) ?? []) {
    const call = d.type === "Call" ? d : undefined
    const t = text(call ? (call.func as Expr) : d)
    if (/(?:^|\.)(?:route|get|post|put|patch|delete|api_route|websocket|api_view|action|view_config|expose)$/.test(t) && !/^(?:property|cached_property|functools|pytest|mock|patch)\b/.test(t)) {
      const a0 = ((call?.args as PyNode[]) ?? [])[0]?.value as Expr | undefined
      return { path: a0?.type === "Str" ? String(a0.value) : "" }
    }
  }
  return undefined
}

/** FastAPI / Pydantic-style annotations that cannot carry text. */
const NON_TEXT_TYPE = /^(?:int|float|bool|UUID|uuid\.UUID|datetime|date|time|Decimal|conint|confloat|PositiveInt|NonNegativeInt|Literal|Enum|IntEnum|Optional\[(?:int|float|bool|UUID)\]|(?:int|float|bool|UUID)\s*\|\s*None)$/
const INJECTED = /^(?:Depends|Security|Header|Cookie|BackgroundTasks|Request|Response|WebSocket|Session|AsyncSession|HTTPConnection|SecurityScopes|OAuth2PasswordRequestForm)\b/

function annText(n: Expr | undefined): string {
  if (!n) return ""
  if (n.type === "Name") return String(n.id)
  if (n.type === "Attribute") return text(n)
  if (n.type === "Subscript") return `${annText(n.value as Expr)}[${annText(n.index as Expr)}]`
  if (n.type === "BinOp" && n.op === "|") return `${annText(n.left as Expr)} | ${annText(n.right as Expr)}`
  if (n.type === "Const") return String(n.value)
  if (n.type === "Tuple") return ((n.elts as Expr[]) ?? []).map(annText).join(", ")
  if (n.type === "Str") return String(n.value)
  return ""
}

class Ctx {
  private returns: Value = []
  /** The class whose method is being analysed: `self.helper()` resolves inside it first. */
  cls?: string
  /** Base classes of that class, as written (`BaseHTTPRequestHandler`). */
  clsBases = ""
  /** Library mode: the file serves no requests, so public functions' parameters are the inputs. */
  lib = false
  libParams = false
  constructor(private project: Project, private file: string, private content: string, private depth: number, private callStack: Set<object>, private route = false) {}

  private step(n: PyNode | undefined, t: string): Step {
    return { line: n?.line ?? 0, text: t.length > 80 ? `${t.slice(0, 77)}…` : t, file: this.file }
  }

  private fact(n: PyNode, src: string): Fact {
    return { src, safe: new Set(), steps: [this.step(n, src)] }
  }

  /** Analyse a function body with `args` bound to its parameters; returns what it returns. */
  fn(node: Stmt, args: Value[], closure: Env, kwargs: Map<string, Value> = new Map()): Value {
    const env: Env = new Map(closure)
    const params = (node.params as PyNode[]) ?? []
    const route = routeOf(node)
    // GraphQL resolvers (Graphene, Strawberry, Ariadne): arguments after `info` come from the query.
    const names = params.map((p) => String(p.name))
    const gql = this.depth === 0 && names.includes("info") && /^(?:resolve_\w+|mutate)$|^\w+$/.test(String(node.name)) && /\b(?:graphene|strawberry|ariadne)\b/.test(this.content) ? names.indexOf("info") : -1
    let pos = 0
    for (const p of params) {
      const name = String(p.name)
      let v: Value = []
      if (p.kind === "pos") v = args[pos++] ?? kwargs.get(name) ?? []
      else if (p.kind === "kwonly") v = kwargs.get(name) ?? []
      else if (p.kind === "varargs") v = merge(...args.slice(pos))
      else if (p.kind === "kwargs") v = merge(...kwargs.values())
      if (!v.length && route && this.depth === 0) v = this.routeParam(node, p, route.path)
      if (!v.length && this.libParams && libParam(p)) v = [{ ...this.fact(p, `parameter ${name}`), lib: true }]
      if (!v.length && gql >= 0 && names.indexOf(name) > gql && !NON_TEXT_TYPE.test(annText(p.annotation as Expr))) v = [this.fact(p, `graphql arg ${name}`)]
      if (p.default) v = merge(v, this.expr(p.default as Expr, env).filter(() => false))
      env.set(name, v.length ? withStep(v, this.step(p, name)) : [])
    }
    const prev = this.route
    this.route = !!route || this.route
    if (node.type === "Lambda") this.returns = merge(this.returns, this.expr(node.body as Expr, env))
    else this.block((node.body as Stmt[]) ?? [], env)
    this.route = prev
    return this.returns
  }

  /** A route handler's own parameter, filled from the URL or the body by the framework. */
  private routeParam(fn: Stmt, p: PyNode, path: string): Value {
    const name = String(p.name)
    if (name === "self" || name === "cls" || name === "request" || name === "req") return []
    const ann = annText(p.annotation as Expr)
    const dflt = p.default as Expr | undefined
    const dfltCall = dflt?.type === "Call" ? text(dflt.func as Expr) : ""
    if (INJECTED.test(ann) || INJECTED.test(dfltCall.replace(/^\w+\./, ""))) return []
    if (NON_TEXT_TYPE.test(ann.replace(/^Annotated\[([^,\]]+).*$/, "$1").trim())) return []
    // Flask: <name>, <path:name>, <string:name> are text; <int:name>, <uuid:name> are not.
    const flask = new RegExp(`<(?:(\\w+):)?${name}>`).exec(path)
    if (flask) return /^(?:int|float|uuid)$/.test(flask[1] ?? "") ? [] : [{ ...this.fact(p, `route <${name}>`), segment: flask[1] !== "path" }]
    // FastAPI: {name} path params and every other plain parameter (query, body model).
    const fa = new RegExp(`\\{${name}(:[^}]*)?\\}`).exec(path)
    if (fa) return /^:(?:int|float|uuid)$/.test(fa[1] ?? "") ? [] : [{ ...this.fact(p, `route {${name}}`), segment: fa[1] !== ":path" }]
    const isFastApi = ((fn.decorators as Expr[]) ?? []).some((d) => /(?:^|\.)(?:get|post|put|patch|delete|api_route)$/.test(text(d.type === "Call" ? (d.func as Expr) : d)) && /\b(?:fastapi|APIRouter|FastAPI)\b/.test(this.content))
    if (!isFastApi) return []
    if (!ann && !dflt) return [this.fact(p, `query ${name}`)]
    if (/UploadFile/.test(ann) || /^(?:File)$/.test(dfltCall.replace(/^\w+\./, "")) && !/str/.test(ann)) return [{ ...this.fact(p, `upload ${name}`), upload: true, safe: new Set<Kind>(UPLOAD_SAFE) }]
    if (/^(?:str|Optional\[str\]|str \| None|Any|bytes|List\[str\]|list\[str\])$/.test(ann) || /^(?:Query|Form|Body|Path)$/.test(dfltCall.replace(/^\w+\./, ""))) return [this.fact(p, `param ${name}`)]
    // A Pydantic body model: its str fields are client text.
    if (/^[A-Z]\w*$/.test(ann) && new RegExp(`class\\s+${ann}\\s*\\(\\s*(?:BaseModel|Schema|\\w*Model|\\w*Schema)`).test(this.content)) return [this.fact(p, `body ${name}`)]
    return []
  }

  private bind(t: Expr | undefined, v: Value, env: Env) {
    if (!t) return
    switch (t.type) {
      case "Name": env.set(String(t.id), v.length ? withStep(v, this.step(t, String(t.id))) : []); return
      case "Tuple": case "List": {
        const elts = (t.elts as Expr[]) ?? []
        const positional = v.some((f) => f.field?.startsWith("#")) && !elts.some((e) => e.type === "Starred")
        elts.forEach((e, i) => this.bind(e, positional ? pick(v, `#${i}`) : pick(v, undefined), env))
        return
      }
      case "Starred": case "Paren": this.bind(t.value as Expr, v, env); return
      case "Attribute": case "Subscript": {
        // obj.field = x / d['k'] = x: the root object now carries it (under that key for a dict).
        let root: Expr = t
        while (root.type === "Attribute" || root.type === "Subscript") root = root.value as Expr
        if (t.type === "Subscript") this.expr(t.index as Expr, env)
        if (root.type === "Name" && v.length) {
          const k = String(root.id)
          const key = t.type === "Subscript" && (t.index as Expr)?.type === "Str" && (t.value as Expr) === root ? String((t.index as Expr).value) : undefined
          const tagged = key ? v.map((f) => ({ ...f, field: key })) : v
          env.set(k, merge(env.get(k) ?? [], withStep(tagged, this.step(t, text(t)))))
        }
        return
      }
    }
  }

  private block(stmts: Stmt[], env: Env) {
    for (const s of stmts ?? []) this.stmt(s, env)
  }

  private branch(blocks: Stmt[][], env: Env) {
    const outs: Env[] = []
    for (const b of blocks) {
      const e: Env = new Map(env)
      this.block(b, e)
      outs.push(e)
    }
    for (const e of outs) for (const [k, v] of e) env.set(k, merge(env.get(k) ?? [], v))
  }

  private stmt(s: Stmt | undefined, env: Env) {
    if (!s || ++this.project.work > MAX_WORK) return
    switch (s.type) {
      case "ExprStmt": this.expr(s.value as Expr, env); return
      case "Assign": {
        const v = this.expr(s.value as Expr, env)
        for (const t of (s.targets as Expr[]) ?? []) this.bind(t, v, env)
        return
      }
      case "AugAssign": {
        const v = this.expr(s.value as Expr, env)
        const cur = this.expr(s.target as Expr, env)
        this.bind(s.target as Expr, s.op === "+" || s.op === "%" || s.op === "|" ? merge(cur, v) : cur, env)
        return
      }
      case "Return": if (s.value) this.returns = merge(this.returns, this.ret(s.value as Expr, env)); return
      case "If": this.expr(s.test as Expr, env); this.branch([(s.body as Stmt[]) ?? [], (s.orelse as Stmt[]) ?? []], env); return
      case "While": this.expr(s.test as Expr, env); this.block((s.body as Stmt[]) ?? [], env); this.block((s.orelse as Stmt[]) ?? [], env); return
      case "For": {
        const it = this.expr(s.iter as Expr, env)
        this.bind(s.target as Expr, it, env)
        this.block((s.body as Stmt[]) ?? [], env)
        this.block((s.orelse as Stmt[]) ?? [], env)
        return
      }
      case "Try": {
        this.block((s.body as Stmt[]) ?? [], env)
        for (const h of (s.handlers as PyNode[]) ?? []) this.block((h.body as Stmt[]) ?? [], env)
        this.block((s.orelse as Stmt[]) ?? [], env)
        this.block((s.final as Stmt[]) ?? [], env)
        return
      }
      case "With":
        for (const it of (s.items as PyNode[]) ?? []) {
          const v = this.expr(it.expr as Expr, env)
          if (it.as) this.bind(it.as as Expr, v, env)
        }
        this.block((s.body as Stmt[]) ?? [], env)
        return
      case "Match": {
        this.expr(s.subject as Expr, env)
        this.branch((s.cases as Stmt[][]) ?? [], env)
        return
      }
      case "FunctionDef": this.closure(s, env, [], undefined, undefined, true); return
      case "ClassDef":
        for (const m of (s.body as Stmt[]) ?? []) {
          if (m.type === "FunctionDef") this.closure(m, env, [], String(s.name), ((s.bases as PyNode[]) ?? []).map((b) => text(b.value as Expr)).join(","), true)
          else if (m.type !== "ClassDef") this.stmt(m, env)
        }
        return
      case "Raise": if (s.exc) this.expr(s.exc as Expr, env); return
      case "Assert": this.expr(s.test as Expr, env); return
    }
  }

  /** What a route returns is the response body: an HTML string built from input is reflected XSS. */
  private ret(e: Expr, env: Env): Value {
    const v = this.expr(e, env)
    if (this.route && this.depth === 0 && v.length && /<[a-zA-Z!/][^>]*>/.test(literalAll(e))) this.sink("xss", v, e, "return html")
    return v
  }

  private closure(fn: Stmt, env: Env, args: Value[] = [], cls?: string, bases?: string, defined = false): Value {
    if (this.depth >= MAX_DEPTH || this.callStack.has(fn)) return []
    const stack = new Set(this.callStack).add(fn)
    // Nested defs and methods keep the depth of a root when they are handlers (`def create_app(): @app.route …`, class views).
    const root = (routeOf(fn) || cls) && !args.length
    const c = new Ctx(this.project, this.file, this.content, root ? 0 : this.depth + 1, stack, root ? false : this.route)
    c.cls = cls ?? this.cls
    c.clsBases = bases ?? this.clsBases
    c.lib = this.lib
    c.libParams = this.lib && defined && !args.length && isPublic(String(fn.name)) && (!cls || isPublic(cls))
    return c.fn(fn, args, env)
  }

  private source(n: Expr): Value {
    const t = text(n)
    // request.args, request.form['x'] (via Subscript), self.request.GET, request.META
    if (n.type === "Attribute") {
      const recv = text(n.value as Expr)
      const attr = String(n.attr)
      if (REQ_NAME.test(recv) && REQ_MEMBER.test(attr) && this.looksLikeRequest(recv)) {
        // `r.` and `req.` are short names: need the attribute to be a request-only one.
        if (/^(?:r)$/.test(recv) && !/^(?:args|form|GET|POST|FILES|COOKIES|META|query_params|match_info)$/.test(attr)) return []
        // The request's own URL: sending the user back to it, or fetching it, stays on our site.
        if (/^(?:path|url|full_path|path_info|get_full_path)$/.test(attr)) return [{ ...this.fact(n, t), safe: new Set<Kind>(["sql", "cmd", "deser", "file", "redirect", "ssrf"]) }]
        if (attr === "files" || attr === "FILES") return [{ ...this.fact(n, t), upload: true, safe: new Set<Kind>(UPLOAD_SAFE) }]
        return [this.fact(n, t)]
      }
      // http.server handlers: the request line, headers and body.
      if (recv === "self" && /^(?:path|headers|rfile|requestline)$/.test(attr) && /HTTPRequestHandler|RequestHandler\b|Handler$/.test(this.clsBases)) return [this.fact(n, t)]
    }
    return []
  }

  /** `request` is the web request: imported from a framework, or a view's first parameter. */
  private looksLikeRequest(recv: string): boolean {
    if (recv === "self.request") return /\b(?:tornado|django|rest_framework|View|Handler)\b/.test(this.content)
    return /\b(?:flask|werkzeug|django|rest_framework|fastapi|starlette|bottle|aiohttp|sanic|tornado|falcon|quart|pyramid|litestar|web\.Request|HttpRequest)\b/.test(this.content)
  }

  expr(n: Expr | undefined, env: Env): Value {
    if (!n || ++this.project.work > MAX_WORK) return []
    switch (n.type) {
      case "Name": return env.get(String(n.id)) ?? []
      case "Attribute": {
        const src = this.source(n)
        if (src.length) return src
        const obj = this.expr(n.value as Expr, env)
        if (!obj.length) return []
        const attr = String(n.attr)
        if (/^(?:__len__|__class__|__name__|size|status_code|ok|id|pk|is_authenticated|is_staff|is_superuser|count|length|content_type|headers|mimetype)$/.test(attr)) return []
        // request.files['f'].filename / UploadFile.filename: the client's chosen name, now a full source.
        if (attr === "filename" && obj.some((f) => f.upload)) return withStep(obj.map((f) => (f.upload ? { ...f, upload: false, safe: new Set<Kind>() } : f)), this.step(n, text(n)))
        // Path(x).suffix / .name / .stem: one path component, no separator in it.
        if (NAME_PART.test(attr)) return withStep(makeSafe(pick(obj, attr), ["file"]), this.step(n, `.${attr}`))
        return pick(obj, attr)
      }
      case "Subscript": {
        const idx = n.index as Expr
        this.expr(idx, env)
        const obj = this.expr(n.value as Expr, env)
        return pick(obj, idx?.type === "Str" ? String(idx.value) : idx?.type === "Num" && /^\d+$/.test(String(idx.value)) && obj.some((f) => f.field?.startsWith("#")) ? `#${idx.value}` : undefined)
      }
      case "Str": {
        const parts = (n.parts as Expr[]) ?? []
        if (!parts.length) return []
        // A hole glued after other text in the same path component (f"{uid}_{name}") cannot start a `..`:
        // the joined component does not exist as a directory.
        const lits = String(n.value).split("{}")
        let hostOpen = true
        const vals = parts.map((p, i) => {
          let v = this.expr(p, env)
          const before = lits[i] ?? ""
          if (before && !/[/\\]$/.test(before)) v = makeSafe(v, ["file"])
          // Only a hole with nothing but a scheme before it picks the host (f"{base}/{id}", f"https://x/{q}" do not).
          const lead = lits.slice(0, i + 1).join("")
          if (!hostOpen || !(lead === "" || SCHEME_ONLY.test(lead))) v = makeSafe(v, ["ssrf", "redirect"])
          else if (v.length) hostOpen = false
          else if (i > 0 || lead) hostOpen = SCHEME_ONLY.test(lead) || lead === ""
          return v
        })
        return withStep(pick(merge(...vals), undefined), this.step(n, 'f"…{}"'))
      }
      case "BinOp": {
        const l = this.expr(n.left as Expr, env)
        const r = this.expr(n.right as Expr, env)
        if (n.op === "+") {
          // "https://api.x.com/" + q, base_url + "/" + q: the right side comes after the host.
          const leftLead = literalAll(n.left as Expr)
          const leftFixed = (n.left as Expr).type === "Str" ? !SCHEME_ONLY.test(leftLead) && leftLead !== "" : !l.length || l.every((f) => f.safe.has("ssrf"))
          return merge(l, leftFixed ? makeSafe(r, ["ssrf", "redirect"]) : r)
        }
        if (n.op === "%") {
          // "… %s …" % x pastes x; a number format (%d) does not carry text.
          const lit = literalAll(n.left as Expr)
          if (lit && !/%(?:\([^)]*\))?[-#0 +]*\d*(?:\.\d+)?[sr]/.test(lit)) return []
          return withStep(pick(merge(l, r), undefined), this.step(n, "% format"))
        }
        if (n.op === "/" && l.length) return l // Path(a) / b
        if (n.op === "/" && r.length && /Path|path|DIR|dir|root|ROOT|base|BASE/.test(text(n.left as Expr))) return withStep(r, this.step(n, "Path /"))
        if (n.op === "|") return merge(l, r)
        return []
      }
      case "BoolOp": return merge(...((n.values as Expr[]) ?? []).map((v) => this.expr(v, env)))
      case "IfExp": this.expr(n.test as Expr, env); return merge(this.expr(n.body as Expr, env), this.expr(n.orelse as Expr, env))
      case "Compare": this.expr(n.left as Expr, env); for (const c of (n.comparators as Expr[]) ?? []) this.expr(c, env); return []
      case "UnaryOp": this.expr(n.operand as Expr, env); return []
      case "Paren": case "Await": case "Starred": return this.expr(n.value as Expr, env)
      case "NamedExpr": {
        const v = this.expr(n.value as Expr, env)
        this.bind(n.target as Expr, v, env)
        return v
      }
      // A tuple keeps its positions (`return where, params` → `where, params = f()`); lists and sets mix.
      case "Tuple": return merge(...((n.elts as Expr[]) ?? []).map((e, i) => pick(this.expr(e, env), undefined).map((f) => ({ ...f, field: `#${i}` }))))
      case "List": case "Set": return merge(...((n.elts as Expr[]) ?? []).map((e) => pick(this.expr(e, env), undefined)))
      case "Dict": {
        const out: Value[] = []
        const keys = (n.keys as (Expr | undefined)[]) ?? []
        for (const [i, v] of ((n.values as Expr[]) ?? []).entries()) {
          const val = this.expr(v, env)
          const k = keys[i]
          if (k) this.expr(k, env)
          out.push(k?.type === "Str" && !(k.parts as Expr[])?.length ? val.map((f) => ({ ...f, field: String(k.value) })) : val)
        }
        return merge(...out)
      }
      case "ListComp": case "SetComp": case "GeneratorExp": case "DictComp": {
        const inner: Env = new Map(env)
        for (const g of (n.gens as PyNode[]) ?? []) {
          this.bind(g.target as Expr, pick(this.expr(g.iter as Expr, inner), undefined), inner)
          for (const c of (g.ifs as Expr[]) ?? []) this.expr(c, inner)
        }
        return merge(this.expr(n.elt as Expr, inner), n.value ? this.expr(n.value as Expr, inner) : [])
      }
      case "Lambda": return []
      case "Call": return this.call(n, env)
      case "Yield": return n.value ? this.expr(n.value as Expr, env) : []
      default: return []
    }
  }

  private call(n: Expr, env: Env): Value {
    const func = n.func as Expr
    const argNodes = ((n.args as PyNode[]) ?? [])
    const pos = argNodes.filter((a) => !a.name && !a.star).map((a) => a.value as Expr)
    const kw = new Map<string, Expr>()
    for (const a of argNodes) if (a.name) kw.set(String(a.name), a.value as Expr)
    const args = pos.map((a) => (a.type === "Lambda" ? [] : this.expr(a, env)))
    const kwVals = new Map<string, Value>()
    for (const [k, v] of kw) kwVals.set(k, this.expr(v, env))
    const starVals = argNodes.filter((a) => a.star).map((a) => this.expr(a.value as Expr, env))
    const ct = text(func)
    const method = func?.type === "Attribute" ? String(func.attr) : ct
    const recvNode = func?.type === "Attribute" ? (func.value as Expr) : undefined
    const recv = recvNode ? text(recvNode) : ""
    const recvVal = recvNode ? this.expr(recvNode, env) : []
    const line = this.step(n, `${ct.length > 50 ? method : ct}()`)
    const allArgs = merge(...args, ...kwVals.values(), ...starVals)

    this.sinks(n, ct, method, recv, args, pos, kw, kwVals, env)

    // Lambdas passed as callbacks: analysed with the receiver's elements.
    for (const a of pos) if (a.type === "Lambda") this.closure(a as Stmt, env, [recvVal])

    // Request sources that are calls.
    if (recvNode && /^(?:request|req|self\.request)$/.test(recv) && REQ_CALL.test(method) && this.looksLikeRequest(recv))
      return [this.fact(n, `${recv}.${method}()`)]
    if (recv === "self" && TORNADO_GET.test(method) && /\btornado\b/.test(this.content)) return [this.fact(n, `self.${method}(${pos[0]?.type === "Str" ? `'${pos[0].value}'` : ""})`)]
    // Django forms read straight from the request: form.cleaned_data comes back with whatever it was given.

    if (CLEAN_FUNCS.test(ct)) return []
    // In-memory file objects: the bytes inside, never a path.
    if (/^(?:io\.)?(?:BytesIO|StringIO)$/.test(ct)) return withStep(makeSafe(merge(...args), ["file", "cmd", "sql", "ssrf", "redirect"]), line)
    // re.sub(r"[^\w]", "", x): a character allowlist leaves nothing to inject.
    if (/^(?:re\.sub|re\.subn)$/.test(ct)) {
      const pat = pos[0]?.type === "Str" ? String(pos[0].value) : ""
      if (/^\[\^[^\]]*\]\+?$/.test(pat) && pos[1]?.type === "Str" && !String(pos[1].value)) return []
      return withStep(merge(args[1] ?? [], args[2] ?? []), line)
    }
    if (/^re\.(?:findall|search|match|fullmatch|split|finditer)$/.test(ct)) return withStep(args[1] ?? [], line)
    for (const [re, kinds] of SANITIZE) if (re.test(ct)) return withStep(makeSafe(merge(...args, recvVal), kinds), line)
    // The project's own confining or validating helpers.
    if (/(?:^|\.)_*(?:\w*safe_\w*|\w*_safe|sanitize\w*|clean_\w+|validate_\w+|\w*_within|is_safe_\w*|escape_\w+|check_\w*(?:path|name|id)\w*|ensure_\w*(?:within|inside|under|safe)\w*|\w*_checked\w*|get_checked\w*)$/i.test(ct) && !/^(?:safe_load|safe_dump)$/.test(method))
      return withStep(makeSafe(merge(...args, recvVal), ALL_KINDS), line)
    if (/^(?:yaml\.safe_load|json\.dumps|jsonify|JsonResponse|Response\.json)$/.test(ct)) return []
    if (PASS_FUNCS.has(ct) || PASS_FUNCS.has(method) && /^(?:os\.path|posixpath|json|base64|urllib\.parse|parse|copy|codecs)$/.test(recv)) return withStep(merge(...args, ...starVals), line)

    // Methods on a tainted value that hand its text on.
    if (recvVal.length && STRING_METHODS.has(method)) {
      // "…{}…".format(x) / ",".join(xs): the arguments are pasted in.
      const pasted = method === "format" || method === "format_map" || method === "join" || method === "replace" ? allArgs : []
      if (method === "get" || method === "getlist" || method === "pop" || method === "setdefault") {
        const key = pos[0]?.type === "Str" ? String(pos[0].value) : undefined
        return withStep(merge(pick(recvVal, key), args[1] ?? []), this.step(n, `${recv.length > 30 ? "" : recv}.${method}(${key ? `'${key}'` : ""})`))
      }
      return withStep(merge(pick(recvVal, undefined), pasted), line)
    }
    if (!recvVal.length && method === "format" && recvNode?.type === "Str") {
      const lead = String(recvNode.value).split("{")[0]
      return withStep(pick(lead && !SCHEME_ONLY.test(lead) ? makeSafe(allArgs, ["ssrf", "redirect"]) : allArgs, undefined), line)
    }
    if (!recvVal.length && method === "join" && recvNode?.type === "Str") return withStep(pick(allArgs, undefined), line)
    // Flask/Werkzeug FileStorage.save(dst): the destination path.
    if (method === "save" && recvVal.some((f) => f.upload) && args[0]?.length) this.sink("file", args[0], n, `${recv.length > 20 ? "file" : recv}.save()`)
    // pathlib: Path(x).read_text(), (base / name).unlink()
    if (recvVal.length && /^(?:read_text|read_bytes|write_text|write_bytes|unlink|rmdir|iterdir|open|rename|replace|touch|mkdir|glob|rglob)$/.test(method) &&
      recvNode && (/(?:^|\.)(?:Path|PurePath|pathlib\.Path)\(\)$/.test(recv) || recvNode.type === "BinOp" || recvVal.some((f) => f.steps.some((s) => /^(?:Path|pathlib\.Path|PurePath|Path \/|\w*\.joinpath)\(?\)?$/.test(s.text)))))
      this.sink("file", recvVal, n, `Path.${method}()`)
    if (recvVal.length && /^(?:open|read_text|read_bytes|resolve|absolute|joinpath|with_name|with_suffix|as_posix|expanduser)$/.test(method) && recvNode) {
      if (method === "joinpath") return withStep(merge(recvVal, allArgs), line)
      return withStep(recvVal, line)
    }
    if (!recvVal.length && method === "joinpath" && allArgs.length) return withStep(allArgs, line)

    // An argument checked against an allowlist just before the call.
    const lines = this.content.split(/\r?\n/).slice(Math.max(0, n.line - 9), n.line).join("\n")
    for (const [i, a] of pos.entries()) {
      if (a?.type !== "Name" || !args[i]?.length) continue
      const id = String(a.id)
      if (new RegExp(`\\bif\\s+(?:not\\s+)?${id}\\s+(?:not\\s+)?in\\s+[\\w.]*[A-Z_]{3,}|\\bif\\s+${id}\\s+in\\s*[\\[({]`).test(lines)) args[i] = makeSafe(args[i], ALL_KINDS)
    }

    // The project's own functions: analysed with these arguments.
    const qualified = recv === "self" || recv === "cls" ? (this.cls ? `${this.cls}.${method}` : "") : /^[A-Z]\w*$/.test(recv) ? `${recv}.${method}` : ""
    const def = recvVal.length ? undefined : (qualified ? this.project.lookup(qualified) : undefined) ??
      (!recvNode || recv === "self" || recv === "cls" || /^[a-z_][\w.]*$/.test(recv) ? this.project.lookup(method) : undefined)
    if (def && this.depth < MAX_DEPTH && !this.callStack.has(def.node) && (args.some((a) => a.length) || [...kwVals.values()].some((v) => v.length))) {
      const stack = new Set(this.callStack).add(def.node)
      const first = String((def.node.params as PyNode[])?.[0]?.name ?? "")
      const bound = !!def.cls && (first === "self" || first === "cls") && !((def.node.decorators as Expr[]) ?? []).some((d) => text(d) === "staticmethod")
      const callArgs = bound ? [[], ...args] : args
      const kwArgs = new Map([...kwVals].map(([k, v]) => [k, withStep(v, line)]))
      const ret = new Ctx(this.project, def.file, def.content, this.depth + 1, stack).fn(def.node, callArgs.map((a) => withStep(a, line)), new Map(), kwArgs)
      return withStep(ret, line)
    }
    // Value wrappers whose instance is still the text it was built from.
    if (/^(?:PurePosixPath|PureWindowsPath|SafeText|Template|Popen|Request)$/.test(method) && allArgs.length) return withStep(allArgs, line)
    return []
  }

  private sinks(n: Expr, ct: string, method: string, recv: string, args: Value[], pos: Expr[], kw: Map<string, Expr>, kwVals: Map<string, Value>, env: Env) {
    const a0 = args[0] ?? []
    const node0 = pos[0]
    const any = args.some((a) => a.length) || [...kwVals.values()].some((v) => v.length)
    if (!any) return

    // SQL text
    if (/^(?:execute|executemany|executescript|exec_driver_sql|mogrify|raw|read_sql|read_sql_query|fetch|fetchrow|fetchval|fetchone|fetchall|query|scalar|scalars)$/.test(method) && a0.length) {
      const generic = /^(?:execute|query|fetch|fetchrow|fetchval|fetchone|fetchall|scalar|scalars|raw)$/.test(method)
      const lit = literalAll(node0)
      const sqlLike = SQL_TEXT.test(lit)
      const dbLike = DB_RECV.test(recv) || /^(?:pd|pandas)$/.test(recv) || /\.objects$/.test(recv)
      const builtSql = sqlLike || (node0?.type === "Name" && new RegExp(`\\b${String(node0.id)}\\s*\\+?=\\s*[fFrRbBuU]{0,2}(?:'''|"""|'|")[^\\n]*\\b(?:SELECT|INSERT|UPDATE|DELETE|WHERE|FROM)\\b`, "i").test(this.content))
      // A query string passed whole (cursor.execute(q)) is SQL only if it was built by pasting: its facts saw an f-string, % or +.
      const pasted = a0.some((f) => f.steps.some((s) => /f"…\{\}"|% format|\.format\(\)|\.join\(\)|\+/.test(s.text))) || sqlLike || node0?.type === "BinOp" || node0?.type === "Str" && Array.isArray(node0.parts)
      if ((dbLike || builtSql) && (!generic || builtSql || dbLike && pasted) && node0 && !/^(?:Dict|List|Tuple)$/.test(node0.type))
        this.sink("sql", a0, n, `${recv ? `${recv.length > 30 ? "…" : recv}.` : ""}${method}()`)
    }
    if (/^(?:text|sqlalchemy\.text|sa\.text|RawSQL|literal_column|sql\.SQL)$/.test(ct) && a0.length && /sqlalchemy|RawSQL|psycopg/.test(this.content)) this.sink("sql", a0, n, `${ct}()`)
    if (method === "extra" && /objects|queryset|qs/i.test(recv)) for (const k of ["where", "select", "tables"]) if (kwVals.get(k)?.length) this.sink("sql", kwVals.get(k)!, n, `.extra(${k}=)`)

    // Shell
    if (/^(?:os\.system|os\.popen|os\.popen2|os\.popen3|commands\.getoutput|commands\.getstatusoutput|subprocess\.getoutput|subprocess\.getstatusoutput|popen2\.popen\d|asyncio\.create_subprocess_shell|create_subprocess_shell)$/.test(ct) && a0.length)
      this.sink("cmd", a0, n, `${ct}()`)
    if (/^(?:subprocess\.)?(?:run|call|check_call|check_output|Popen)$/.test(ct) && (ct.startsWith("subprocess.") || /from\s+subprocess\s+import/.test(this.content))) {
      const shell = kw.get("shell")
      const isShell = shell && !(shell.type === "Const" && shell.value === "False")
      if (isShell && a0.length) this.sink("cmd", a0, n, `${ct}(shell=True)`)
      else if (node0?.type === "List" || node0?.type === "Tuple") {
        // The program itself chosen by the input.
        const first = (node0.elts as Expr[])?.[0]
        const fv = first && first.type !== "Starred" ? this.expr(first, env) : []
        if (fv.length) this.sink("cmd", fv, n, `${ct}([program, …])`)
        // `["sh", "-c", x]` / `["bash", "-c", x]`: a shell after all.
        const els = (node0.elts as Expr[]) ?? []
        if (els[0]?.type === "Str" && /^(?:\/bin\/)?(?:ba|z|da)?sh$|^cmd(?:\.exe)?$|^powershell/.test(String(els[0].value)) && els[1]?.type === "Str" && /^(?:-c|\/c)$/i.test(String(els[1].value)) && a0.length)
          this.sink("cmd", a0, n, `${ct}([shell, -c, …])`)
      }
      // A string without shell=True names one program; an f-string there fails rather than injects.
    }
    if (/^os\.(?:exec[lv]p?e?|spawn[lv]p?e?)$/.test(ct) && any) this.sink("cmd", ct.startsWith("os.spawn") ? args[1] ?? [] : a0, n, `${ct}()`)

    // Code
    if (/^(?:eval|exec|compile|builtins\.eval|builtins\.exec|__import__|importlib\.import_module|import_module)$/.test(ct) && a0.length) this.sink("code", a0, n, `${ct}()`)
    if (/^(?:render_template_string|flask\.render_template_string|Template|jinja2\.Template|Environment\(\)\.from_string|from_string|mako\.template\.Template|Engine\(\)\.from_string|SandboxedEnvironment\(\)\.from_string)$/.test(ct) && a0.length) {
      if (ct === "Template" && !/\bjinja2\b|\bmako\b|from\s+django\.template\s+import|from\s+string\s+import\s+Template/.test(this.content)) { /* unknown Template class */ }
      else if (ct === "Template" && /from\s+string\s+import\s+Template/.test(this.content) && !/\bjinja2\b|\bmako\b/.test(this.content)) { /* string.Template does not run code */ }
      else this.sink("code", a0, n, `${ct}()`)
    }
    if (method === "from_string" && /env|jinja|Environment|templates?/i.test(recv) && a0.length) this.sink("code", a0, n, `${recv}.from_string()`)

    // Deserialization
    if (/^(?:pickle|cPickle|_pickle|dill|cloudpickle|joblib|marshal|shelve|jsonpickle)\.(?:loads?|decode|Unpickler|open)$/.test(ct) && a0.length) this.sink("deser", a0, n, `${ct}()`)
    if (/^(?:yaml\.load|yaml\.load_all|yaml\.unsafe_load|yaml\.full_load)$/.test(ct) && a0.length) {
      const loader = text(kw.get("Loader") ?? pos[1])
      if (ct === "yaml.unsafe_load" || ct === "yaml.full_load" || !/Safe|CSafe|BaseLoader/.test(loader)) this.sink("deser", a0, n, `${ct}()`)
    }
    if (/^(?:torch\.load|numpy\.load|np\.load|pandas\.read_pickle|pd\.read_pickle)$/.test(ct) && a0.length && !/weights_only\s*=\s*True|allow_pickle\s*=\s*False/.test(this.content.split(/\r?\n/)[n.line - 1] ?? "")) this.sink("deser", a0, n, `${ct}()`)

    // Files
    if (/^(?:open|io\.open|codecs\.open|os\.open|builtins\.open|aiofiles\.open|send_file|flask\.send_file|FileResponse|static_file|os\.remove|os\.unlink|os\.rmdir|os\.removedirs|os\.listdir|os\.scandir|os\.makedirs|os\.mkdir|os\.rename|os\.replace|os\.chmod|os\.stat|shutil\.rmtree|shutil\.copy|shutil\.copyfile|shutil\.copy2|shutil\.move|shutil\.copytree|tarfile\.open|zipfile\.ZipFile|np\.load|numpy\.load|pd\.read_csv|pandas\.read_csv|Image\.open|PIL\.Image\.open)$/.test(ct) && a0.length) {
      if (!(ct === "static_file" && kw.has("root"))) this.sink("file", a0, n, `${ct}()`)
    }
    if (/^(?:send_from_directory|flask\.send_from_directory)$/.test(ct) && a0.length) this.sink("file", a0, n, `${ct}(directory)`)

    // Outgoing requests
    const urlCall = /^(?:requests|httpx|urllib3|aiohttp|session|client|http|self\.session|self\.client|s|sess|http_client|async_client|self\.http)$/.test(recv) && /^(?:get|post|put|patch|delete|head|options|request|stream|urlopen)$/.test(method) ||
      /^(?:urlopen|urllib\.request\.urlopen|urllib2\.urlopen|request\.urlopen|urlretrieve|urllib\.request\.urlretrieve|requests\.request|httpx\.request|pycurl|urllib\.request\.Request|Request)$/.test(ct)
    if (urlCall) {
      const i = method === "request" && pos.length > 1 ? 1 : 0
      const v = args[i]?.length ? args[i] : kwVals.get("url") ?? []
      const node = args[i]?.length ? pos[i] : kw.get("url")
      if (v.length && (ct !== "Request" || /urllib/.test(this.content)) && this.hostFromInput(node, env, n.line)) this.sink("ssrf", v, n, `${ct}()`)
    }

    // Redirects
    if (/^(?:redirect|flask\.redirect|HttpResponseRedirect|HttpResponsePermanentRedirect|RedirectResponse|web\.HTTPFound|HTTPFound|bottle\.redirect|shortcuts\.redirect)$/.test(ct) || (method === "redirect" && recv === "self" && /tornado/.test(this.content))) {
      const v = a0.length ? a0 : kwVals.get("url") ?? []
      if (v.length && this.leavesSite(node0 ?? kw.get("url"))) this.sink("redirect", v, n, `${ct}()`)
    }

    // HTML
    if (/^(?:Markup|markupsafe\.Markup|mark_safe|SafeString|django\.utils\.safestring\.mark_safe)$/.test(ct) && a0.length) this.sink("xss", a0, n, `${ct}()`)
    if (/^(?:HTMLResponse|responses\.HTMLResponse)$/.test(ct) && (a0.length || kwVals.get("content")?.length)) this.sink("xss", a0.length ? a0 : kwVals.get("content")!, n, `${ct}()`)
    if (/^(?:HttpResponse|make_response|Response|web\.Response|flask\.Response)$/.test(ct) && a0.length) {
      const ctype = literalAll(kw.get("content_type") ?? kw.get("mimetype") ?? kw.get("media_type"))
      const html = /<[a-zA-Z!/][^>]*>/.test(literalAll(node0))
      if (html && (!ctype || /html/.test(ctype))) this.sink("xss", a0, n, `${ct}(html)`)
      // Django's HttpResponse(user text) is text/html by default.
      else if (ct === "HttpResponse" && !ctype && a0.some((f) => f.steps.length <= 3)) this.sink("xss", a0, n, `${ct}(input)`)
    }
    if (method === "write" && recv === "self" && /tornado/.test(this.content) && a0.length && /<[a-zA-Z!/]/.test(literalAll(node0))) this.sink("xss", a0, n, "self.write(html)")
  }

  /** The URL's host is chosen by the input: the value starts it, or it follows only a scheme. */
  private hostFromInput(node: Expr | undefined, env: Env, line: number, depth = 0): boolean {
    if (!node || depth > 3) return false
    if (node.type === "Paren") return this.hostFromInput(node.value as Expr, env, line, depth + 1)
    if (node.type === "Str") {
      const parts = (node.parts as Expr[]) ?? []
      if (!parts.length) return false
      const lead = String(node.value).split("{}")[0]
      // f"{base}/x/{id}" or f"https://{host}/…": the first hole picks the host; ours unless it is tainted.
      if (!lead || /^(?:https?:)?\/\/$/i.test(lead.trim())) return this.expr(parts[0], env).length > 0
      return false
    }
    if (node.type === "BinOp" && node.op === "+") {
      const left = node.left as Expr
      if (left.type === "Str" || left.type === "BinOp") return this.hostFromInput(left, env, line, depth + 1) || (literalLead(left) !== "" && /^(?:https?:)?\/\/$/i.test(literalLead(left).trim()) && this.expr(node.right as Expr, env).length > 0)
      return this.expr(left, env).length > 0
    }
    if (node.type === "Call" && (node.func as Expr)?.type === "Attribute" && (node.func as Expr).attr === "format") {
      const lead = literalLead(node)
      if (lead && !/^(?:https?:)?\/\/$/i.test(lead.trim())) return false
      return true
    }
    // A variable: what it was last assigned above (url = f"https://api.example.com/{q}").
    if (node.type === "Name") {
      const lines = this.content.split(/\r?\n/)
      const re = new RegExp(`^\\s*${String(node.id)}\\s*(?::[^=]+)?=\\s*(.+)$`)
      for (let i = line - 2; i >= Math.max(0, line - 80); i--) {
        const m = re.exec(lines[i] ?? "")
        if (!m) continue
        const body = parsePython(m[1])
        const e = body?.[0]?.type === "ExprStmt" ? (body[0].value as Expr) : undefined
        if (!e) break
        shift(e, i)
        return this.hostFromInput(e, env, i + 1, depth + 1)
      }
      return true
    }
    return !literalLead(node)
  }

  /** A redirect target that can leave the site: not a path on our own origin. */
  private leavesSite(node: Expr | undefined): boolean {
    if (!node) return false
    const lead = literalLead(node)
    if (!lead) return true
    return !(lead.startsWith("/") && !lead.startsWith("//") && !lead.startsWith("/\\")) && !/^\?|^#/.test(lead) && !/^https?:\/\/[^/{]/.test(lead)
  }

  sink(kind: Kind, v: Value, at: PyNode, label: string) {
    const line = at.line
    for (const f of v) {
      if (f.safe.has(kind)) continue
      // Library mode: only text that is pasted into SQL, a shell line or code; a path or URL from the caller is the API.
      if (f.lib && (!LIB_KINDS.has(kind) || /\[program/.test(label))) continue
      this.project.report({
        kind, file: this.file, line, sink: label,
        fact: { ...f, steps: [...f.steps, { line, text: label, file: this.file }] },
        guarded: guardedNear(this.content, line, f.src, kind, f.steps.find((x) => x.file === this.file && x.line > 0)?.line, f.steps.filter((x) => x.file === this.file).map((x) => x.text)) ||
          // A check inside a helper on the way (another file): the 30 lines above each step there.
          // A check inside a helper on the way (another file): around each step there, the early-return
          // guard often sits just below the parameter (`if not SAFE.match(x): return None`).
          f.steps.some((st) => st.line > 0 && guardedNear(this.project.contents.get(st.file) ?? "", st.line + 12, f.src, kind, Math.max(1, st.line - 30), f.steps.filter((x) => x.file === st.file).map((x) => x.text))),
      })
    }
  }
}

/** A check above the sink on the same value: allowlist, regex, path containment, host check. */
export function guardedNear(content: string, line: number, src: string, kind: Kind, from?: number, names: string[] = []): boolean {
  const start = from && from <= line && line - from <= 600 ? from - 1 : Math.max(0, line - 41)
  const window = content.split(/\r?\n/).slice(start, line).join("\n")
  const srcKey = /\['([^']+)'\]|\("([^"]+)"\)|\('([^']+)'\)|\["([^"]+)"\]/.exec(src)?.slice(1).find(Boolean) ?? src.split(".").pop()?.replace(/\(.*$/, "") ?? ""
  const keys = [...new Set([srcKey, ...names.filter((n) => /^[A-Za-z_]\w{2,}$/.test(n))])]
  return keys.some((key) => guardedBy(window, key, kind))
}

function guardedBy(window: string, key: string, kind: Kind): boolean {
  const k = key.replace(/[^\w]/g, "")
  // Containment: a resolved path compared with its base (a bare `.startswith('/features/')` routes, it does not confine).
  if (kind === "file" && /os\.path\.commonpath|os\.path\.commonprefix|is_relative_to|relative_to\s*\(|(?:realpath|abspath|normpath|resolve)\([^\n]*\)[\s\S]{0,400}?\.startswith\s*\(|\.\.['"]\s+(?:not\s+)?in\b|safe_join/.test(window)) return true
  if (kind === "redirect" && /url_has_allowed_host_and_scheme|is_safe_url|\.netloc\b|\.startswith\s*\(\s*['"]\/|urlparse\(/.test(window)) return true
  if (kind === "ssrf" && /\.netloc\b|\.hostname\b|ALLOWED_\w*HOSTS|allowed_\w*hosts|ipaddress\.|is_private/.test(window)) return true
  if (!k || k.length < 3) return false
  // A validating call on the value (`_validate_filename(filename, …)`, `check_name(name)`).
  if (new RegExp(`\\b_*(?:validate|check|verify|ensure|assert|sanitize)\\w*\\(\\s*${k}\\b`).test(window)) return true
  // `if x not in ALLOWED:` / `if x in (…)` / `assert x in …`
  if (new RegExp(`(?:\\b(?:if|elif|assert|and|or|not|while)\\s+|\\(\\s*)[\\w.]*\\b${k}\\b\\s+(?:not\\s+)?in\\s+[\\w.\\[({]`).test(window)) return true
  // `re.match(r'^\\w+$', x)` / `x.isalnum()` / `x.isdigit()`
  // Only as a condition: `if not re.fullmatch(r'\\w+', x):` — a search that extracts from the value is not a check.
  if (new RegExp(`\\b(?:if|elif|assert|and|or)\\s+(?:not\\s+)?(?:re\\.(?:match|fullmatch)\\([^\\n]*\\b${k}\\b|[\\w.]+\\.(?:match|fullmatch)\\(\\s*${k}\\b|${k}\\.(?:isalnum|isdigit|isidentifier|isnumeric|isdecimal|isalpha)\\(\\))`).test(window)) return true
  return false
}

/** Re-number a node parsed out of one line so its lines match the file (line index i → line i+1). */
function shift(n: unknown, i: number) {
  if (!n || typeof n !== "object") return
  if (Array.isArray(n)) { for (const c of n) shift(c, i); return }
  const node = n as PyNode
  if (typeof node.line === "number") node.line += i
  for (const [k, v] of Object.entries(node)) if (k !== "line" && v && typeof v === "object") shift(v, i)
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

const LIB_KINDS = new Set<Kind>(["sql", "cmd", "code"])
const isPublic = (name: string) => name === "__init__" || name === "__call__" || !name.startsWith("_")
/** A text-like parameter: not self, not typed as a number or an object, not defaulting to a number or flag. */
function libParam(p: PyNode): boolean {
  const name = String(p.name)
  if (p.kind !== "pos" && p.kind !== "kwonly") return false
  if (/^(?:self|cls|mcs|request|req|ctx|context|config|cfg|settings|options|opts|logger|log|session|conn|connection|cursor|engine|db|client|model|callback|cb|fn|func)$/.test(name)) return false
  const ann = annText(p.annotation as Expr)
  if (ann && !/^(?:str|Optional\[str\]|str \| None|Any|Text|AnyStr|Union\[str[^\]]*\])$/.test(ann)) return false
  const d = p.default as Expr | undefined
  if (d && (d.type === "Num" || d.type === "Const" && d.value !== "None" || d.type === "Dict" || d.type === "List" || d.type === "Tuple")) return false
  return true
}

const ROOT = /\b(?:request|req)\b|RequestHandler|\binfo\b|@\w+\.(?:route|get|post|put|patch|delete)\b|get_argument|get_query_argument|self\.request/

export const pyTaintScanner: Scanner = {
  id: "py-taint",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const project = new Project()
    const files: { file: string; content: string; body: Stmt[] }[] = []
    for (const file of ctx.files) {
      const norm = file.replace(/\\/g, "/")
      if (!PY_FILE.test(norm) || SKIP_PATH.test(norm)) continue
      if (files.length >= MAX_FILES) break
      const size = await ctx.fileSize?.(file)
      if (size != null && size > MAX_BYTES) continue
      const content = await ctx.readFile(file)
      if (!content || content.length > MAX_BYTES) continue
      const body = parsePython(content)
      if (!body) continue
      index(project, body, norm, content)
      project.contents.set(norm, content)
      files.push({ file: norm, content, body })
    }
    for (const f of files) {
      if (project.work > MAX_WORK) break
      const c = new Ctx(project, f.file, f.content, 0, new Set())
      c.lib = !ROOT.test(f.content)
      c.fn({ type: "FunctionDef", line: 0, name: "<module>", params: [], body: f.body, decorators: [] }, [], new Map())
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
      // One URL segment can only be `..`: one level up, with the rest of the path still ours.
      if (f.kind === "file" && f.fact.segment) confidence = "low"
      // Library mode: whether a caller passes untrusted text is not known here.
      if (f.fact.lib) confidence = "low"
      // Headers, cookies and the request's own URL are set by the attacker in their own request:
      // reflecting them back needs another bug first.
      if ((f.kind === "xss" || f.kind === "redirect") && /\.(?:headers|cookies|COOKIES|META)\b|get_cookie|\.(?:path|url|full_path)$/.test(f.fact.src) && confidence !== "low") confidence = "low"
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
