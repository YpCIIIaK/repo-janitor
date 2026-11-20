import { expect, it } from "vitest"
import { scanSource } from "../../src/scanners/insecure-code"

const ids = (source: string) => scanSource(source, "js").map(hit => hit.rule.id)

it("finds the stream assembler write and leaves an own-property write alone", () => {
  const rule = "js-prototype-pollution-stream-key"
  const assembler = (write: string) => `class Builder {
    accept(token) { this[token.name]?.(token.value) }
    field(value) { this.key = value }
    store(value) { ${write} }
  }`
  const hits = scanSource(assembler("this.record[this.key] = value"), "js")
  expect(hits.find(hit => hit.rule.id === rule)).toMatchObject({ line: 4, tainted: false })
  expect(ids(assembler("Object.defineProperty(this.record, this.key, { value })"))).not.toContain(rule)
  expect(ids(assembler(`if (this.key === "__proto__") {
    Object.defineProperty(this.record, this.key, { value })
  } else { this.record[this.key] = value }`))).not.toContain(rule)
  expect(ids(assembler(`if (this.other === "__proto__") {
    return
  } else { this.record[this.key] = value }`))).toContain(rule)
  expect(ids("class Builder { store(value) { this.record[this.key] = value } }")).not.toContain(rule)
})

it("flags nested unbounded repetition without interpreting comments or strings", () => {
  expect(ids("const pattern = /^(a+)+$/")).toContain("js-redos")
  expect(ids("const pattern = new RegExp('^(a+)+$')")).toContain("js-redos")
  expect(ids("const pattern = new RegExp(config.pattern)")).not.toContain("js-redos")
  expect(ids("const pattern = new RegExp('^(a+)' + '+$')")).toContain("js-redos")
  expect(ids("const pattern = new RegExp(config.prefix + '+$')")).not.toContain("js-redos")
  expect(ids("const pattern = /^a+$/")).not.toContain("js-redos")
  expect(ids("const pattern = /[ ]+$/")).toContain("js-redos")
  expect(ids("const pattern = /[ ]+$/y")).not.toContain("js-redos")
  expect(ids("const pattern = /[^ ] [ ]*$/")).not.toContain("js-redos")
  expect(ids(String.raw`const pattern = /^a+\x61+$/`)).toContain("js-redos")
  expect(ids("const pattern = /^(?:[a-z]+)+!$/")).toContain("js-redos")
  expect(ids("const pattern = /^\\s+\\s+!$/")).toContain("js-redos")
  expect(ids("const pattern = /^(?:[a-z]+,)+!$/")).not.toContain("js-redos")
  expect(ids("const pattern = /^(?:ab|abab)+$/")).toContain("js-redos")
  expect(ids("const pattern = /^(?:ab|ac)+$/")).not.toContain("js-redos")
  expect(ids("// /^(a+)+$/\nconst docs = '/^(a+)+$/'")).not.toContain("js-redos")
})


it("flags a direct request object in deep merge sources", () => {
  expect(ids("_.merge(defaults, req.body)")).toContain("js-request-deep-merge")
  expect(ids("_.merge(defaults, validate(req.body))")).not.toContain("js-request-deep-merge")
  expect(ids("Object.assign(defaults, req.body)")).not.toContain("js-request-deep-merge")
})

it("detects overlapping character sets without flagging disjoint repeats", () => {
  expect(ids(String.raw`const pattern = /^\d*\w+!$/`)).toContain("js-redos")
  expect(ids(String.raw`const pattern = /^\d*[a-z]+!$/`)).not.toContain("js-redos")
})
