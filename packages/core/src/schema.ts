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
  "secret",
  "dead-code",
])
export type IssueCategory = z.infer<typeof categorySchema>

export const issueSchema = z.object({
  id: z.string(),
  category: categorySchema,
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

export const scanReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  repo: z.object({
    owner: z.string(),
    name: z.string(),
    defaultBranch: z.string(),
  }),
  generatedAt: z.string(), // ISO timestamp
  score: z.number().int().min(0).max(100),
  grade: gradeSchema,
  issues: z.array(issueSchema),
})
export type ScanReport = z.infer<typeof scanReportSchema>
