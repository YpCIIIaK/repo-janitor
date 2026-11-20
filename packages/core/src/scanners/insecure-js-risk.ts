import { RegExpParser, visitRegExpAST, type AST } from "@eslint-community/regexpp"
import { analyse } from "scslre"
import { walk, type Node } from "../ast"
import type { CodeHit } from "./insecure-code"

const redos: CodeHit["rule"] = {
  id: "js-redos",
  lang: "js",
  re: /(?:)/,
  severity: "warning",
  title: "Ambiguous unbounded regular expression repetition",
  detail: "Multiple repetitions can consume the same input, causing excessive backtracking. Simplify the repetition and bound input length.",
}

const merge: CodeHit["rule"] = {
  id: "js-request-deep-merge",
  lang: "js",
  re: /(?:)/,
  severity: "warning",
  title: "Request object passed directly to a deep merge",
  detail: "Validate the request against an allowlisted schema before merging. Review the merge implementation and installed version for prototype key handling.",
}

const streamedKeyWrite: CodeHit["rule"] = {
  ...merge,
  id: "js-prototype-pollution-stream-key",
  title: "Stream-supplied key used in an object property assignment",
  detail: "Review how stream keys are validated. For dictionaries that store arbitrary keys, create own data properties or use a Map.",
}

function thisField(node: Node | undefined): string | undefined {
  const property = node?.property as Node | undefined
  return node?.type === "MemberExpression" && !node.computed &&
    (node.object as Node)?.type === "ThisExpression" && property?.type === "Identifier"
    ? String(property.name) : undefined
}

/** Flag the token-assembler pattern only when the class also shows dynamic
 * dispatch of token values and a method that stores its parameter as a key. */
export function streamedKeyWrites(node: Node): Node[] {
  if (node.type !== "ClassDeclaration" && node.type !== "ClassExpression") return []
  const methods = ((node.body as Node)?.body as Node[] | undefined) ?? []
  const fields = new Set<string>()
  const writes: Node[] = []
  const excludedKeys = new WeakMap<Node, Set<string>>()
  let dispatchesTokens = false
  for (const method of methods) {
    if (method.type !== "ClassMethod") continue
    const body = method.body as Node
    const statements = body.body as Node[]
    const params = method.params as Node[]
    const assignment = statements.length === 1 ? statements[0].expression as Node | undefined : undefined
    const rhs = assignment?.right as Node | undefined
    if (params.length === 1 && params[0].type === "Identifier" &&
        assignment?.type === "AssignmentExpression" && assignment.operator === "=" &&
        rhs?.type === "Identifier" && rhs.name === params[0].name) {
      const field = thisField(assignment.left as Node)
      if (field) fields.add(field)
    }
    walk(body, child => {
      if (child.type === "IfStatement") {
        const test = child.test as Node
        const left = test.left as Node | undefined
        const right = test.right as Node | undefined
        // Ordinary assignment cannot call the legacy prototype setter when
        // the branch excludes its exact property name.
        if (test.type === "BinaryExpression" && test.operator === "===" &&
            right?.type === "StringLiteral" && right.value === "__proto__") {
          const field = thisField(left)
          const alternate = child.alternate as Node | undefined
          const statements = alternate?.type === "BlockStatement" ? alternate.body as Node[] : [alternate]
          const expression = statements.length === 1 ? statements[0]?.expression as Node | undefined : undefined
          if (field && expression) excludedKeys.set(expression, new Set([field]))
        }
      }
      if (child.type === "AssignmentExpression" && child.operator === "=") writes.push(child)
      if (child.type !== "CallExpression" && child.type !== "OptionalCallExpression") return
      const callee = child.callee as Node | undefined
      const selector = callee?.property as Node | undefined
      const args = child.arguments as Node[] | undefined
      const value = args?.[0]
      if (callee?.type !== "MemberExpression" || !callee.computed ||
          (callee.object as Node)?.type !== "ThisExpression" ||
          selector?.type !== "MemberExpression" || selector.computed ||
          value?.type !== "MemberExpression" || value.computed) return
      const token = selector.object as Node
      const valueObject = value.object as Node
      if (token.type === "Identifier" && valueObject.type === "Identifier" &&
          token.name === valueObject.name && (selector.property as Node).name === "name" &&
          (value.property as Node).name === "value") dispatchesTokens = true
    })
  }
  if (!dispatchesTokens) return []
  return writes.filter(write => {
    const target = write.left as Node | undefined
    const key = thisField(target?.property as Node | undefined)
    return target?.type === "MemberExpression" && target.computed &&
      thisField(target.object as Node) !== undefined && key !== undefined && fields.has(key) &&
      !excludedKeys.get(write)?.has(key)
  })
}

export { streamedKeyWrite }

