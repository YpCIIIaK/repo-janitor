"use client"

import { useEffect, useState } from "react"
import { useLocale } from "@/components/i18n/locale-provider"
import { percentileCopy } from "@/lib/percentile-copy"
import { sizeBucket, type Percentile } from "@/lib/scan-stats"

/**
 * Where a freshly-scanned repository stands, fetched after the result renders.
 *
 * Client-side and deliberately late: the scan result is the thing the user
 * waited for, and it must never be held up by a statistics query. The line
 * appears when the answer arrives, and if it never arrives — no Supabase, too
 * few comparable scans, a failed request — nothing is rendered at all. A
 * placeholder saying "no data" would be worse than the silence, since the
 * absence is not information the reader can use.
 */

interface Props {
  score: number
  /** Language breakdown from the report profile, richest first. */
  languages?: { language?: string; loc?: number }[]
}

export function PercentileLine({ score, languages }: Props) {
  const { t } = useLocale()
  const [hit, setHit] = useState<Percentile | null>(null)

  useEffect(() => {
    let live = true
    const langs = languages ?? []
    const primary = langs.reduce<{ language?: string; loc?: number } | null>(
      (best, l) => ((l.loc ?? 0) > (best?.loc ?? -1) ? l : best),
      null,
    )
    const loc = langs.reduce((n, l) => n + (l.loc ?? 0), 0)

    const params = new URLSearchParams({ score: String(score) })
    if (primary?.language) params.set("language", primary.language)
    if (loc > 0) params.set("size", sizeBucket(loc))

    fetch(`/api/percentile?${params}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (live && j && typeof j.betterThan === "number") setHit(j as Percentile)
      })
      .catch(() => {
        /* a missing comparison is not an error worth showing */
      })

    return () => {
      live = false
    }
  }, [score, languages])

  if (!hit) return null
  const copy = percentileCopy(hit)
  const primary = (languages ?? []).reduce<{ language?: string; loc?: number } | null>(
    (best, l) => ((l.loc ?? 0) > (best?.loc ?? -1) ? l : best),
    null,
  )

  return (
    <p className="text-xs">
      <span className={copy.direction === "worse" ? "text-warning" : "text-success"}>
        {t(copy.key, { percent: copy.percent, language: primary?.language ?? "" })}
      </span>{" "}
      <span className="text-muted-foreground">{t("pct.sample", { count: hit.sample })}</span>
    </p>
  )
}
