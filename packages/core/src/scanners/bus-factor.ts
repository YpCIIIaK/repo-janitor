import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Bus Factor scanner.
 *
 * Surfaces knowledge-concentration risk: source files that exactly ONE author has
 * ever committed AND that haven't been touched in a long time. Those are the files
 * where, if that person leaves ("gets hit by a bus"), nobody else has context.
 *
 * Needs git history (`ctx.git.fileOwnership`); degrades to no findings when git is
 * unavailable. Recently-touched single-author files are ignored — active solo work
 * is normal; the risk is *stale* solo-owned code. Results are capped to the worst
 * offenders so the report stays focused.
 */

const SOURCE_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts|py|go|rs|java|rb|php|c|cc|cpp|h|hpp|cs|kt|swift|scala)$/
const STALE_DAYS = 365
const MAX_TOTAL = 30

function years(days: number): string {
  if (days >= 365) {
    const y = Math.floor(days / 365)
    return `${y} year${y === 1 ? "" : "s"}`
  }
  const m = Math.max(1, Math.floor(days / 30))
  return `${m} month${m === 1 ? "" : "s"}`
}

export const busFactorScanner: Scanner = {
  id: "bus-factor",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    if (!ctx.git.fileOwnership) return []

    const ownership = await ctx.git.fileOwnership()
    const tracked = new Set(ctx.files.map((f) => f.replace(/\\/g, "/")))

    const candidates = Object.entries(ownership)
      .filter(([path, info]) => {
        const norm = path.replace(/\\/g, "/")
        return (
          tracked.has(norm) &&
          SOURCE_RE.test(norm) &&
          info.authors === 1 &&
          info.ageDays >= STALE_DAYS
        )
      })
      // Worst first: oldest single-owner files are the biggest knowledge risk.
      .sort((a, b) => b[1].ageDays - a[1].ageDays)
      .slice(0, MAX_TOTAL)

    return candidates.map(([path, info]) => {
      const norm = path.replace(/\\/g, "/")
      return {
        id: `busfactor-${norm}`,
        category: "hygiene",
        severity: "info",
        title: `Single-author file untouched for ${years(info.ageDays)}`,
        location: norm,
        ageDays: info.ageDays,
        detail:
          `Only one contributor has ever committed ${norm}, and it hasn't changed in ` +
          `${years(info.ageDays)}. That's a knowledge-concentration risk — consider a review or ` +
          "pairing pass so a second person understands it.",
      }
    })
  },
}
