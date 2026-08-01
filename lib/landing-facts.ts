import type { MessageKey } from "@/lib/i18n"

/**
 * The factual claims the landing page makes, in one place so a test can check
 * them against the engine.
 *
 * Everything here duplicates something that lives in `packages/core`: the
 * scanner registry, the grade thresholds in `scoreToGrade`, the penalties in
 * `DEFAULT_WEIGHTS`. The duplication is not laziness — the dashboard does not
 * depend on the core package (it shells out to the built CLI instead), so the
 * numbers cannot simply be imported.
 *
 * What makes that acceptable is `test/landing-facts.test.ts`, which reads the
 * engine's own source and fails when the two drift. A landing page quietly
 * claiming twenty-six checks after someone added the twenty-seventh is exactly
 * the decay this project exists to report, and it would be embarrassing here.
 */

export interface CheckFamily {
  /** Stable key, used by the page to pick an icon. */
  id: "security" | "deps" | "ci" | "docs" | "decay" | "code"
  title: MessageKey
  body: MessageKey
  /**
   * Scanner ids, printed verbatim and never translated: they are the same
   * strings the CLI prints, the JSON report carries, and `.repo-anti-rot.json`
   * matches on.
   */
  scanners: string[]
}

/**
 * The registry, grouped for a reader rather than by the engine's own
 * `IssueCategory` enum — "hygiene" is one category internally and four quite
 * different questions to somebody deciding whether to run this.
 */
export const CHECK_FAMILIES: CheckFamily[] = [
  {
    id: "security",
    title: "landing.cat.security.title",
    body: "landing.cat.security.body",
    scanners: ["secrets", "vulnerable-deps", "insecure-code", "workflow-security"],
  },
  {
    id: "deps",
    title: "landing.cat.deps.title",
    body: "landing.cat.deps.body",
    scanners: [
      "dependency-funeral",
      "eol-runtime",
      "license-risk",
      "outdated-deps",
      "lockfile-drift",
    ],
  },
  {
    id: "ci",
    title: "landing.cat.ci.title",
    body: "landing.cat.ci.body",
    scanners: ["ci-health", "config-conflict", "dockerfile", "project-hygiene"],
  },
  {
    id: "docs",
    title: "landing.cat.docs.title",
    body: "landing.cat.docs.body",
    scanners: ["docs-drift", "dead-links", "broken-doc-links"],
  },
  {
    id: "decay",
    title: "landing.cat.decay.title",
    body: "landing.cat.decay.body",
    scanners: ["stale-branch", "todo-debt", "bus-factor", "env-lifecycle", "repo-bloat"],
  },
  {
    id: "code",
    title: "landing.cat.code.title",
    body: "landing.cat.code.body",
    scanners: [
      "dead-code",
      "duplicate-code",
      "commented-code",
      "leftover-debug",
      "skipped-tests",
    ],
  },
]

/** How many checks the page claims to run. */
export const TOTAL_CHECKS = CHECK_FAMILIES.reduce((n, f) => n + f.scanners.length, 0)

/** Grade bands, mirroring `scoreToGrade`. F is everything below the last one. */
export const GRADE_BANDS: { grade: string; min: number }[] = [
  { grade: "A", min: 90 },
  { grade: "B", min: 75 },
  { grade: "C", min: 60 },
  { grade: "D", min: 40 },
]

/** Mirrors `DEFAULT_WEIGHTS` — points subtracted per finding. */
export const PENALTIES = { critical: 10, warning: 3, info: 0.25 }
