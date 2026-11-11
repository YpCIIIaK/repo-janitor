import type { Issue } from "../schema"
import type { ScanContext, Scanner } from "../scanner"
import { erlangAtom, erlangCall, erlangClauses, erlangContainer, erlangForms, erlangLine, erlangNonProductPath, erlangPairs, erlangSplit, erlangTokens, isErlangBlock, type ErlCall, type ErlToken } from "../erlang"

type Env = Map<string, Value>
interface Value {
  source?: string
  constant?: boolean
  localEncoding?: boolean
  items?: Value[]
  tokens?: ErlToken[]
  shape?: "binary" | "string" | "list" | "pairs" | "tuple" | "map" | "number" | "atom" | "function"
  fields?: Map<string, Value>
  fieldsComplete?: boolean
}
const UNKNOWN: Value = {}
const CONST: Value = { constant: true }
const BIFS = new Set(["binary_to_term", "list_to_atom", "binary_to_atom", "binary_to_existing_atom", "list_to_existing_atom", "open_port", "apply", "spawn", "spawn_link", "spawn_monitor"])
const TRANSFORMS = new Set([
  "erlang:binary_to_list", "erlang:list_to_binary", "erlang:iolist_to_binary", "erlang:binary_to_term",
  "unicode:characters_to_binary", "unicode:characters_to_list", "lists:flatten", "lists:concat",
  "jsx:decode", "jiffy:decode", "json:decode", "io_lib:format", "erlang:atom_to_list", "erlang:atom_to_binary",
  "os:find_executable",
])

function fieldKey(tokens: ErlToken[]): string | null {
  if (tokens.length === 1 && ["atom", "string", "number"].includes(tokens[0].kind)) return `${tokens[0].kind}:${tokens[0].value}`
  const binary = erlangContainer(tokens, "<<")
  return binary?.length === 1 && binary[0].length === 1 && binary[0][0].kind === "string" ? `binary:${binary[0][0].value}` : null
}

interface Scope {
  shadowed: Set<string>
  imported: Map<string, string>
  macros: Map<string, ErlToken[]>
}

function moduleOf(call: ErlCall, scope: Scope): string | undefined {
  if (call.module) return call.module
  const key = `${call.name}/${call.args.length}`
  if (scope.shadowed.has(key)) return undefined
  return scope.imported.get(key) ?? (BIFS.has(call.name) || ["binary_to_list", "list_to_binary", "iolist_to_binary", "term_to_binary"].includes(call.name) ? "erlang" : undefined)
}

function expand(tokens: ErlToken[], env: Env, scope: Scope, depth = 0): ErlToken[] {
  if (depth > 8) return tokens
  if (tokens.length === 1 && tokens[0].kind === "variable") {
    const value = env.get(tokens[0].value)?.tokens
    if (value && value !== tokens) return expand(value, env, scope, depth + 1)
  }
  if (tokens.length === 2 && tokens[0].value === "?") {
    const value = scope.macros.get(tokens[1].value)
    if (value && value[0]?.start < tokens[0].start) return expand(value, env, scope, depth + 1)
  }
  return tokens
}

