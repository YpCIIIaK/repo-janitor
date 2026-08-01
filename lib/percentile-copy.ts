import type { MessageKey } from "@/lib/i18n"
import { phrasePercentile, type Percentile } from "@/lib/scan-stats"

/**
 * The message key for a percentile, so both the server-rendered share page and
 * the client-side result card say the same sentence.
 *
 * Pure and separate from `lib/percentile.ts`, which is `server-only` — a client
 * component cannot import that file at all, and the phrasing rule is worth
 * having in exactly one place.
 */

const KEYS: Record<"worse" | "better", Record<Percentile["basis"], MessageKey>> = {
  worse: {
    "language-size": "pct.worse.languageSize",
    language: "pct.worse.language",
    size: "pct.worse.size",
    all: "pct.worse.all",
  },
  better: {
    "language-size": "pct.better.languageSize",
    language: "pct.better.language",
    size: "pct.better.size",
    all: "pct.better.all",
  },
}

export interface PercentileCopy {
  key: MessageKey
  percent: number
  direction: "worse" | "better"
}

export function percentileCopy(p: Percentile): PercentileCopy {
  const { direction, percent } = phrasePercentile(p)
  return { key: KEYS[direction][p.basis], percent, direction }
}
