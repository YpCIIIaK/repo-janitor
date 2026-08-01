import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"

/**
 * Config Conflict scanner ⭐.
 *
 * Finds places where a repository declares the same thing twice, in two files
 * that disagree — and where exactly one of the two is silently ignored.
 *
 * This is decay of a specific and nasty kind. Nothing here is broken: both files
 * parse, the build runs, CI is green. But one of them stopped being read at some
 * point — when ESLint 9 landed, when someone ran `npm install` in a pnpm repo,
 * when the team moved off Travis — and it kept sitting in the tree looking
 * authoritative. Every subsequent edit to the dead file does nothing, and the
 * person making the edit has no way to tell. A rule someone carefully added to
 * `.eslintrc.json` two years ago has never once run.
 *
 * ## Only pairs where one side is provably ignored
 *
 * The temptation is to report every duplicate-looking file. That produces noise,
 * because plenty of legitimate setups keep several config files on purpose:
 * per-package configs in a monorepo, `tsconfig.build.json` beside `tsconfig.json`,
 * a `docker-compose.override.yml`. None of those are conflicts — they compose.
 *
 * So every rule below meets two conditions:
 *
 *  1. **Same directory.** A config in `packages/api/` does not compete with one
 *     in the root; that is how monorepos are supposed to look. Conflicts are
 *     grouped per directory and never across.
 *  2. **A documented precedence rule decides the winner.** For each pair the
 *     tool itself picks one file and ignores the other — that is the finding.
 *     Where a tool merges instead of picking, there is no conflict and no rule.
 *
 * The lockfile rule is the one exception to "one is ignored", and it is worse:
 * nothing is ignored, both are read, by different people on different machines,
 * producing different dependency trees from the same commit.
 */

/** Cap so a large monorepo cannot fill a report with directory-level noise. */
const MAX_ISSUES = 25

/**
 * Directory names whose contents are not the project.
 *
 * Every rule below asks "did someone leave two configs here by accident", and
 * inside these directories the answer is always no: the two configs ARE the
 * test. Running the first draft across twelve well-known repositories produced
 * nine findings and every one of them came from here — pnpm's
 * `__fixtures__/workspace-has-shared-yarn-lock/` (a fixture whose entire purpose
 * is a yarn.lock in a pnpm workspace), five `.eslintrc` files under eslint's own
 * `tests/fixtures/`, one under babel's. Accusing a tool of the thing it is
 * testing for is the most embarrassing false positive available here.
 *
 * `examples` and `templates` are in the list for a weaker but sufficient reason:
 * they are sample projects, deliberately standalone, and their configs are
 * meant to differ from the parent's.
 */
const NOT_THE_PROJECT = new Set([
  "__fixtures__",
  "fixtures",
  "fixture",
  "__tests__",
  "__mocks__",
  "test",
  "tests",
  "e2e",
  "spec",
  "testdata",
  "playground",
  "playgrounds",
  "sandbox",
  "example",
  "examples",
  "template",
  "templates",
  "node_modules",
])

/** How long an unused CI config must sit untouched before it counts as left behind. */
const ABANDONED_CI_DAYS = 365

/** Does any segment of this path name a directory that is not the project? */
export function isFixturePath(file: string): boolean {
  return file
    .replace(/\\/g, "/")
    .split("/")
    .slice(0, -1)
    .some((seg) => NOT_THE_PROJECT.has(seg.toLowerCase()))
}

/** Lockfiles by the manager that writes them. */
const LOCKFILES: Record<string, string> = {
  "package-lock.json": "npm",
  "npm-shrinkwrap.json": "npm",
  "yarn.lock": "Yarn",
  "pnpm-lock.yaml": "pnpm",
  "bun.lockb": "Bun",
  "bun.lock": "Bun",
}

/**
 * ESLint's legacy (eslintrc) config files.
 *
 * From ESLint 9 the flat config is the default and the presence of
 * `eslint.config.*` means these are not read at all — no warning, no error.
 */
const ESLINT_LEGACY = [
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.mjs",
  ".eslintrc.json",
  ".eslintrc.yml",
  ".eslintrc.yaml",
]

const ESLINT_FLAT = [
  "eslint.config.js",
  "eslint.config.mjs",
  "eslint.config.cjs",
  "eslint.config.ts",
  "eslint.config.mts",
  "eslint.config.cts",
]