function evaluate(tokens: ErlToken[], env: Env, scope: Scope, depth = 0): Value {
  if (!tokens.length || depth > 16) return UNKNOWN
  if (tokens.length === 1 && tokens[0].kind === "variable") return env.get(tokens[0].value) ?? UNKNOWN
  if (tokens.length === 1 && ["string", "number", "atom"].includes(tokens[0].kind)) return { constant: true, tokens, shape: tokens[0].kind === "string" ? "string" : tokens[0].kind as "number" | "atom" }
  const expanded = expand(tokens, env, scope)
  if (expanded !== tokens) return evaluate(expanded, env, scope, depth + 1)
  const pairs = erlangPairs(tokens)
  if (tokens[0].value === "(" && pairs.get(0) === tokens.length - 1) return evaluate(tokens.slice(1, -1), env, scope, depth + 1)
  if (tokens[0].kind === "keyword" && tokens[0].value === "fun") return { shape: "function", tokens }
  if (["=:=", "=/=", "==", "/=", "=<", ">=", "<", ">", "andalso", "orelse"].some(op => erlangSplit(tokens, op, pairs).length > 1)) return { constant: true, shape: "atom" }
  const call = erlangCall(tokens, 0, pairs)
  if (call && call.next === tokens.length) {
    const module = moduleOf(call, scope), key = `${module}:${call.name}`
    const from = `${key} (source offset ${call.start})`
    if (module === "cowboy_req") {
      if (["read_body", "read_urlencoded_body"].includes(call.name) && [1, 2].includes(call.args.length)) return { shape: "tuple", items: [CONST, { source: from, shape: call.name === "read_body" ? "binary" : "pairs" }, UNKNOWN] }
      if ((["qs", "parse_qs", "headers", "parse_cookies"].includes(call.name) && call.args.length === 1) ||
          (["binding", "header", "cookie"].includes(call.name) && [2, 3].includes(call.args.length))) return { source: from, shape: call.name === "headers" ? "map" : ["parse_qs", "parse_cookies"].includes(call.name) ? "pairs" : "binary" }
    }
    // Socket mode may be list or binary, so recv payload has no assumed shape.
    if ((module === "gen_tcp" || module === "ssl") && call.name === "recv" && [2, 3].includes(call.args.length)) return { shape: "tuple", items: [CONST, { source: from }] }
    const values = call.args.map(arg => evaluate(arg, env, scope, depth + 1))
    if ((key === "maps:get" || key === "proplists:get_value") && [2, 3].includes(call.args.length)) {
      const container = values[1] ?? UNKNOWN, fallback = values[2] ?? CONST, selector = fieldKey(call.args[0])
      if (selector && container.fields?.has(selector)) return container.fields.get(selector)!
      if (container.fieldsComplete) {
        if (selector) return fallback
        const possible = [...(container.fields?.values() ?? []), fallback]
        return { source: possible.find(x => x.source)?.source, constant: possible.every(x => x.constant) }
      }
      // A tainted selector does not make fixed container values attacker data.
      return { source: container.source ?? fallback.source, constant: !!container.constant && !!fallback.constant }
    }
    if (module === "erlang" && call.name === "term_to_binary") return { localEncoding: true, shape: "binary", tokens }
    if (module === "erlang" && ["binary_to_existing_atom", "list_to_existing_atom", "binary_to_atom", "list_to_atom"].includes(call.name)) return { source: values[0]?.source, constant: values[0]?.constant, shape: "atom", tokens }
    if (module === "gen_udp" && call.name === "recv" && [2, 3].includes(call.args.length)) return { shape: "tuple", items: [CONST, { shape: "tuple", items: [UNKNOWN, UNKNOWN, { source: from }] }] }
    if (key === "erl_scan:string") return { shape: "tuple", items: [CONST, { source: values[0]?.source, shape: "list" }, CONST] }
    if (key === "erl_parse:parse_exprs") return { shape: "tuple", items: [CONST, { source: values[0]?.source, shape: "list" }] }
    if (TRANSFORMS.has(key)) {
      const source = values.find(v => v.source)?.source
      const shape = /(?:list_to_binary|iolist_to_binary|characters_to_binary|atom_to_binary)$/.test(key) ? "binary" : /(?:binary_to_list|characters_to_list|atom_to_list|flatten|concat|format|find_executable)$/.test(key) ? "string" : undefined
      return { source, shape, constant: values.every(v => v.constant), tokens }
    }
    // Arbitrary user-defined functions may validate or transform their input.
    // Do not propagate taint through them just because an argument is nearby.
    return UNKNOWN
  }
  const tuple = erlangContainer(tokens, "{")
  if (tuple) {
    const items = tuple.map(x => evaluate(x, env, scope, depth + 1))
    return { items, shape: "tuple", constant: items.every(v => v.constant), tokens }
  }
  if (tokens[0].value === "#" && tokens[1]?.value === "{" && pairs.get(1) === tokens.length - 1) {
    const fields = new Map<string, Value>()
    let source: string | undefined, constant = true, fieldsComplete = true
    for (const entry of erlangSplit(tokens.slice(2, -1), ",")) {
      const parts = erlangSplit(entry, "=>")
      if (parts.length !== 2) return UNKNOWN
      const key = fieldKey(parts[0]), value = evaluate(parts[1], env, scope, depth + 1)
      if (!key) { constant = false; fieldsComplete = false; fields.clear() }
      else fields.set(key, value)
      source ??= value.source; constant &&= !!value.constant
    }
    return { shape: "map", fields, fieldsComplete, source, constant, tokens }
  }
  const list = erlangContainer(tokens, "[") ?? erlangContainer(tokens, "<<")
  if (list) {
    // Generator bindings have their own scope; a comprehension is not a literal
    // concatenation of the surrounding variables. The traversal handles bodies.
    if (erlangSplit(tokens.slice(1, -1), "||").length > 1) return UNKNOWN
    const items = list.map(x => evaluate(x, env, scope, depth + 1))
    const fields = new Map<string, Value>()
    let fieldsComplete = true
    list.forEach((part, i) => {
      const tuple = erlangContainer(part, "{"), key = tuple?.length === 2 ? fieldKey(tuple[0]) : null
      if (key && !fields.has(key)) fields.set(key, items[i].items?.[1] ?? UNKNOWN)
      if (!key) fieldsComplete = false
    })
    return { source: items.find(v => v.source)?.source ?? items.flatMap(v => v.items ?? []).find(v => v.source)?.source,
      fields, fieldsComplete: tokens[0].value === "[" && fieldsComplete, shape: tokens[0].value === "<<" ? "binary" : list.length > 0 && list.every(x => erlangContainer(x, "{") !== null) ? "pairs" : "list", constant: items.every(v => v.constant), tokens }
  }
  // Erlang list/binary construction and concatenation preserve payload origin.
  // Never use substring matching on variable names, comments or other functions.
  let source: string | undefined
  let constant = true
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind === "variable" && tokens[i + 1]?.value === "(") return UNKNOWN
    const inner = erlangCall(tokens, i, pairs)
    if (inner) {
      const value = evaluate(tokens.slice(i, inner.next), env, scope, depth + 1)
      source ??= value.source; constant &&= !!value.constant; i = inner.next - 1
    } else if (t.kind === "variable") {
      const value = env.get(t.value) ?? UNKNOWN
      source ??= value.source; constant &&= !!value.constant
    } else if (t.value === "?" || t.kind === "keyword") constant = false
  }
  return { source, constant, tokens }
}

