"use client"

import type { Issue, IssueCategory } from "@/lib/mock-data"
import type { ScanReport } from "@/lib/reports-store"
import { readAiSettings, enabledCategories, type AiSettings } from "@/lib/ai-settings"

/**
 * Client-side AI enrichment for scan findings.
 *
 * After a scan, each finding whose category the user enabled is sent (title +
 * location + redacted snippet + the analyzer note) to our `/api/ai/complete`
 * proxy and gets a short, decisive assessment attached as `aiNote`. Deterministic
 * scan results are never altered — we only ADD context, so a failed/disabled AI
 * call degrades gracefully.
 *
 * For secrets the snippet is already REDACTED by the scanner, so no live
 * credential is ever sent to the model.
 */

// Bound cost/time: cap total enriched issues and how many run at once.
const MAX_ISSUES = 40
const CONCURRENCY = 4

/** Shared tail appended to every category prompt: be decisive, no fluff. */
const COMMON_RULES =
  "Answer in 1-2 sentences, plain text, no markdown. NO hedging words ('likely', " +
  "'probably', 'maybe', 'might'). Begin with a one-word/short verdict, then the reason. " +
  "Be specific to THIS finding, not generic advice."

const CATEGORY_PROMPTS: Record<IssueCategory, string> = {
  "dead-code": [
    "You are a senior engineer triaging 'unused export' findings from a static analyzer.",
    "ESTABLISHED FACT — do not question it: the analyzer already scanned EVERY file in the repo,",
    "INCLUDING index/barrel files, and confirmed this export has NO static import and NO re-export",
    "anywhere. Never suggest 'check index.ts' or 'check for re-exports' — that is already proven negative.",
    "Judge only the blind spots a reference graph cannot see: (1) framework/tooling auto-discovery",
    "(Next.js useMDXComponents/metadata/route handlers, Vite glob imports, Fumadocs defineDocs, test",
    "hooks); (2) published-package public API (paths like sdk/, packages/*/src, lib entrypoints =",
    "external consumers); (3) dynamic import()/require/reflection. If none apply, it is genuinely dead.",
    "Begin with exactly 'Safe to remove', 'Keep', or 'Verify <one concrete thing>'. " + COMMON_RULES,
  ].join("\n"),

  env: [
    "You are a senior engineer reviewing an environment-variable lifecycle finding (a var read in",
    "code but missing from .env.example, or declared in .env.example but unused).",
    "Assess: is the variable actually required at runtime or optional (has a code fallback)? Is it",
    "security-sensitive (API key/secret/credential vs. a benign flag/URL)? What should the maintainer",
    "do — document it in .env.example, remove the dead entry, or provide a default?",
    "Begin with exactly 'Document it', 'Remove it', 'Optional', or 'Verify <one concrete thing>'. " +
      COMMON_RULES,
  ].join("\n"),

  dependency: [
    "You are a senior engineer reviewing a dependency finding (an unused, abandoned, or stale",
    "dependency). Judge whether it is safe to drop or replace: is it a build/runtime/peer/dev",
    "dependency, is it used implicitly (CLI, plugin, type-only, config), and what is the migration",
    "risk? Note a well-known modern replacement only if one clearly applies.",
    "Begin with exactly 'Safe to remove', 'Keep', 'Replace with <x>', or 'Verify <one concrete thing>'. " +
      COMMON_RULES,
  ].join("\n"),

  branch: [
    "You are a senior engineer reviewing a stale-branch finding (a branch with no recent activity).",
    "Advise whether to delete, merge, or keep it, and the main risk (unmerged work, release branch,",
    "long-lived integration branch). Be pragmatic about git hygiene.",
    "Begin with exactly 'Delete', 'Merge first', 'Keep', or 'Verify <one concrete thing>'. " +
      COMMON_RULES,
  ].join("\n"),

  todo: [
    "You are a senior engineer triaging a TODO/FIXME debt finding. Judge whether it is still",
    "actionable or likely stale/obsolete, how urgent it is, and the concrete next step. Consider that",
    "the surrounding code may already address it.",
    "Begin with exactly 'Act now', 'Backlog', 'Stale — drop it', or 'Verify <one concrete thing>'. " +
      COMMON_RULES,
  ].join("\n"),

  secret: [
    "You are a security engineer reviewing a potential committed-secret finding. The snippet shown is",
    "ALREADY REDACTED (the credential is masked) — never ask to see the real value. Judge whether",
    "this looks like a live credential or a placeholder/test/sample value, and give the remediation:",
    "rotate the key, move it to a secret store/env var, and purge it from git history if real.",
    "Begin with exactly 'Rotate now', 'Likely a placeholder', or 'Verify <one concrete thing>'. " +
      COMMON_RULES,
  ].join("\n"),
}