/** Babel: a `babel.config.*` is project-wide, `.babelrc` is file-relative. */
const BABEL_LEGACY = [".babelrc", ".babelrc.js", ".babelrc.cjs", ".babelrc.json"]
const BABEL_ROOT = ["babel.config.js", "babel.config.cjs", "babel.config.mjs", "babel.config.json"]

/**
 * CI providers other than GitHub Actions, by the file that declares them.
 *
 * Reported at info only. Two live CI systems is a real (if unusual) setup, and
 * the scanner cannot tell a live one from an abandoned one by reading the tree —
 * so the finding states the fact and leaves the judgement to the reader.
 */
const OTHER_CI: Record<string, string> = {
  ".travis.yml": "Travis CI",
  ".circleci/config.yml": "CircleCI",
  "appveyor.yml": "AppVeyor",
  ".appveyor.yml": "AppVeyor",
  "azure-pipelines.yml": "Azure Pipelines",
  ".drone.yml": "Drone",
  "Jenkinsfile": "Jenkins",
  ".gitlab-ci.yml": "GitLab CI",
  "bitbucket-pipelines.yml": "Bitbucket Pipelines",
  "wercker.yml": "Wercker",
}

export type ConflictKind =
  | "lockfiles"
  | "eslint"
  | "babel"
  | "prettier"
  | "jest"
  | "ci"
  | "ts-strict"

export interface ConfigConflict {
  kind: ConflictKind
  /** Directory the conflict lives in, "" for the repo root. */
  dir: string
  /** The files in conflict, repo-relative, in the order the rule names them. */
  files: string[]
  /** Extra labels the message needs, e.g. manager or provider names. */
  labels: string[]
}

/** Repo-relative directory of a path; "" for a root-level file. */
function dirOf(file: string): string {
  const i = file.lastIndexOf("/")
  return i < 0 ? "" : file.slice(0, i)
}

function baseOf(file: string): string {
  const i = file.lastIndexOf("/")
  return i < 0 ? file : file.slice(i + 1)
}

/** Group paths by directory, keeping the full path for each basename. */
function byDirectory(files: string[]): Map<string, Map<string, string>> {
  const out = new Map<string, Map<string, string>>()
  for (const raw of files) {
    const file = raw.replace(/\\/g, "/")
    const dir = dirOf(file)
    let bucket = out.get(dir)
    if (!bucket) {
      bucket = new Map()
      out.set(dir, bucket)
    }
    bucket.set(baseOf(file), file)
  }
  return out
}

/**
 * Every conflict decidable from the file list alone.
 *
 * Exported because these rules ARE the scanner; each one wants a test written
 * against a realistic layout rather than against the message it produces.
 */
export function findFilenameConflicts(files: string[]): ConfigConflict[] {
  const dirs = byDirectory(files.filter((f) => !isFixturePath(f)))
  const out: ConfigConflict[] = []
  // Stable output regardless of how the file walker ordered things: shallowest
  // directory first, so the root conflict leads the report.
  const sorted = [...dirs.entries()].sort(([a], [b]) => a.localeCompare(b))

  for (const [dir, bucket] of sorted) {
    const has = (name: string) => bucket.get(name)
    const join = (name: string) => bucket.get(name) as string

    // --- competing lockfiles ------------------------------------------------
    const locks = Object.keys(LOCKFILES).filter((n) => bucket.has(n))
    const managers = [...new Set(locks.map((n) => LOCKFILES[n]))]
    // Two files from ONE manager (package-lock + npm-shrinkwrap) is a different,
    // milder problem and npm documents which wins; only cross-manager counts.
    if (managers.length > 1) {
      out.push({ kind: "lockfiles", dir, files: locks.map(join), labels: managers })
    }

    // --- eslintrc left behind after the flat-config move --------------------
    const flat = ESLINT_FLAT.find(has)
    const legacy = ESLINT_LEGACY.find(has)
    if (flat && legacy) {
      out.push({ kind: "eslint", dir, files: [join(legacy), join(flat)], labels: [] })
    }

    // --- babel --------------------------------------------------------------
    const babelRoot = BABEL_ROOT.find(has)
    const babelLegacy = BABEL_LEGACY.find(has)
    if (babelRoot && babelLegacy) {
      out.push({ kind: "babel", dir, files: [join(babelLegacy), join(babelRoot)], labels: [] })
    }
  }

  // --- another CI provider beside GitHub Actions ----------------------------
  //
  // Repo-level rather than per-directory: these files only mean anything at the
  // root, and `.circleci/config.yml` lives in its own directory by design.
  const norm = files.map((f) => f.replace(/\\/g, "/"))
  const hasActions = norm.some((f) => /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(f))
  if (hasActions) {
    for (const [path, provider] of Object.entries(OTHER_CI)) {
      if (norm.includes(path)) {
        out.push({ kind: "ci", dir: "", files: [path], labels: [provider] })
      }
    }
  }

  return out
}

