"use client"

import { useEffect, useState } from "react"
import { Settings, Sparkles, Eye, EyeOff, Check, Clock, Globe, BarChart3, Palette } from "lucide-react"
import { ThemePicker } from "@/components/theme-switcher"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import {
  ALL_CATEGORIES,
  MODEL_PRESETS,
  readAiSettings,
  saveAiSettings,
  isLargeContextModel,
  modelContextTokens,
  type AiSettings,
} from "@/lib/ai-settings"
import { categoryLabels } from "@/lib/mock-data"
import {
  readSchedule,
  saveSchedule,
  describeSchedule,
  MIN_INTERVAL_HOURS,
  type ScheduleSettings,
} from "@/lib/schedule-store"
import { setUsageOptedOut, useUsageOptedOut } from "@/lib/visitor"
import { OwnerKey } from "./owner-key"
import { useLocale } from "@/components/i18n/locale-provider"

const CATEGORY_HINT: Record<string, string> = {
  "dead-code": "Is each unused export really safe to remove?",
  env: "Required vs optional env var, and what to document.",
  dependency: "Safe to drop/replace a dependency, and the risk.",
  branch: "Delete, merge, or keep a stale branch.",
  todo: "Is the TODO still actionable or stale?",
  security: "Live credential vs placeholder, or CVE exploitability + remediation.",
  hygiene: "Missing files, tests/CI, debug logs, docs — the concrete fix.",
}

/**
 * `trigger` lets the caller supply its own button — the sidebar rail needs a
 * rail-shaped one. Passing the whole dialog around beats duplicating its
 * contents next to a second trigger.
 */