function buildPrompt(issue: Issue): string {
  const parts = [`Finding: ${issue.title}`, `Location: ${issue.location}`]
  // For dead-code we omit the analyzer's "verify before removing" note so it
  // doesn't nudge the model back toward hedging; other categories benefit from it.
  if (issue.category !== "dead-code" && issue.detail) parts.push(`Analyzer note: ${issue.detail}`)
  if (issue.evidence) parts.push(`Code:\n${issue.evidence}`)
  parts.push("Verdict?")
  return parts.join("\n")
}

async function analyzeOne(issue: Issue, settings: AiSettings, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("/api/ai/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        apiKey: settings.apiKey,
        model: settings.model,
        system: CATEGORY_PROMPTS[issue.category],
        prompt: buildPrompt(issue),
        // Generous headroom: free models can be verbose / emit a reasoning preamble.
        maxTokens: 2000,
      }),
    })
    const data = (await res.json().catch(() => null)) as { text?: string; error?: string } | null
    if (!res.ok || !data?.text) return null
    return data.text
  } catch {
    return null // network/abort — skip enrichment for this issue
  }
}

/** Run tasks with a small concurrency limit, preserving input order in results. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

/** Issues in a report that WOULD be enriched given current settings — for progress planning. */
export function aiTargetCount(report: ScanReport): number {
  const settings = readAiSettings()
  if (!settings.apiKey.trim()) return 0
  const enabled = new Set(enabledCategories(settings))
  if (enabled.size === 0) return 0
  return Math.min(report.issues.filter((i) => enabled.has(i.category)).length, MAX_ISSUES)
}

export interface EnrichOptions {
  signal?: AbortSignal
  /** Fires as analyses complete, for a progress bar. */
  onProgress?: (done: number, total: number) => void
}

/**
 * Return a copy of `report` whose findings (in enabled categories) carry an
 * `aiNote`. No-op (returns the original) when no key or no category is enabled.
 */
export async function enrichReport(report: ScanReport, opts: EnrichOptions = {}): Promise<ScanReport> {
  const settings = readAiSettings()
  if (!settings.apiKey.trim()) return report
  const enabled = new Set(enabledCategories(settings))
  if (enabled.size === 0) return report

  const targets = report.issues.filter((i) => enabled.has(i.category)).slice(0, MAX_ISSUES)
  if (targets.length === 0) return report

  let done = 0
  opts.onProgress?.(0, targets.length)
  const notes = await mapLimit(targets, CONCURRENCY, async (issue) => {
    const note = await analyzeOne(issue, settings, opts.signal)
    opts.onProgress?.(++done, targets.length)
    return note
  })

  const noteById = new Map<string, string>()
  targets.forEach((issue, i) => {
    const note = notes[i]
    if (note) noteById.set(issue.id, note)
  })
  if (noteById.size === 0) return report

  return {
    ...report,
    issues: report.issues.map((i) =>
      noteById.has(i.id) ? { ...i, aiNote: noteById.get(i.id) } : i,
    ),
  }
}
