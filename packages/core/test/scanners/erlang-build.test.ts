import { describe, it, expect } from "vitest"
import { erlangBuildScanner } from "../../src/scanners/erlang-build"
import { makeContext } from "../helpers"
import { ruleOf } from "../../src/rules"

const SHA = "0123456789abcdef0123456789abcdef01234567"
const scan = (config: string, lock?: string, path = "rebar.config") => erlangBuildScanner.run(makeContext({ files: {
  [path]: config, ...(lock ? { [path.replace(/rebar\.config$/, "rebar.lock")]: lock } : {}),
} }))

describe("Erlang/Rebar build supply chain", () => {
  it("checks bare build plugins, not ordinary dependency declarations or versioned plugins", async () => {
    const issues = await scan('{deps,[cowboy,{ecall,"0.1.2"}]}.\n{project_plugins,[rebar3_hex,{rebar3_ex_doc,"0.2.0"},covertool]}.')
    expect(issues).toHaveLength(2)
    expect(issues.every(x => ruleOf(x) === 'erlang-plugin-unversioned' && x.severity === 'info')).toBe(true)
    expect(issues.map(x => x.evidence)).toEqual(['rebar3_hex','covertool'])
  })

  it("finds floating Git refs and cleartext source transport", async () => {
    const issues = await scan('{deps,[{x,{git,"git://example.org/x",{branch,"main"}}}]}.')
    expect(issues.map(ruleOf).sort()).toEqual(['erlang-dep-cleartext','erlang-dep-floating'])
  })

  it("uses immutable default-profile lock refs instead of moving manifest branches", async () => {
    expect(await scan('{deps,[{x,{git,"https://example.org/x",{branch,"main"}}}]}.',`{"1.2.0",[{<<"x">>,{git,"https://example.org/x",{ref,"${SHA}"}},0}]}.`)).toHaveLength(0)
  })

  it("uses the lock's effective URL and reports the correct lock-file location", async () => {
    const issues = await scan('{deps,[{x,{git,"https://example.org/x",{branch,"main"}}}]}.',`{"1.2.0",[\n{<<"x">>,{git,"http://example.org/x",{ref,"${SHA}"}},0}]}.`)
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ location: 'rebar.lock:2' })
  })

  it("does not report a shadowed insecure manifest URL when the effective lock is HTTPS", async () => {
    expect(await scan('{deps,[{x,{git,"http://example.org/x",{branch,"main"}}}]}.',`{"1.2.0",[{<<"x">>,{git,"https://example.org/x",{ref,"${SHA}"}},0}]}.`)).toHaveLength(0)
  })

  it("does not borrow a runtime dependency lock for plugins or nondefault profiles", async () => {
    const lock = `{"1.2.0",[{<<"x">>,{git,"https://example.org/x",{ref,"${SHA}"}},0}]}.`
    const plugins = await scan('{plugins,[{x,{git,"https://example.org/x",{branch,"main"}}}]}.',lock)
    const profile = await scan('{profiles,[{test,[{deps,[{x,{git,"https://example.org/x",{branch,"main"}}}]}]}]}.',lock)
    expect(plugins).toHaveLength(1)
    expect(profile).toHaveLength(1)
  })

  it("handles fixed Git commits, subdirectories and authenticated SSH", async () => {
    expect(await scan(`{deps,[{x,{git,"git@example.org:x",{ref,"${SHA}"}}},{y,{git_subdir,"https://example.org/y",{ref,"${SHA}"},"apps/y"}}]}.`)).toHaveLength(0)
  })

  it("ignores comments, literal documentation strings and unrelated configuration keys", async () => {
    expect(await scan('% {plugins,[evil]}.\n{description,"{plugins,[evil]}."}.\n{other,[{plugins_fake,[evil]}]}.')).toHaveLength(0)
  })

  it("keeps nested application locks separate", async () => {
    const config='{deps,[{x,{git,"https://example.org/x",{branch,"main"}}}]}.'
    const issues = await erlangBuildScanner.run(makeContext({ files:{'apps/a/rebar.config':config,'apps/b/rebar.lock':`{"1.2.0",[{<<"x">>,{git,"https://example.org/x",{ref,"${SHA}"}},0}]}.`} }))
    expect(issues).toHaveLength(1)
    expect(issues[0].location).toBe('apps/a/rebar.config:1')
  })

  it("deduplicates multiple dependency occurrences by source location/name and caps output", async () => {
    const issues = await scan('{plugins,['+Array.from({length:100},(_,i)=>'plugin'+i).join(',')+']}.')
    expect(issues).toHaveLength(80)
    expect(new Set(issues.map(x=>x.id)).size).toBe(80)
  })

  it("does not mistake compiler macro data or plugin settings for dependencies", async () => {
    expect(await scan('{erl_opts,[{d,\'EXAMPLE_DATA\',{deps,[{fake,{git,"http://example.invalid/repo",{branch,"main"}}}]}}]}.')).toHaveLength(0)
    expect(await scan('{profiles,[{test,[{erl_opts,[{d,\'EXAMPLE_DATA\',{plugins,[fake]}}]}]}]}.')).toHaveLength(0)
  })

  it("does not treat a branch/tag named like a SHA as an immutable commit ref", async () => {
    for (const type of ['tag','branch']) expect(await scan(`{deps,[{x,{git,"https://example.org/x",{${type},"${SHA}"}}}]}.`)).toHaveLength(1)
  })
})
