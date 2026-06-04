import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Project Hygiene scanner.
 *
 * Repo-level "is the basic scaffolding there?" checks — the things a healthy
 * project is expected to have and that new contributors / CI rely on:
 *  - **README**  — a project entry point (warning if absent)
 *  - **LICENSE** — legal clarity for reuse (info if absent)
 *  - **tests**   — any test files at all (warning if none found)
 *  - **CI**      — an automated pipeline config (info if none found)
 *
 * Each is a single repo-wide finding (not per-file), so the scanner emits at most
 * four issues. All matching is filename-based against the already-globbed file
 * list — no file contents are read.
 */

const README_RE = /^readme(\.(md|rst|txt|adoc))?$/i
const LICENSE_RE = /^licen[sc]e(\.(md|txt))?$/i
const TEST_RE = /(^|\/)(__tests__\/|test\/|tests\/|spec\/)|\.(test|spec)\.[cm]?[jt]sx?$/i

// CI config locations across the common providers.
const CI_RE =
  /^(\.github\/workflows\/.+\.ya?ml|\.gitlab-ci\.yml|\.circleci\/config\.yml|\.travis\.yml|azure-pipelines\.yml|\.drone\.yml|Jenkinsfile|\.woodpecker\.ya?ml|bitbucket-pipelines\.yml)$/i

/** Basename of a repo-relative path (forward-slash normalized). */
function baseName(p: string): string {
  const norm = p.replace(/\\/g, "/")
  const i = norm.lastIndexOf("/")
  return i === -1 ? norm : norm.slice(i + 1)
}

export const projectHygieneScanner: Scanner = {
  id: "project-hygiene",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const files = ctx.files.map((f) => f.replace(/\\/g, "/"))
    // Only consider root-level README/LICENSE (a docs/ README isn't the entry point).
    const rootFiles = files.filter((f) => !f.includes("/"))

    const hasReadme = rootFiles.some((f) => README_RE.test(f))
    const hasLicense = rootFiles.some((f) => LICENSE_RE.test(baseName(f)))
    const hasTests = files.some((f) => TEST_RE.test(f))
    const hasCI = files.some((f) => CI_RE.test(f))

    const issues: Issue[] = []

    if (!hasReadme) {
      issues.push({
        id: "hygiene-no-readme",
        category: "hygiene",
        severity: "warning",
        title: "No README at the repository root",
        location: ".",
        ageDays: 0,
        detail:
          "No README file was found at the repo root. A README is the first thing " +
          "contributors and users look for — add one describing what the project is and how to run it.",
      })
    }

    if (!hasLicense) {
      issues.push({
        id: "hygiene-no-license",
        category: "hygiene",
        severity: "info",
        title: "No LICENSE file",
        location: ".",
        ageDays: 0,
        detail:
          "No LICENSE file was found. Without an explicit license the code is " +
          "All Rights Reserved by default, which blocks reuse — add one if you intend others to use it.",
      })
    }

    if (!hasTests) {
      issues.push({
        id: "hygiene-no-tests",
        category: "hygiene",
        severity: "warning",
        title: "No test files found",
        location: ".",
        ageDays: 0,
        detail:
          "No test files (*.test.*, *.spec.*, or a test/ directory) were found anywhere " +
          "in the repo. Untested code is risky to change — consider adding at least smoke tests.",
      })
    }

    if (!hasCI) {
      issues.push({
        id: "hygiene-no-ci",
        category: "hygiene",
        severity: "info",
        title: "No CI configuration",
        location: ".",
        ageDays: 0,
        detail:
          "No CI config was found (.github/workflows, .gitlab-ci.yml, etc.). Automated " +
          "checks on every push catch regressions early — consider adding a basic pipeline.",
      })
    }

    return issues
  },
}
