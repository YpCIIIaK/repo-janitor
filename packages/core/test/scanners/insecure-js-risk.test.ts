import { expect, it, vi } from "vitest"
import * as redosDetector from "redos-detector"
import { scanSource } from "../../src/scanners/insecure-code"

vi.mock("redos-detector", { spy: true })

const find = (code: string, id: string) => scanSource(code, "js").find(hit => hit.rule.id === id)
const pollution = "js-prototype-pollution"
const redos = "js-redos"

it.each(["hitMaxSteps", "timedOut"] as const)("keeps %s as a low-confidence budget finding", error => {
  const detector = vi.mocked(redosDetector.isSafePattern).mockReturnValueOnce({
    safe: false, error, trails: [], score: { infinite: false, value: 1 },
    pattern: "^a+$", patternDowngraded: false,
  })
  try {
    const hits = scanSource("const pattern = /^a+$/", "js")
    expect(hits.map(hit => [hit.rule.id, hit.tainted])).toEqual([["js-regexp-analysis-budget", false]])
    expect(detector).toHaveBeenCalledWith("^a+$", expect.objectContaining({ maxSteps: 120_000, timeout: 30 }))
  } finally {
    detector.mockRestore()
  }
})

it.each([
  ["_.mergeWith({}, req.body)", "direct lodash method"],
  ["import combine from 'lodash/merge'; const data = ctx.request.query;\ncombine({}, data)", "subpath import"],
  ["import { setWith as update } from 'lodash-es';\nupdate({}, req.params.key, 'value')", "renamed path setter"],
  ["const { defaultsDeep: hydrate } = require('lodash');\nconst alias = hydrate;\nalias({}, location.search)", "destructured and aliased CommonJS"],
  ["import jq from 'jquery';\njq.extend(true, {}, req.body)", "deep jQuery extend"],
  ["$.extend(true, req.body)", "deep jQuery extend on receiver"],
])("tracks a source to %s (%s)", code => {
  expect(find(code, pollution)?.tainted).toBe(true)
})

it("keeps unknown sources low and ignores shallow or unrelated calls", () => {
  expect(find("_.merge({}, options)", pollution)?.tainted).toBe(false)
  expect(find("let payload = req.body;\npayload = {};\n_.merge({}, payload)", pollution)?.tainted).toBe(false)
  expect(find("_.set({}, 'name', req.body)", pollution)?.tainted).toBe(false)
  expect(find("$.extend(false, {}, req.body)", pollution)).toBeUndefined()
  expect(find("const _ = service;\n_.merge({}, req.body)", pollution)).toBeUndefined()
  expect(find("metadata.merge({}, req.body)", pollution)).toBeUndefined()
  expect(find("_.merge({}, 'req.body')", pollution)?.tainted).toBe(false)
  expect(find(`const data = req.body;${"\n".repeat(26)}_.merge({}, data)`, pollution)?.tainted).toBe(false)
})

it("tracks input keys into writes in a recursive function without matching its name", () => {
  const copy = (fn: string, assignment: string) => `function ${fn}(target, input) {
    const key = req.params.name;
    if (input.child) ${fn}(target, input.child);
    ${assignment}
  }`
  for (const fn of ["copy", "combine"]) {
    expect(find(copy(fn, "target[key] = input.value"), pollution)?.tainted).toBe(true)
    expect(find(copy(fn, "Object.defineProperty(target, key, { value: input.value })"), pollution)).toBeUndefined()
  }
})

it("uses static regex analysis and keeps unresolved constructors low", () => {
  expect(find("const pattern = /^(a+)+$/", redos)?.tainted).toBe(false)
  expect(find("const pattern = new RegExp('^(a+)' + '+$')", redos)?.tainted).toBe(false)
  expect(find("const pattern = new RegExp(config.prefix + '$')", "js-dynamic-regexp")?.tainted).toBe(false)
  expect(find("const pattern = new RegExp(config.prefix + '$')", redos)).toBeUndefined()
  expect(find("const pattern = /^a+$/", redos)).toBeUndefined()
  expect(find(String.raw`const pattern = /^\d*[a-z]+!$/`, redos)).toBeUndefined()
  expect(find("// /^(a+)+$/\nconst docs = '/^(a+)+$/'", redos)).toBeUndefined()
})

it("uses low confidence for keys from an unknown object and respects a loop guard", () => {
  const fixture = (guard: string) => `function combine(result, delta) {
    for (const field in delta) {
      ${guard}
      result[field] = combine(result[field], delta[field])
    }
    return result
  }`
  expect(find(fixture(""), pollution)?.tainted).toBe(false)
  expect(find(fixture("if (field === '__proto__') continue"), pollution)).toBeUndefined()
  expect(find(fixture("if (field === '__proto__' || field === 'constructor') continue"), pollution)).toBeUndefined()
  expect(find(fixture("if (field === '__proto__' && strict) continue"), pollution)?.tainted).toBe(false)
})

it("tracks key-path segments from parameters without requiring HTTP input", () => {
  expect(find(`function update(target, path, value) {
    const keys = path.split(".")
    target[keys[0]][keys[1]] = value
  }`, pollution)?.tainted).toBe(false)
  expect(find(`function update(target, key, value) {
    target[req.params.segment][key] = value
  }`, pollution)?.tainted).toBe(true)
})

it("tracks callback path elements and respects explicit key rejection", () => {
  const update = (guards: string) => `function update(target, path, value) {
    path.forEach(part => {
      ${guards}
      target[part] = value
    })
  }`
  expect(find(update(""), pollution)?.tainted).toBe(false)
  expect(find(update(`if (part === "__proto__") throw Error()
    if (part === "constructor") throw Error()`), pollution)).toBeUndefined()
})

it("does not follow a guarded own-property fallback as an inherited sub-object", () => {
  const update = (guard: string) => `function update(target, path, value) {
    const first = path[0]
    let child = target[first]
    ${guard}
    if (path.length > 1) update(child, path.slice(1), value)
    else target[first] = value
  }`
  expect(find(update(""), pollution)?.tainted).toBe(false)
  expect(find(update("if (!child || !hasOwn(target, first)) child = (target[first] = {})"), pollution))
    .toBeUndefined()
})
