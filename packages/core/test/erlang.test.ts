import { describe, it, expect } from "vitest"
import { erlangCall, erlangClauses, erlangForms, erlangTokens, erlangSplit } from "../src/erlang"

describe("Erlang lexical/form reader", () => {
  it("preserves real calls after comments, characters and multiline strings", () => {
    const source = '-module(test).\nf(X) -> $%, $(, $\\x{25}, "os:cmd(X)", erlang:binary_to_term(X).'
    const tokens = erlangTokens(source), forms=erlangForms(tokens)
    expect(forms).toHaveLength(2)
    const calls = forms[1].flatMap((_,i)=>{const x=erlangCall(forms[1],i);return x?[x]:[]})
    expect(calls.map(x=>x.module+':'+x.name)).toContain('erlang:binary_to_term')
    expect(calls.some(x=>x.module==='os')).toBe(false)
  })

  it("balances nested cases, fun blocks, binaries, maps and list comprehensions", () => {
    const tokens=erlangTokens('foo(case X of a -> fun(Y) -> {Y,<<1,2>>} end; b -> #{a=>[T || T <- X]} end, Other)')
    const call=erlangCall(tokens,0)
    expect(call?.args).toHaveLength(2)
    expect(erlangSplit(call!.args[0],';')).toHaveLength(1)
  })

  it("does not confuse function captures and record field access with form/block endings", () => {
    const forms=erlangForms(erlangTokens('f(X) -> fun m:f/1, X#r.field, 1.25.\ng() -> ok.'))
    expect(forms).toHaveLength(2)
    expect(forms[1][0].value).toBe('g')
  })

  it("never reinterprets an unterminated string as executable calls", () => {
    const tokens=erlangTokens('"binary_to_term(X)\nos:cmd(Y)')
    expect(tokens).toHaveLength(1)
    expect(tokens[0].kind).toBe('string')
  })

  it("keeps disjunctive guards inside the function clause", () => {
    const clauses=erlangClauses(erlangTokens('f(X) when is_binary(X); is_list(X) -> binary_to_term(X); f(_) -> ok'))
    expect(clauses).toHaveLength(2)
    expect(clauses[0].filter(x=>x.value===';')).toHaveLength(1)
  })
})
