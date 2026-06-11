"use client"

import { useSyncExternalStore } from "react"
import type { IssueCategory } from "@/lib/mock-data"

/**
 * Client-side AI settings (OpenRouter).
 *
 * The API key lives in localStorage so it survives reloads and never ships in the
 * server bundle. It is sent ONLY to our own same-origin `/api/ai/complete` proxy
 * (in the POST body, over HTTPS) — the browser never calls OpenRouter directly,
 * so the key never appears in third-party network logs or CORS preflights.
 */

export interface AiSettings {
  /** OpenRouter API key. Empty string when not configured. */
  apiKey: string
  /** OpenRouter model id, e.g. "google/gemini-2.0-flash-exp:free". */
  model: string
  /**
   * Let the model search the web (OpenRouter web plugin) when triaging findings
   * that reference external advisories — security CVEs and dependency status. Lets
   * it read the ACTUAL advisory, including ones published after its training cutoff.
   * Costs extra per OpenRouter's web pricing, so it's opt-in and off by default.
   */
  webSearch: boolean
  /** Which scanner categories get an AI assessment after a scan. */
  categories: Record<IssueCategory, boolean>
}

/** Every category the AI pass can enrich, in display order. */
export const ALL_CATEGORIES: IssueCategory[] = [
  "dead-code",
  "env",
  "dependency",
  "branch",
  "todo",
  "security",
  "hygiene",
]

/**
 * Suggested starter models — free/cheap. The field also accepts any custom id.
 * `contextTokens` is the model's context window; the AI pass uses it to scale how
 * much it feeds the model (see `aiBudget`) — a 1M-token model gets far more
 * findings per request than a 32K one.
 */
