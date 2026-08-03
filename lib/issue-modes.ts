import type { Issue } from "@/lib/mock-data"

/**
 * Focused views over a report — "modes" in the UI.
 *
 * A scan is always a whole scan; a mode is a lens on its results, not a
 * different run. Splitting the scan itself would mean cloning the repository
 * twice to answer two questions about the same commit, and would let the two
 * answers disagree.
 *
 * Membership comes from the `scanner` field the engine stamps on every finding.
 * Reports produced before that field existed fall back to matching the shape of
 * `id` — the ids have always been prefixed with their scanner's name. The
 * fallback is deliberately narrow and tested: it exists so an older stored
 * report still populates these views, not as the primary mechanism.
 */

export type IssueMode = "security" | "links"

interface ModeSpec {
  /** Scanner ids that feed this mode. */
  scanners: string[]
  /** Id prefixes for reports written before the `scanner` field existed. */
  legacyPrefixes: string[]
}

const MODES: Record<IssueMode, ModeSpec> = {
  security: {
    // Three different kinds of problem that a reader thinks of as one question:
    // "is anything here going to get me owned?"
    // The workflow scanner belongs here rather than in a CI section of its own:
    // a stranger reading your secrets out of a pull request is the same question
    // as a hard-coded key, however different the file it lives in.
    scanners: ["insecure-code", "secrets", "vulnerable-deps", "workflow-security", "supply-chain"],
    legacyPrefixes: ["insecure-", "secret-", "vuln-", "supply-"],
  },
  links: {
    // Internal and external link rot are the same chore, split across two
    // scanners only because checking them needs different machinery.
    scanners: ["dead-links", "broken-doc-links"],
    legacyPrefixes: ["deadlink-", "doclink-"],
  },
}

export function inMode(issue: Issue, mode: IssueMode): boolean {
  const spec = MODES[mode]
  if (issue.scanner) return spec.scanners.includes(issue.scanner)
  return spec.legacyPrefixes.some((p) => issue.id.startsWith(p))
}

export function filterMode(issues: Issue[], mode: IssueMode): Issue[] {
  return issues.filter((i) => inMode(i, mode))
}

/** Scanner ids a mode covers — used to explain an empty view honestly. */
export function modeScanners(mode: IssueMode): string[] {
  return [...MODES[mode].scanners]
}
