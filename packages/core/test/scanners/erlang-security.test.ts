import { describe, it, expect } from "vitest"
import { erlangSecurityScanner } from "../../src/scanners/erlang-security"
import { ruleOf } from "../../src/rules"
import { makeContext } from "../helpers"

const scan = (source: string, path = "src/handler.erl") => erlangSecurityScanner.run(makeContext({ files: { [path]: source } }))
const module = (body: string) => `-module(handler).\nhandle(Req) ->\n${body}.\n`

describe("Erlang security — real syntax and safe variants", () => {
  it("tracks HTTP body tuple bindings and aliases to external term decoding", async () => {
    const issues = await scan(module('{ok, Body, Req1} = cowboy_req:read_body(Req),\nAlias = Body,\nbinary_to_term(Alias)'))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ confidence: "high", location: "src/handler.erl:5" })
    expect(ruleOf(issues[0])).toBe("erlang-unsafe-term")
    expect(issues[0].detail).toContain("cowboy_req:read_body")
  })

  it.each(["[safe]", "[used, safe]", "['safe']"])("respects safe ETF options %s", async options => {
    expect(await scan(module(`{ok, Body, _} = cowboy_req:read_body(Req), erlang:binary_to_term(Body, ${options})`))).toHaveLength(0)
  })

  it("resolves immutable option bindings and simple macros", async () => {
    expect(await scan('-module(handler).\n-define(OPTS, [safe]).\nf(Bin) -> Opts = ?OPTS, binary_to_term(Bin, Opts).')).toHaveLength(0)
    expect(await scan(module('{ok, Body, _} = cowboy_req:read_body(Req), Opts = [], binary_to_term(Body, Opts)'))).toHaveLength(1)
  })

  it("does not invent an unsafe option when options are unknown", async () => {
    expect(await scan('-module(handler).\nf(Bin, Options) -> binary_to_term(Bin, Options).')).toHaveLength(0)
  })

  it("does not treat a safe word in a comment as a decoder option", async () => {
    const issues = await scan(module('{ok, Body, _} = cowboy_req:read_body(Req),\n% binary_to_term(Body, [safe])\nbinary_to_term(Body, [used])'))
    expect(issues).toHaveLength(1)
    expect(issues[0].confidence).toBe("high")
  })

  it("does not flag literal or proven local term round trips", async () => {
    expect(await scan(module('A = term_to_binary({ok, existing}),\nbinary_to_term(A),\nbinary_to_term(term_to_binary(Req))'))).toHaveLength(0)
  })

  it("keeps unknown library input conditional and hidden by default", async () => {
    const issues = await scan('-module(handler).\ndecode(Data) -> binary_to_term(Data).')
    expect(issues).toHaveLength(1)
    expect(issues[0].confidence).toBe("low")
  })

  it("recognizes qualified and quoted BIF calls", async () => {
    const issues = await scan(module("{ok, Body, _} = cowboy_req:read_body(Req),\n'erlang' : 'binary_to_term'(Body)"))
    expect(issues).toHaveLength(1)
    expect(issues[0].confidence).toBe("high")
  })

  it("does not confuse local overrides or imports with BIFs", async () => {
    expect(await scan('-module(handler).\n-compile({no_auto_import,[binary_to_term/1]}).\nf(Data) -> binary_to_term(Data).\nbinary_to_term(Data) -> {data,Data}.')).toHaveLength(0)
    expect(await scan('-module(handler).\n-import(codec,[binary_to_term/1]).\nf(Data) -> binary_to_term(Data), codec:binary_to_term(Data).')).toHaveLength(0)
    const imported=await scan('-module(handler).\n-import(os,[cmd/1]).\nf(Req)->B=cowboy_req:qs(Req),cmd(binary_to_list(B)).')
    expect(imported[0].confidence).toBe('high')
  })

  it("ignores documentation strings, spec declarations and character literals", async () => {
    expect(await scan([
      '-module(handler).', '-doc """', 'binary_to_term(Data).', 'os:cmd(Input).', '""".',
      '-spec binary_to_term(binary()) -> term().',
      'f() -> A = $%, B = $(, C = $\\", D = $\\x{25},',
      '"binary_to_term(Data), os:cmd(Input)", {A,B,C,D}.',
      '% erlang:binary_to_term(Data).',
    ].join('\n'))).toHaveLength(0)
  })

  it("does not mistake fun references for invocation or unbalance later forms", async () => {
    const issues = await scan('-module(handler).\nf() -> fun erlang:binary_to_term/1.\ng(Bin) -> erlang:binary_to_term(Bin).')
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe('src/handler.erl:3')
  })

  it("recognizes integer/float expressions and record-field periods without losing the form", async () => {
    const issues = await scan('-module(handler).\nf(State, Data) -> X = State#state.field, F = 1.5, binary_to_term(Data), {X,F}.')
    expect(issues).toHaveLength(1)
  })

  it("detects externally derived atom allocation but keeps existing/literal atoms safe", async () => {
    const issues = await scan(module('Name = cowboy_req:binding(name, Req),\nbinary_to_atom(Name, utf8),\nlist_to_atom(binary_to_list(Name)),\nbinary_to_existing_atom(Name, utf8),\nlist_to_existing_atom("ready"), list_to_atom("fixed"), binary_to_atom(<<"fixed">>,utf8)'))
    expect(issues).toHaveLength(2)
    expect(issues.every(x => x.confidence === 'high' && ruleOf(x) === 'erlang-dynamic-atom')).toBe(true)
  })

  it("separates clauses and unrelated source variables", async () => {
    const issues = await scan('-module(handler).\nf(Req) -> Data = cowboy_req:qs(Req), Data;\nf(Data) -> binary_to_term(Data).\ng(Data) -> binary_to_term(Data).')
    expect(issues).toHaveLength(2)
    expect(issues.every(x => x.confidence === 'low')).toBe(true)
  })

  it("follows case-bound socket payloads without leaking into other branches", async () => {
    const issues = await scan('-module(handler).\nf(Socket, Other) -> case gen_tcp:recv(Socket, 0) of\n{ok, Data} -> binary_to_term(Data);\n_ -> binary_to_term(Other) end.')
    expect(issues).toHaveLength(2)
    expect(issues.map(x => x.confidence)).toEqual(['high', 'low'])
  })

  it("does not let a same-name anonymous-fun parameter inherit captured taint", async () => {
    const issues = await scan(module('Data = cowboy_req:qs(Req),\nFun = fun(Data) -> binary_to_term(Data) end, Fun'))
    expect(issues).toHaveLength(1)
    expect(issues[0].confidence).toBe('low')
  })

  it("does not transfer branch-local sources beyond a case", async () => {
    const issues = await scan(module('case check() of true -> Data = cowboy_req:qs(Req); false -> Data = <<"fixed">> end, binary_to_term(Data)'))
    expect(issues).toHaveLength(1)
    expect(issues[0].confidence).toBe('low')
  })

  it("respects a literal allowlist branch instead of claiming attacker control", async () => {
    expect(await scan(module('Data = cowboy_req:qs(Req), case Data of <<"ready">> -> binary_to_atom(Data); _ -> reject end'))).toHaveLength(0)
  })

  it("handles active socket payloads in OTP callbacks and receive", async () => {
    const a = await scan('-module(handler).\nhandle_info({tcp, Socket, Data}, State) -> binary_to_term(Data), {noreply,State}.')
    const b = await scan('-module(handler).\nf() -> receive {ssl, Socket, Data} -> binary_to_term(Data) end.')
    expect(a[0].confidence).toBe('high')
    expect(b[0].confidence).toBe('high')
  })

  it("detects shell payloads and avoids executable/argument-vector false positives", async () => {
    const issues = await scan(module('Input = cowboy_req:qs(Req),\nos:cmd("ping " ++ binary_to_list(Input)),\nopen_port({spawn, binary_to_list(Input)}, []),\nopen_port({spawn_executable, "/bin/echo"}, [{args, [binary_to_list(Input)]}]),\nos:cmd("uptime")'))
    expect(issues).toHaveLength(2)
    expect(issues.every(x => x.severity === 'critical' && x.confidence === 'high')).toBe(true)
  })

  it("detects shells explicitly invoked through spawn_executable", async () => {
    const issues = await scan(module('Input = cowboy_req:qs(Req),\nopen_port({spawn_executable, os:find_executable("sh")}, [{args, ["-c", binary_to_list(Input)]}])'))
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ confidence: 'high', severity: 'critical' })
  })

  it("tracks the scan/parse/eval pipeline and direct externally supplied BEAM", async () => {
    const issues = await scan(module('{ok, Body, _} = cowboy_req:read_body(Req),\n{ok, Tokens, _} = erl_scan:string(binary_to_list(Body)),\n{ok, Exprs} = erl_parse:parse_exprs(Tokens),\nerl_eval:exprs(Exprs, erl_eval:new_bindings()),\ncode:load_binary(plugin, "plugin.beam", Body)'))
    expect(issues).toHaveLength(2)
    expect(issues.every(x => x.confidence === 'high' && x.severity === 'critical')).toBe(true)
  })

  it("checks client TLS calls and immutable options, not unrelated/server tuples", async () => {
    const issues = await scan('-module(handler).\nf(Host, Socket) -> Opts = [{verify,verify_none}],\nssl:connect(Host,443,Opts),\nssl:connect(Socket,Opts),\nssl:connect(Socket,Opts,5000),\nssl:connect(Host,443,Opts,5000),\nssl:listen(443,Opts),\nother:connect(Host,443,Opts),\nssl:connect(Host,443,[{verify,verify_peer}]),\nssl:connect(Host,443,[{verify,verify_none},{verify_fun,{fun verify/3,[]}}]).')
    expect(issues).toHaveLength(4)
    expect(issues.every(x => ruleOf(x) === 'erlang-tls-verify-none' && x.confidence === 'medium')).toBe(true)
  })

  it.each(['test/foo.erl','src/codec_tests.erl','src/codec_SUITE.erl','_build/default/lib/x/src/x.erl','deps/x/src/x.erl','docs/example.erl'])("does not report test/vendor/example code: %s", async path => {
    expect(await scan('-module(handler).\nf(Data) -> binary_to_term(Data).',path)).toHaveLength(0)
  })

  it("supports production header macros and escripts", async () => {
    expect(await scan('-define(DECODE(Data), erlang:binary_to_term(Data)).','include/codec.hrl')).toHaveLength(1)
    expect(await scan('#!/usr/bin/env escript\nmain([Data]) -> list_to_atom(Data).','scripts/convert.escript')).toHaveLength(1)
  })

  it("keeps comprehension generators local, including strict and zipped generators", async () => {
    for (const generator of ['B <- [<<"fixed">>]', 'B <:- [<<"fixed">>]', 'B <- [<<"fixed">>] && X <- [1]']) {
      const issues=await scan(module(`B = cowboy_req:qs(Req), [binary_to_atom(B) || ${generator}]`))
      expect(issues.every(x=>x.confidence!=='high')).toBe(true)
    }
  })

  it("clears every fun-clause parameter and the recursive fun name", async () => {
    const multi=await scan(module('B = cowboy_req:qs(Req), F = fun(B) when is_binary(B) -> ok; (B) -> binary_to_atom(B) end, F(<<"fixed">>)'))
    const named=await scan(module('B = cowboy_req:qs(Req), F = fun B(X) -> binary_to_atom(B(X)) end, F'))
    expect([...multi,...named].every(x=>x.confidence!=='high')).toBe(true)
  })

  it("does not confuse a tainted selector with returned map/proplist bytes", async () => {
    for (const lookup of ['maps:get(Key, #{<<"one">> => <<"fixed">>})','proplists:get_value(Key, [{<<"one">>, <<"fixed">>}])']) {
      expect(await scan(module(`Key = cowboy_req:qs(Req), B = ${lookup}, binary_to_atom(B)`))).toHaveLength(0)
    }
  })

  it("tracks map fields independently and respects absent/default fields", async () => {
    const issues=await scan(module('Body = cowboy_req:qs(Req), M = #{safe => <<"fixed">>, unsafe => Body}, A=maps:get(safe,M), B=maps:get(unsafe,M), C=maps:get(missing,M,<<"fixed">>),\nbinary_to_atom(A),\nbinary_to_atom(B),\nbinary_to_atom(C)'))
    expect(issues).toHaveLength(1)
    expect(issues[0].confidence).toBe('high')
  })

  it("respects map last-wins and proplist first-wins semantics", async () => {
    expect(await scan(module('Body=cowboy_req:qs(Req), Key=cowboy_req:binding(k,Req), M=#{key=>Body,key=><<"fixed">>}, P=[{key,<<"fixed">>},{key,Body}], A=maps:get(Key,M,<<"fixed">>), B=proplists:get_value(Key,P), binary_to_atom(A), binary_to_atom(B)'))).toHaveLength(0)
    const dynamic=await scan(module('Body=cowboy_req:qs(Req), Key=cowboy_req:binding(k,Req), M=#{fixed=><<"safe">>,Key=>Body}, B=maps:get(fixed,M), binary_to_atom(B)'))
    expect(dynamic[0].confidence).toBe('high')
  })

  it("does not claim exploits from statically incompatible API shapes", async () => {
    expect(await scan(module('binary_to_atom(cowboy_req:headers(Req)), list_to_atom(cowboy_req:parse_qs(Req)), binary_to_term(cowboy_req:read_body(Req)), erl_eval:exprs(cowboy_req:qs(Req),[])'))).toHaveLength(0)
  })

  it("does not resolve macros retroactively through later redefinitions", async () => {
    expect(await scan('-module(handler).\n-define(OPTS,[{verify,verify_peer}]).\nf()->ssl:connect("host",443,?OPTS).\n-undef(OPTS).\n-define(OPTS,[{verify,verify_none}]).\ng()->ok.')).toHaveLength(0)
  })

  it("honors no_auto_import without requiring a local function body", async () => {
    expect(await scan('-module(handler).\n-compile({no_auto_import,[binary_to_term/1]}).\nf(Data)->binary_to_term(Data).')).toHaveLength(0)
    expect(await scan('-module(handler).\n-compile(no_auto_import).\nf(Data)->erlang:binary_to_term(Data).')).toHaveLength(1)
  })

  it("decodes escaped atom names instead of treating executable calls as strings", async () => {
    const issues=await scan(module("B=cowboy_req:qs(Req), 'erlang':'\\x62inary_to_term'(B)"))
    expect(issues).toHaveLength(1)
    expect(issues[0].confidence).toBe('high')
  })

  it("finds explicit accept-all certificate callbacks, but not normal valid-event handlers", async () => {
    const a=await scan('-module(handler).\nf()->ssl:connect("host",443,[{verify,verify_none},{verify_fun,{fun(_,_,S)->{valid,S} end,[]}}]).')
    const b=await scan('-module(handler).\nf()->ssl:connect("host",443,[{verify,verify_peer},{verify_fun,{fun(_, {bad_cert,_},S)->{valid,S}; (_,valid_peer,S)->{valid,S} end,[]}}]).')
    const c=await scan('-module(handler).\nf()->ssl:connect("host",443,[{verify,verify_peer},{verify_fun,{fun(_, {bad_cert,_},_)->{fail,bad}; (_,valid_peer,S)->{valid,S} end,[]}}]).')
    expect(a.map(ruleOf)).toEqual(['erlang-tls-accept-bad-cert'])
    expect(b.map(ruleOf)).toEqual(['erlang-tls-accept-bad-cert'])
    expect(c).toHaveLength(0)
  })

  it("keeps an externally controlled critical sink even after many conditional hotspots", async () => {
    const body = Array.from({length:70},()=> 'binary_to_term(Unknown)').join(',\n')
    const issues=await scan(module('Unknown=internal:load(),\n'+body+',\nB=cowboy_req:qs(Req), os:cmd(binary_to_list(B))'))
    expect(issues).toHaveLength(60)
    expect(issues[0]).toMatchObject({confidence:'high',severity:'critical'})
  })

  it("tracks UDP and WebSocket inputs, but does not taint arbitrary actor messages", async () => {
    const udp=await scan('-module(handler).\nf(S)->{ok,{IP,Port,Data}}=gen_udp:recv(S,0),binary_to_term(Data).')
    const ws=await scan('-module(handler).\nwebsocket_handle({binary,Data},State)->binary_to_term(Data),{ok,State}.')
    const actor=await scan('-module(handler).\nhandle_info({rpc,Data},State)->binary_to_term(Data),{noreply,State}.')
    expect(udp[0].confidence).toBe('high')
    expect(ws[0].confidence).toBe('high')
    expect(actor[0].confidence).toBe('low')
  })

  it("finds untrusted executable selectors without treating fixed-target RPC as injection", async () => {
    const issues=await scan(module('M=binary_to_existing_atom(cowboy_req:binding(module,Req),utf8),\nF=binary_to_existing_atom(cowboy_req:binding(function,Req),utf8),\nArgs=cowboy_req:parse_qs(Req),\napply(M,F,Args),\napply(fixed_module,fixed_function,Args)'))
    expect(issues.map(ruleOf)).toEqual(['erlang-tainted-dispatch'])
    expect(issues[0].confidence).toBe('high')
    const safe=await scan(module('Key=cowboy_req:binding(action,Req), M=maps:get(Key,#{<<"status">>=>status_module}), apply(M,status,[])'))
    expect(safe).toHaveLength(0)
  })

  it("does not consider [safe] sufficient to execute a decoded function", async () => {
    const issues=await scan(module('{ok,Body,_}=cowboy_req:read_body(Req), Fun=binary_to_term(Body,[safe]), apply(Fun,[])'))
    expect(issues.map(ruleOf)).toEqual(['erlang-tainted-dispatch'])
    expect(issues[0].confidence).toBe('high')
  })

  it("does not confuse argument safety with executable authorization", async () => {
    const issues=await scan(module('Program=binary_to_list(cowboy_req:binding(program,Req)), open_port({spawn_executable,os:find_executable(Program)},[{args,["fixed"]}])'))
    expect(issues.map(ruleOf)).toEqual(['erlang-external-executable'])
    expect(issues[0]).toMatchObject({confidence:'high',severity:'critical'})
  })

  it("checks httpc SSL options in the correct argument and excludes plain HTTP", async () => {
    const issues=await scan('-module(handler).\nf()->\nhttpc:request(get,{"https://example.invalid",[]},[{ssl,[{verify,verify_none}]}],[]),\nhttpc:request(get,{"http://example.invalid",[]},[{ssl,[{verify,verify_none}]}],[]),\nhttpc:request(get,{"https://example.invalid",[]},[],[{ssl,[{verify,verify_none}]}]).')
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe('src/handler.erl:3')
  })

  it("uses a successful literal pattern match as a real validation boundary", async () => {
    expect(await scan(module('B=cowboy_req:qs(Req), B = <<"fixed">>, binary_to_atom(B)'))).toHaveLength(0)
    const failed=await scan(module('B=cowboy_req:qs(Req), try B = <<"fixed">> catch _:_ -> ok end, binary_to_atom(B)'))
    expect(failed[0].confidence).toBe('high')
  })

  it("does not lose code behind guard alternatives", async () => {
    const issues=await scan('-module(handler).\nf(Req) when is_map(Req); is_tuple(Req) -> B=cowboy_req:qs(Req), binary_to_atom(B).')
    expect(issues[0].confidence).toBe('high')
  })
})
