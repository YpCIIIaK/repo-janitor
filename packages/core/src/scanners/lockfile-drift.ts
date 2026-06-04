import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Lockfile Drift scanner.
 *
 * Catches the manifest ↔ lockfile mismatches that bite new contributors and CI:
 *  - **no lockfile**  — deps are declared but no lockfile is committed, so installs
 *                       are non-reproducible. Checked across npm, Python (Pipenv /
 *                       Poetry), Rust, Ruby and Go.
 *  - **drift** (npm)  — a dependency is declared in package.json but never appears
 *                       in the committed lockfile (it was added without re-locking).
 *
 * The drift check is a deliberately conservative text match: a package whose name
 * is entirely absent from the lockfile is almost certainly un-locked. We don't try
 * to diff version ranges (that's the dependency scanner's job) — only presence.
 */

const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "npm-shrinkwrap.json"]

/**
 * Non-npm ecosystems for the "no lockfile committed" reproducibility check. Each
 * fires only when the manifest is present AND actually declares dependencies
 * (`hasDeps`) AND none of its lockfiles are committed.
 */
interface LockSpec {
  ecosystem: string
  manifest: string
  lockfiles: string[]
  lockName: string
  hasDeps: (content: string) => boolean
}

const LOCK_SPECS: LockSpec[] = [
  {
    ecosystem: "Python (Pipenv)",
    manifest: "Pipfile",
    lockfiles: ["Pipfile.lock"],
    lockName: "Pipfile.lock",
    hasDeps: (c) => /\[packages\]/.test(c),
  },
  {
    ecosystem: "Python (Poetry)",
    manifest: "pyproject.toml",
    lockfiles: ["poetry.lock"],
    lockName: "poetry.lock",
    hasDeps: (c) => /\[tool\.poetry/.test(c),
  },
  {
    ecosystem: "Rust",
    manifest: "Cargo.toml",
    lockfiles: ["Cargo.lock"],
    lockName: "Cargo.lock",
    hasDeps: (c) => /\[dependencies/.test(c),
  },
  {
    ecosystem: "Ruby",
    manifest: "Gemfile",
    lockfiles: ["Gemfile.lock"],
    lockName: "Gemfile.lock",
    hasDeps: (c) => /(^|\n)\s*gem\s+["']/.test(c),
  },
  {
    ecosystem: "Go",
    manifest: "go.mod",
    lockfiles: ["go.sum"],
    lockName: "go.sum",
    hasDeps: (c) => /(^|\n)\s*require\b/.test(c),
  },
  {
    ecosystem: "PHP (Composer)",
    manifest: "composer.json",
    lockfiles: ["composer.lock"],
    lockName: "composer.lock",
    hasDeps: (c) => /"require(?:-dev)?"\s*:/.test(c),
  },
]

export const lockfileDriftScanner: Scanner = {
  id: "lockfile-drift",
  category: "dependency",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []
    const fileSet = new Set(ctx.files)

    // ---- npm: no-lockfile + drift -----------------------------------------
    const raw = await ctx.readFile("package.json")
    if (raw) {
      let pkgJson: {
        dependencies?: Record<string, string>
        devDependencies?: Record<string, string>
        optionalDependencies?: Record<string, string>
      } | null = null
      try {
        pkgJson = JSON.parse(raw)
      } catch {
        pkgJson = null // malformed package.json — skip npm checks
      }

      const names = pkgJson
        ? [
            ...Object.keys(pkgJson.dependencies ?? {}),
            ...Object.keys(pkgJson.devDependencies ?? {}),
            ...Object.keys(pkgJson.optionalDependencies ?? {}),
          ]
        : []

      if (names.length > 0) {
        const present = LOCKFILES.filter((f) => fileSet.has(f))
        if (present.length === 0) {
          // 1) No lockfile at all → non-reproducible installs.
          issues.push({
            id: "lockfile-missing",
            category: "dependency",
            severity: "warning",
            title: "No lockfile committed",
            location: "package.json",
            ageDays: 0,
            detail:
              "package.json declares dependencies but no lockfile (pnpm-lock.yaml / " +
              "package-lock.json / yarn.lock) is committed. Installs are not reproducible — " +
              "commit a lockfile so everyone resolves the same versions.",
          })
        } else {
          // 2) Compare declared deps against the committed lockfile's contents.
          const lockName = present[0]
          const lockText = await ctx.readFile(lockName)
          if (lockText) {
            for (const name of names) {
              // The exact package name always appears in a healthy lockfile (as a
              // key / path / spec). Total absence => it was added without re-locking.
              if (!lockText.includes(name)) {
                issues.push({
                  id: `lockfile-drift-${name}`,
                  category: "dependency",
                  severity: "warning",
                  title: `${name} is declared but missing from ${lockName}`,
                  location: "package.json",
                  ageDays: 0,
                  detail:
                    `${name} is in package.json but does not appear in ${lockName}. The lockfile is ` +
                    `out of sync — run your package manager's install to re-lock and commit the result.`,
                })
              }
            }
          }
        }
      }
    }

    // ---- polyglot: no-lockfile reproducibility check ----------------------
    for (const spec of LOCK_SPECS) {
      if (!fileSet.has(spec.manifest)) continue
      if (spec.lockfiles.some((f) => fileSet.has(f))) continue // a lockfile is present
      const content = await ctx.readFile(spec.manifest)
      if (!content || !spec.hasDeps(content)) continue // no manifest / no declared deps

      issues.push({
        id: `lockfile-missing-${spec.lockName}`,
        category: "dependency",
        severity: "warning",
        title: `No ${spec.lockName} committed (${spec.ecosystem})`,
        location: spec.manifest,
        ageDays: 0,
        detail:
          `${spec.manifest} declares dependencies but no ${spec.lockName} is committed, so ${spec.ecosystem} ` +
          `installs are not reproducible — contributors and CI can resolve different versions. ` +
          `Generate and commit ${spec.lockName}.`,
      })
    }

    return issues
  },
}
