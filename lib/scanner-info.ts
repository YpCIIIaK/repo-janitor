/**
 * Human names and one-line descriptions for the engine's scanners, keyed by the
 * scanner id stamped on each finding. Used by the Breakdown tab.
 */
export const SCANNER_INFO: Record<string, { name: string; what: string }> = {
  secrets: { name: "Secrets", what: "Credentials committed to the tree or still in git history" },
  "vulnerable-deps": { name: "Vulnerable dependencies", what: "Packages with known CVEs / GHSAs (OSV database)" },
  "insecure-code": { name: "Insecure code", what: "eval, shell/SQL interpolation, TLS off, weak hashes" },
  "workflow-security": { name: "Workflow security", what: "GitHub Actions that expose secrets or the repo to outsiders" },
  "supply-chain": { name: "Supply chain", what: "Install scripts piping to a shell, insecure dependency URLs" },
  "env-lifecycle": { name: "Env lifecycle", what: "Env vars used but undocumented, or documented but unused" },
  "dependency-funeral": { name: "Dependency funeral", what: "Unused, deprecated and abandoned npm packages" },
  "outdated-deps": { name: "Outdated dependencies", what: "PyPI, crates, gems and Go modules behind or abandoned" },
  "eol-runtime": { name: "End-of-life runtime", what: "Node, Python or CI runners that no longer get patches" },
  "license-risk": { name: "License risk", what: "Dependency licenses with obligations the project hasn't taken on" },
  "lockfile-drift": { name: "Lockfile drift", what: "Missing lockfiles and manifest ↔ lockfile mismatches" },
  "stale-branch": { name: "Stale branches", what: "Remote branches long untouched or far behind" },
  "todo-debt": { name: "TODO debt", what: "Debt markers in comments, ranked by age" },
  "dead-code": { name: "Dead code", what: "Exported values nothing imports" },
  "duplicate-code": { name: "Duplicate code", what: "The same block copied into several places" },
  "commented-code": { name: "Commented-out code", what: "Blocks of code left in comments" },
  "leftover-debug": { name: "Leftover debug", what: "debugger, console.log, print and breakpoints" },
  "skipped-tests": { name: "Skipped tests", what: "Disabled and focused (.only) tests" },
  "ci-health": { name: "CI health", what: "Whether CI actually runs the tests, and on pull requests" },
  "bus-factor": { name: "Bus factor", what: "Old files only one person has ever touched" },
  "project-hygiene": { name: "Project hygiene", what: "README, LICENSE and other basic scaffolding" },
  "repo-bloat": { name: "Repo bloat", what: "Binaries and oversized files in version control" },
  dockerfile: { name: "Dockerfile", what: "Unpinned base images, root user, remote ADD" },
  "config-conflict": { name: "Config conflicts", what: "Two configs for one tool, one silently ignored" },
  "docs-drift": { name: "Docs drift", what: "Instructions in docs that no longer match the repo" },
  "broken-doc-links": { name: "Broken doc links", what: "Relative links in markdown to files that are gone" },
  "dead-links": { name: "Dead links", what: "External links that no longer resolve" },
}

/** Scanners whose results are partial without full git history. */
export const HISTORY_SCANNERS = ["secrets", "bus-factor", "todo-debt", "stale-branch"]

export function scannerName(id: string): string {
  return SCANNER_INFO[id]?.name ?? id.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase())
}
