"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import data from "@/benchmark/findings.json"
import { useLocale } from "@/components/i18n/locale-provider"
import { Card } from "@/components/ui/card"
import { fixExampleFor } from "@/lib/fix-examples"
import { ruleLabel } from "@/packages/core/src/rules"
import { cn } from "@/lib/utils"

/**
 * What each rule finds across the benchmark corpus — counts, where in a repo it
 * fires, how often a hand check agreed, and how to fix it. Deliberately
 * anonymous: benchmark/findings.json carries no repo names, paths or code.
 */

interface Row {
  rule: string
  count: number
  hidden: number
  repoShare: number
  medianPerRepo: number
  severity: string | null
  where: Record<string, number>
  labelled: { tp: number; fp: number } | null
}

const WHERE = ["source", "tests", "docs", "config", "ci", "vendored", "repo"] as const
const WHERE_TONE: Record<string, string> = {
  source: "bg-primary", tests: "bg-warning", docs: "bg-muted-foreground", config: "bg-sky-500",
  ci: "bg-violet-500", vendored: "bg-destructive", repo: "bg-secondary-foreground/40",
}

const T = {
  en: {
    title: "What the scanners find",
    lede: (n: number) => `Every rule, measured on ${n.toLocaleString("en-US")} public repositories. No project names, paths or code are published — only aggregates.`,
    back: "← State of open source",
    search: "Filter rules…",
    sort: { count: "Most frequent", share: "Most widespread", precision: "Most accurate" },
    repos: "of repos",
    findings: "findings",
    perRepo: "median per affected repo",
    hidden: (n: number) => `${n.toLocaleString("en-US")} more hidden as low confidence`,
    precision: (p: number, n: number) => `${p}% confirmed in a hand check of ${n}`,
    unlabelled: "not hand-checked yet",
    where: { source: "source", tests: "tests", docs: "docs & examples", config: "config", ci: "CI", vendored: "vendored", repo: "repo-level" },
    sev: { critical: "critical", warning: "warning", info: "info" } as Record<string, string>,
    how: "How to fix",
    before: "Before",
    after: "After",
  },
  ru: {
    title: "Что находят сканеры",
    lede: (n: number) => `Каждое правило, измеренное на ${n.toLocaleString("ru-RU")} публичных репозиториях. Названия проектов, пути и код не публикуются — только агрегаты.`,
    back: "← Состояние open source",
    search: "Фильтр по правилам…",
    sort: { count: "Чаще всего", share: "В большем числе репо", precision: "Самые точные" },
    repos: "репозиториев",
    findings: "находок",
    perRepo: "медиана на затронутый репо",
    hidden: (n: number) => `ещё ${n.toLocaleString("ru-RU")} скрыто как низкая уверенность`,
    precision: (p: number, n: number) => `${p}% подтвердилось при ручной проверке ${n}`,
    unlabelled: "ещё не проверялось вручную",
    where: { source: "код", tests: "тесты", docs: "документация и примеры", config: "конфиги", ci: "CI", vendored: "чужой код", repo: "весь репо" },
    sev: { critical: "критично", warning: "предупреждение", info: "инфо" } as Record<string, string>,
    how: "Как исправить",
    before: "Было",
    after: "Стало",
  },
}

const sevTone: Record<string, string> = { critical: "text-destructive border-destructive/40", warning: "text-warning border-warning/40", info: "text-muted-foreground border-border" }
const precisionOf = (r: Row) => (r.labelled && r.labelled.tp + r.labelled.fp >= 3 ? r.labelled.tp / (r.labelled.tp + r.labelled.fp) : null)

