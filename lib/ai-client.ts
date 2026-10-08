"use client"

import { isUsableAiText } from "@/lib/ai-output"

/**
 * Shared transport for AI completions.
 *
 * Every AI feature (per-finding enrichment, executive summary, …) posts through
 * the same same-origin `/api/ai/complete` proxy, so the OpenRouter key only ever
 * travels browser → our origin → OpenRouter and is never in the client bundle or
 * third-party logs. Rate-limited (429) and transient (5xx) responses back off and
 * retry, since free tiers throttle hard.
 */

export const MAX_RETRIES = 3

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export interface CompletionBody {
  apiKey: string
  model: string
  system: string
  prompt: string
  maxTokens: number
  /** Fetch public source metadata directly; no OpenRouter search plugin. */
  web?: boolean
}

/** One proxied completion with retry/backoff. Returns the text, or null on failure. */
export async function fetchCompletion(
  body: CompletionBody,
  signal?: AbortSignal,
): Promise<string | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let res: Response
    try {
      res = await fetch("/api/ai/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify(body),
      })
    } catch {
      return null // network error / abort
    }

    if (res.ok) {
      const data = (await res.json().catch(() => null)) as { text?: string; sources?: { label: string; url: string; status: string }[] } | null
      if (!isUsableAiText(data?.text)) return null
      if (!Array.isArray(data.sources)) return data.text
      const checks = data.sources.length ? data.sources.map((s) => `${s.label}: ${s.status === "fetched" ? "fetched" : "not verified"} (${s.url})`).join("; ") : "No supported source identifiers found; not verified."
      const suffix = `Source checks for this request: ${checks}`
      // Preserve the numbered batch protocol while retaining deterministic source provenance.
      return /^\s*\[?\d+\]?\s*[:.)-]/m.test(data.text)
        ? data.text.split("\n").map((line) => /^\s*\[?\d+\]?\s*[:.)-]/.test(line) ? `${line} ${suffix}` : line).join("\n")
        : `${data.text}\n\n${suffix}`
    }

    // Rate-limited or transient server error → back off and retry.
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      const retryAfter = Number(res.headers.get("retry-after"))
      const backoff =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : 600 * 2 ** attempt + Math.random() * 300 // jittered exponential
      await sleep(backoff)
      continue
    }
    return null // non-retryable (4xx) or out of retries
  }
  return null
}
