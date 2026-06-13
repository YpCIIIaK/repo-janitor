"use client"

import type { Issue, Severity } from "@/lib/mock-data"
import { categoryLabels } from "@/lib/mock-data"
import { categoryScores, scoreToGrade, computeScore, type SeverityWeights } from "@/lib/score"
import { hotspotFiles } from "@/lib/hotspots"
import { readAiSettings, aiCacheModel, aiBudget } from "@/lib/ai-settings"
import { fetchCompletion } from "@/lib/ai-client"

/**
 * AI "executive summary" — one short, decisive paragraph about a repo's overall
 * health, generated on demand from the current findings.
 *
 * Cheap by design: a single request per repo, cached by model + the exact set of
 * findings, so reopening the repo (or rescanning with no changes) never re-asks.
 * Only finding metadata (title/location/category/severity) is sent — never the
 * `evidence` snippet — so a redacted secret's masked value still never leaves.
 */

const KEY = "repo-anti-rot:ai-summary:v1"
const CACHE_VERSION = "2"

const SYSTEM =
  "You are a staff engineer giving a repository's maintainer a brutally honest, " +
  "actionable executive summary of its health, based on an automated rot scan. " +
  "Write 3-4 sentences of plain text (no markdown, no bullet lists, no preamble). " +
  "Lead with the overall verdict tied to the grade, name the 1-2 biggest concrete " +
  "risks (reference the actual findings/files), and end with the single highest-" +
  "leverage next action. NO hedging ('likely', 'maybe'); be specific to THIS repo, " +
  "not generic advice. If the repo is clean, say so plainly and briefly. " +
  "If web results are available, use them to gauge the real severity of any CVE/" +
  "dependency finding rather than assuming from the title."

// ---------------------------------------------------------------------------
// Cache (keyed by model + a fingerprint of the finding set)
// ---------------------------------------------------------------------------

/** djb2 string hash → short hex, used to fingerprint the finding set. */
function hash(s: string): string {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

function fingerprint(issueIds: string[]): string {
  return hash([...issueIds].sort().join(""))
}

function cacheKey(model: string, repoId: string, issueIds: string[]): string {
  return `${CACHE_VERSION}::${model}::${repoId}::${fingerprint(issueIds)}`
}

function readCache(): Record<string, string> {
  if (typeof window === "undefined") return {}
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

function writeCache(map: Record<string, string>): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(map))
  } catch {
    /* quota — best-effort */
  }
}

/** The cached summary for this repo's exact finding set under the active model, if any. */
export function getCachedSummary(model: string, repoId: string, issueIds: string[]): string | null {
  return readCache()[cacheKey(model, repoId, issueIds)] ?? null
}

function putCachedSummary(model: string, repoId: string, issueIds: string[], summary: string): void {
  const map = readCache()
  map[cacheKey(model, repoId, issueIds)] = summary
  writeCache(map)
}

// ---------------------------------------------------------------------------
// Digest + generation
// ---------------------------------------------------------------------------

export interface SummaryInput {
  repoId: string
  owner: string
  name: string
  issues: Issue[]
  weights?: SeverityWeights
}

function count(issues: Issue[], sev: Severity): number {
  return issues.filter((i) => i.severity === sev).length
}

/** Compact, evidence-free digest of the repo's health for the model. */
function buildDigest(input: SummaryInput, topFindings: number): string {
  const { owner, name, issues, weights } = input
  const score = computeScore(issues, weights)
  const grade = scoreToGrade(score)
  const cats = categoryScores(issues, weights)
  const spots = hotspotFiles(issues, weights, 5)

  const lines: string[] = [
    `Repository: ${owner}/${name}`,
    `Health score: ${score}/100 (grade ${grade})`,
    `Findings: ${count(issues, "critical")} critical, ${count(issues, "warning")} warning, ${count(issues, "info")} info (${issues.length} total)`,
  ]

  if (cats.length > 0) {
    lines.push(
      "Weakest areas: " +
        cats.slice(0, 4).map((c) => `${c.label} (${c.score}/100, ${c.count})`).join("; "),
    )
  }
  if (spots.length > 0) {
    lines.push(
      "Hotspot files: " + spots.map((s) => `${s.file} (${s.issues.length})`).join("; "),
    )
  }

  // Most severe findings first; cap to the model's budget (a large-context model
  // sees far more of the report, so it can ground the summary in more specifics).
  const order: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
  const top = [...issues].sort((a, b) => order[a.severity] - order[b.severity]).slice(0, topFindings)
  if (top.length > 0) {
    lines.push("Top findings:")
    for (const i of top) {
      lines.push(`- [${i.severity}] ${categoryLabels[i.category]}: ${i.title} (${i.location})`)
    }
  }
  return lines.join("\n")
}

export interface SummaryResult {
  summary: string
  cached: boolean
}

/**
 * Return an executive summary for the repo, using the cache when the finding set
 * is unchanged. Returns null when AI isn't configured (no key) or the model call
 * fails. `force` bypasses the cache to regenerate.
 */
export async function generateSummary(
  input: SummaryInput,
  opts: { force?: boolean; signal?: AbortSignal } = {},
): Promise<SummaryResult | null> {
  const settings = readAiSettings()
  if (!settings.apiKey.trim()) return null

  // Cache namespace folds in the web-search toggle (see aiCacheModel).
  const cacheModel = aiCacheModel(settings)
  const ids = input.issues.map((i) => i.id)
  if (!opts.force) {
    const hit = getCachedSummary(cacheModel, input.repoId, ids)
    if (hit) return { summary: hit, cached: true }
  }

  const budget = aiBudget(settings)
  const grade = scoreToGrade(computeScore(input.issues, input.weights))
  const prompt =
    `Here is the rot scan for a repository graded ${grade}. Write the executive ` +
    `summary as instructed.\n\n${buildDigest(input, budget.summaryTopFindings)}`

  // Web search only pays off when there's an advisory-bearing finding to look up.
  const wantWeb =
    settings.webSearch &&
    input.issues.some((i) => i.category === "security" || i.category === "dependency")

  const text = await fetchCompletion(
    {
      apiKey: settings.apiKey,
      model: settings.model,
      system: SYSTEM,
      prompt,
      maxTokens: budget.summaryMaxTokens,
      web: wantWeb,
    },
    opts.signal,
  )
  if (!text) return null

  const summary = text.trim()
  putCachedSummary(cacheModel, input.repoId, ids, summary)
  return { summary, cached: false }
}