export function FindingsBreakdown() {
  const { locale } = useLocale()
  const l = locale === "ru" ? "ru" : "en"
  const t = T[l]
  const [q, setQ] = useState("")
  const [sort, setSort] = useState<"count" | "share" | "precision">("count")
  const rows = useMemo(() => {
    const all = (data.rules as Row[]).filter((r) => r.count > 0 || r.hidden > 0)
    const needle = q.trim().toLowerCase()
    const hit = needle ? all.filter((r) => `${r.rule} ${ruleLabel(r.rule) ?? ""}`.toLowerCase().includes(needle)) : all
    const key = { count: (r: Row) => r.count, share: (r: Row) => r.repoShare, precision: (r: Row) => precisionOf(r) ?? -1 }[sort]
    return [...hit].sort((a, b) => key(b) - key(a))
  }, [q, sort])

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
      <header className="space-y-3">
        <Link href="/state" className="text-xs text-muted-foreground hover:text-foreground">{t.back}</Link>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{t.title}</h1>
        <p className="max-w-prose text-muted-foreground">{t.lede(data.repos)}</p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.search} className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 text-sm" />
        {(Object.keys(t.sort) as (keyof typeof t.sort)[]).map((k) => (
          <button key={k} onClick={() => setSort(k)} className={cn("h-9 rounded-md border px-3 text-xs", sort === k ? "border-primary text-primary" : "border-border text-muted-foreground")}>{t.sort[k]}</button>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {WHERE.map((w) => <span key={w} className="inline-flex items-center gap-1.5"><span className={cn("inline-block size-2 rounded-full", WHERE_TONE[w])} />{t.where[w]}</span>)}
      </div>

      {rows.map((r) => {
        const fix = fixExampleFor(r.rule)
        const p = precisionOf(r)
        const n = r.labelled ? r.labelled.tp + r.labelled.fp : 0
        return (
          <Card key={r.rule} className="gap-3 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-medium">{ruleLabel(r.rule) ?? r.rule}</h2>
              {r.severity && <span className={cn("rounded border px-1.5 py-0.5 text-[11px]", sevTone[r.severity])}>{t.sev[r.severity] ?? r.severity}</span>}
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <div><div className="font-mono text-xl font-semibold tabular-nums text-primary">{Math.round(r.repoShare * 100)}%</div><div className="text-xs text-muted-foreground">{t.repos}</div></div>
              <div><div className="font-mono text-xl font-semibold tabular-nums">{r.count.toLocaleString(l)}</div><div className="text-xs text-muted-foreground">{t.findings}</div></div>
              <div><div className="font-mono text-xl font-semibold tabular-nums">{r.medianPerRepo}</div><div className="text-xs text-muted-foreground">{t.perRepo}</div></div>
            </div>
            {r.count > 0 && (
              <div className="flex h-2 overflow-hidden rounded-full bg-secondary" title={WHERE.filter((w) => r.where[w]).map((w) => `${t.where[w]} ${Math.round(r.where[w] * 100)}%`).join(" · ")}>
                {WHERE.map((w) => r.where[w] ? <span key={w} className={WHERE_TONE[w]} style={{ width: `${r.where[w] * 100}%` }} /> : null)}
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              {p !== null ? <span className={p >= 0.8 ? "text-success" : p < 0.5 ? "text-warning" : ""}>{t.precision(Math.round(p * 100), n)}</span> : t.unlabelled}
              {r.hidden > 0 && <> · {t.hidden(r.hidden)}</>}
            </p>
            {fix && (
              <details className="text-sm">
                <summary className="cursor-pointer text-xs font-medium text-primary">{t.how}</summary>
                <p className="mt-2 text-foreground/90">{fix.how[l]}</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {fix.before && <div><div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t.before}</div><pre className="overflow-x-auto rounded bg-destructive/5 p-2 text-xs"><code>{fix.before}</code></pre></div>}
                  {fix.after && <div><div className="mb-1 text-[11px] uppercase tracking-wide text-muted-foreground">{t.after}</div><pre className="overflow-x-auto rounded bg-success/5 p-2 text-xs"><code>{fix.after}</code></pre></div>}
                </div>
              </details>
            )}
          </Card>
        )
      })}
    </main>
  )
}
