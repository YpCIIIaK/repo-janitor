import { analyse } from "scslre"
import { isSafePattern } from "redos-detector"
import { SKIP_KEYS, type Node } from "../ast"
import type { CodeHit } from "./insecure-code"

type Rule = CodeHit["rule"]
const redos: Rule = {
  id: "js-redos", lang: "js", re: /(?:)/, severity: "warning",
  title: "Potentially expensive regular expression",
  detail: "Review the regular expression for excessive backtracking and bound the length of input it processes.",
}
const dynamicRegExp: Rule = {
  ...redos,
  id: "js-dynamic-regexp",
  title: "Regular expression could not be resolved statically",
  detail: "Review which patterns can reach this call and bound the input length. The runtime pattern was not established by static analysis.",
}
const unresolvedRegExp: Rule = {
  ...redos,
  id: "js-regexp-analysis-budget",
  title: "Regular expression analysis exhausted its budget",
  detail: "The static analyzer reached a time or step limit. Review the expression and enforce an input length bound where it runs.",
}
const pollution: Rule = {
  id: "js-prototype-pollution", lang: "js", re: /(?:)/, severity: "warning",
  title: "Unverified keys flow into an object update",
  detail: "Validate allowed keys and check whether the resolved library version or implementation safely handles prototype properties.",
}

const lodashMethods = new Set(["merge", "mergeWith", "defaultsDeep", "set", "setWith"])
type Binding = {
  callable?: string
  sourceLine?: number
  enumerated?: boolean
  parameterDerived?: boolean
  pathRead?: { object: string; key: string }
  excludesPrototypeSetter?: boolean
  excludesConstructor?: boolean
  excludesPrototype?: boolean
}
type Frame = { name?: string; recursive: boolean; pathIterator: boolean; writes: CodeHit[] }
const node = (value: unknown) => value as Node | undefined
const nodes = (value: unknown) => Array.isArray(value) ? value as Node[] : []
const name = (n: Node | undefined) => n?.type === "Identifier" ? String(n.name) : undefined
const literal = (n: Node | undefined) => n?.type === "StringLiteral" ? String(n.value) : undefined
const lineOf = (n: Node | undefined) => (n?.loc as { start?: { line?: number } } | undefined)?.start?.line ?? 0

function excludedPrototypeKey(test: Node | undefined, forbidden = "__proto__"): string | undefined {
  if (test?.type === "LogicalExpression" && test.operator === "||") {
    const right = node(test.right)
    const simpleComparison = right?.type === "BinaryExpression" && right.operator === "===" &&
      ((name(node(right.left)) && literal(node(right.right)) !== undefined) ||
       (name(node(right.right)) && literal(node(right.left)) !== undefined))
    return excludedPrototypeKey(right, forbidden) ?? (simpleComparison ? excludedPrototypeKey(node(test.left), forbidden) : undefined)
  }
  if (test?.type !== "BinaryExpression" || test.operator !== "===") return
  const left = node(test.left), right = node(test.right)
  if (literal(left) === forbidden) return name(right)
  if (literal(right) === forbidden) return name(left)
}

function constant(n: Node | undefined, depth = 0): string | undefined {
  if (!n || depth > 12) return
  if (n.type === "TemplateLiteral" && nodes(n.expressions).length === 0) {
    return nodes(n.quasis).map(q => (q.value as { cooked?: string }).cooked ?? "").join("")
  }
  if (n.type !== "BinaryExpression" || n.operator !== "+") return literal(n)
  const left = constant(node(n.left), depth + 1), right = constant(node(n.right), depth + 1)
  if (left !== undefined && right !== undefined && left.length + right.length <= 2048) return left + right
}

function analysePattern(pattern: string, flags: string): Rule | undefined {
  try {
    if (analyse({ source: pattern, flags }, { maxReports: 1, assumeRejectingSuffix: false }).reports.length) return redos
  } catch { /* unsupported by scslre */ }
  if (flags.includes("v") || flags.includes("y")) return
  try {
    const result = isSafePattern(pattern, {
      caseInsensitive: flags.includes("i"),
      unicode: flags.includes("u"),
      dotAll: flags.includes("s"),
      multiLine: flags.includes("m"),
      maxSteps: 120_000,
      timeout: 30,
      downgradePattern: false,
    })
    if (result.error === "hitMaxSteps" || result.error === "timedOut") return unresolvedRegExp
    if (!result.safe && (result.error === null || result.error === "hitMaxScore")) return redos
  } catch { /* invalid or unsupported pattern */ }
}

