"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { GRADE_CSS_VAR } from "@/lib/grade-style"
import type { Grade } from "@/lib/mock-data"
import { useLocale } from "@/components/i18n/locale-provider"
import { cn } from "@/lib/utils"

type ProofRow = {
  owner: string
  name: string
  label: string
  url: string
  grade: Grade
  score: number
  source: "live" | "snapshot"
}

type ProofPayload = {
  updatedAt?: string
  repos?: ProofRow[]
}

function formatUpdatedAt(iso: string, locale: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(locale === "ru" ? "ru-RU" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  })
}

/**
 * Social-proof strip: known public repos with a grade from /api/proof.
 * Click → prefill the scan form via `?url=`.
 */
export function ProofRepos() {
  const { t, locale } = useLocale()
  const [rows, setRows] = useState<ProofRow[] | null>(null)
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch("/api/proof")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: ProofPayload | null) => {
        if (cancelled || !data?.repos?.length) return
        setRows(data.repos)
        if (typeof data.updatedAt === "string") setUpdatedAt(data.updatedAt)
      })
      .catch(() => {
        /* strip stays hidden on network failure */
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!rows?.length) return null

  return (
    <section className="mx-auto mt-14 max-w-3xl">
      <h2 className="text-center text-sm font-medium tracking-tight">{t("proof.title")}</h2>
      <p className="mt-1 text-center text-xs text-muted-foreground">{t("proof.lead")}</p>
      <ul className="mt-5 flex flex-wrap justify-center gap-2">
        {rows.map((r) => (
          <li key={`${r.owner}/${r.name}`}>
            <Link
              href={`/?url=${encodeURIComponent(r.url)}`}
              className={cn(
                "inline-flex items-center gap-2 rounded-lg border border-border bg-card/50 px-2.5 py-1.5",
                "font-mono text-xs transition-colors hover:border-primary/35 hover:bg-card",
              )}
              title={`${r.owner}/${r.name}`}
            >
              <span
                className="flex size-6 items-center justify-center rounded-md text-[11px] font-bold"
                style={{
                  color: GRADE_CSS_VAR[r.grade],
                  backgroundColor: `color-mix(in oklab, ${GRADE_CSS_VAR[r.grade]} 15%, transparent)`,
                }}
              >
                {r.grade}
              </span>
              <span className="text-foreground">{r.label}</span>
              <span className="tabular-nums text-muted-foreground">{r.score}</span>
            </Link>
          </li>
        ))}
      </ul>
      {updatedAt && (
        <p className="mt-3 text-center text-[11px] tabular-nums text-muted-foreground/80">
          {t("proof.updated", { when: formatUpdatedAt(updatedAt, locale) })}
        </p>
      )}
    </section>
  )
}
