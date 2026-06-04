import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Lockfile Drift scanner.
 *
 * Catches the package.json ↔ lockfile mismatches that bite new contributors and CI:
 *  - **no lockfile**  — deps are declared but no lockfile is committed, so installs
 *                       are non-reproducible.
 *  - **drift**        — a dependency is declared in package.json but never appears
 *                       in the committed lockfile (it was added without re-locking).
 *
 * The drift check is a deliberately conservative text match: a package whose name
 * is entirely absent from the lockfile is almost certainly un-locked. We don't try
 * to diff version ranges (that's the dependency scanner's job) — only presence.
 */

const LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "npm-shrinkwrap.json"]

export const lockfileDriftScanner: Scanner = {
  id: "lockfile-drift",
  category: "dependency",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const raw = await ctx.readFile("package.json")
    if (!raw) return []

    let pkgJson: {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    try {
      pkgJson = JSON.parse(raw)
    } catch {
      return [] // malformed package.json — nothing reliable to compare
    }

    const names = [
      ...Object.keys(pkgJson.dependencies ?? {}),
      ...Object.keys(pkgJson.devDependencies ?? {}),
      ...Object.keys(pkgJson.optionalDependencies ?? {}),
    ]
    if (names.length === 0) return []

    // Which lockfile(s) are committed at the repo root?
    const fileSet = new Set(ctx.files)
    const present = LOCKFILES.filter((f) => fileSet.has(f))

    // 1) No lockfile at all → non-reproducible installs.
    if (present.length === 0) {
      return [
        {
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
        },
      ]
    }

    // 2) Compare declared deps against the committed lockfile's contents.
    const lockName = present[0]
    const lockText = await ctx.readFile(lockName)
    if (!lockText) return [] // unreadable lock — skip the drift check

    const issues: Issue[] = []
    for (const name of names) {
      // The exact package name always appears in a healthy lockfile (as a key /
      // path / spec). Total absence => it was added without re-locking.
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

    return issues
  },
}
