"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { GRADE_CSS_VAR } from "@/lib/grade-style"
import type { Grade } from "@/lib/mock-data"
import { useLocale } from "@/components/i18n/locale-provider"

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
 * Social proof as a full-bleed strip: real grades on repositories the reader has
 * heard of, sliding past under the hero.
 *
 * These are the eight repos in `lib/proof-repos.ts`, graded by the same engine
 * the button runs — clicking one prefills the scan form with its URL, so any
 * claim here can be checked in one click. That is the whole point of the strip
 * and the reason it links rather than just displays.
 *
 * The track holds the list twice and translates by exactly -50%, which is what
 * makes the loop seamless; hovering pauses it so a name can be read. It renders
 * nothing at all if `/api/proof` fails — a landing page must not have a hole in
 * it because a fetch timed out.
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

  const track = [...rows, ...rows]

  return (
    <section aria-label={t("proof.title")} className="border-b border-border bg-card/30">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3 sm:px-6">
        <h2 className="hidden shrink-0 font-mono text-[11px] uppercase tracking-widest text-muted-foreground sm:block">
          {t("proof.title")}
        </h2>

        {/* Faded at both edges so names slide in and out rather than being
            chopped off by a hard boundary. */}
        <div className="relative min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_right,transparent,black_6%,black_94%,transparent)]">
          <ul className="marquee-track flex w-max items-center gap-3">
            {track.map((r, i) => (
              <li key={`${r.owner}/${r.name}-${i}`}>
                <Link
                  href={`/?url=${encodeURIComponent(r.url)}`}
                  // The second copy of the list is there to make the loop
                  // seamless, not to be read — a screen reader announcing every
                  // repository twice is worse than not announcing the strip.
                  aria-hidden={i >= rows.length}
                  tabIndex={i >= rows.length ? -1 : undefined}
                  title={`${r.owner}/${r.name}`}
                  className="flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 transition-colors hover:border-primary/40"
                >
                  <span
                    className="flex size-5 items-center justify-center rounded font-mono text-[11px] font-bold"
                    style={{
                      color: GRADE_CSS_VAR[r.grade],
                      backgroundColor: `color-mix(in oklab, ${GRADE_CSS_VAR[r.grade]} 15%, transparent)`,
                    }}
                  >
                    {r.grade}
                  </span>
                  <span className="font-mono text-xs text-foreground">{r.label}</span>
                  <span className="tabnum font-mono text-xs text-muted-foreground">{r.score}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>

        {updatedAt && (
          <p className="tabnum hidden shrink-0 font-mono text-[11px] text-muted-foreground/70 lg:block">
            {t("proof.updated", { when: formatUpdatedAt(updatedAt, locale) })}
          </p>
        )}
      </div>
    </section>
  )
}