export function SettingsDialog({ trigger }: { trigger?: React.ReactNode } = {}) {
  const { locale } = useLocale()
  const ru = locale === "ru"
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<AiSettings>(readAiSettings)
  const [sched, setSched] = useState<ScheduleSettings>(readSchedule)
  const [showKey, setShowKey] = useState(false)
  const [saved, setSaved] = useState(false)
  // Not part of the draft: this one takes effect the moment it is flipped, with
  // no Save. Consent that only applies once you find the right button is not
  // consent, and the id is deleted the instant the switch goes off.
  const optedOut = useUsageOptedOut()

  // Re-sync the draft from storage whenever the dialog is opened.
  useEffect(() => {
    if (open) {
      // Intentional: re-sync the draft from storage each time the dialog opens.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft(readAiSettings())
      setSched(readSchedule())
      setShowKey(false)
      setSaved(false)
    }
  }, [open])

  function save() {
    saveAiSettings(draft)
    saveSchedule(sched)
    setSaved(true)
    setTimeout(() => {
      setSaved(false)
      setOpen(false)
    }, 700)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" className="size-8" title={ru ? "Настройки" : "Settings"} aria-label={ru ? "Настройки" : "Settings"}>
            <Settings className="size-4" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="size-4 text-primary" />
            {ru ? "Настройки" : "Settings"}
          </DialogTitle>
          <DialogDescription>
            {ru ? "Настройте анализ ИИ и расписание сканирования. Настройки сохраняются в этом браузере." : "Configure AI analysis and scheduled scans. Preferences are saved in this browser."}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 min-h-0 flex-1 space-y-5 overflow-y-auto thin-scrollbar px-1 py-2">
          {/* Appearance — applies immediately, no Save */}
          <div className="space-y-2">
            <div className="space-y-0.5">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                <Palette className="size-4 text-primary" />
                {ru ? "Внешний вид" : "Appearance"}
              </h3>
              <p className="text-xs text-muted-foreground">
                {ru ? "Тема для этого браузера. Применяется сразу." : "Colour themes for this browser. The choice takes effect immediately."}
              </p>
            </div>
            <ThemePicker />
          </div>

          {/* AI analysis */}
          <div className="space-y-0.5 border-t border-border pt-5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold">
              <Sparkles className="size-4 text-primary" />
              {ru ? "Анализ с ИИ" : "AI analysis"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {ru ? "Подключите OpenRouter для оценки находок с помощью ИИ. Запросы с вашим ключом проходят через наш сервер к OpenRouter." : "Connect OpenRouter to assess findings with AI. Requests using your key pass through our server to OpenRouter."}
            </p>
          </div>

          {/* API key */}
          <div className="space-y-1.5">
            <Label htmlFor="ai-key">{ru ? "API-ключ OpenRouter" : "OpenRouter API key"}</Label>
            <div className="relative">
              <Input
                id="ai-key"
                type={showKey ? "text" : "password"}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="sk-or-v1-…"
                className="pr-9 font-mono text-sm"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                title={showKey ? (ru ? "Скрыть" : "Hide") : (ru ? "Показать" : "Show")}
                aria-label={showKey ? (ru ? "Скрыть ключ" : "Hide key") : (ru ? "Показать ключ" : "Show key")}
              >
                {showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              {ru ? "Получить ключ: " : "Get one at "}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2 hover:text-foreground"
              >
                openrouter.ai/keys
              </a>
              .
            </p>
          </div>

          {/* Model id */}
          <div className="space-y-1.5">
            <Label htmlFor="ai-model">{ru ? "Идентификатор модели" : "Model ID"}</Label>
            <Input
              id="ai-model"
              value={draft.model}
              onChange={(e) => setDraft({ ...draft, model: e.target.value })}
              placeholder="vendor/model-id"
              className="font-mono text-sm"
              autoComplete="off"
            />
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {MODEL_PRESETS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setDraft({ ...draft, model: m.id })}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    draft.model === m.id
                      ? "border-primary/40 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                  title={m.id}
                >
                  {m.label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {ru ? "Введите идентификатор модели OpenRouter или выберите модель выше." : "Paste any OpenRouter model id, or pick a preset above."}
              {isLargeContextModel(draft.model) ? (
                <span className="text-primary">
                  {" "}
                  {ru ? "Большой контекст" : "Large context"} ({(modelContextTokens(draft.model) / 1_000_000).toFixed(1)}M) — {ru ? "больше находок за один запрос." : "more findings per pass."}
                </span>
              ) : null}
            </p>
          </div>

          {/* Web search */}
          <div className="flex items-start justify-between gap-4 rounded-md border border-border px-3 py-2.5">
            <div className="min-w-0 space-y-0.5">
              <Label htmlFor="ai-web" className="flex items-center gap-1.5">
                <Globe className="size-4 text-primary" />
                {ru ? "Проверять актуальные источники" : "Check current sources"}
              </Label>
              <p className="text-xs text-muted-foreground">
                {ru ? "Проверяем сведения об уязвимостях в OSV, метаданные пакетов npm и состояние связанных репозиториев GitHub. Результаты кешируются; недоступные источники отмечаются как непроверенные. Платный поисковый плагин не нужен, но оплата токенов модели и лимиты публичных API сохраняются." : "Fetch advisories from OSV, npm package metadata and linked GitHub repository status. No paid search plugin. Results are cached; unavailable sources are marked unverified. Model token charges and public API limits still apply."}
              </p>
            </div>
            <Switch
              id="ai-web"
              checked={draft.webSearch}
              onCheckedChange={(v) => setDraft((d) => ({ ...d, webSearch: v }))}
            />
          </div>

          {/* Per-category toggles */}
          <div className="space-y-2">
            <div className="space-y-0.5">
              <Label>{ru ? "Категории для анализа при сканировании" : "Analyze these categories on scan"}</Label>
              <p className="text-xs text-muted-foreground">
                {ru ? "После сканирования ИИ оценивает предупреждения и критические находки выбранных категорий. Информационные заметки исключены. Передаются только название находки, расположение и фрагмент кода с замаскированными секретами." : "After each scan, warning and critical findings in the enabled categories get an AI verdict. Info notes are excluded. Only the finding's title, location and (redacted) snippet are sent."}
              </p>
            </div>
            <div className="divide-y divide-border rounded-md border border-border">
              {ALL_CATEGORIES.map((cat) => (
                <div key={cat} className="flex items-start justify-between gap-4 px-3 py-2.5">
                  <div className="min-w-0 space-y-0.5">
                    <Label htmlFor={`ai-cat-${cat}`} className="cursor-pointer">
                      {categoryLabels[cat]}
                    </Label>
                    <p className="text-xs text-muted-foreground">{CATEGORY_HINT[cat]}</p>
                  </div>
                  <Switch
                    id={`ai-cat-${cat}`}
                    checked={draft.categories[cat]}
                    onCheckedChange={(v) =>
                      setDraft((d) => ({ ...d, categories: { ...d.categories, [cat]: v } }))
                    }
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Scheduled scans */}
          <div className="space-y-2 border-t border-border pt-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="sched-enabled" className="flex items-center gap-1.5">
                  <Clock className="size-4 text-primary" />
                  {ru ? "Сканирование по расписанию" : "Scheduled scans"}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {ru ? "Работает, пока открыта эта вкладка браузера. Закрытие вкладки останавливает расписание. Для автоматического мониторинга используйте GitHub Action или уведомления Watch по почте." : "Runs only while this browser tab stays open — closing it stops the schedule. For unattended monitoring use the GitHub Action or Watch email alerts."}
                </p>
              </div>
              <Switch
                id="sched-enabled"
                checked={sched.enabled}
                onCheckedChange={(v) => setSched((s) => ({ ...s, enabled: v }))}
              />
            </div>

            {sched.enabled && (
              <div className="space-y-3 rounded-md border border-border p-3">
                {/* Mode toggle */}
                <div className="flex gap-1.5">
                  {(["interval", "daily"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setSched((s) => ({ ...s, mode: m }))}
                      className={cn(
                        "flex-1 rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                        sched.mode === m
                          ? "border-primary/40 bg-primary/10 text-primary"
                          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
                      )}
                    >
                      {m === "interval" ? (ru ? "Каждые N часов" : "Every N hours") : (ru ? "Ежедневно" : "Daily at time")}
                    </button>
                  ))}
                </div>

                {sched.mode === "interval" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="sched-hours">{ru ? "Часов между сканами каждого репозитория" : "Hours between scans (per repo)"}</Label>
                    <Input
                      id="sched-hours"
                      type="number"
                      min={MIN_INTERVAL_HOURS}
                      step={0.25}
                      value={sched.intervalHours}
                      onChange={(e) => {
                        const n = parseFloat(e.target.value)
                        setSched((s) => ({ ...s, intervalHours: Number.isFinite(n) ? n : s.intervalHours }))
                      }}
                      onBlur={() =>
                        setSched((s) => ({ ...s, intervalHours: Math.max(MIN_INTERVAL_HOURS, s.intervalHours) }))
                      }
                      className="w-28 text-sm"
                    />
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="sched-time">{ru ? "Местное время" : "Local time of day"}</Label>
                    <Input
                      id="sched-time"
                      type="time"
                      value={sched.dailyTime}
                      onChange={(e) => setSched((s) => ({ ...s, dailyTime: e.target.value }))}
                      className="w-32 text-sm"
                    />
                  </div>
                )}

                <p className="text-xs text-muted-foreground">
                  {ru ? (sched.mode === "daily" ? `Ежедневно в ${sched.dailyTime}` : `Интервал в часах: ${sched.intervalHours}`) : describeSchedule(sched)} · {ru ? "Вкладка должна оставаться открытой. Для работы без браузера настройте GitHub Action или уведомления Watch по почте после скана." : "This tab must stay open. For unattended scans, configure the GitHub Action or Watch email alerts after a scan."}
                </p>
              </div>
            )}
          </div>

          <OwnerKey />

          {/* Usage statistics */}
          <div className="space-y-2 border-t border-border pt-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="usage-stats" className="flex items-center gap-1.5">
                  <BarChart3 className="size-4 text-primary" />
                  {ru ? "Статистика использования" : "Usage statistics"}
                </Label>
                {/* Says exactly what is recorded, in the place where it can be
                    switched off. A vaguer sentence would be easier to write and
                    would make the switch impossible to judge.
                    This text and lib/scan-stats.ts change together: the moment
                    one describes something the other does not do, the switch is
                    a lie with a nice UI. */}
                <p className="text-xs text-muted-foreground">
                  {ru ? "Сохраняются две раздельные записи. Статистика использования: случайный идентификатор браузера, событие и адрес репозитория без оценки. Статистика результатов: оценка, буква, основной язык, диапазон размера и число находок по важности, без имени и адреса репозитория, идентификатора браузера и содержимого кода. Вторая запись датируется днём и используется для сравнения с похожими репозиториями. Пути файлов, код и IP-адрес не сохраняются. Изменение применяется сразу: кнопка «Отмена» его не отменяет." : <>
                  Writes two rows, into two tables that cannot be joined.{" "}
                  <strong className="font-medium text-foreground/80">Usage:</strong> a random id
                  for this browser, the event, and the repository&apos;s address — no score.{" "}
                  <strong className="font-medium text-foreground/80">Result shape:</strong> the
                  score, grade, main language, a size band and the count of findings per
                  severity — no repository name, no address, no browser id, and nothing from
                  inside your code. That second row is what makes &ldquo;better than 71% of
                  comparable repositories&rdquo; possible, and it is dated to the day rather
                  than the second so the two cannot be lined up. Never your file paths, code or
                  IP address. Takes effect immediately — Cancel does not undo it.
                  </>}
                </p>
              </div>
              <Switch
                id="usage-stats"
                checked={!optedOut}
                onCheckedChange={(v) => setUsageOptedOut(!v)}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>
            {ru ? "Отмена" : "Cancel"}
          </Button>
          <Button onClick={save}>
            {saved ? <Check className="size-4" /> : null}
            {saved ? (ru ? "Сохранено" : "Saved") : (ru ? "Сохранить" : "Save")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
