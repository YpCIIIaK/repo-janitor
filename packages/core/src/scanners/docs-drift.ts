import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Docs Drift scanner ⭐.
 *
 * Checks what the documentation *claims* against what the repository actually
 * contains. Sibling to {@link brokenDocLinksScanner} and {@link deadLinksScanner},
 * which between them cover every link; this one never looks at a link. It reads
 * the instructions.
 *
 * The rot it finds is the most embarrassing kind a project has, because it is
 * the first thing a stranger meets. A README that opens with `npm run dev` for a
 * script deleted two years ago does not fail quietly somewhere in the internals —
 * it fails at step one, for the one person who was willing to try.
 *
 * ## Three rules, all of them checkable against the repo itself
 *
 * No network, no heuristics about prose. Every rule compares a literal string in
 * a doc against a literal fact in the tree, which is why they can be trusted:
 *
 *  - a documented `npm run <script>` with no such script in ANY package.json
 *  - a CI badge for a workflow file that is not there
 *  - install instructions in a package manager the lockfile contradicts
 *
 * Prose is never parsed and intent is never guessed. Where a command cannot be
 * resolved with certainty — a placeholder, an unknown shape — the answer is
 * silence.
 */

const MAX_ISSUES = 25

/** Docs worth reading. Deliberately not every markdown file in the repo. */
const DOC_RE = /^(readme|contributing|docs\/.*|\.github\/(readme|contributing))\.mdx?$/i

/**
 * Package-manager subcommands, which are never scripts.
 *
 * `npm test` runs the `test` script, so bare verbs generally ARE script names —
 * but `npm install` is not, and reporting a missing "install script" would be
 * absurd. Only genuine subcommands go here; anything else is treated as a script
 * name and checked.
 */
const PM_SUBCOMMANDS = new Set([
  "install", "i", "ci", "add", "remove", "rm", "uninstall", "un", "up", "update",
  "upgrade", "exec", "dlx", "create", "init", "publish", "pack", "link", "unlink",
  "audit", "outdated", "why", "list", "ls", "config", "store", "prune", "dedupe",
  "login", "logout", "whoami", "version", "view", "info", "search", "help",
  "workspace", "workspaces", "global", "set", "get", "cache", "fund", "docs",
])

/**
 * Bare verbs that every manager treats as a shortcut for a script of that name.
 *
 * The distinction matters because `pnpm <word>` and `yarn <word>` will happily
 * run a BINARY from node_modules when no script matches — `yarn prettier .`,
 * `pnpm lefthook install`. Those are not missing scripts, and reporting them as
 * such produced seven false positives on prettier's docs alone. Only these four
 * words are unambiguously script shortcuts; every other bare word could be a
 * binary, so it takes an explicit `run` to be checked.
 */
const LIFECYCLE = new Set(["test", "start", "stop", "restart"])

/**
 * A name that is a stand-in rather than a real script: `npm run <script>`,
 * `npm run [name]`, `npm run $TASK`, `npm run your-task`.
 */
function isPlaceholder(name: string): boolean {
  return /[<>[\]{}$*|]/.test(name) || /^(your|my|some|the)[-_]/i.test(name)
}

/**
 * Flags that swallow the next token, so it must not be mistaken for a script.
 *
 * `pnpm --filter web build` names the script `build`, not `--filter` and not
 * `web`. This is the single most common shape in a pnpm monorepo, and getting it
 * wrong produced five false positives on this project's own README.
 */
const VALUE_FLAGS = new Set(["--filter", "-F", "--dir", "-C", "--prefix", "--workspace"])

/** Flags that stand alone and can simply be stepped over. */
const BOOL_FLAGS = new Set([
  "-w", "--workspace-root", "-r", "--recursive", "-s", "--silent",
  "--if-present", "--no-bail", "--parallel", "--stream",
])