/**
 * Tools whose settings can live either in a dedicated file or under a key in
 * package.json — where the dedicated file wins and the key is dead weight.
 */
const PKG_KEY_TOOLS: {
  kind: ConflictKind
  key: string
  label: string
  fileRe: RegExp
}[] = [
  {
    kind: "prettier",
    key: "prettier",
    label: "Prettier",
    fileRe: /^(\.prettierrc(\.(json|json5|yml|yaml|js|cjs|mjs|toml))?|prettier\.config\.(js|cjs|mjs|ts))$/,
  },
  {
    kind: "jest",
    key: "jest",
    label: "Jest",
    fileRe: /^jest\.config\.(js|cjs|mjs|ts|mts|cts|json)$/,
  },
]

/**
 * Conflicts between a package.json key and a dedicated config file beside it.
 *
 * Takes the parsed keys rather than the raw JSON so the rule stays pure and the
 * caller owns the parsing (and its failure).
 */
export function findPackageKeyConflicts(
  pkgFile: string,
  keys: string[],
  files: string[],
): ConfigConflict[] {
  const dir = dirOf(pkgFile.replace(/\\/g, "/"))
  const siblings = files
    .map((f) => f.replace(/\\/g, "/"))
    .filter((f) => dirOf(f) === dir)
  const out: ConfigConflict[] = []

  for (const tool of PKG_KEY_TOOLS) {
    if (!keys.includes(tool.key)) continue
    const file = siblings.find((f) => tool.fileRe.test(baseOf(f)))
    if (!file) continue
    out.push({ kind: tool.kind, dir, files: [pkgFile, file], labels: [tool.label] })
  }

  return out
}

/**
 * Line of an explicit `"strict": false` in a tsconfig, or null.
 *
 * Explicit only. A tsconfig with no `strict` key at all may well inherit one
 * from `extends`, and this scanner does not resolve extends chains — guessing
 * there would mean accusing a correctly-configured project. Turning strict OFF
 * by hand, on the other hand, is unambiguous: someone wrote it, and it usually
 * outlives the migration it was written for.
 */
export function findStrictOff(content: string): number | null {
  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    // Comments are legal in tsconfig, and a commented-out setting is not a
    // setting.
    if (/^\s*(\/\/|\/\*|\*)/.test(lines[i])) continue
    if (/"strict"\s*:\s*false/.test(lines[i])) return i + 1
  }
  return null
}

