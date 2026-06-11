"use client"

import type { Issue, IssueCategory } from "@/lib/mock-data"
import type { ScanReport } from "@/lib/reports-store"
import { readAiSettings, enabledCategories, aiCacheModel, aiBudget, type AiSettings } from "@/lib/ai-settings"
import { getCachedNotes, putCachedNotes } from "@/lib/ai-cache"
import { fetchCompletion } from "@/lib/ai-client"

/**
 * Client-side AI enrichment for scan findings.
 *
 * After a scan, each finding whose category the user enabled gets a short,
 * decisive `aiNote` from the model via our `/api/ai/complete` proxy. Deterministic
 * scan results are never altered — we only ADD context, so a failed/disabled AI
 * call degrades gracefully. For secrets the snippet is already REDACTED by the
 * scanner, so no live credential is ever sent to the model.
 *
 * Tuned for weak/free models:
 *  - **Cache** — verdicts are cached by model + stable issue id, so a rescan never
 *    re-asks for an unchanged finding (big token/time saving).
 *  - **Batch** — findings of one category go out in a single request (one verdict
 *    per finding) instead of one request each — far fewer round-trips.
 *  - **Retry** — 429/5xx responses back off and retry (free tiers rate-limit hard).
 *  - **Always answer** — the prompt forbids hedging/refusals so even a small model
 *    commits to a verdict.
 */

// Bound cost/time: how many parallel requests we allow. The per-pass issue cap and
// batch size come from `aiBudget(settings)` so a large-context model analyzes far
// more findings (in bigger batches) than a small one.
const CONCURRENCY = 3

// Categories whose findings reference EXTERNAL advisories (CVE/GHSA pages, package
// registries). Only these benefit from web search, so the (paid) web plugin is
// requested for them alone — repo-internal categories never trigger a web call.
const WEB_SEARCH_CATEGORIES = new Set<IssueCategory>(["security", "dependency"])

/** Shared tail appended to every category prompt: be decisive, no fluff, always answer. */
const COMMON_RULES =
  "Answer in 1-2 sentences, plain text, no markdown. NO hedging words ('likely', " +
  "'probably', 'maybe', 'might'). Begin with a one-word/short verdict, then the reason. " +
  "Be specific to THIS finding, not generic advice. ALWAYS commit to a single verdict even " +
  "with limited information — never refuse, never say you cannot determine; pick the most " +
  "probable verdict and justify it briefly."

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
    "You are a senior engineer reviewing a dependency finding (an unused, abandoned, stale, or",
    "un-locked dependency). Judge whether it is safe to drop or replace: is it a build/runtime/peer/dev",
    "dependency, is it used implicitly (CLI, plugin, type-only, config), and what is the migration",
    "risk? Note a well-known modern replacement only if one clearly applies.",
    "If web results are available, check the package's current status (latest release, deprecation,",
    "maintained fork) before judging it abandoned or recommending a replacement.",
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

  security: [
    "You are a security engineer triaging a security finding. It is ONE of two kinds — read the",
    "finding to tell which:",
    "(A) a committed CREDENTIAL/secret. The snippet shown is ALREADY REDACTED (the value is masked) —",
    "never ask to see the real value. Judge whether it looks like a live credential or a",
    "placeholder/test/sample, and give remediation: rotate the key, move it to a secret store/env var,",
    "and purge it from git history if real. Begin with exactly 'Rotate now' or 'Likely a placeholder'.",
    "(B) a dependency with a known VULNERABILITY (a CVE/GHSA advisory id is in the finding). Judge real",
    "exploitability for THIS repo (is the vulnerable code path reachable, is it a dev-only dependency,",
    "is a fix published) and give the action: upgrade to the fixed version, or a concrete mitigation.",
    "If web results are available, consult the linked advisory (OSV/GHSA/NVD) to state what the flaw",
    "ACTUALLY allows and which versions are affected — do not merely restate the finding text.",
    "Begin with exactly 'Upgrade now', 'Low risk here', or 'Verify <one concrete thing>'.",
    "For either kind you may instead begin with 'Verify <one concrete thing>' when warranted. " +
      COMMON_RULES,
  ].join("\n"),

  hygiene: [
    "You are a senior engineer triaging a repository-hygiene finding. It is ONE of: a missing",
    "standard file (README/LICENSE), absent tests or CI, a leftover debug statement",
    "(console.log/debugger) in shipped code, a broken relative link in docs, or a bus-factor risk",
    "(a file only one author has ever touched). Read the finding's title/location and give the",
    "concrete fix and whether it actually matters for THIS repo (e.g. a debug log in a CLI tool's",
    "output path may be intentional; missing tests in a one-off script is fine).",
    "Begin with exactly 'Fix it', 'Add it', 'Safe to ignore', or 'Verify <one concrete thing>'. " +
      COMMON_RULES,
  ].join("\n"),
}

/** Compact description of one finding for the model. */
function findingBlock(issue: Issue): string {
  const parts = [`Finding: ${issue.title}`, `Location: ${issue.location}`]
  // For dead-code we omit the analyzer's "verify before removing" note so it
  // doesn't nudge the model back toward hedging; other categories benefit from it.
  if (issue.category !== "dead-code" && issue.detail) parts.push(`Analyzer note: ${issue.detail}`)
  if (issue.evidence) parts.push(`Code:\n${issue.evidence}`)
  return parts.join("\n")
}

// ---------------------------------------------------------------------------
// Batch: one request per group of same-category findings.
// ---------------------------------------------------------------------------

