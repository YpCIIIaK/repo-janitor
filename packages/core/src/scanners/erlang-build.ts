import type { Issue } from "../schema"
import type { ScanContext, Scanner } from "../scanner"
import { erlangAtom, erlangContainer, erlangForms, erlangLine, erlangNonProductPath, erlangTokens, type ErlToken } from "../erlang"

interface GitDependency { name: string; url: string; ref: string; refKind: string; offset: number }
const immutable = (ref: string) => /^(?:[a-f\d]{40}|[a-f\d]{64})$/i.test(ref)
const pinned = (dep: GitDependency) => ["ref", "legacy"].includes(dep.refKind) && immutable(dep.ref)
const cleartext = (url: string) => /^(?:git\+)?http:\/\/|^git:\/\//i.test(url)

function text(tokens: ErlToken[]): string | null {
  if (tokens.length === 1 && ["atom", "string"].includes(tokens[0].kind)) return tokens[0].value
  const binary = erlangContainer(tokens, "<<")
  return binary?.length === 1 && binary[0].length === 1 && binary[0][0].kind === "string" ? binary[0][0].value : null
}

function dependency(tokens: ErlToken[]): GitDependency | null {
  const parts = erlangContainer(tokens, "{")
  if (!parts || parts.length < 2) return null
  const name = text(parts[0])
  if (!name) return null
  for (const part of parts.slice(1)) {
    const source = erlangContainer(part, "{")
    if (!source || source.length < 2 || !["git", "git_subdir"].includes(erlangAtom(source[0]) ?? "")) continue
    const url = text(source[1])
    if (!url) continue
    const refTuple = source[2] && erlangContainer(source[2], "{")
    const ref = refTuple?.length === 2 ? text(refTuple[1]) : source[2] ? text(source[2]) : null
    return { name, url, ref: ref ?? "HEAD", refKind: refTuple ? erlangAtom(refTuple[0]) ?? "unknown" : source[2] ? "legacy" : "default", offset: tokens[0].start }
  }
  return null
}

/** Walk literal terms only. Never evaluates rebar.config.script or build hooks. */
function walk(tokens: ErlToken[], visit: (tuple: ErlToken[][], tokens: ErlToken[], depth: number) => void, depth = 0): void {
  if (depth > 30) return
  const tuple = erlangContainer(tokens, "{")
  if (tuple) { visit(tuple, tokens, depth); for (const part of tuple) walk(part, visit, depth + 1); return }
  const list = erlangContainer(tokens, "[")
  if (list) for (const part of list) walk(part, visit, depth + 1)
}

export const erlangBuildScanner: Scanner = {
  id: "erlang-build", category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = [], seen = new Set<string>()
    for (const file of ctx.files) {
      const norm = file.replace(/\\/g, "/")
      if (!/(^|\/)rebar\.config$/.test(norm) || erlangNonProductPath(norm)) continue
      const source = await ctx.readFile(file)
      if (!source) continue
      const lockPath = norm.replace(/rebar\.config$/, "rebar.lock"), lockSource = await ctx.readFile(lockPath)
      const locks = new Map<string, GitDependency>()
      if (lockSource) for (const form of erlangForms(erlangTokens(lockSource))) walk(form, (_tuple, tokens) => {
        const dep = dependency(tokens)
        if (dep && pinned(dep)) locks.set(dep.name, dep)
      })
      const emit = (rule: string, name: string, title: string, detail: string, at: number, path = norm, contents = source) => {
        if (issues.length >= 80) return
        const line = erlangLine(contents, at), id = `erlang-${rule}-${path}:${line}-${name}`
        if (seen.has(id)) return
        seen.add(id)
        issues.push({ id, scanner: "erlang-build", category: "security", severity: rule === "plugin-unversioned" ? "info" : "warning", confidence: "medium",
          title, detail, location: `${path}:${line}`, ageDays: 0, evidence: name })
      }
      const inspect = (tuple: ErlToken[][], tokens: ErlToken[], depth: number) => {
        const key = erlangAtom(tuple[0] ?? [])
        if (!key || !["deps", "plugins", "project_plugins"].includes(key) || tuple.length !== 2) return
        const entries = erlangContainer(tuple[1], "[")
        if (!entries) return
        const plugin = key !== "deps"
        for (const entry of entries) {
          if (plugin && entry.length === 1 && entry[0].kind === "atom") {
            const name = entry[0].value
            emit("plugin-unversioned", name, `Rebar build plugin has no version constraint: ${name}`,
              "Rebar plugins execute during builds and are not locked by the normal rebar.lock dependency entries. Specify a tested plugin version. This is a build reproducibility/hardening finding, not a demonstrated compromise.", entry[0].start)
          }
          const declared = dependency(entry)
          if (!declared) continue
          // Only top-level default dependencies are covered by rebar.lock.
          // Profile dependencies and build plugins must not borrow those pins.
          const locked = !plugin && depth === 0 ? locks.get(declared.name) : undefined
          const effective = locked ?? declared
          if (cleartext(effective.url)) emit("dep-cleartext", declared.name, `Rebar dependency fetched over cleartext transport: ${declared.name}`,
            "The effective Git dependency URL uses HTTP or unauthenticated git:// transport. Use HTTPS or authenticated SSH; retain immutable refs and the lock file.",
            effective.offset, locked ? lockPath : norm, locked ? lockSource! : source)
          if (!pinned(effective)) emit("dep-floating", declared.name, `Rebar Git dependency has no effective immutable pin: ${declared.name}`,
            plugin ? "Build plugins are not protected by the normal dependency lock. Use a full Git commit SHA or a tested immutable package release instead of a moving branch/tag."
              : "This Git dependency resolves from a branch/tag/HEAD without an applicable immutable rebar.lock entry. Commit the default-profile lock file or pin a full Git SHA; non-default profile dependencies are not locked by the default lock.", entry[0]?.start ?? tokens[0].start)
        }
      }
      // Configuration data inside erl_opts/plugin settings is not a dependency
      // declaration. Traverse only options and explicitly recognized profiles.
      for (const form of erlangForms(erlangTokens(source))) {
        const tuple = erlangContainer(form, "{")
        if (!tuple) continue
        inspect(tuple, form, 0)
        if (tuple.length === 2 && erlangAtom(tuple[0]) === "profiles") {
          for (const profile of erlangContainer(tuple[1], "[") ?? []) {
            const parts = erlangContainer(profile, "{")
            if (parts?.length !== 2) continue
            for (const option of erlangContainer(parts[1], "[") ?? []) {
              const optionTuple = erlangContainer(option, "{")
              if (optionTuple) inspect(optionTuple, option, 1)
            }
          }
        }
      }
    }
    return issues
  },
}
