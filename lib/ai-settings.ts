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
  "secret",
]

/** Suggested starter models — free/cheap. The field also accepts any custom id. */
export const MODEL_PRESETS: { id: string; label: string }[] = [
  { id: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash (free)" },
  { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (free)" },
  { id: "qwen/qwen-2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B (cheap)" },
  { id: "anthropic/claude-3.5-haiku", label: "Claude 3.5 Haiku (cheap)" },
]

const NO_CATEGORIES: Record<IssueCategory, boolean> = {
  "dead-code": false,
  env: false,
  dependency: false,
  branch: false,
  todo: false,
  secret: false,
}

export const DEFAULT_SETTINGS: AiSettings = {
  apiKey: "",
  model: MODEL_PRESETS[0].id,
  categories: { ...NO_CATEGORIES },
}

const KEY = "repo-anti-rot:ai-settings:v1"
const EVENT = "repo-anti-rot:ai-settings:changed"

function normalize(raw: unknown): AiSettings {
  const o = (raw ?? {}) as Partial<AiSettings> & { deadCodeEnabled?: boolean }
  const categories = { ...NO_CATEGORIES }
  if (o.categories && typeof o.categories === "object") {
    for (const c of ALL_CATEGORIES) {
      if (typeof (o.categories as Record<string, unknown>)[c] === "boolean") {
        categories[c] = (o.categories as Record<IssueCategory, boolean>)[c]
      }
    }
  } else if (typeof o.deadCodeEnabled === "boolean") {
    // migrate the old single-toggle shape
    categories["dead-code"] = o.deadCodeEnabled
  }
  return {
    apiKey: typeof o.apiKey === "string" ? o.apiKey : DEFAULT_SETTINGS.apiKey,
    model: typeof o.model === "string" && o.model.trim() ? o.model : DEFAULT_SETTINGS.model,
    categories,
  }
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