/** Parse "1: verdict" / "2) verdict" lines into an n-length array of verdicts. */
function parseBatch(text: string, n: number): string[] {
  const out = new Array<string>(n).fill("")
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*\[?(\d+)\]?\s*[:.)\-]\s*(.+)$/)
    if (!m) continue
    const idx = Number(m[1]) - 1
    if (idx >= 0 && idx < n && !out[idx]) out[idx] = m[2].trim()
  }
  // Single-finding fallback: a small model may skip numbering for one item.
  if (n === 1 && !out[0]) out[0] = text.trim()
  return out
}

/** Analyze one same-category batch; returns id → verdict for the ones we got. */
async function analyzeBatch(
  category: IssueCategory,
  issues: Issue[],
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<Map<string, string>> {
  const numbered = issues.map((iss, i) => `[${i + 1}]\n${findingBlock(iss)}`).join("\n\n")
  const prompt =
    `You are given ${issues.length} finding(s), numbered below. Return EXACTLY one verdict per ` +
    `finding, each on its own line, prefixed with its number and a colon (e.g. "1: ..."). ` +
    `Cover every number from 1 to ${issues.length}. Output nothing else.\n\n${numbered}`

  const text = await fetchCompletion(
    {
      apiKey: settings.apiKey,
      model: settings.model,
      system: CATEGORY_PROMPTS[category],
      // Generous headroom: free models are verbose and may add a reasoning preamble.
      // The ceiling scales with the model's context budget (bigger batches need more).
      maxTokens: Math.min(aiBudget(settings).enrichTokenCap, Math.max(400, 240 * issues.length)),
      prompt,
      // Web search only for advisory-bearing categories, and only when enabled.
      web: settings.webSearch && WEB_SEARCH_CATEGORIES.has(category),
    },
    signal,
  )
  const result = new Map<string, string>()
  if (!text) return result
  const verdicts = parseBatch(text, issues.length)
  issues.forEach((iss, i) => {
    if (verdicts[i]) result.set(iss.id, verdicts[i])
  })
  return result
}

/** Run tasks with a small concurrency limit. */
async function mapLimit<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Analyze a single finding on demand (used by the issue detail drawer). Returns
 * the verdict text, or null when no API key is set or the model gives nothing.
 * Unlike the bulk pass, this ignores the per-category enable toggles — the user
 * explicitly asked for this one. The caller is responsible for caching the result.
 */
export async function analyzeOneIssue(
  issue: Issue,
  settings: AiSettings,
  signal?: AbortSignal,
): Promise<string | null> {
  if (!settings.apiKey.trim()) return null
  const verdicts = await analyzeBatch(issue.category, [issue], settings, signal)
  return verdicts.get(issue.id) ?? null
}

/** Issues that would trigger a NEW model call given current settings + cache. */
export function aiTargetCount(report: ScanReport): number {
  const settings = readAiSettings()
  if (!settings.apiKey.trim()) return 0
  const enabled = new Set(enabledCategories(settings))
  if (enabled.size === 0) return 0
  const targets = report.issues.filter((i) => enabled.has(i.category))
  const cached = getCachedNotes(aiCacheModel(settings), targets.map((i) => i.id))
  const misses = targets.filter((i) => !cached.has(i.id)).length
  return Math.min(misses, aiBudget(settings).maxIssues)
}

export interface EnrichOptions {
  signal?: AbortSignal
  /** Fires as analyses complete, for a progress bar (counts NEW calls only). */
  onProgress?: (done: number, total: number) => void
}

/**
 * Return a copy of `report` whose findings (in enabled categories) carry an
 * `aiNote`. Cached verdicts are applied instantly; only uncached findings hit the
 * model (batched by category). No-op (returns the original) when no key/category.
 */
export async function enrichReport(report: ScanReport, opts: EnrichOptions = {}): Promise<ScanReport> {
  const settings = readAiSettings()
  if (!settings.apiKey.trim()) return report
  const enabled = new Set(enabledCategories(settings))
  if (enabled.size === 0) return report

  const targets = report.issues.filter((i) => enabled.has(i.category))
  if (targets.length === 0) return report

  // 1) Re-use cached verdicts; only fetch the misses (capped to the model's budget).
  const budget = aiBudget(settings)
  const cacheModel = aiCacheModel(settings)
  const cached = getCachedNotes(cacheModel, targets.map((i) => i.id))
  const misses = targets.filter((i) => !cached.has(i.id)).slice(0, budget.maxIssues)

  const noteById = new Map<string, string>(cached)

  // 2) Group misses by category and split into batches.
  const byCategory = new Map<IssueCategory, Issue[]>()
  for (const issue of misses) {
    const list = byCategory.get(issue.category)
    if (list) list.push(issue)
    else byCategory.set(issue.category, [issue])
  }
  const batches: { category: IssueCategory; issues: Issue[] }[] = []
  for (const [category, list] of byCategory) {
    for (let i = 0; i < list.length; i += budget.batchSize) {
      batches.push({ category, issues: list.slice(i, i + budget.batchSize) })
    }
  }

  // 3) Run batches with limited concurrency, caching fresh verdicts.
  const total = misses.length
  let done = 0
  opts.onProgress?.(0, total)
  const fresh: Array<[string, string]> = []
  await mapLimit(batches, CONCURRENCY, async (batch) => {
    const notes = await analyzeBatch(batch.category, batch.issues, settings, opts.signal)
    for (const [id, note] of notes) {
      noteById.set(id, note)
      fresh.push([id, note])
    }
    done += batch.issues.length
    opts.onProgress?.(done, total)
  })
  putCachedNotes(cacheModel, fresh)

  if (noteById.size === 0) return report
  return {
    ...report,
    issues: report.issues.map((i) =>
      noteById.has(i.id) ? { ...i, aiNote: noteById.get(i.id) } : i,
    ),
  }
}
