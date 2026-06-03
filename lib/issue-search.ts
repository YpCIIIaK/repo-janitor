import { categoryLabels, type Issue, type IssueCategory } from "@/lib/mock-data"

/**
 * Lightweight "semantic" issue search — no embeddings, no network.
 *
 * It matches a query against every field of an issue (title, detail, location,
 * category label, severity) and expands query terms with domain synonyms so a
 * search for "credential" or "leak" surfaces `secret` issues, "package" surfaces
 * `dependency` issues, "config" surfaces `env` issues, and so on. Results are
 * ranked by relevance. Good enough for a local tool; swap in real embeddings
 * later if cross-meaning recall matters.
 */

const CATEGORY_SYNONYMS: Record<IssueCategory, string[]> = {
  secret: [
    "secret", "secrets", "key", "keys", "credential", "credentials", "token", "tokens",
    "password", "passwords", "apikey", "leak", "leaked", "exposed", "aws", "stripe",
  ],
  env: [
    "env", "environment", "config", "configuration", "variable", "variables", "dotenv",
    "undocumented", "missing",
  ],
  dependency: [
    "dependency", "dependencies", "package", "packages", "module", "modules", "npm",
    "library", "libraries", "outdated", "deprecated", "unused", "bloat",
  ],
  branch: ["branch", "branches", "stale", "merged", "abandoned", "prune", "behind"],
  todo: ["todo", "todos", "fixme", "debt", "tech"],
  "dead-code": ["dead", "deadcode", "unused", "unreferenced", "orphan", "export"],
}

function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9_]+/).filter(Boolean)
}

/** Categories whose synonym set contains (or starts with) the term. */
function categoriesForTerm(term: string): IssueCategory[] {
  const out: IssueCategory[] = []
  for (const cat of Object.keys(CATEGORY_SYNONYMS) as IssueCategory[]) {
    if (CATEGORY_SYNONYMS[cat].some((s) => s === term || s.startsWith(term) || term.startsWith(s))) {
      out.push(cat)
    }
  }
  return out
}

/** Optimal-string-alignment distance, capped — used for typo tolerance. */
function lev(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (Math.abs(m - n) > 2) return 3
  const dp = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]
    dp[0] = j
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i]
      dp[i] = Math.min(
        dp[i] + 1,
        dp[i - 1] + 1,
        prev + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
      prev = tmp
    }
  }
  return dp[m]
}

function scoreTerm(term: string, haystack: string, hayTokens: string[], issue: Issue): number {
  let best = 0
  if (haystack.includes(term)) best = 3

  for (const tok of hayTokens) {
    if (best >= 3) break
    if (tok === term) best = Math.max(best, 3)
    else if (tok.startsWith(term) || term.startsWith(tok)) best = Math.max(best, 2)
    else if (term.length >= 4 && lev(tok, term) <= 1) best = Math.max(best, 1)
  }

  // synonym / category expansion: typing a related word still matches the issue
  const cats = categoriesForTerm(term)
  if (cats.includes(issue.category)) best = Math.max(best, 2)
  if (best < 2) {
    for (const cat of cats) {
      if (CATEGORY_SYNONYMS[cat].some((s) => haystack.includes(s))) {
        best = Math.max(best, 1)
        break
      }
    }
  }
  return best
}

function scoreIssue(issue: Issue, terms: string[]): number {
  const haystack = [
    issue.title,
    issue.detail,
    issue.location,
    issue.category,
    categoryLabels[issue.category],
    issue.severity,
  ]
    .join(" ")
    .toLowerCase()
  const hayTokens = tokenize(haystack)

  let total = 0
  for (const term of terms) {
    const s = scoreTerm(term, haystack, hayTokens, issue)
    if (s === 0) return 0 // every term must match something (AND semantics)
    total += s
  }
  return total
}

/** Filter + rank issues by relevance. Empty query returns the list unchanged. */
export function searchIssues(issues: Issue[], query: string): Issue[] {
  const q = query.trim().toLowerCase()
  if (!q) return issues
  const terms = tokenize(q)
  if (terms.length === 0) return issues

  return issues
    .map((issue) => ({ issue, score: scoreIssue(issue, terms) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((x) => x.issue)
}
