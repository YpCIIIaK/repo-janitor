import { z } from "zod"

/**
 * Versioned report schema — single source of truth shared by CLI, GitHub Action
 * and the dashboard. The shape intentionally matches the dashboard mock data in
 * `lib/mock-data.ts` so the UI can consume real reports without changes.
 *
 * Bump SCHEMA_VERSION on any breaking change and keep a migration note in HANDOFF.md.
 */
export const SCHEMA_VERSION = 1

export const gradeSchema = z.enum(["A", "B", "C", "D", "F"])
export type Grade = z.infer<typeof gradeSchema>

export const severitySchema = z.enum(["critical", "warning", "info"])
export type Severity = z.infer<typeof severitySchema>

export const categorySchema = z.enum([
  "env",
  "dependency",
  "branch",
  "todo",
  // Umbrella for security findings: committed secrets (working tree + git
  // history) and dependencies with known vulnerabilities (CVE/GHSA).
  "security",
  "dead-code",
  // Umbrella for repo/code hygiene: missing standard files, no tests/CI,
  // leftover debug statements, broken doc links, bus-factor risk.
  "hygiene",
])
export type IssueCategory = z.infer<typeof categorySchema>

/**
 * Back-compat for reports written before the `secret` category was folded into
 * the broader `security` category (schema stayed v1 — only an enum value was
 * renamed). Old ingested reports carry `"secret"`; map it forward on parse so
 * they still validate and render under the new category.
 */
const categoryInput = z.preprocess(
  (v) => (v === "secret" ? "security" : v),
  categorySchema,
)

export const issueSchema = z.object({
  id: z.string(),
  category: categoryInput,
  severity: severitySchema,
  title: z.string(),
  /** human-readable location, e.g. "src/server/db.ts:42" or "package.json" */
  location: z.string(),
  /** age in days since the problem was introduced (from git blame when available) */
  ageDays: z.number().int().nonnegative(),
  /** short explanation of why this is flagged */
  detail: z.string(),
  /**
   * Optional one-line snippet showing the offending code. For secrets this is
   * REDACTED (the credential is masked) so the report never leaks the value.
   */
  evidence: z.string().optional(),
  /**
   * Optional AI-generated assessment. Attached client-side by the dashboard when
   * AI analysis is enabled; the core scanners never populate it.
   */
  aiNote: z.string().optional(),
})
export type Issue = z.infer<typeof issueSchema>

/**
 * Repo "profile" — what the codebase is made of: a language breakdown (by file
 * count and non-blank lines) and the ecosystems/tooling detected from manifest
 * files. Optional, so reports produced before profiling shipped still validate.
 */
export const repoProfileSchema = z.object({
  /** Total files the scan walked (after ignore globs). */
  totalFiles: z.number().int().nonnegative(),
  /** Source languages, sorted by lines of code descending. */
  languages: z.array(
    z.object({
      language: z.string(),
      files: z.number().int().nonnegative(),
      loc: z.number().int().nonnegative(),
    }),
  ),
  /** Detected ecosystems/tooling (e.g. "Node.js", "Docker", "GitHub Actions"). */
  tools: z.array(z.string()),
})
export type RepoProfile = z.infer<typeof repoProfileSchema>

export const scanReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  repo: z.object({
    owner: z.string(),
    name: z.string(),
    defaultBranch: z.string(),
    /** HEAD commit SHA at scan time — powers stable GitHub permalinks. */
    commit: z.string().optional(),
  }),
  generatedAt: z.string(), // ISO timestamp
  score: z.number().int().min(0).max(100),
  grade: gradeSchema,
  issues: z.array(issueSchema),
  /**
   * Effective scan configuration echoed into the report. Lets the dashboard
   * recompute the score client-side (for Snooze) with the SAME weights the scan
   * used, even when a repo overrides them via .repo-anti-rot.json.
   */
  config: z
    .object({
      weights: z.object({
        critical: z.number().nonnegative(),
        warning: z.number().nonnegative(),
        info: z.number().nonnegative(),
      }),
    })
    .optional(),
  /**
   * Repo size metrics, for normalized comparison (e.g. issues per 1000 lines) so
   * a big repo isn't unfairly compared to a small one on raw issue count.
   */
  metrics: z
    .object({
      /** non-blank lines across recognised source files */
      linesOfCode: z.number().int().nonnegative(),
    })
    .optional(),
  /** What the codebase is made of — languages and detected tooling. */
  profile: repoProfileSchema.optional(),
})
export type ScanReport = z.infer<typeof scanReportSchema>