function constantPattern(node: Node | undefined, depth = 0): string | undefined {
  if (!node || depth > 12) return
  if (node.type === "StringLiteral" && typeof node.value === "string") return node.value
  if (node.type !== "BinaryExpression" || node.operator !== "+") return
  const left = constantPattern(node.left as Node, depth + 1)
  const right = constantPattern(node.right as Node, depth + 1)
  if (left !== undefined && right !== undefined && left.length + right.length <= 2_048) return left + right
}

const parser = new RegExpParser()
const singleCharacter = (node: AST.QuantifiableElement) =>
  node.type === "Character" || node.type === "CharacterClass" || node.type === "CharacterSet"

/** The star-height idea from safe-regex, restricted to unbounded repetitions
 * with a shared atom. Delimited repeats such as (a+,)+ are excluded. */
function ambiguousRepeat(pattern: string, flags: string): boolean {
  if (pattern.length > 2_048) return false
  try {
    const ast = parser.parsePattern(pattern, 0, pattern.length, {
      unicode: flags.includes("u"), unicodeSets: flags.includes("v"),
    })
    let found = false
    visitRegExpAST(ast, {
      onAlternativeEnter({ elements }) {
        // A suffix-only search can retry a long run at each starting position.
        // Restrict to a standalone repeated atom and skip sticky matching.
        const [first, last] = elements
        if (!flags.includes("y") && elements.length === 2 && first.type === "Quantifier" &&
            first.max === Infinity && singleCharacter(first.element) &&
            last.type === "Assertion" && last.kind === "end" &&
            last.parent.parent.type === "Pattern") found = true
        // Require a suffix that can fail after the repeated region.
        for (let i = 0; i + 1 < elements.length && !found; i++) {
          const repeat = elements[i]
          if (repeat.type !== "Quantifier" || repeat.max !== Infinity) continue
          const following = elements[i + 1]
          if ((repeat.element.type === "Group" || repeat.element.type === "CapturingGroup") &&
              following.type !== "Quantifier") {
            found = repeat.element.alternatives.some(({ elements: branch }) => {
              const inner = branch[0]
              return branch.length === 1 && inner.type === "Quantifier" &&
                inner.max === Infinity && singleCharacter(inner.element)
            })
            // Two repeatable branches are ambiguous when a literal branch is
            // an exact repetition of the other, e.g. (a|aa)+. A shared prefix
            // alone (e.g. (ab|ac)+) does not establish that ambiguity.
            const words = repeat.element.alternatives.map(({ elements: branch }) =>
              branch.length && branch.every(atom => atom.type === "Character" && atom.value < 128)
                ? branch.map(atom => atom.raw).join("") : "",
            ).filter(word => /^[a-zA-Z0-9]+$/.test(word))
            found ||= words.some(short => words.some(long =>
              long.length > short.length && long.length % short.length === 0 &&
              short.repeat(long.length / short.length) === long,
            ))
          }
          const suffix = elements[i + 2]
          if (following.type === "Quantifier" && following.max === Infinity &&
              singleCharacter(repeat.element) && repeat.element.raw === following.element.raw &&
              suffix && suffix.type !== "Quantifier") found = true
          if (following.type === "Quantifier" && following.max === Infinity &&
              repeat.element.type === "Character" && following.element.type === "Character" &&
              repeat.element.value === following.element.value && suffix?.type === "Assertion" &&
              suffix.kind === "end") found = true
        }
      },
    })
    return found || analyse({ source: pattern, flags }, { maxReports: 1 }).reports.length > 0
  } catch {
    return false
  }
}

export function jsRiskRule(node: Node): CodeHit["rule"] | undefined {
  if (node.type === "RegExpLiteral" && typeof node.pattern === "string" &&
      ambiguousRepeat(node.pattern, String(node.flags ?? ""))) return redos

  if (node.type === "CallExpression" || node.type === "NewExpression") {
    const callee = node.callee as Node | undefined
    const args = Array.isArray(node.arguments) ? node.arguments as Node[] : []
    if (callee?.type === "Identifier" && callee.name === "RegExp") {
      const pattern = constantPattern(args[0])
      const flags = args[1] ? constantPattern(args[1]) : ""
      if (pattern !== undefined && flags !== undefined && ambiguousRepeat(pattern, flags)) return redos
    }
  }

  if (node.type !== "CallExpression" || !Array.isArray(node.arguments)) return
  const callee = node.callee as Node | undefined
  const receiver = callee?.object as Node | undefined
  const method = callee?.property as Node | undefined
  if (callee?.type !== "MemberExpression" || callee.computed ||
      receiver?.type !== "Identifier" || receiver.name !== "_" ||
      method?.type !== "Identifier" || !["merge", "defaultsDeep"].includes(String(method.name))) return

  return node.arguments.slice(1).some((arg: Node) => {
    const object = arg.object as Node | undefined
    const property = arg.property as Node | undefined
    return arg.type === "MemberExpression" && !arg.computed &&
      object?.type === "Identifier" && ["req", "request"].includes(String(object.name)) &&
      property?.type === "Identifier" && ["body", "query"].includes(String(property.name))
  }) ? merge : undefined
}