function describe(c: ConfigConflict): { severity: Severity; title: string; detail: string } {
  switch (c.kind) {
    case "lockfiles":
      return {
        severity: "warning",
        title: `Competing lockfiles: ${c.labels.join(" and ")}`,
        detail:
          `${c.files.join(" and ")} are both committed. Nothing here is ignored — each is read by its ` +
          `own package manager, so two people running install with the tools they have get two different ` +
          `dependency trees from the same commit, and only one of them matches CI. Delete the lockfile of ` +
          `whichever manager the project is not on, and pin the choice with the "packageManager" field.`,
      }
    case "eslint":
      return {
        severity: "warning",
        title: `${baseOf(c.files[0])} is never read while ${baseOf(c.files[1])} exists`,
        detail:
          `From ESLint 9 the flat config is the default, and when ${baseOf(c.files[1])} is present the ` +
          `legacy ${baseOf(c.files[0])} is not loaded at all — silently, with no warning. Every rule, ` +
          `override and ignore in it has stopped applying. Either port what is still wanted into the flat ` +
          `config, or delete the file so nobody edits it expecting an effect.`,
      }
    case "babel":
      return {
        severity: "info",
        title: `${baseOf(c.files[0])} sits beside ${baseOf(c.files[1])}`,
        detail:
          `Babel treats these differently: ${baseOf(c.files[1])} is project-wide, while ` +
          `${baseOf(c.files[0])} is file-relative and applies only within its own package. When both ` +
          `exist the resulting config depends on which file is being compiled, which is rarely what anyone ` +
          `intended and almost never what the two files say together.`,
      }
    case "prettier":
    case "jest":
      return {
        severity: "info",
        title: `${c.labels[0]} is configured twice: ${baseOf(c.files[1])} and package.json`,
        detail:
          `${c.labels[0]} reads ${baseOf(c.files[1])} and ignores the "${c.kind}" key in ` +
          `${c.files[0]} — the dedicated file wins outright, it is not merged. Whatever the package.json ` +
          `key says has no effect, so remove it rather than leaving two answers to the same question.`,
      }
    case "ci":
      return {
        severity: "info",
        title: `Untouched ${c.labels[0]} config sits alongside GitHub Actions`,
        detail:
          `${c.files[0]} declares a ${c.labels[0]} pipeline while .github/workflows also defines one, and ` +
          `nobody has edited it in over a year. Either it stopped running when the project moved to ` +
          `Actions — in which case it is a leftover that still looks authoritative to anyone reading the ` +
          `repo, with steps that have quietly diverged from the ones that actually run — or it is still ` +
          `running unattended, which is worse.`,
      }
    case "ts-strict":
      return {
        severity: "info",
        title: `TypeScript strict mode is explicitly disabled`,
        detail:
          `${c.files[0]} sets "strict": false. This is usually written during a migration and then never ` +
          `revisited, so the codebase keeps growing under the weaker checks it was meant to leave behind. ` +
          `The individual flags (strictNullChecks, noImplicitAny) can be turned on one at a time, which ` +
          `makes it a gradual job rather than one large one.`,
      }
  }
}

/**
 * Files worth opening — the content rules only need these.
 *
 * `tsconfig.json` at the ROOT only. A nested one is a package's own stance in a
 * monorepo or, as often, a corner of the repo that is not the product at all:
 * vite ships `playground/tsconfig.json` with strict off, which is correct for a
 * playground and was the last false positive this scanner produced. The root
 * config is the project's answer to the question; the rest are details.
 */
function isReadable(file: string): boolean {
  const norm = file.replace(/\\/g, "/")
  if (norm === "tsconfig.json") return true
  return baseOf(norm) === "package.json" && !isFixturePath(norm)
}

export const configConflictScanner: Scanner = {
  id: "config-conflict",
  category: "hygiene",

  async run(ctx: ScanContext): Promise<Issue[]> {
    const files = ctx.files.map((f) => f.replace(/\\/g, "/"))
    const conflicts = findFilenameConflicts(files)

    for (const file of files.filter(isReadable)) {
      if (conflicts.length >= MAX_ISSUES) break
      const content = await ctx.readFile(file)
      if (!content) continue

      if (baseOf(file) === "package.json") {
        try {
          const json = JSON.parse(content) as Record<string, unknown>
          conflicts.push(...findPackageKeyConflicts(file, Object.keys(json), files))
        } catch {
          /* malformed package.json is another scanner's finding, not this one's */
        }
        continue
      }

      const line = findStrictOff(content)
      if (line !== null) {
        conflicts.push({ kind: "ts-strict", dir: dirOf(file), files: [`${file}:${line}`], labels: [] })
      }
    }

    const issues: Issue[] = []
    for (const c of conflicts.slice(0, MAX_ISSUES)) {
      const { severity, title, detail } = describe(c)
      const location = c.files[0]

      let ageDays = 0
      try {
        const [path, line] = location.split(":")
        ageDays = await ctx.git.blameAgeDays(path, Number(line) || 1)
      } catch {
        /* blame is a nicety; a finding without an age is still a finding */
      }

      // Two CI systems in one repo is a legitimate setup — babel and nest both
      // run CircleCI beside Actions on purpose, and reporting them said nothing
      // true. What makes this a finding is not the second file's existence but
      // its abandonment, and the only evidence of abandonment available here is
      // that nobody has touched it in a year. With no git (age 0) the rule goes
      // quiet, which is the safe direction.
      if (c.kind === "ci" && ageDays < ABANDONED_CI_DAYS) continue

      issues.push({
        id: `config-conflict-${c.kind}-${c.dir || "root"}`,
        category: "hygiene",
        severity,
        title,
        location,
        ageDays,
        detail,
        evidence: c.files.join(" · "),
      })
    }

    return issues
  },
}
