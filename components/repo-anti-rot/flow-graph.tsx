"use client"

import { useState } from "react"
import type { FlowStep } from "@/lib/mock-data"
import { cn } from "@/lib/utils"

const ROLE = {
  source: { en: "input", ru: "ввод", tone: "border-warning/40 bg-warning/10 text-warning" },
  step: { en: "passes through", ru: "проходит", tone: "border-border bg-muted text-muted-foreground" },
  guard: { en: "guard", ru: "защита", tone: "border-primary/40 bg-primary/10 text-primary" },
  sink: { en: "dangerous call", ru: "опасный вызов", tone: "border-destructive/40 bg-destructive/10 text-destructive" },
} as const

/** Long paths show both ends and fold the middle; the ends are what a reviewer checks. */
const KEEP_HEAD = 2
const KEEP_TAIL = 2

/**
 * Vertical data-flow graph for one finding: where untrusted input enters,
 * what carries it, and the call where it does harm. Each node names the code
 * as written and its file:line, so the path can be checked by reading it.
 */
export function FlowGraph({ steps, locale }: { steps: FlowStep[]; locale: string }) {
  const ru = locale === "ru"
  const [open, setOpen] = useState(false)
  const foldable = steps.length > KEEP_HEAD + KEEP_TAIL + 1
  const hidden = foldable && !open ? steps.length - KEEP_HEAD - KEEP_TAIL : 0
  const labelled = withWhere(steps, ru)
  const shown = hidden ? [...labelled.slice(0, KEEP_HEAD), null, ...labelled.slice(-KEEP_TAIL)] : labelled

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-medium text-foreground">{ru ? "Путь данных" : "Data flow"}</div>
        <div className="text-[11px] text-muted-foreground">
          {ru ? `${steps.length} ${stepsRu(steps.length)} от ввода до вызова` : `${steps.length} steps from input to call`}
        </div>
      </div>
      <ol className="relative space-y-0">
        {shown.map((s, i) => {
          const last = i === shown.length - 1
          if (s === null) {
            return (
              <li key="fold" className="relative pl-6">
                <span aria-hidden className="absolute left-[9px] top-0 h-full w-px bg-border" />
                <button
                  type="button"
                  onClick={() => setOpen(true)}
                  className="my-1 rounded px-2 py-1 text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {ru ? `ещё ${hidden} ${stepsRu(hidden)} — показать` : `${hidden} more steps — show`}
                </button>
              </li>
            )
          }
          const role = ROLE[s.role]
          const where = s.where
          return (
            <li key={`${i}-${s.text}`} className="relative pb-2 pl-6 last:pb-0">
              {!last && <span aria-hidden className="absolute left-[9px] top-5 h-[calc(100%-12px)] w-px bg-border" />}
              <span
                aria-hidden
                className={cn("absolute left-1 top-1.5 h-3 w-3 rounded-full border-2", s.role === "sink" ? "border-destructive bg-destructive" : s.role === "source" ? "border-warning bg-background" : s.role === "guard" ? "border-primary bg-background" : "border-border bg-background")}
              />
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className={cn("rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", role.tone)}>{ru ? role.ru : role.en}</span>
                <code className="break-all font-mono text-xs text-foreground">{s.text}</code>
              </div>
              {where && <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">{where}</div>}
            </li>
          )
        })}
      </ol>
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {ru
          ? "Путь восстановлен статическим анализом: код не запускался. Если на пути есть проверка, которую анализ не узнал, отметьте находку как ложную."
          : "Reconstructed by static analysis; no code was run. If a check on this path was not recognised, report the finding as a false positive."}
      </p>
    </div>
  )
}

/** Name the file only when it changes along the path: most paths stay in one file. */
function withWhere(steps: FlowStep[], ru: boolean): (FlowStep & { where: string })[] {
  return steps.map((s, i) => {
    const prevFile = steps.slice(0, i).reverse().find((p) => p.file)?.file
    const where = s.file && s.file !== prevFile ? `${s.file}${s.line ? `:${s.line}` : ""}` : s.line ? `${ru ? "строка" : "line"} ${s.line}` : ""
    return { ...s, where }
  })
}

function stepsRu(n: number): string {
  const d = n % 10, h = n % 100
  if (d === 1 && h !== 11) return "шаг"
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return "шага"
  return "шагов"
}