export const MODEL_PRESETS: { id: string; label: string; contextTokens: number }[] = [
  { id: "openai/gpt-oss-120b:free", label: "GPT-OSS 120B (free, best for code)", contextTokens: 131_072 },
  { id: "nvidia/nemotron-3-ultra-550b-a55b:free", label: "Nemotron 3 Ultra 550B (free, 1M context)", contextTokens: 1_000_000 },
  { id: "openai/gpt-oss-20b:free", label: "GPT-OSS 20B (free, lighter)", contextTokens: 131_072 },
  { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free)", contextTokens: 1_000_000 },
  { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)", contextTokens: 131_072 },
  { id: "qwen/qwen-2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B (cheap)", contextTokens: 32_768 },
  { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku (cheap)", contextTokens: 200_000 },
]

const NO_CATEGORIES: Record<IssueCategory, boolean> = {
  "dead-code": false,
  env: false,
  dependency: false,
  branch: false,
  todo: false,
  security: false,
  hygiene: false,
}

export const DEFAULT_SETTINGS: AiSettings = {
  apiKey: "",
  model: MODEL_PRESETS[0].id,
  webSearch: false,
  categories: { ...NO_CATEGORIES },
}

const KEY = "repo-anti-rot:ai-settings:v1"
const EVENT = "repo-anti-rot:ai-settings:changed"

function normalize(raw: unknown): AiSettings {
  const o = (raw ?? {}) as Partial<AiSettings> & { deadCodeEnabled?: boolean }
  const categories = { ...NO_CATEGORIES }
  if (o.categories && typeof o.categories === "object") {
    const saved = o.categories as Record<string, unknown>
    for (const c of ALL_CATEGORIES) {
      if (typeof saved[c] === "boolean") {
        categories[c] = saved[c] as boolean
      }
    }
    // Migrate the legacy `secret` toggle into the broader `security` category.
    if (typeof saved.secret === "boolean") categories.security = saved.secret as boolean
  } else if (typeof o.deadCodeEnabled === "boolean") {
    // migrate the old single-toggle shape
    categories["dead-code"] = o.deadCodeEnabled
  }
  return {
    apiKey: typeof o.apiKey === "string" ? o.apiKey : DEFAULT_SETTINGS.apiKey,
    model: typeof o.model === "string" && o.model.trim() ? o.model : DEFAULT_SETTINGS.model,
    webSearch: typeof o.webSearch === "boolean" ? o.webSearch : DEFAULT_SETTINGS.webSearch,
    categories,
  }
}

/**
 * Cache namespace for AI verdicts. Folds the web-search toggle into the model key
 * so a web-informed verdict is never confused with a non-web one (toggling web
 * yields a fresh answer instead of a stale cache hit).
 */
export function aiCacheModel(s: AiSettings): string {
  return s.webSearch ? `${s.model}::web` : s.model
}

// ---------------------------------------------------------------------------
// Context budget — scale how much we feed the model to its context window.
// ---------------------------------------------------------------------------

/** A model at/above this many context tokens is treated as "large context". */
const LARGE_CONTEXT_TOKENS = 400_000

/**
 * Best-effort context window for a model id. Known presets report it exactly;
 * for a custom id we read common size hints from the name ("1m", "200k", "128k"),
 * otherwise assume a conservative small window so we never overrun an unknown model.
 */
export function modelContextTokens(modelId: string): number {
  const preset = MODEL_PRESETS.find((m) => m.id === modelId)
  if (preset) return preset.contextTokens
  const id = modelId.toLowerCase()
  if (/\b\d+\s*m\b|[:-]1m\b|1m-/.test(id)) return 1_000_000
  const k = id.match(/(\d{2,4})\s*k\b/)
  if (k) return Number(k[1]) * 1000
  return 128_000
}

/**
 * How much the AI pass may feed a model, scaled to its context window. Large-context
 * models get many more findings per request (and bigger batches / longer summaries)
 * so they can reason across the whole report at once instead of a narrow slice.
 */
export interface AiBudget {
  /** Enrichment: cap on NEW per-finding analyses in one pass. */
  maxIssues: number
  /** Enrichment: findings sent in a single request. */
  batchSize: number
  /** Enrichment: hard ceiling on the per-batch response token budget. */
  enrichTokenCap: number
  /** Executive summary: how many top findings to list in the digest. */
  summaryTopFindings: number
  /** Executive summary: response token budget. */
  summaryMaxTokens: number
}

const SMALL_BUDGET: AiBudget = {
  maxIssues: 40,
  batchSize: 5,
  enrichTokenCap: 3000,
  summaryTopFindings: 12,
  summaryMaxTokens: 500,
}

const LARGE_BUDGET: AiBudget = {
  maxIssues: 200,
  batchSize: 20,
  enrichTokenCap: 8000,
  summaryTopFindings: 60,
  summaryMaxTokens: 900,
}

/** True when the model's context window is big enough for the generous budget. */
export function isLargeContextModel(modelId: string): boolean {
  return modelContextTokens(modelId) >= LARGE_CONTEXT_TOKENS
}

/** The context budget for the active model. */
export function aiBudget(s: AiSettings): AiBudget {
  return isLargeContextModel(s.model) ? LARGE_BUDGET : SMALL_BUDGET
}

/** True when a key is set and at least one category is enabled. */
export function isAiEnabled(s: AiSettings): boolean {
  return !!s.apiKey.trim() && ALL_CATEGORIES.some((c) => s.categories[c])
}

/** Categories the user has turned on. */
export function enabledCategories(s: AiSettings): IssueCategory[] {
  return ALL_CATEGORIES.filter((c) => s.categories[c])
}

/** Non-reactive read — for use outside React (e.g. enrichment helpers). */
export function readAiSettings(): AiSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS
  try {
    const raw = window.localStorage.getItem(KEY)
    return raw ? normalize(JSON.parse(raw)) : DEFAULT_SETTINGS
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveAiSettings(next: AiSettings): void {
  if (typeof window === "undefined") return
  window.localStorage.setItem(KEY, JSON.stringify(normalize(next)))
  window.dispatchEvent(new Event(EVENT))
}

// useSyncExternalStore plumbing with stable snapshots
let cachedString: string | null = null
let cachedValue: AiSettings = DEFAULT_SETTINGS

function getSnapshot(): AiSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS
  const raw = window.localStorage.getItem(KEY)
  if (raw === cachedString) return cachedValue
  cachedString = raw
  cachedValue = raw ? normalize(safeParse(raw)) : DEFAULT_SETTINGS
  return cachedValue
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function getServerSnapshot(): AiSettings {
  return DEFAULT_SETTINGS
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener("storage", callback)
  window.addEventListener(EVENT, callback)
  return () => {
    window.removeEventListener("storage", callback)
    window.removeEventListener(EVENT, callback)
  }
}

/** React hook: the live AI settings. */
export function useAiSettings(): AiSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
