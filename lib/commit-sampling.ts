/**
 * Pure commit-selection logic for the scan-history tree.
 *
 * Scanning every commit is far too expensive (a full scan is seconds each), so we
 * scan a representative SAMPLE of the first-parent history and draw the rest of the
 * graph as context. The sampling is deterministic and side-effect free so it can be
 * unit-tested without git.
 */

export interface Commit {
  /** full 40-char sha */
  sha: string
  /** author/commit date, epoch milliseconds */
  date: number
  /** parent shas (≥2 ⇒ a merge commit) */
  parents: string[]
  /** first line of the commit message */
  subject: string
  /** true when this commit carries a tag ref */
  tagged: boolean
}

/** A line from `git log --format=%H%x1f%ct%x1f%P%x1f%D%x1f%s`, separated by US (0x1f). */
export function parseLogLine(line: string): Commit | null {
  const parts = line.split("\x1f")
  if (parts.length < 5) return null
  const [sha, ct, parentField, decoration, ...subjectParts] = parts
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) return null
  const seconds = parseInt(ct, 10)
  if (!Number.isFinite(seconds)) return null
  return {
    sha,
    date: seconds * 1000,
    parents: parentField.trim() ? parentField.trim().split(/\s+/) : [],
    subject: subjectParts.join("\x1f").trim(),
    // `%D` lists ref names; a tag shows up as "tag: <name>".
    tagged: /\btag:/.test(decoration),
  }
}

/** Parse a full `git log` dump (newest-first) into commits, dropping bad lines. */
export function parseLog(stdout: string): Commit[] {
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map(parseLogLine)
    .filter((c): c is Commit => c !== null)
}

const isMerge = (c: Commit) => c.parents.length >= 2

/** ISO-week-ish bucket key: the integer week index since the epoch (UTC). */
function weekKey(dateMs: number): number {
  return Math.floor(dateMs / (7 * 24 * 60 * 60 * 1000))
}

/**
 * Choose up to `max` commits to scan from a newest-first first-parent history.
 *
 * Priorities, in order, until the budget fills:
 *  1. the newest commit (HEAD) and the oldest — always anchor both ends
 *  2. tagged commits (releases) and merge commits (feature landings) — the moments
 *     a repo's health most plausibly shifts
 *  3. one commit per calendar week (the newest in each week not already picked),
 *     to keep the timeline evenly spaced rather than clustered around busy periods
 *
 * Always returns a newest-first list with no duplicates, length ≤ `max`. With
 * `max` ≥ the history length, every commit is returned.
 */
export function selectCommits(commits: Commit[], max = 18): Commit[] {
  if (commits.length === 0) return []
  if (max <= 0) return []
  if (commits.length <= max) return [...commits]

  // Index for stable ordering/dedupe; input is assumed newest-first.
  const order = new Map(commits.map((c, i) => [c.sha, i]))
  const picked = new Set<string>()
  const take = (c: Commit) => {
    if (picked.size < max) picked.add(c.sha)
  }

  // 1. Anchor both ends.
  take(commits[0])
  take(commits[commits.length - 1])

  // 2. Tagged + merge commits, newest-first (already in input order).
  for (const c of commits) {
    if (picked.size >= max) break
    if (c.tagged || isMerge(c)) take(c)
  }

  // 3. Fill remaining budget with one-per-week, newest commit in each fresh week.
  if (picked.size < max) {
    const seenWeeks = new Set<number>()
    for (const sha of picked) seenWeeks.add(weekKey(commits[order.get(sha)!].date))
    for (const c of commits) {
      if (picked.size >= max) break
      const wk = weekKey(c.date)
      if (seenWeeks.has(wk)) continue
      seenWeeks.add(wk)
      take(c)
    }
  }

  return [...picked]
    .map((sha) => commits[order.get(sha)!])
    .sort((a, b) => order.get(a.sha)! - order.get(b.sha)!)
}
