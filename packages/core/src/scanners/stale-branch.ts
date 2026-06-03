import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"

/**
 * Stale Branch scanner.
 *
 * Flags remote branches that have rotted: untouched for a long time and/or far
 * behind the default branch. Both signals come from `ScanContext.git.listBranches()`
 * (`ageDays` = days since last commit, `behind` = commits behind default).
 *
 * Thresholds are intentionally simple; a future config file (.repo-anti-rotrc) can make
 * them tunable. The default branch is never flagged against itself.
 */
const ABANDONED_DAYS = 180 // ~6 months untouched → warning
const STALE_DAYS = 90 // ~3 months untouched → info

function severityFor(ageDays: number): Severity | null {
  if (ageDays >= ABANDONED_DAYS) return "warning"
  if (ageDays >= STALE_DAYS) return "info"
  return null
}

function humanAge(days: number): string {
  if (days >= 365) {
    const years = Math.floor(days / 365)
    return `${years} year${years === 1 ? "" : "s"}`
  }
  if (days >= 30) {
    const months = Math.floor(days / 30)
    return `${months} month${months === 1 ? "" : "s"}`
  }
  return `${days} day${days === 1 ? "" : "s"}`
}

export const staleBranchScanner: Scanner = {
  id: "stale-branch",
  category: "branch",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []
    const branches = await ctx.git.listBranches()

    for (const branch of branches) {
      if (branch.name === ctx.repo.defaultBranch) continue

      const severity = severityFor(branch.ageDays)
      if (!severity) continue

      const behindNote =
        branch.behind > 0 ? ` and ${branch.behind} commit${branch.behind === 1 ? "" : "s"} behind ${ctx.repo.defaultBranch}` : ""

      issues.push({
        id: `branch-stale-${branch.name}`,
        category: "branch",
        severity,
        title: `${branch.name} untouched for ${humanAge(branch.ageDays)}`,
        location: `origin/${branch.name}`,
        ageDays: branch.ageDays,
        detail: `Last commit ${humanAge(branch.ageDays)} ago${behindNote}. Likely safe to delete after review.`,
      })
    }

    return issues
  },
}