function bind(pattern: ErlToken[], value: Value, env: Env): void {
  if (pattern.length === 1 && pattern[0].kind === "variable") {
    const name = pattern[0].value
    // Erlang variables are single-assignment: another match is not a write.
    if (name !== "_" && (!env.has(name) || value.constant)) env.set(name, value)
    return
  }
  const tuple = erlangContainer(pattern, "{")
  if (tuple && value.items) tuple.forEach((part, i) => bind(part, value.items?.[i] ?? UNKNOWN, env))
}

function scopeInfo(forms: ErlToken[][]): Scope {
  const scope: Scope = { shadowed: new Set(), imported: new Map(), macros: new Map() }
  const ambiguousMacros = new Set<string>()
  for (const form of forms) {
    if (form[0]?.value !== "-") {
      for (const clause of erlangClauses(form)) {
        const head = erlangCall(clause, 0)
        if (head && clause.slice(head.next).some(t => t.value === "->")) scope.shadowed.add(`${head.name}/${head.args.length}`)
      }
      continue
    }
    if (form[1]?.value === "define") {
      const args = erlangCall(form, 1)?.args
      if (args?.length === 2 && args[0].length === 1) {
        const name = args[0][0].value
        if (scope.macros.has(name)) ambiguousMacros.add(name)
        scope.macros.set(name, args[1])
      }
    }
    if (form[1]?.value === "undef") {
      const name = erlangCall(form, 1)?.args[0]?.[0]?.value
      if (name) ambiguousMacros.add(name)
    }
    if (form[1]?.value === "compile" && form.some(x => x.value === "no_auto_import")) {
      let specific = false
      for (let i = 0; i < form.length - 2; i++) if (form[i].kind === "atom" && form[i + 1].value === "/" && form[i + 2].kind === "number") {
        scope.shadowed.add(`${form[i].value}/${form[i + 2].value}`); specific = true
      }
      if (!specific) for (const name of BIFS) for (const arity of [1, 2, 3]) scope.shadowed.add(`${name}/${arity}`)
    }
    if (form[1]?.value === "import") {
      const args = erlangCall(form, 1)?.args, module = args && erlangAtom(args[0])
      if (!args || !module) continue
      for (const entry of erlangContainer(args[1], "[") ?? []) {
        if (entry.length === 3 && entry[0].kind === "atom" && entry[1].value === "/" && entry[2].kind === "number") scope.imported.set(`${entry[0].value}/${entry[2].value}`, module)
      }
    }
  }
  for (const name of ambiguousMacros) scope.macros.delete(name)
  return scope
}