export interface CommandRef {
  manager: "npm" | "pnpm" | "yarn" | "bun"
  /** The word after the manager (and after `run`, when that is present). */
  script: string
  /**
   * Did anything follow the subcommand — a package name, a `-g`?
   *
   * `npm install` installs THIS project. `npm i -g widget` installs a published
   * package and has nothing to do with the local lockfile, so the wrong-manager
   * rule must not touch it. Telling someone to run `pnpm i -g` our own CLI
   * because the repo uses pnpm is advice that is simply wrong.
   */
  hasArgs: boolean
  /**
   * Is `script` one of the manager's own subcommands rather than a script name?
   *
   * Both kinds are returned because the two rules that read this want opposite
   * halves: the missing-script rule wants script names, and the wrong-manager
   * rule is only ever about `install`. Filtering subcommands out here — which is
   * what the first version did — silently made the second rule unreachable.
   */
  isSubcommand: boolean
  line: number
  evidence: string
}

/**
 * Every package-manager invocation a document tells the reader to run.
 *
 * Only lines that ARE the command are taken — optionally behind a `$` or `>`
 * shell prompt. A command mentioned mid-sentence is prose about a command, and
 * prose is not what this scanner reads.
 *
 * Exported for tests: the parsing is where this scanner can embarrass itself.
 */
