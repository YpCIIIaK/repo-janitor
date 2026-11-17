"use client"

import Link from "next/link"
import { useLocale } from "@/components/i18n/locale-provider"
import { FlowGraph } from "@/components/repo-anti-rot/flow-graph"
import type { FlowStep } from "@/lib/mock-data"
import stats from "@/benchmark/stats.json"

type Bucket = { tp: number; fp: number }
const precision = (b?: Bucket) => (b && b.tp + b.fp ? Math.round((b.tp / (b.tp + b.fp)) * 100) : null)

/**
 * Recall on DVWA (benchmark/recall.mjs, Nov 2026): the deliberately vulnerable
 * app's own levels say where each hole is. Fast = every scan; deep = the opt-in
 * PHP data-flow engine. Kept literal: it changes only when a recall run does.
 */
const RECALL: { cls: { en: string; ru: string }; fast: string; deep: string }[] = [
  { cls: { en: "SQL injection", ru: "SQL-инъекции" }, fast: "5/6", deep: "6/6" },
  { cls: { en: "Command injection", ru: "Внедрение команд" }, fast: "3/3", deep: "3/3" },
  { cls: { en: "File upload", ru: "Загрузка файлов" }, fast: "0/3", deep: "3/3" },
  { cls: { en: "Open redirect", ru: "Открытый редирект" }, fast: "0/3", deep: "3/3" },
  { cls: { en: "File inclusion", ru: "Включение файлов" }, fast: "0/3", deep: "3/3" },
  { cls: { en: "Cross-site scripting", ru: "XSS" }, fast: "0/13", deep: "6/13" },
]

/** DVWA's reflected XSS: three source files, one echo. What the deep engine draws. */
const path = (file: string, line: number): FlowStep[] => [
  { role: "source", text: "$_GET['name']", file: `vulnerabilities/xss_r/source/${file}`, line },
  { role: "step", text: "$html", file: `vulnerabilities/xss_r/source/${file}`, line },
  { role: "step", text: "$page['body']", file: "vulnerabilities/xss_r/index.php", line: 49 },
  { role: "step", text: "dvwaHtmlEcho()", file: "vulnerabilities/xss_r/index.php", line: 64 },
  { role: "sink", text: "echo", file: "dvwa/includes/dvwaPage.inc.php", line: 388 },
]