function acceptsBadCertificate(tokens: ErlToken[]): boolean {
  const tuple = erlangContainer(tokens, "{")
  if (tuple?.length !== 2) return false
  const fn = tuple[0], pairs = erlangPairs(fn)
  if (fn[0]?.value !== "fun" || pairs.get(0) !== fn.length - 1) return false
  for (const clause of erlangSplit(fn.slice(1, -1), ";")) {
    const cp = erlangPairs(clause), open = clause[0]?.value === "(" ? 0 : 1, close = cp.get(open)
    if (close === undefined || clause[close + 1]?.value !== "->") return false
    const args = erlangSplit(clause.slice(open + 1, close), ",")
    if (args.length !== 3 || args[0].length !== 1 || args[0][0].kind !== "variable") return false
    const event = args[1], badCert = erlangContainer(event, "{")
    const anyEvent = event.length === 1 && event[0].kind === "variable"
    if (!anyEvent && !(badCert?.length === 2 && erlangAtom(badCert[0]) === "bad_cert")) continue
    const result = erlangContainer(clause.slice(close + 2), "{")
    // Only a direct unconditional acceptance is established. Guards, helper
    // calls, certificate patterns and unknown references may implement pinning.
    return !!result && result.length === 2 && ["valid", "valid_peer"].includes(erlangAtom(result[0]) ?? "")
  }
  return false
}

function tlsOptions(tokens: ErlToken[], env: Env, scope: Scope): "none" | "callback" | null {
  const entries = erlangContainer(expand(tokens, env, scope), "[")
  if (!entries) return null
  const options = entries.map(x => erlangContainer(x, "{"))
  const callbacks = options.filter(x => x?.length === 2 && erlangAtom(x[0]) === "verify_fun")
  if (callbacks.length === 1 && acceptsBadCertificate(expand(callbacks[0]![1], env, scope))) return "callback"
  // An unknown custom verification function can implement certificate pinning.
  if (callbacks.length) return null
  const verify = options.filter(x => x && erlangAtom(x[0]) === "verify")
  return verify.length === 1 && verify[0]?.length === 2 && erlangAtom(verify[0][1]) === "verify_none" ? "none" : null
}