function moduleBinding(path: string | undefined): string | undefined {
  if (path === "lodash" || path === "lodash-es") return "lodash"
  if (path === "jquery") return "jquery"
  const match = /^lodash(?:-es)?[./]([a-z]+)(?:\.js)?$/i.exec(path ?? "")
  return match && [...lodashMethods].find(method => method.toLowerCase() === match[1].toLowerCase()) || undefined
}

function methodOf(receiver: string | undefined, method: string | undefined): string | undefined {
  if (receiver === "lodash" && method && lodashMethods.has(method)) return method
  if (receiver === "jquery" && method === "extend") return "extend"
}

export function scanJsRisk(tree: Node, content: string, source: RegExp, window: number): CodeHit[] {
  const hits: CodeHit[] = []
  const text = (n: Node) => content.slice(Number(n.start), Number(n.end))
  const makeHit = (n: Node, rule: Rule, tainted: boolean): CodeHit =>
    ({ rule, line: lineOf(n), evidence: text(n).slice(0, 160), tainted })

  function visit(n: Node, bindings: Map<string, Binding>, frame?: Frame, pathIterator = false) {
    const line = lineOf(n)
    function callable(expr: Node | undefined): string | undefined {
      const id = name(expr)
      if (id) return bindings.has(id) ? bindings.get(id)?.callable : id === "_" ? "lodash" :
        id === "$" || id === "jQuery" ? "jquery" : undefined
      if (expr?.type === "MemberExpression") {
        return methodOf(callable(node(expr.object)), expr.computed ? literal(node(expr.property)) : name(node(expr.property)))
      }
      if (expr?.type === "CallExpression" && name(node(expr.callee)) === "require" && !bindings.has("require")) {
        return moduleBinding(literal(nodes(expr.arguments)[0]))
      }
    }

    function tainted(expr: Node | undefined): boolean {
      if (!expr) return false
      const id = name(expr)
      if (id && bindings.has(id)) {
        const from = bindings.get(id)?.sourceLine
        return from !== undefined && line - from <= window
      }
      switch (expr.type) {
        case "Identifier": return source.test(text(expr))
        case "MemberExpression":
        case "OptionalMemberExpression":
          return source.test(text(expr).replace(/(['"])(?:\\.|(?!\1).)*\1/g, "")) ||
            tainted(node(expr.object))
        case "BinaryExpression": return tainted(node(expr.left)) || tainted(node(expr.right))
        case "TemplateLiteral": return nodes(expr.expressions).some(tainted)
        default: return false
      }
    }

    function parameterDerived(expr: Node | undefined): boolean {
      const id = name(expr)
      if (id) return bindings.get(id)?.parameterDerived === true
      if (expr?.type === "MemberExpression") return parameterDerived(node(expr.object))
      if (expr?.type === "CallExpression") {
        const callee = node(expr.callee)
        const method = name(node(callee?.property))
        return callee?.type === "MemberExpression" && !callee.computed &&
          ["split", "slice", "substring", "substr", "shift", "at"].includes(method ?? "") &&
          parameterDerived(node(callee.object))
      }
      return false
    }

    function bind(target: Node | undefined, value: Binding) {
      const id = name(target)
      if (id) bindings.set(id, value)
      if (target?.type === "ObjectPattern") for (const property of nodes(target.properties)) {
        if (property.type !== "ObjectProperty") continue
        bind(node(property.value), { sourceLine: value.sourceLine,
          callable: methodOf(value.callable, name(node(property.key)) ?? literal(node(property.key))) })
      }
    }

    if (n.type === "ImportDeclaration" && n.importKind !== "type") {
      const module = moduleBinding(literal(node(n.source)))
      for (const specifier of nodes(n.specifiers)) {
        const imported = name(node(specifier.imported)) ?? literal(node(specifier.imported))
        bind(node(specifier.local), { callable: imported ? methodOf(module, imported) : module })
      }
    }

    if (n.type === "FunctionDeclaration" || n.type === "FunctionExpression" ||
        n.type === "ArrowFunctionExpression" || n.type === "ObjectMethod" || n.type === "ClassMethod") {
      const local = new Map(bindings)
      const functionName = name(node(n.id))
      if (functionName) local.set(functionName, {})
      for (const [index, p] of nodes(n.params).entries()) {
        const id = name(p) ?? name(node(p.left))
        if (id) local.set(id, { parameterDerived: true, enumerated: pathIterator && index === 0 })
      }
      const current: Frame = { name: functionName, recursive: pathIterator, pathIterator, writes: [] }
      const body = node(n.body)
      if (body) visit(body, local, current)
      if (current.recursive) hits.push(...current.writes)
      if (n.type === "FunctionDeclaration" && functionName) bindings.set(functionName, {})
      return
    }

    if (n.type === "RegExpLiteral" || n.type === "NewExpression" || n.type === "CallExpression" || n.type === "OptionalCallExpression") {
      const args = nodes(n.arguments)
      const callee = node(n.callee)
      if (n.type === "RegExpLiteral" || (name(callee) === "RegExp" && !bindings.has("RegExp") && args.length)) {
        const pattern = n.type === "RegExpLiteral" ? String(n.pattern) : constant(args[0])
        const flags = n.type === "RegExpLiteral" ? String(n.flags ?? "") : args[1] ? constant(args[1]) : ""
        if (pattern === undefined || flags === undefined || pattern.length > 2048) {
          hits.push(makeHit(n, dynamicRegExp, false))
        } else {
          const rule = analysePattern(pattern, flags)
          if (rule) hits.push(makeHit(n, rule, false))
        }
      }
      if (n.type === "CallExpression" || n.type === "OptionalCallExpression") {
        const sink = callable(callee)
        if (frame?.name && name(callee) === frame.name) {
          frame.recursive = true
          const traversed = bindings.get(name(args[0]) ?? "")?.pathRead
          if (traversed && args.slice(1).some(parameterDerived)) {
            hits.push(makeHit(n, pollution, args.some(tainted)))
          }
        }
        const inputs = sink === "extend" && args[0]?.type === "BooleanLiteral" && args[0].value === true
          ? args.slice(args.length === 2 ? 1 : 2)
          : sink === "set" || sink === "setWith" ? args.slice(1, 2)
          : sink && lodashMethods.has(sink) ? args.slice(1) : []
        if (inputs.length) hits.push(makeHit(n, pollution, inputs.some(tainted)))
      }
    }

    if (n.type === "AssignmentExpression" && n.operator === "=") {
      const left = node(n.left)
      const key = node(left?.property)
      const binding = bindings.get(name(key) ?? "")
      if (frame && left?.type === "MemberExpression" && left.computed) {
        const parent = node(left.object)
        const pathKeys = [key]
        for (let segment = parent; segment?.type === "MemberExpression"; segment = node(segment.object)) {
          if (segment.computed) pathKeys.push(node(segment.property))
        }
        const exposed = pathKeys.filter(part => {
          const origin = bindings.get(name(part) ?? "")
          return !(origin?.excludesPrototypeSetter && origin.excludesConstructor && origin.excludesPrototype)
        })
        const high = exposed.some(tainted)
        const fromPath = exposed.some(parameterDerived)
        if (pathKeys.length > 1 && (high || fromPath)) hits.push(makeHit(n, pollution, high))
        else if ((!binding?.excludesPrototypeSetter || frame.pathIterator && !binding.excludesConstructor) &&
                 (tainted(key) || binding?.enumerated)) {
          frame.writes.push(makeHit(n, pollution, tainted(key)))
        }
      }
    }

    // Child scopes can read earlier bindings but cannot leak conditional writes.
    const childBindings = n.type === "BlockStatement" || n.type === "IfStatement" ||
      n.type === "ForInStatement" || n.type === "ForOfStatement" ? new Map(bindings) : bindings
    if (n.type === "ForInStatement" || n.type === "ForOfStatement") {
      const left = node(n.left)
      const declaration = nodes(left?.declarations)[0]
      const id = name(node(declaration?.id) ?? left)
      if (id) childBindings.set(id, { sourceLine: tainted(node(n.right)) ? line : undefined,
        enumerated: n.type === "ForInStatement", parameterDerived: parameterDerived(node(n.right)) })
    }
    for (const field of Object.keys(n)) {
      if (SKIP_KEYS.has(field) || ((n.type === "ForInStatement" || n.type === "ForOfStatement") && field === "left")) continue
      const value = n[field]
      for (const child of Array.isArray(value) ? value : [value]) {
        if (!child || typeof child !== "object" || typeof (child as Node).type !== "string") continue
        const callee = node(n.callee)
        const args = nodes(n.arguments)
        const iteratesPath = n.type === "CallExpression" && field === "arguments" &&
          (name(callee) === "forEach" && child === args[1] && parameterDerived(args[0]) ||
           callee?.type === "MemberExpression" && !callee.computed && name(node(callee.property)) === "forEach" &&
           child === args[0] && parameterDerived(node(callee.object)))
        visit(child as Node, childBindings, frame, iteratesPath)
      }
    }
    if (n.type === "VariableDeclarator" || n.type === "AssignmentExpression") {
      const value = node(n.init ?? n.right)
      const object = name(node(value?.object)), key = name(node(value?.property))
      bind(node(n.id ?? n.left), {
        callable: n.operator && n.operator !== "=" ? undefined : callable(value),
        sourceLine: tainted(value) ? line : undefined,
        parameterDerived: parameterDerived(value),
        pathRead: value?.type === "MemberExpression" && value.computed && object && key &&
          parameterDerived(node(value.property)) ? { object, key } : undefined,
      })
    }
    if (n.type === "IfStatement" && !n.alternate) {
      const test = node(n.test)
      const branch = node(n.consequent)
      const exit = branch?.type === "BlockStatement" && nodes(branch.body).length === 1
        ? nodes(branch.body)[0] : branch
      if ((exit?.type === "ContinueStatement" && !exit.label) || exit?.type === "ThrowStatement" ||
          (exit?.type === "ReturnStatement" && !exit.argument)) {
        for (const [forbidden, field] of [
          ["__proto__", "excludesPrototypeSetter"],
          ["constructor", "excludesConstructor"],
          ["prototype", "excludesPrototype"],
        ] as const) {
          const key = excludedPrototypeKey(test, forbidden)
          const binding = key ? bindings.get(key) : undefined
          if (key && (binding?.enumerated || binding?.parameterDerived)) {
            bindings.set(key, { ...binding, [field]: true })
          }
        }
      }
      const expression = exit?.type === "ExpressionStatement" ? node(exit.expression) : undefined
      const alias = expression?.type === "AssignmentExpression" ? name(node(expression.left)) : undefined
      const read = alias ? bindings.get(alias)?.pathRead : undefined
      const fallback = node(expression?.right)
      const target = node(fallback?.left)
      const guard = test?.type === "LogicalExpression" && test.operator === "||" ? node(test.right) : test
      const check = guard?.type === "UnaryExpression" && guard.operator === "!" ? node(guard.argument) : undefined
      const checkArgs = nodes(check?.arguments)
      if (alias && read && expression?.operator === "=" &&
          fallback?.type === "AssignmentExpression" && fallback.operator === "=" &&
          target?.type === "MemberExpression" && target.computed &&
          name(node(target.object)) === read.object && name(node(target.property)) === read.key &&
          node(fallback.right)?.type === "ObjectExpression" &&
          check?.type === "CallExpression" && name(node(check.callee)) === "hasOwn" &&
          name(checkArgs[0]) === read.object && name(checkArgs[1]) === read.key &&
          (guard === test || (node(test?.left)?.type === "UnaryExpression" &&
            node(test?.left)?.operator === "!" && name(node(node(test?.left)?.argument)) === alias))) {
        bindings.set(alias, { ...bindings.get(alias), pathRead: undefined })
      }
    }
  }
  visit(tree, new Map())
  return hits.filter(hit => hit.line > 0)
}