export function findCommandRefs(content: string): CommandRef[] {
  const out: CommandRef[] = []
  const lines = content.split(/\r?\n/)
  // Script names have no `@` or `/`; a token carrying either is a package
  // reference that slipped through, not something to check against scripts.
  const NAME = /^[\w:.-]+$/
  const MANAGERS: readonly string[] = ["npm", "pnpm", "yarn", "bun"]

  // Once a document has told the reader to `cd` somewhere, every command after
  // it runs in a different project and says nothing about this one.
  //
  // Express's README is the case that taught this: its Quick Start scaffolds an
  // app with `express /tmp/foo && cd /tmp/foo`, then says `npm install` and
  // `npm start`. Those are the generated app's scripts. Reporting "express has
  // no start script" would be reading the instructions and missing the point of
  // them.
  let leftTheRepo = false
  // Only inside a fenced code block, or behind a shell prompt. Prose gets no
  // vote: pnpm's own README opens sentences with "pnpm uses a
  // content-addressable filesystem…" and "pnpm is up to 2x faster…", which a
  // rule as loose as "the line begins with the manager's name" reads as an
  // instruction to run the scripts `uses` and `is`.
  let inFence = false

  for (let i = 0; i < lines.length; i++) {
    if (/^\s*(```|~~~)/.test(lines[i])) {
      inFence = !inFence
      continue
    }
    const prompted = /^\s*[$>]\s+/.test(lines[i])
    // Strip a shell prompt and any leading indentation.
    const line = lines[i].replace(/^\s*[$>]\s+/, "").trim()
    if (/(^|&&|;|\|\|)\s*cd\s+\S/.test(line)) leftTheRepo = true
    if (leftTheRepo) continue
    if (!inFence && !prompted) continue
    const tokens = line.split(/\s+/)
    const manager = tokens[0] as CommandRef["manager"]
    if (!MANAGERS.includes(manager)) continue

    // Step over flags to reach the verb. An unrecognised flag ends the line:
    // we cannot know whether it takes a value, and guessing wrong turns its
    // value into a "missing script". Silence beats a confident mistake.
    let t = 1
    let bailed = false
    while (t < tokens.length && tokens[t].startsWith("-")) {
      const flag = tokens[t]
      if (VALUE_FLAGS.has(flag)) t += 2
      else if (BOOL_FLAGS.has(flag)) t += 1
      else if (flag.includes("=")) t += 1 // --filter=web carries its own value
      else {
        bailed = true
        break
      }
    }
    if (bailed || t >= tokens.length) continue

    // `npm run x` names a script by construction; the word after `run` is the
    // one that matters, and if there is no usable word after it the line is a
    // template (`npm run <script>`) rather than an instruction.
    const explicitRun = tokens[t] === "run"
    if (explicitRun) t += 1
    const word = tokens[t]
    if (!word) continue
    if (isPlaceholder(word) || !NAME.test(word)) continue

    const isSubcommand = !explicitRun && PM_SUBCOMMANDS.has(word)
    // A bare word that is neither a subcommand nor a lifecycle verb may be a
    // binary from node_modules rather than a script, and nothing in the
    // repository can tell the two apart. Subcommands are still returned — the
    // wrong-manager rule needs them.
    if (!explicitRun && !isSubcommand && !LIFECYCLE.has(word)) continue
    out.push({
      manager,
      script: word,
      isSubcommand,
      hasArgs: tokens.length > t + 1,
      line: i + 1,
      evidence: line.slice(0, 200),
    })
  }

  return out
}

export interface BadgeRef {
  /** The workflow file or workflow name the badge points at. */
  workflow: string
  line: number
  evidence: string
}

/**
 * GitHub Actions status badges, and the workflow each names.
 *
 * `…/actions/workflows/ci.yml/badge.svg` names a file; the older
 * `…/workflows/Build/badge.svg` form names a workflow's `name:`. Both shapes are
 * collected and the caller accepts either kind of match, because a badge that
 * resolves by name is not broken.
 */
export function findWorkflowBadges(content: string): BadgeRef[] {
  const out: BadgeRef[] = []
  const lines = content.split(/\r?\n/)
  const re = /github\.com\/[^/\s)]+\/[^/\s)]+\/(?:actions\/)?workflows\/([^/\s)]+)\/badge\.svg/gi

  for (let i = 0; i < lines.length; i++) {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(lines[i]))) {
      out.push({
        workflow: decodeURIComponent(m[1]),
        line: i + 1,
        evidence: lines[i].trim().slice(0, 200),
      })
    }
  }

  return out
}

/** Lockfile → the manager that writes it. */
const LOCKFILES: Record<string, CommandRef["manager"]> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lockb": "bun",
  "bun.lock": "bun",
}

/**
 * The one manager this repository uses, or null when that is not a single
 * answer.
 *
 * Two lockfiles is its own problem and not this scanner's to report; with more
 * than one present there is no contradiction to point at, so this says nothing.
 */
export function soleManager(files: string[]): CommandRef["manager"] | null {
  const found = new Set<CommandRef["manager"]>()
  for (const f of files) {
    const base = f.replace(/\\/g, "/").split("/").pop() ?? ""
    const mgr = LOCKFILES[base]
    if (mgr) found.add(mgr)
  }
  return found.size === 1 ? [...found][0] : null
}

export const docsDriftScanner: Scanner = {
  id: "docs-drift",
  category: "hygiene",

  async run(ctx: ScanContext): Promise<Issue[]> {
    const norm = (f: string) => f.replace(/\\/g, "/")
    const docs = ctx.files.filter((f) => DOC_RE.test(norm(f)))
    if (docs.length === 0) return []

    // --- what the repository actually offers --------------------------------

    // Scripts from EVERY package.json, not just the root one. In a monorepo the
    // root README routinely documents a command that lives in a workspace, and
    // checking the root alone would report each of them as missing.
    const scripts = new Set<string>()
    let sawManifest = false
    for (const file of ctx.files) {
      if ((norm(file).split("/").pop() ?? "") !== "package.json") continue
      if (norm(file).includes("node_modules/")) continue
      const raw = await ctx.readFile(file)
      if (!raw) continue
      try {
        const json = JSON.parse(raw) as { scripts?: Record<string, string> }
        sawManifest = true
        for (const key of Object.keys(json.scripts ?? {})) scripts.add(key)
      } catch {
        /* malformed manifest — treated as unreadable, see the guard below */
      }
    }

    // Workflow files, by filename AND by declared `name:` — a badge may use
    // either, and resolving by name is not a broken badge.
    const workflowFiles = ctx.files.filter((f) =>
      /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(norm(f)),
    )
    const workflowKeys = new Set<string>()
    for (const file of workflowFiles) {
      workflowKeys.add(norm(file).split("/").pop() ?? "")
      const content = await ctx.readFile(file)
      const nameLine = content?.split(/\r?\n/).find((l) => /^name\s*:/.test(l))
      const declared = nameLine?.replace(/^name\s*:\s*/, "").replace(/^['"]|['"]$/g, "").trim()
      if (declared) workflowKeys.add(declared)
    }

    const manager = soleManager(ctx.files)
    const issues: Issue[] = []

    for (const file of docs) {
      if (issues.length >= MAX_ISSUES) break
      const content = await ctx.readFile(file)
      if (!content) continue
      const f = norm(file)

      const at = async (line: number) => {
        try {
          return await ctx.git.blameAgeDays(f, line)
        } catch {
          return 0
        }
      }

      // --- rule 1: a documented script that does not exist ------------------
      //
      // Guarded on having read at least one manifest. With none — a docs-only
      // repository, or every package.json malformed — "not in scripts" means
      // "we could not look", and accusing the README then would be a scanner
      // reporting its own blindness as the project's fault.
      if (sawManifest) {
        for (const ref of findCommandRefs(content)) {
          if (issues.length >= MAX_ISSUES) break
          if (ref.isSubcommand) continue // `npm install` is not a missing script
          if (scripts.has(ref.script)) continue
          issues.push({
            id: `docs-drift-script-${f}-${ref.line}`,
            category: "hygiene",
            severity: "warning",
            title: `Documented command does not exist: ${ref.manager} run ${ref.script}`,
            location: `${f}:${ref.line}`,
            ageDays: await at(ref.line),
            detail:
              `${f} tells the reader to run \`${ref.script}\`, but no package.json in this repository ` +
              `defines a script by that name. Whoever follows these instructions gets an error at this ` +
              `step. Either the script was renamed or removed and the doc was not updated, or the doc ` +
              `describes something that never shipped.`,
            evidence: ref.evidence,
          })
        }
      }

      // --- rule 2: a status badge for a workflow that is not there ----------
      for (const badge of findWorkflowBadges(content)) {
        if (issues.length >= MAX_ISSUES) break
        if (workflowKeys.has(badge.workflow)) continue
        issues.push({
          id: `docs-drift-badge-${f}-${badge.line}`,
          category: "hygiene",
          severity: "warning",
          title: `CI badge points at a workflow that does not exist: ${badge.workflow}`,
          location: `${f}:${badge.line}`,
          ageDays: await at(badge.line),
          detail:
            `This badge renders the status of \`${badge.workflow}\`, and no workflow in ` +
            `.github/workflows matches it by filename or by name. GitHub serves such a badge as ` +
            `"no status", so the README shows a grey badge forever — which reads as "CI is broken" ` +
            `to anyone who does not click it.`,
          evidence: badge.evidence,
        })
      }

      // --- rule 3: install instructions the lockfile contradicts ------------
      if (manager) {
        for (const ref of findCommandRefs(content)) {
          if (issues.length >= MAX_ISSUES) break
          if (ref.manager === manager) continue
          // Only the install step. Every other command works well enough across
          // managers, but installing with the wrong one writes a second
          // lockfile and, in a workspace repo, silently produces a broken tree.
          if (!ref.isSubcommand || !/^(install|i|ci)$/.test(ref.script)) continue
          // Bare `npm install` installs THIS project's dependencies, which is
          // the only case the lockfile governs. `npm i -g repo-anti-rot` and
          // `npm install lodash` install something else entirely — this repo's
          // choice of pnpm has no bearing on either, and saying otherwise is
          // advice that is simply wrong.
          if (ref.hasArgs) continue
          issues.push({
            id: `docs-drift-manager-${f}-${ref.line}`,
            category: "hygiene",
            severity: "warning",
            title: `Setup instructions use ${ref.manager}, but this repo is a ${manager} project`,
            location: `${f}:${ref.line}`,
            ageDays: await at(ref.line),
            detail:
              `The only lockfile committed here is ${manager}'s, so ${manager} is what reproduces the ` +
              `tested dependency tree. Following this line runs ${ref.manager} instead, which ignores ` +
              `that lockfile, resolves its own versions and leaves a second lockfile behind. In a ` +
              `workspace repository it usually produces a tree that does not work at all.`,
            evidence: ref.evidence,
          })
        }
      }
    }

    return issues
  },
}