/** Static calls plus intraclause, branch-scoped payload provenance. No execution. */
export function scanErlangSecurity(source: string, file: string): Issue[] {
  const forms = erlangForms(erlangTokens(source)), scope = scopeInfo(forms), issues: Issue[] = []
  const seen = new Set<string>()
  const emit = (call: ErlCall, rule: string, title: string, detail: string, value?: Value, definite = false) => {
    const line = erlangLine(source, call.start), id = `erlang-${rule}-${file}:${line}`
    if (seen.has(id)) return
    seen.add(id)
    issues.push({ id, category: "security", severity: value?.source && ["shell", "eval", "code-load", "tainted-dispatch", "external-executable"].includes(rule) ? "critical" : "warning",
      confidence: value?.source ? "high" : definite ? "medium" : "low", title, location: `${file}:${line}`, ageDays: 0,
      detail: detail + (value?.source ? ` Input provenance: ${value.source}.` : ""), evidence: source.slice(call.start, call.end).replace(/\s+/g, " ").slice(0, 180) })
  }
  for (const form of forms) {
    const attribute = form[0]?.value === "-"
    if (attribute && form[1]?.value !== "define") continue
    for (const clause of attribute ? [form] : erlangClauses(form)) {
      const pairs = erlangPairs(clause), env: Env = new Map()
      let body = 0
      if (!attribute) {
        const head = erlangCall(clause, 0, pairs)
        if (!head) continue
        body = clause.findIndex((t, i) => i >= head.next && t.value === "->") + 1
      if (!body) continue
        for (const arg of head.args) for (const t of arg) if (t.kind === "variable" && t.value !== "_") env.set(t.value, UNKNOWN)
        if (head.name === "handle_info" && head.args.length === 2) {
          const message = erlangContainer(head.args[0], "{")
          if (message?.length === 3 && ["tcp", "ssl"].includes(erlangAtom(message[0]) ?? "") && message[2].length === 1 && message[2][0].kind === "variable") env.set(message[2][0].value, { source: "handle_info socket payload" })
          if (message?.length === 5 && erlangAtom(message[0]) === "udp" && message[4].length === 1 && message[4][0].kind === "variable") env.set(message[4][0].value, { source: "handle_info UDP payload" })
        }
        if (head.name === "websocket_handle" && head.args.length === 2) {
          const frame = erlangContainer(head.args[0], "{")
          if (frame?.length === 2 && ["text", "binary"].includes(erlangAtom(frame[0]) ?? "") && frame[1].length === 1 && frame[1][0].kind === "variable") env.set(frame[1][0].value, { source: "websocket_handle client frame", shape: "binary" })
        }
      }
      let current = env
      const branches: { parent: Env; base: Env; kind: string; subject?: Value; subjectVariable?: string; patternStart: number; close?: number }[] = []
      for (let i = body; i < clause.length; i++) {
        const t = clause[i]
        if (branches.at(-1)?.kind === "comprehension" && branches.at(-1)?.close === i) current = branches.pop()!.parent
        if (["[", "<<", "{"].includes(t.value)) {
          const end = pairs.get(i)
          const parts = end !== undefined && end > i ? erlangSplit(clause.slice(i + 1, end), "||") : []
          if (parts.length === 2) {
            const base = new Map(current)
            // Generator variables shadow outer bindings even in the result
            // expression, which lexically appears before the generators.
            for (const group of erlangSplit(parts[1], ",")) for (const qualifier of erlangSplit(group, "&&")) {
              for (const arrow of ["<-", "<=", "<:-", "<:="]) {
                const generator = erlangSplit(qualifier, arrow)
                if (generator.length === 2) {
                  const collection = evaluate(generator[1], base, scope)
                  const element = collection.constant ? CONST : UNKNOWN
                  for (const name of generator[0]) if (name.kind === "variable" && name.value !== "_") base.set(name.value, element)
                }
              }
            }
            branches.push({ parent: current, base, kind: "comprehension", patternStart: -1, close: end })
            current = new Map(base)
          }
        }
        if (isErlangBlock(clause, i)) {
          let subject: Value | undefined, subjectVariable: string | undefined
          if (t.value === "case") {
            let end = i + 1
            while (end < clause.length && clause[end].value !== "of") {
              const close = pairs.get(end)
              end = close !== undefined && close > end ? close + 1 : end + 1
            }
            const expression = clause.slice(i + 1, end)
            subject = evaluate(expression, current, scope)
            if (expression.length === 1 && expression[0].kind === "variable") subjectVariable = expression[0].value
          }
          const base = new Map(current)
          if (t.value === "fun" && clause[i + 1]?.kind === "variable") base.set(clause[i + 1].value, UNKNOWN)
          branches.push({ parent: current, base, kind: t.value, subject, subjectVariable, patternStart: t.value === "receive" ? i + 1 : -1 })
          current = new Map(base)
          if (t.value === "fun") {
            const open = clause[i + 1]?.value === "(" ? i + 1 : i + 2
            const close = pairs.get(open)
            if (close !== undefined) for (const param of clause.slice(open + 1, close)) if (param.kind === "variable" && param.value !== "_") current.set(param.value, UNKNOWN)
          }
        }
        else if (t.kind === "keyword" && t.value === "end" && branches.length) current = branches.pop()!.parent
        else if (t.value === ";" && branches.length) {
          const branch = branches.at(-1)!
          current = new Map(branch.base); branch.patternStart = i + 1
        } else if (t.kind === "keyword" && t.value === "of" && branches.length) branches.at(-1)!.patternStart = i + 1
        else if (t.kind === "keyword" && ["catch", "after", "else"].includes(t.value) && branches.length) {
          const branch = branches.at(-1)!
          current = new Map(branch.base); branch.patternStart = -1; branch.subject = undefined
        }
        if (t.value === "->" && branches.length) {
          const branch = branches.at(-1)!
          if (branch.patternStart >= 0) {
            const raw = clause.slice(branch.patternStart, i), when = raw.findIndex(x => x.value === "when")
            const pattern = when < 0 ? raw : raw.slice(0, when)
            if (branch.subject) {
              bind(pattern, branch.subject, current)
              const literal = evaluate(pattern, new Map(), scope)
              if (branch.subjectVariable && literal.constant) current.set(branch.subjectVariable, literal)
            }
            if (branch.kind === "fun") {
              const open = pattern[0]?.value === "(" ? 0 : 1
              const close = erlangPairs(pattern).get(open)
              if (close !== undefined) for (const param of pattern.slice(open + 1, close)) if (param.kind === "variable" && param.value !== "_") current.set(param.value, UNKNOWN)
            }
            const message = erlangContainer(pattern, "{")
            if (branch.kind === "receive" && message?.length === 3 && ["tcp", "ssl"].includes(erlangAtom(message[0]) ?? "") && message[2].length === 1 && message[2][0].kind === "variable") current.set(message[2][0].value, { source: "receive socket payload" })
            branch.patternStart = -1
          }
        }
        if (t.value === "=") {
          let start = i - 1
          if (clause[start]?.value === "}") start = pairs.get(start) ?? start
          const tail = erlangSplit(clause.slice(i + 1), ",")[0]
          // A semicolon closes a clause/branch; never absorb a different branch.
          const rhs = erlangSplit(tail, ";")[0]
          bind(clause.slice(start, i), evaluate(rhs, current, scope), current)
        }
        const call = erlangCall(clause, i, pairs)
        if (!call) continue
        const module = moduleOf(call, scope), arity = call.args.length
        const value = evaluate(call.args[0] ?? [], current, scope)
        const accepts = (v: Value, shapes: NonNullable<Value["shape"]>[]) => !v.shape || shapes.includes(v.shape)
        if (module === "erlang" && call.name === "binary_to_term" && [1, 2].includes(arity) && accepts(value, ["binary"]) && !value.constant && !value.localEncoding) {
          const opts = arity === 2 ? erlangContainer(expand(call.args[1], current, scope), "[") : []
          if (opts && opts.every(x => ["safe", "used"].includes(erlangAtom(x) ?? "")) && !opts.some(x => erlangAtom(x) === "safe")) emit(call, "unsafe-term", "External term decoding without safe", "binary_to_term without [safe] can allocate attacker-selected atoms. If input is untrusted, enforce size limits, use [safe], and validate the decoded schema; [safe] is not an application sandbox.", value)
        }
        if (module === "erlang" && ((call.name === "list_to_atom" && arity === 1 && accepts(value, ["string", "list"])) || (call.name === "binary_to_atom" && [1, 2].includes(arity) && accepts(value, ["binary"]))) && !value.constant) emit(call, "dynamic-atom", "Runtime data converted to a new atom", "Atoms are not garbage-collected. Unbounded external names can exhaust the VM atom table. Prefer a finite lookup table or an existing-atom conversion with an allowlist. Trusted bounded startup names need manual review.", value)
        if (module === "os" && call.name === "cmd" && [1, 2].includes(arity) && accepts(value, ["string", "list", "atom"]) && !value.constant) emit(call, "shell", "Dynamic value passed to the operating-system shell", "os:cmd interprets shell syntax. If this command contains external input, use spawn_executable with separate arguments and validate executable/options.", value)
        if (module === "erlang" && call.name === "open_port" && arity === 2) {
          const port = erlangContainer(expand(call.args[0], current, scope), "{")
          if (port?.length === 2 && erlangAtom(port[0]) === "spawn") {
            const command = evaluate(port[1], current, scope)
            if (!command.constant) emit(call, "shell", "Dynamic shell command in open_port", "The {spawn, Command} port form uses a shell. Prefer {spawn_executable, Path} with a separate {args, Args} vector for external values.", command)
          }
          if (port?.length === 2 && erlangAtom(port[0]) === "spawn_executable") {
            const selected = evaluate(port[1], current, scope)
            if (selected.source && accepts(selected, ["string", "list", "binary"])) emit(call, "external-executable", "External input selects the host executable", "Separate argument vectors prevent shell parsing but do not authorize the executable itself. Keep the executable fixed or map operation names through an explicit allowlist; PATH lookup alone is not an allowlist.", selected)
            let executable = expand(port[1], current, scope)
            const find = erlangCall(executable, 0)
            if (find?.module === "os" && find.name === "find_executable" && find.args.length === 1) executable = find.args[0]
            const shell = executable.length === 1 && executable[0].kind === "string" ? executable[0].value.split(/[\\/]/).at(-1)?.toLowerCase() : ""
            if (shell && /^(?:ba|da|z|k)?sh$|^(?:cmd(?:\.exe)?|powershell(?:\.exe)?|pwsh(?:\.exe)?)$/.test(shell)) {
              for (const option of erlangContainer(expand(call.args[1], current, scope), "[") ?? []) {
                const tuple = erlangContainer(option, "{")
                if (tuple?.length !== 2 || erlangAtom(tuple[0]) !== "args") continue
                const args = erlangContainer(expand(tuple[1], current, scope), "[")
                if (args && args.length >= 2 && args[0].length === 1 && args[0][0].kind === "string" && /^(?:-[a-z]*c|\/c|-command|-encodedcommand|-enc)$/i.test(args[0][0].value)) {
                  const command = evaluate(args[1], current, scope)
                  if (!command.constant) emit(call, "shell", "Shell interpreter receives a dynamic command string", "spawn_executable avoids shell parsing only when the executable is not itself a shell interpreting -c, /c or -Command. Pass external values as arguments to a fixed executable instead.", command)
                }
              }
            }
          }
        }
        if (module === "erl_eval" && ["expr", "exprs"].includes(call.name) && arity >= 2 && accepts(value, call.name === "expr" ? ["tuple"] : ["list"]) && !value.constant) emit(call, "eval", "Runtime Erlang expression evaluation", "erl_eval executes expressions with runtime privileges. Do not evaluate externally supplied expressions; use a restricted data format and explicit operations instead.", value)
        if (module === "code" && call.name === "load_binary" && arity === 3) {
          const beam = evaluate(call.args[2], current, scope)
          if (accepts(beam, ["binary"]) && !beam.constant) emit(call, "code-load", "Runtime BEAM code loading", "Loaded BEAM code is fully trusted and can access the host. Accept code only from an authenticated, integrity-checked release process, never directly from request data.", beam)
        }
        if (module === "erlang" && ["apply", "spawn", "spawn_link", "spawn_monitor"].includes(call.name)) {
          if (arity === 3) {
            const targets = call.args.slice(0, 2).map(x => evaluate(x, current, scope))
            const external = targets.find(x => x.source && accepts(x, ["atom"]))
            if (external) emit(call, "tainted-dispatch", "External input selects the Erlang module or function", "Existing-atom conversion prevents atom allocation but does not authorize which loaded function may run. Map external operation names to an explicit finite set of approved module/function pairs. Ordinary trusted-cluster RPC and untrusted arguments to a fixed target are not this finding.", external)
          } else if (call.name === "apply" && arity === 2 && value.source && accepts(value, ["function"])) emit(call, "tainted-dispatch", "Externally supplied function object is invoked", "Do not invoke functions decoded from untrusted external terms. binary_to_term [safe] does not make a received function safe to execute. Choose approved operations explicitly.", value)
        }
        if (module === "ssl" && call.name === "connect" && [2, 3, 4].includes(arity)) {
          const candidates = arity === 2 ? [call.args[1]] : arity === 4 ? [call.args[2]] : [call.args[1], call.args[2]]
          const tls = candidates.map(x => tlsOptions(x, current, scope)).find(Boolean)
          if (tls === "none") emit(call, "tls-verify-none", "TLS client certificate verification explicitly disabled", "ssl:connect with {verify, verify_none} does not authenticate the server certificate. Use verify_peer and appropriate CA/hostname verification. Server-side ssl:listen is not this rule.", undefined, true)
          if (tls === "callback") emit(call, "tls-accept-bad-cert", "TLS client callback unconditionally accepts certificate errors", "The literal verify_fun accepts bad_cert events without a certificate pattern, guard or validation call. Keep verification failures fatal; use an explicit authenticated pinning/trust policy for legitimate exceptions.", undefined, true)
        }
        if (module === "httpc" && call.name === "request" && [4, 5].includes(arity)) {
          const request = erlangContainer(expand(call.args[1], current, scope), "{")
          const url = request?.[0]
          const plainHttp = url?.length === 1 && url[0].kind === "string" && /^http:\/\//i.test(url[0].value)
          if (!plainHttp) for (const option of erlangContainer(expand(call.args[2], current, scope), "[") ?? []) {
            const pair = erlangContainer(option, "{")
            if (pair?.length !== 2 || erlangAtom(pair[0]) !== "ssl") continue
            const tls = tlsOptions(pair[1], current, scope)
            if (tls === "none") emit(call, "tls-verify-none", "HTTP client TLS certificate verification explicitly disabled", "httpc request SSL options disable server certificate verification. Use verify_peer and suitable trust/hostname validation. Literal plain-HTTP requests and server listen options are not classified as TLS bypasses.", undefined, true)
            if (tls === "callback") emit(call, "tls-accept-bad-cert", "HTTP client TLS callback accepts certificate errors", "The literal HTTP client verification callback accepts bad_cert events without certificate validation. Keep those errors fatal or implement an explicit authenticated trust policy.", undefined, true)
          }
        }
      }
    }
  }
  return issues.sort((a, b) => priority(b) - priority(a)).slice(0, 60)
}

function priority(issue: Issue): number {
  return ({ high: 3, medium: 2, low: 1 }[issue.confidence ?? "medium"] * 10) + ({ critical: 3, warning: 2, info: 1 }[issue.severity])
}

export const erlangSecurityScanner: Scanner = {
  id: "erlang-security", category: "security",
  async run(ctx: ScanContext) {
    const issues: Issue[] = []
    for (const file of ctx.files) {
      const norm = file.replace(/\\/g, "/")
      if (!/\.(?:erl|hrl|escript)$/i.test(norm) || erlangNonProductPath(norm)) continue
      const source = await ctx.readFile(file)
      if (source) issues.push(...scanErlangSecurity(source, norm).map(x => ({ ...x, scanner: "erlang-security" })))
    }
    return issues.sort((a, b) => priority(b) - priority(a)).slice(0, 80)
  },
}