export function TrustSection({ index }: { index: string }) {
  const { locale } = useLocale()
  const ru = locale === "ru"
  const p = (stats as { precision?: Record<string, Bucket> }).precision ?? {}
  const repos = (stats as { uniqueRepositories?: number; repos: number }).uniqueRepositories ?? stats.repos
  const fmt = new Intl.NumberFormat(ru ? "ru-RU" : "en-US").format(repos)
  const levels = [
    { key: "high", label: ru ? "высокая" : "high", note: ru ? "показываем и учитываем в оценке" : "shown and scored", tone: "text-primary" },
    { key: "medium", label: ru ? "средняя" : "medium", note: ru ? "показываем и учитываем в оценке" : "shown and scored", tone: "text-warning" },
    { key: "low", label: ru ? "низкая" : "low", note: ru ? "скрыто, на оценку не влияет" : "hidden, never scored", tone: "text-muted-foreground" },
  ] as const

  return (
    <section id="trust" className="border-b border-border">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-24">
        <div className="max-w-2xl">
          <span className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {index} · {ru ? "проверка проверок" : "checking the checks"}
          </span>
          <h2 className="mt-4 text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
            {ru ? "Как мы знаем, что находкам можно верить" : "How we know a finding is worth your time"}
          </h2>
          <p className="mt-3 text-pretty leading-relaxed text-muted-foreground">
            {ru
              ? `В корпусе ${fmt} закреплённых open-source проектов. Часть находок проверяется вручную: по этой выборке оценивается точность правил и выбирается уровень уверенности.`
              : `The corpus contains ${fmt} pinned open-source projects. A sample of findings is reviewed by hand to estimate rule precision and assign confidence levels.`}
          </p>
          <p className="mt-3 font-mono text-xs text-muted-foreground">
            {ru ? "Снимок данных: " : "Data snapshot: "}
            <time dateTime={stats.generatedAt}>{new Intl.DateTimeFormat(ru ? "ru-RU" : "en-GB", { dateStyle: "medium", timeZone: "UTC" }).format(new Date(stats.generatedAt))}</time>
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-3">
          {levels.map((l) => (
            <div key={l.key} className="rounded-lg border border-border bg-card/40 p-5">
              <div className={`font-mono text-3xl font-semibold tabular-nums ${l.tone}`}>{precision(p[l.key]) === null ? "—" : `${precision(p[l.key])}%`}</div>
              <div className="mt-1 text-sm font-medium">{ru ? `Уверенность: ${l.label}` : `Confidence: ${l.label}`}</div>
              <p className="mt-1 text-xs text-muted-foreground">
                {ru ? "доля верных среди проверенных · " : "share right among checked · "}
                {l.note}
              </p>
              <p className="mt-2 text-xs tabular-nums text-muted-foreground">
                {ru ? "Проверено находок: " : "Reviewed findings: "}
                {new Intl.NumberFormat(ru ? "ru-RU" : "en-US").format((p[l.key]?.tp ?? 0) + (p[l.key]?.fp ?? 0))}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-14 grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-14">
          <div className="min-w-0 space-y-4">
            <h3 className="text-lg font-semibold tracking-tight">{ru ? "И сколько мы пропускаем" : "And how much we miss"}</h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {ru
                ? "Точность не говорит о пропусках, поэтому сканер проверяется ещё и на коде, где уязвимости известны заранее: учебные приложения и пары «уязвимая / исправленная версия» из реальных CVE. Ниже — DVWA, учебное приложение на PHP."
                : "Precision says nothing about misses, so the scanner is also run on code whose holes are known in advance: training apps and vulnerable/fixed pairs from real CVEs. Below: DVWA, a deliberately vulnerable PHP app."}
            </p>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40 text-left font-mono text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">{ru ? "Класс" : "Class"}</th>
                    <th className="px-3 py-2 text-right font-medium">{ru ? "Обычный скан" : "Regular scan"}</th>
                    <th className="px-3 py-2 text-right font-medium">{ru ? "Глубокий PHP" : "Deep PHP"}</th>
                  </tr>
                </thead>
                <tbody>
                  {RECALL.map((r) => (
                    <tr key={r.cls.en} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">{ru ? r.cls.ru : r.cls.en}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted-foreground">{r.fast}</td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{r.deep}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {ru
                ? "Оставшиеся XSS в DVWA — хранимый (через базу данных) и DOM (в JavaScript браузера): их глубокий анализ PHP пока не видит."
                : "The XSS still missed in DVWA are stored (through the database) and DOM-based (in browser JavaScript), which the PHP engine does not follow yet."}
            </p>
          </div>

          <div className="min-w-0 space-y-4">
            <h3 className="text-lg font-semibold tracking-tight">
              {ru ? "Глубокий анализ PHP (бета): путь, а не строка" : "Deep PHP analysis (beta): a path, not a line"}
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {ru
                ? "Обычное правило видит одну строку. Глубокий анализ прослеживает данные от запроса через переменные, файлы и функции до опасного вызова и рисует этот путь — его можно проверить глазами. Включается галочкой в настройках скана."
                : "A regular rule sees one line. The deep engine follows request data through variables, files and functions to the dangerous call and draws the path, so you can check it by reading. Turn it on in the scan settings."}
            </p>
            <FlowGraph steps={path("high.php", 11)} alternatives={[path("low.php", 6), path("medium.php", 9)]} locale={locale} />
          </div>
        </div>

        <aside className="mt-10 rounded-lg border border-border bg-muted/30 p-5">
          <h3 className="font-semibold">{ru ? "Что делать с результатом" : "How to use the result"}</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {ru
              ? "Начните с находок высокой уверенности: откройте указанный файл и проверьте контекст. Оценка A означает мало штрафов по выполненным проверкам; она не гарантирует отсутствие уязвимостей. Проценты выше описывают проверенную выборку, а не вероятность эксплуатации конкретной находки."
              : "Start with high-confidence findings: open the referenced file and check its context. An A means few penalties from the checks that ran; it does not guarantee the absence of vulnerabilities. The percentages above describe the reviewed sample, not the exploitability of an individual finding."}
          </p>
        </aside>
        <div className="mt-10 flex flex-wrap gap-3 text-sm">
          <Link href="/state" className="inline-flex items-center rounded-md border border-border bg-background px-4 py-2 font-medium hover:bg-muted">
            {ru ? "Точность по каждому правилу" : "Precision for every rule"} →
          </Link>
        </div>
      </div>
    </section>
  )
}
