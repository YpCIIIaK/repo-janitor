import type { Issue } from "../schema"
import type { Scanner } from "../scanner"
import { parseFile, SKIP_KEYS, type Node } from "../ast"

type Value = "query" | "stored" | "allowlist" | "params" | "constant" | "dynamic" | "opaque"
type Env = Map<string, Value>
const node = (value: unknown): Node | undefined => value && typeof value === "object" && typeof (value as Node).type === "string" ? value as Node : undefined
function member(n: Node | undefined): string {
  if (!n) return ""
  if (n.type === "Identifier") return String(n.name)
  if (n.type === "MemberExpression" || n.type === "OptionalMemberExpression") {
    const p = node(n.property)
    const key = n.computed ? p?.type === "StringLiteral" ? String(p.value) : "" : String(p?.name ?? "")
    return key ? `${member(node(n.object))}.${key}` : ""
  }
  return ""
}
function evaluate(n: Node | undefined, env: Env, depth = 0): Value {
  if (!n || depth > 16) return "dynamic"
  if (["TSAsExpression", "TSNonNullExpression", "ParenthesizedExpression"].includes(n.type ?? "")) return evaluate(node(n.expression), env, depth + 1)
  if (["StringLiteral", "NumericLiteral", "BooleanLiteral", "NullLiteral"].includes(n.type ?? "")) return "constant"
  if (n.type === "Identifier") return env.get(String(n.name)) ?? "dynamic"
  const path = member(n)
  if (/^(?:window\.|document\.)?location\.(?:search|hash|href)$/.test(path) && !env.has(path.split(".")[0])) return "query"
  if (["MemberExpression","OptionalMemberExpression"].includes(n.type ?? "") && ["query","stored"].includes(evaluate(node(n.object),env,depth+1))) return evaluate(node(n.object),env,depth+1)
  const args = Array.isArray(n.arguments) ? n.arguments.map(node) : []
  if (n.type === "NewExpression" && member(node(n.callee)) === "Set" && !env.has("Set")) {
    const elements=args[0]?.type === "ArrayExpression" ? args[0].elements as unknown[] : []
    if (elements.length && elements.every(x=>node(x)?.type === "StringLiteral" && /^https?:\/\/[^/?#*\s]+$/.test(String(node(x)?.value)))) return "allowlist"
  }
  if (n.type === "NewExpression" && member(node(n.callee)) === "URLSearchParams" && !env.has("URLSearchParams") && evaluate(args[0], env, depth + 1) === "query") return "params"
  if (n.type === "CallExpression" || n.type === "OptionalCallExpression") {
    const callee = node(n.callee)
    if (["MemberExpression", "OptionalMemberExpression"].includes(callee?.type ?? "") && /\.(?:get|getAll)$/.test(member(callee)) && evaluate(node(callee?.object), env, depth + 1) === "params") return "query"
    if (/^(?:window\.)?(?:localStorage|sessionStorage)\.getItem$/.test(member(callee)) && !env.has(member(callee).split(".")[0])) return "stored"
    // An arbitrary function may validate or sanitize. Do not invent propagation.
    return "opaque"
  }
  if (["BinaryExpression", "LogicalExpression", "ConditionalExpression", "TemplateLiteral"].includes(n.type ?? "")) {
    const values = (n.type === "TemplateLiteral" ? n.expressions as unknown[] : n.type === "ConditionalExpression" ? [n.consequent,n.alternate] : [n.left,n.right]).map(x => evaluate(node(x),env,depth+1))
    if (values.includes("query")) return "query"
    if (values.includes("stored")) return "stored"
    if (values.every(x => x === "constant")) return "constant"
  }
  return "dynamic"
}
function dynamicMarkup(n: Node | undefined, env: Env): boolean {
  if (!n || !["query", "stored"].includes(evaluate(n, env))) return false
  // Report concatenation/interpolation and plain values, not arbitrary calls
  // whose contract may be HTML sanitization or Trusted Types creation.
  return ["TemplateLiteral", "BinaryExpression", "Identifier", "MemberExpression", "OptionalMemberExpression"].includes(n.type ?? "")
}

/** Local structural review rules, deliberately low-confidence until trust boundaries are checked. */
export const browserSecurityScanner: Scanner = {
  id: "browser-security",
  category: "security",
  async run(ctx) {
    const issues: Issue[] = []
    for (const file of ctx.files) {
      const norm = file.replace(/\\/g,"/")
      if (!/\.[cm]?[jt]sx?$/i.test(norm) || /(?:^|\/)(?:node_modules|vendor|dist|build|coverage|tests?|__tests__|fixtures?|examples?|docs)(?:\/|$)|\.(?:test|spec|d)\.[cm]?[jt]sx?$/i.test(norm)) continue
      const content = await ctx.readFile(file)
      if (!content || !/innerHTML|outerHTML|insertAdjacentHTML|postMessage|\borigin\b/.test(content)) continue
      const tree = parseFile(content,norm)
      if (!tree) continue
      const seen = new Set<string>()
      const emit = (rule: string, n: Node, title: string, detail: string) => {
        const start = typeof n.start === "number" ? n.start : 0
        const line = content.slice(0,start).split("\n").length
        const key = `${rule}:${line}`
        if (seen.has(key) || seen.size >= 60 || issues.length >= 120) return
        seen.add(key)
        issues.push({id:`browser-${rule}-${norm}:${line}`,category:"security",severity:"warning",title,detail,
          location:`${norm}:${line}`,ageDays:0,evidence:content.slice(start,typeof n.end === "number" ? Math.min(n.end,start+400) : start+200),
          scanner:"browser-security",rule:`browser-${rule}`,confidence:"low"})
      }
      const visit = (input: unknown, env: Env, parameterSource?: Value): void => {
        if (Array.isArray(input)) { for (const child of input) visit(child,env); return }
        const n = node(input)
        if (!n || seen.size >= 60 || issues.length >= 120) return
        // Lexical scopes: parameters shadow outer bindings. No cross-function
        // return-value inference or arbitrary callback source assumptions.
        if (["FunctionDeclaration","FunctionExpression","ArrowFunctionExpression","ObjectMethod","ClassMethod"].includes(n.type ?? "")) {
          const inner = new Map(env)
          if (node(n.id)?.name) inner.set(String(node(n.id)?.name),"dynamic")
          for (const p of n.params as unknown[] ?? []) shadow(node(p),inner)
          const first=node((n.params as unknown[] ?? [])[0])
          if (parameterSource && first?.type === "Identifier") inner.set(String(first.name),parameterSource)
          visit(n.body,inner)
          return
        }
        if (n.type === "ImportDeclaration") {
          for (const specifier of n.specifiers as Node[] ?? []) shadow(node(specifier.local),env)
          return
        }
        if (n.type === "CatchClause") {
          const inner=new Map(env);shadow(node(n.param),inner);visit(n.body,inner);return
        }
        if (n.type === "BlockStatement" || n.type === "Program") {
          const inner = new Map(env)
          // Hide all local lexical names before walking (including TDZ), so a
          // later local declaration cannot borrow an outer query source.
          for (const statement of n.body as Node[] ?? []) {
            if (statement.type === "VariableDeclaration") for (const d of statement.declarations as Node[] ?? []) shadow(node(d.id),inner)
          }
          visit(n.body,inner); return
        }
        if (n.type === "IfStatement") {
          visit(n.test,env)
          const guard=originGuard(node(n.test),env)
          const yes=new Map(env),no=new Map(env)
          if (guard) (guard.positive ? yes : no).set(guard.name,"constant")
          visit(n.consequent,yes);visit(n.alternate,no)
          if (guard && !guard.positive && exits(node(n.consequent))) env.set(guard.name,"constant")
          return
        }
        if (n.type === "VariableDeclarator") {
          visit(n.init,env)
          const id=node(n.id)
          if (id?.type === "Identifier") env.set(String(id.name),evaluate(node(n.init),env))
          else shadow(id,env)
          return
        }
        if (n.type === "AssignmentExpression") {
          const left=node(n.left),right=node(n.right)
          if (/\.(?:innerHTML|outerHTML)$/.test(member(left)) && dynamicMarkup(right,env)) emit("dynamic-html",n,"URL or browser storage value inserted as HTML",
            "A locally traced URL or browser storage value reaches an HTML parser sink. Review its source and HTML/attribute context; this is not proof of XSS. Prefer textContent or DOM element construction for text, or an audited sanitizer/Trusted Types policy for intended HTML. CSP may prevent script execution without preventing HTML injection.")
          visit(n.right,env)
          if (left?.type === "Identifier") {
            const name=String(left.name),value=evaluate(right,env)
            // Conditional writes are not a proof of validation; retain earlier
            // query provenance and keep this a review item, never an exploit claim.
            env.set(name,env.get(name)==="query" ? "query" : value)
          }
          return
        }
        if (n.type === "BinaryExpression" && ["===","==","!==","!="].includes(String(n.operator))) {
          const left=node(n.left),right=node(n.right)
          if ((/\.origin$/.test(member(left)) && evaluate(right,env)==="query") || (/\.origin$/.test(member(right)) && evaluate(left,env)==="query")) emit("query-origin",n,"Origin comparison uses a URL-derived trust value",
            "The origin being compared is derived locally from location or URLSearchParams. Checking event.origin against an attacker-selected address does not authenticate the intended sender. Verify a fixed allowlist or trusted host configuration and event.source. This local analysis does not prove validation is absent elsewhere or that a deployed application is exploitable.")
        }
        if (n.type === "CallExpression" || n.type === "OptionalCallExpression") {
          const callee=member(node(n.callee)),args=n.arguments as unknown[] ?? []
          const calleeNode=node(n.callee)
          const storedCallback=/^(?:chrome|browser)\.storage\.(?:local|sync|session)\.get$/.test(callee) && !env.has(callee.split(".")[0])
          const collectionCallback=/\.(?:forEach|map)$/.test(callee) && ["stored","query"].includes(evaluate(node(calleeNode?.object),env))
          if (storedCallback || collectionCallback) {
            visit(n.callee,env)
            for (const arg of args) {
              const argument=node(arg)
              const callback=["ArrowFunctionExpression","FunctionExpression"].includes(argument?.type ?? "")
              visit(arg,env,callback ? storedCallback ? "stored" : evaluate(node(calleeNode?.object),env) : undefined)
            }
            return
          }
          if (/\.insertAdjacentHTML$/.test(callee) && dynamicMarkup(node(args[1]),env)) emit("dynamic-html",n,"URL or browser storage value inserted as HTML",
            "insertAdjacentHTML parses a runtime value as markup. Trace its trust boundary; prefer text/DOM APIs or an audited HTML sanitizer. Script execution and deployed reachability are not established by this finding.")
          if (/^(?:window(?:\.(?:parent|top|opener))?|parent|top|opener)\.postMessage$/.test(callee) && evaluate(node(args[1]),env)==="query") emit("query-origin",n,"Messaging target origin comes from the URL",
            "The target origin is selected through URL-derived data. Review whether a fixed allowlist or trusted embedding contract binds it to the intended host before sending sensitive payloads. A dynamic target origin alone is not a demonstrated data leak.")
        }
        for (const [key,value] of Object.entries(n)) if (!SKIP_KEYS.has(key)) visit(value,env)
      }
      visit(tree,new Map())
    }
    return issues
  },
}
function shadow(n: Node | undefined,env: Env): void {
  if (!n) return
  if (n.type === "Identifier") {env.set(String(n.name),"dynamic");return}
  if (n.type === "AssignmentPattern") {shadow(node(n.left),env);return}
  if (n.type === "RestElement") {shadow(node(n.argument),env);return}
  if (n.type === "ObjectPattern") for (const p of n.properties as Node[] ?? []) shadow(node(p.value ?? p.argument),env)
  if (n.type === "ArrayPattern") for (const p of n.elements as unknown[] ?? []) shadow(node(p),env)
}

function originGuard(n: Node | undefined, env: Env): {name: string; positive: boolean} | undefined {
  if (!n) return
  if (n.type === "UnaryExpression" && n.operator === "!") {
    const guard=originGuard(node(n.argument),env)
    return guard ? {...guard,positive:!guard.positive} : undefined
  }
  const callee=node(n.callee),args=n.arguments as unknown[] ?? [],arg=node(args[0])
  if (n.type === "CallExpression" && /\.has$/.test(member(callee)) && evaluate(node(callee?.object),env)==="allowlist" && arg?.type === "Identifier" && env.get(String(arg.name))==="query") return {name:String(arg.name),positive:true}
}
function exits(n: Node | undefined): boolean {
  if (!n) return false
  if (["ReturnStatement","ThrowStatement"].includes(n.type ?? "")) return true
  if (n.type === "BlockStatement") return exits((n.body as Node[] ?? []).at(-1))
  return false
}
