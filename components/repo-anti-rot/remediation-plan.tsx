"use client"

import { useEffect, useMemo, useState } from "react"
import { Clipboard, ListChecks, Sparkles } from "lucide-react"
import type { Issue } from "@/lib/mock-data"
import type { SeverityWeights } from "@/lib/score"
import { remediationPlan } from "@/lib/remediation"
import { useLocale } from "@/components/i18n/locale-provider"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

export function RemediationPlan({ issues, weights }: { issues: Issue[]; weights?: SeverityWeights }) {
  const { locale } = useLocale()
  const ru = locale === "ru"
  const plan = useMemo(() => remediationPlan(issues, weights, locale), [issues, weights, locale])
  const [enabled, setEnabled] = useState(false)
  const [auto, setAuto] = useState(false)
  const [ai, setAi] = useState<{ key: string; text: string; error?: boolean } | null>(null)
  const [copyStatus, setCopyStatus] = useState("")
  const payload = JSON.stringify({ locale, issues: plan.map(({ issue }) => ({ title: issue.title, category: issue.category, severity: issue.severity, scanner: issue.scanner })) })

  useEffect(() => {
    const controller = new AbortController()
    fetch("/api/ai/triage", { signal: controller.signal }).then((r) => r.json()).then((data) => {
      setEnabled(data.enabled === true)
      try { setAuto(localStorage.getItem("rar:auto-triage") === "true") } catch { /* unavailable storage */ }
    }).catch(() => {})
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!enabled || !auto || plan.length === 0) return
    const controller = new AbortController()
    fetch("/api/ai/triage", { method: "POST", headers: { "Content-Type": "application/json" }, body: payload, signal: controller.signal })
      .then(async (response) => {
        const data = await response.json()
        if (!response.ok) throw new Error("AI unavailable")
        setAi({ key: payload, text: data.text })
      }).catch(() => {
        if (!controller.signal.aborted) setAi({ key: payload, text: "", error: true })
      })
    return () => controller.abort()
  }, [auto, enabled, payload, plan.length])

  if (!plan.length) return null
  const currentAi = ai?.key === payload ? ai : null

  async function copyPlan() {
    const text = plan.map((item, index) => `${index + 1}. [${item.issue.severity}] ${item.issue.title}\n${item.issue.location}\n${item.action}\n${item.verify}`).join("\n\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopyStatus(ru ? "Скопировано" : "Copied")
    } catch { setCopyStatus(ru ? "Не удалось скопировать" : "Copy failed") }
  }

  return <Card>
    <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
      <CardTitle className="flex items-center gap-2"><ListChecks className="size-5" />{ru ? "План исправлений" : "Action plan"}</CardTitle>
      <Button size="sm" variant="outline" onClick={copyPlan}><Clipboard className="size-4" />{copyStatus || (ru ? "Скопировать план" : "Copy plan")}</Button>
    </CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">{ru ? "Сначала критичные находки. Оценка улучшится только после исправления и повторной проверки." : "Critical findings first. Confirm improvements by fixing the cause and rescanning."}</p>
      <ol className="space-y-3">
        {plan.map((item, index) => <li key={item.issue.id} className="rounded-lg border p-3">
          <details open={index === 0}>
            <summary className="cursor-pointer text-sm font-medium">{index + 1}. {item.issue.title} <span className="text-muted-foreground">· {item.issue.severity}{item.scoreGain > 0 ? ` · +${item.scoreGain} ${ru ? "к оценке при исправлении" : "points if resolved"}` : ""}</span></summary>
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{item.issue.location}</p>
            <p className="mt-2 text-sm">{item.action}</p>
            <p className="mt-2 text-sm text-muted-foreground"><strong>{ru ? "Проверка: " : "Verify: "}</strong>{item.verify}</p>
          </details>
        </li>)}
      </ol>
      {enabled && <div className="space-y-2 border-t pt-4">
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={auto} onChange={(event) => {
            setAuto(event.target.checked)
            try { localStorage.setItem("rar:auto-triage", String(event.target.checked)) } catch { /* unavailable storage */ }
          }} />
          <span>{ru ? "Автоматически дополнять план рекомендациями ИИ" : "Automatically add AI recommendations"}<span className="mt-1 block text-xs text-muted-foreground">{ru ? "Названия и категории находок отправляются в OpenRouter. Исходный код и фрагменты доказательств не отправляются. Можно отключить в любой момент." : "Finding titles and categories are sent to OpenRouter. Source code and evidence snippets are excluded. You can disable this at any time."}</span></span>
        </label>
        {auto && <div className="rounded-lg bg-muted p-3 text-sm" aria-live="polite">
          <p className="mb-2 flex items-center gap-2 font-medium"><Sparkles className="size-4" />{ru ? "Рекомендация ИИ — проверьте перед применением" : "AI recommendation — review before applying"}</p>
          <p className="whitespace-pre-wrap">{currentAi?.error ? (ru ? "ИИ сейчас недоступен. Используйте план выше; повторная попытка — выключить и включить авторазбор." : "AI is unavailable. Use the plan above; toggle automatic analysis to retry.") : currentAi?.text || (ru ? "Готовим рекомендации…" : "Preparing recommendations…")}</p>
        </div>}
      </div>}
    </CardContent>
  </Card>
}
