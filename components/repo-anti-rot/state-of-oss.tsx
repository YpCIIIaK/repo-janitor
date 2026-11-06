"use client"

import stats from "@/benchmark/stats.json"
import history from "@/benchmark/history.json"
import { useLocale } from "@/components/i18n/locale-provider"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

/**
 * "State of open source": what the benchmark corpus says about public repos.
 *
 * Everything on this page comes from benchmark/stats.json and history.json,
 * which `pnpm bench:stats` and `pnpm bench:history` regenerate after each run,
 * so a deploy after a benchmark refreshes the page with no edits here.
 */

type Locale = "en" | "ru"

const T = {
  en: {
    title: (n: number) => `What ${n.toLocaleString("en-US")} open-source repositories look like`,
    lede:
      "repo-janitor scanned popular libraries, applications, infrastructure and tooling at pinned commits and read their full git history. Only findings a user sees by default (high and medium confidence) are counted.",
    updated: "Data from",
    tiles: { repos: "repositories scanned", median: "median health score", todos: "dated TODOs", todoAge: "median TODO age" },
    years: (y: number) => `${y.toFixed(1)} years`,
    dist: "Score distribution",
    distNote: (m: number) => `Repos per 10-point band. Median ${m}.`,
    sev: "What the findings are",
    sevNote: "All default-visible findings across the corpus, by severity.",
    sevL: { critical: "critical", warning: "warning", info: "info" },
    exposure: "Security exposure",
    exposureNote: "Share of repos with at least one such finding. Hard-coded credentials are not shown: on labelled samples nearly all of them were test fixtures and examples, so they stay hidden as low confidence.",
    expL: { critical: "any critical finding", injection: "insecure code pattern (injection, eval…)", iac: "infrastructure misconfiguration", docker: "Dockerfile issue", noLockfile: "no lockfile committed" },
    langs: "By language",
    langsNote: "Main language by lines of code. Density counts findings per 1,000 lines in repos over 500 lines.",
    langH: ["language", "repos", "median", "per 1k lines"],
    act: "Busy repos score lower",
    actNote: (a: number, q: number) => `Active: ≥ 50 commits in the last year (${a} repos). Quiet: < 10 (${q}). More churn, more debt — or simply more code being looked at.`,
    actL: { active: "active", quiet: "quiet" },
    findingsLink: "Every rule in detail: how common, where it fires, how accurate →",
    grades: "Grades",
    gradesNote: "Score adjusts for size: warnings weigh less in big codebases, critical findings never do.",
    supply: "Most GitHub Actions can be swapped under you",
    supplyNote: (n: number) => `Of ${n} repos using GitHub Actions. A tag like @v4 can be moved to new code by the action's owner — the tj-actions/changed-files attack. Pin to a commit SHA.`,
    ring: { tag: "pin at least one action to a mutable tag", third: "do it for a third-party action", perms: "never restrict the workflow token" },
    eol: "End-of-life runtimes",
    eolNode: (_p: string, n: number) => `of ${n} Node.js projects still declare or test an end-of-life Node`,
    eolPy: (_p: string, n: number) => `of ${n} Python projects still support an end-of-life Python`,
    common: "How common each problem is",
    commonNote: "Share of repos where the rule fired at least once.",
    hygiene: "Project files",
    debt: "How old the debt is",
    debtNote: (n: number, p: string) => `${n.toLocaleString("en-US")} TODO/FIXME comments dated with git blame; ${p} are older than five years. The oldest:`,
    size: "Bigger codebases, lower scores — even after the size adjustment",
    sizeNote: "Median score by lines of code.",
    practices: "Do good practices go with healthier code?",
    practicesNote:
      "Median score gap between repos with and without a practice, compared within the same size band. Correlation, not causation: issue templates and CONTRIBUTING mark busy, popular projects rather than careless ones.",
    trajectories: "How the same projects changed since 2012",
    trajectoriesNote: "Share of repos (alive that year) whose git history shows the practice. The corpus is today's survivors.",
    ci: "CI: Travis → GitHub Actions",
    sec: "Security: Dependabot, SECURITY.md, CodeQL",
    tooling: "Tooling: TypeScript, flat ESLint config, pnpm",
    python: "Python: setup.py → pyproject.toml",
    activity: "Median commits and authors per year",
    commits: "commits",
    authors: "authors",
    vuln: "Checked against deliberately vulnerable apps",
    vulnNote:
      "Apps whose holes are known in advance. An injection counts as high confidence only when request input is visible next to it or in a caller in another file.",
    vulnHigh: "high-confidence findings",
    vulnCross: "via another file",
    accuracy: "How far to trust these numbers",
    accuracyNote: (h: number) => `Precision on hand-labelled findings. ${h.toLocaleString("en-US")} low-confidence findings are hidden and left out of every number here.`,
    conf: { high: "High confidence", medium: "Medium confidence", low: "Low confidence (hidden)" },
    correct: "correct",
    extremes: "Cleanest and messiest",
    clean: "Score 100",
    messy: "Lowest scores",
    findings: "findings",
    method:
      "Method: repos are pinned to commits and scanned offline; findings are labelled by hand as true or false positives using one rule — is it true, and would a maintainer act on it. The benchmark, labels and these numbers are in the repo-janitor repository.",
  },
  ru: {
    title: (n: number) => `${n.toLocaleString("ru-RU")} open-source репозиториев изнутри`,
    lede:
      "repo-janitor просканировал популярные библиотеки, приложения, инфраструктуру и инструменты на зафиксированных коммитах и прочитал их полную историю git. Считаются только находки, которые пользователь видит по умолчанию (высокая и средняя уверенность).",
    updated: "Данные на",
    tiles: { repos: "репозиториев просканировано", median: "медианная оценка", todos: "TODO с датой", todoAge: "средний возраст TODO" },
    years: (y: number) => `${y.toFixed(1).replace(".", ",")} года`,
    dist: "Распределение оценок",
    distNote: (m: number) => `Число репозиториев в каждом десятке баллов. Медиана ${m}.`,
    sev: "Из чего состоят находки",
    sevNote: "Все видимые по умолчанию находки корпуса по важности.",
    sevL: { critical: "критичные", warning: "предупреждения", info: "инфо" },
    exposure: "Безопасность",
    exposureNote: "Доля репозиториев хотя бы с одной такой находкой. Ключей в коде здесь нет: в размеченных примерах почти все они оказались тестовыми фикстурами, поэтому скрыты как низкая уверенность.",
    expL: { critical: "хотя бы одна критичная находка", injection: "небезопасный код (инъекции, eval…)", iac: "ошибка в конфигурации инфраструктуры", docker: "проблема в Dockerfile", noLockfile: "нет lockfile" },
    langs: "По языкам",
    langsNote: "Основной язык по числу строк. Плотность — находки на 1000 строк в репозиториях больше 500 строк.",
    langH: ["язык", "репо", "медиана", "на 1k строк"],
    act: "Активные репозитории получают оценку ниже",
    actNote: (a: number, q: number) => `Активные: ≥ 50 коммитов за год (${a} репо). Тихие: < 10 (${q}). Больше изменений — больше долга, или просто больше кода под взглядом.`,
    actL: { active: "активные", quiet: "тихие" },
    findingsLink: "Каждое правило подробно: как часто, где срабатывает, насколько точно →",
    grades: "Оценки",
    gradesNote: "Оценка учитывает размер: в больших проектах предупреждения весят меньше, критические находки — всегда полностью.",
    supply: "Большинство GitHub Actions можно подменить",
    supplyNote: (n: number) => `Из ${n} проектов с GitHub Actions. Тег вроде @v4 автор action может перевесить на другой код — так прошла атака через tj-actions/changed-files. Закрепляйте на SHA коммита.`,
    ring: { tag: "закрепляют хоть один action на изменяемом теге", third: "делают это со сторонним action", perms: "не ограничивают права токена" },
    eol: "Устаревшие версии",
    eolNode: (_p: string, n: number) => `из ${n} Node.js-проектов объявляют или тестируют снятый с поддержки Node`,
    eolPy: (_p: string, n: number) => `из ${n} Python-проектов поддерживают снятый с поддержки Python`,
    common: "Что встречается чаще всего",
    commonNote: "Доля проектов, где правило сработало хотя бы раз.",
    hygiene: "Файлы проекта",
    debt: "Возраст долга",
    debtNote: (n: number, p: string) => `${n.toLocaleString("ru-RU")} TODO/FIXME с датой из git blame; ${p} старше пяти лет. Самые старые:`,
    size: "Чем больше проект, тем ниже оценка — даже с поправкой на размер",
    sizeNote: "Медианная оценка по числу строк кода.",
    practices: "Связаны ли хорошие практики с чистым кодом?",
    practicesNote:
      "Разница медианной оценки у проектов с практикой и без неё внутри групп одинакового размера. Корреляция, не причина: шаблоны issue и CONTRIBUTING — признак популярных проектов с большим потоком изменений, а не небрежных.",
    trajectories: "Как эти же проекты менялись с 2012 года",
    trajectoriesNote: "Доля проектов (существовавших в тот год), у которых в истории git появилась практика. Корпус — это сегодняшние выжившие.",
    ci: "CI: Travis → GitHub Actions",
    sec: "Безопасность: Dependabot, SECURITY.md, CodeQL",
    tooling: "Инструменты: TypeScript, ESLint flat config, pnpm",
    python: "Python: setup.py → pyproject.toml",
    activity: "Медиана коммитов и авторов в год",
    commits: "коммитов",
    authors: "авторов",
    vuln: "Проверка на заведомо уязвимых приложениях",
    vulnNote:
      "Приложения, где дыры известны заранее. Инъекция получает высокую уверенность, только если ввод из запроса виден рядом или в вызывающем коде в другом файле.",
    vulnHigh: "находок с высокой уверенностью",
    vulnCross: "через другой файл",
    accuracy: "Насколько верить этим цифрам",
    accuracyNote: (h: number) => `Точность на вручную размеченных находках. ${h.toLocaleString("ru-RU")} находок с низкой уверенностью скрыты и не входят ни в одну цифру на странице.`,
    conf: { high: "Высокая уверенность", medium: "Средняя уверенность", low: "Низкая уверенность (скрыто)" },
    correct: "верно",
    extremes: "Самые чистые и самые запущенные",
    clean: "Оценка 100",
    messy: "Самые низкие оценки",
    findings: "находок",
    method:
      "Методика: репозитории зафиксированы на коммитах и сканируются офлайн; находки размечены вручную как верные или ложные по одному правилу — правда ли это и стал бы мейнтейнер это исправлять. Бенчмарк, разметка и эти цифры лежат в репозитории repo-janitor.",
  },
} as const

const RULE_LABELS: Record<string, { en: string; ru: string }> = {
  "bus-factor": { en: "Old file only one person ever touched", ru: "Старый файл одного автора" },
  todo: { en: "Old TODO / FIXME", ru: "Старый TODO / FIXME" },
  duplicate: { en: "Duplicated code", ru: "Дублированный код" },
  "workflow-action-tag-first-party": { en: "GitHub action on a mutable tag", ru: "Action GitHub на изменяемом теге" },
  "workflow-no-permissions": { en: "Workflow token not restricted", ru: "Права токена workflow не ограничены" },
  "workflow-action-tag": { en: "Third-party action on a mutable tag", ru: "Сторонний action на теге" },
  "commented-code": { en: "Commented-out code", ru: "Закомментированный код" },
  "eol-node": { en: "End-of-life Node.js", ru: "Снятый с поддержки Node.js" },
  "doc-link": { en: "Broken link in docs", ru: "Битая ссылка в документации" },
  "dead-export": { en: "Export nothing imports", ru: "Неиспользуемый экспорт" },
  "skipped-test": { en: "Skipped test", ru: "Пропущенный тест" },
  bloat: { en: "Heavy file in git", ru: "Тяжёлый файл в git" },
  "hygiene-no-tests": { en: "No tests", ru: "Нет тестов" },
  "eol-python": { en: "End-of-life Python", ru: "Снятый с поддержки Python" },
}

const CHECKLIST: [keyof typeof stats.checklist, string, string][] = [
  ["readme", "README", "README"],
  ["license", "LICENSE", "LICENSE"],
  ["ci", "CI", "CI"],
  ["tests", "Tests", "Тесты"],
  ["contributing", "CONTRIBUTING", "CONTRIBUTING"],
  ["changelog", "CHANGELOG", "CHANGELOG"],
  ["security", "SECURITY.md", "SECURITY.md"],
  ["codeOfConduct", "Code of Conduct", "Code of Conduct"],
]

const pct = (x: number) => `${Math.round(x * 100)}%`

function Bar({ label, value, max, display, tone = "primary" }: { label: string; value: number; max: number; display: string; tone?: "primary" | "success" | "warning" | "destructive" }) {
  const fill = { primary: "bg-primary", success: "bg-success", warning: "bg-warning", destructive: "bg-destructive" }[tone]
  return (
    <div className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,15rem)_1fr_3.5rem]">
      <span className="truncate" title={label}>{label}</span>
      <span className="h-2.5 overflow-hidden rounded-full bg-secondary">
        <span className={cn("block h-full rounded-full", fill)} style={{ width: `${Math.max(1, (value / max) * 100)}%` }} />
      </span>
      <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">{display}</span>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg text-balance">{title}</CardTitle>
        {note && <CardDescription className="max-w-prose">{note}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

type Adoption = Record<string, Record<string, number>>
const YEARS = Array.from({ length: 15 }, (_, i) => String(2012 + i))

/** Small multi-line chart over 2012–2026, one series per practice. */
function Lines({ series, max, unit = "%" }: { series: { label: string; values: number[]; className: string }[]; max: number; unit?: string }) {
  const W = 440, H = 200, L = 36, R = 12, T = 12, B = 22
  const x = (i: number) => L + (i * (W - L - R)) / (YEARS.length - 1)
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {[0, max / 2, max].map((g) => (
          <g key={g}>
            <line x1={L} x2={W - R} y1={y(g)} y2={y(g)} className="stroke-border" />
            <text x={L - 6} y={y(g) + 4} textAnchor="end" className="fill-muted-foreground text-[10px]">{Math.round(g)}{unit}</text>
          </g>
        ))}
        {YEARS.map((yr, i) => i % 2 === 0 && (
          <text key={yr} x={x(i)} y={H - 4} textAnchor="middle" className="fill-muted-foreground text-[10px]">{yr}</text>
        ))}
        {series.map((s) => (
          <g key={s.label} className={s.className}>
            <path d={s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinejoin="round" />
            <circle cx={x(s.values.length - 1)} cy={y(s.values[s.values.length - 1])} r={3.5} fill="currentColor" />
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={cn("inline-block h-0.5 w-3 rounded bg-current", s.className)} />
            {s.label} {s.values[s.values.length - 1]}{unit}
          </span>
        ))}
      </figcaption>
    </figure>
  )
}

export function StateOfOpenSource() {
  const { locale } = useLocale()
  const l: Locale = locale === "ru" ? "ru" : "en"
  const t = T[l]
  const adoption = history.adoption as Adoption
  const series = (key: string) => YEARS.map((y) => Math.round((adoption[key]?.[y] ?? 0) * 100))
  const activity = history.activity as Record<string, { medianCommits: number; medianAuthors: number }>
  const totalGrades = Object.values(stats.grades).reduce((a, b) => a + b, 0)
  const gradeTone: Record<string, string> = { A: "bg-success", B: "bg-primary", C: "bg-muted-foreground", D: "bg-warning", F: "bg-destructive" }
  const ci = stats.ci
  const rules = Object.entries(stats.ruleShare).filter(([k]) => RULE_LABELS[k]).slice(0, 12)
  const prec = stats.precision as Record<"high" | "medium" | "low", { tp: number; fp: number }>
  const date = new Date(stats.generatedAt).toLocaleDateString(l === "ru" ? "ru-RU" : "en-US", { year: "numeric", month: "long", day: "numeric" })
  const practices = stats.practices.filter((p: { scoreGap: number | null }) => p.scoreGap !== null) as { label: string; repos: number; scoreGap: number }[]
  const maxGap = Math.max(...practices.map((p) => Math.abs(p.scoreGap)), 1)

  return (
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{t.title(stats.repos)}</h1>
        <p className="max-w-prose text-muted-foreground">{t.lede}</p>
        <p className="text-xs text-muted-foreground">{t.updated} {date}</p>
        <a href="/state/findings" className="inline-block text-sm font-medium text-primary hover:underline">{t.findingsLink}</a>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [stats.repos.toLocaleString(l), t.tiles.repos],
          [String(stats.medianScore), t.tiles.median],
          [stats.todo.dated.toLocaleString(l), t.tiles.todos],
          [t.years(stats.todo.medianDays / 365), t.tiles.todoAge],
        ].map(([v, label]) => (
          <Card key={label} className="gap-1 p-4">
            <span className="font-mono text-2xl font-semibold tabular-nums text-primary">{v}</span>
            <span className="text-xs text-muted-foreground">{label}</span>
          </Card>
        ))}
      </div>

      <Section title={t.grades} note={t.gradesNote}>
        <div className="flex h-9 overflow-hidden rounded-md">
          {Object.entries(stats.grades).map(([g, c]) => (
            <div key={g} className={cn("flex items-center justify-center text-xs font-semibold text-white", gradeTone[g])} style={{ width: `${(100 * c) / totalGrades}%` }} title={`${g}: ${c}`}>
              {g}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
          {Object.entries(stats.grades).map(([g, c]) => <span key={g}>{g}: {c} · {pct(c / totalGrades)}</span>)}
        </div>
      </Section>

      <Section title={t.dist} note={t.distNote(stats.medianScore)}>
        <div className="flex h-40 items-end gap-1.5">
          {stats.scoreHistogram.map((c, b) => {
            const max = Math.max(...stats.scoreHistogram)
            return (
              <div key={b} className="flex flex-1 flex-col items-center gap-1" title={`${b * 10}–${b === 9 ? 100 : b * 10 + 9}: ${c}`}>
                <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{c}</span>
                <div className={cn("w-full rounded-t", b < 4 ? "bg-destructive" : b < 6 ? "bg-warning" : b < 8 ? "bg-primary" : "bg-success")} style={{ height: `${Math.max(2, (c / max) * 120)}px` }} />
                <span className="font-mono text-[10px] text-muted-foreground">{b * 10}</span>
              </div>
            )
          })}
        </div>
      </Section>

      <Section title={t.exposure} note={t.exposureNote}>
          {(Object.keys(t.expL) as (keyof typeof t.expL)[]).map((k) => (
            <Bar key={k} label={t.expL[k]} value={stats.exposure[k]} max={Math.max(...Object.values(stats.exposure))} display={pct(stats.exposure[k])} tone="destructive" />
          ))}
      </Section>

      <Section title={t.sev} note={t.sevNote}>
        {(() => {
          const sev = stats.severity
          const total = sev.critical + sev.warning + sev.info
          const tone = { critical: "bg-destructive", warning: "bg-warning", info: "bg-muted-foreground" } as const
          return (
            <>
              <div className="flex h-7 overflow-hidden rounded-md">
                {(["critical", "warning", "info"] as const).map((k) => (
                  <div key={k} className={tone[k]} style={{ width: `${(100 * sev[k]) / total}%` }} title={`${t.sevL[k]}: ${sev[k]}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
                {(["critical", "warning", "info"] as const).map((k) => <span key={k}>{t.sevL[k]}: {sev[k].toLocaleString(l)} · {pct(sev[k] / total)}</span>)}
              </div>
            </>
          )
        })()}
      </Section>

      <Section title={t.langs} note={t.langsNote}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>{t.langH.map((h, i) => <th key={h} className={cn("pb-2 font-medium", i > 0 && "text-right")}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {Object.entries(stats.languages as Record<string, { repos: number; medianScore: number; findingsPer1k: number }>)
                .filter(([lang, v]) => v.repos >= 10 && lang !== "other")
                .sort((a, b) => b[1].repos - a[1].repos)
                .map(([lang, v]) => (
                  <tr key={lang} className="border-t border-border">
                    <td className="py-1.5">{lang}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums">{v.repos}</td>
                    <td className={cn("py-1.5 text-right font-mono tabular-nums", v.medianScore >= 80 ? "text-success" : v.medianScore < 60 ? "text-warning" : "")}>{v.medianScore}</td>
                    <td className="py-1.5 text-right font-mono tabular-nums text-muted-foreground">{v.findingsPer1k.toFixed(1)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section title={t.act} note={t.actNote(stats.activity.active, stats.activity.quiet)}>
        <Bar label={t.actL.active} value={stats.activity.activeMedian} max={100} display={String(stats.activity.activeMedian)} tone="warning" />
        <Bar label={t.actL.quiet} value={stats.activity.quietMedian} max={100} display={String(stats.activity.quietMedian)} tone="success" />
      </Section>

      <Section title={t.supply} note={t.supplyNote(ci.withActions)}>
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            [ci.unpinned / ci.withActions, t.ring.tag],
            [ci.thirdPartyUnpinned / ci.withActions, t.ring.third],
            [ci.noPermissions / ci.withActions, t.ring.perms],
          ].map(([v, label]) => (
            <div key={label as string} className="space-y-1">
              <span className={cn("font-mono text-3xl font-semibold tabular-nums", (v as number) > 0.5 ? "text-destructive" : "text-warning")}>{pct(v as number)}</span>
              <p className="text-sm text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t.eol}>
        <div className="grid gap-4 sm:grid-cols-2">
          {[
            [stats.eol.node.eol / stats.eol.node.repos, t.eolNode(pct(stats.eol.node.eol / stats.eol.node.repos), stats.eol.node.repos)],
            [stats.eol.python.eol / stats.eol.python.repos, t.eolPy(pct(stats.eol.python.eol / stats.eol.python.repos), stats.eol.python.repos)],
          ].map(([v, label]) => (
            <div key={label as string} className="space-y-1">
              <span className="font-mono text-3xl font-semibold tabular-nums text-warning">{pct(v as number)}</span>
              <p className="text-sm text-muted-foreground">{label as string}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t.common} note={t.commonNote}>
        {rules.map(([k, v]) => <Bar key={k} label={RULE_LABELS[k][l]} value={v} max={1} display={pct(v)} />)}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title={t.hygiene}>
          {CHECKLIST.map(([k, en, ru]) => <Bar key={k} label={l === "ru" ? ru : en} value={stats.checklist[k]} max={1} display={pct(stats.checklist[k])} tone="success" />)}
        </Section>
        <Section title={t.size} note={t.sizeNote}>
          {stats.sizeBands.map((b) => <Bar key={b.label} label={`${b.label} · ${b.repos}`} value={b.medianScore} max={100} display={String(b.medianScore)} />)}
        </Section>
      </div>

      <Section title={t.debt} note={t.debtNote(stats.todo.dated, pct(stats.todo.overFiveYears / stats.todo.dated))}>
        <ol className="space-y-1.5 text-sm">
          {stats.todo.oldest.map((o) => (
            <li key={o.repo + o.location} className="grid grid-cols-[6.5rem_1fr] gap-2">
              <span className="font-mono tabular-nums">{t.years(o.years)}</span>
              <span className="min-w-0">
                <a className="underline-offset-2 hover:underline" href={`https://github.com/${o.repo}`} target="_blank" rel="noreferrer">{o.repo}</a>{" "}
                <code className="break-all text-xs text-muted-foreground">{o.location}</code>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={t.practices} note={t.practicesNote}>
        <div className="space-y-1.5">
          {practices.map((p) => (
            <div key={p.label} className="grid grid-cols-[minmax(0,9rem)_1fr_3rem] items-center gap-3 text-sm sm:grid-cols-[minmax(0,12rem)_1fr_3rem]">
              <span className="truncate">{p.label} <span className="text-xs text-muted-foreground">· {p.repos}</span></span>
              <span className="grid grid-cols-2">
                <span className="flex justify-end border-r border-border pr-px">
                  {p.scoreGap < 0 && <span className="h-2.5 rounded-l-full bg-destructive" style={{ width: `${(Math.abs(p.scoreGap) / maxGap) * 100}%` }} />}
                </span>
                <span className="flex pl-px">
                  {p.scoreGap > 0 && <span className="h-2.5 rounded-r-full bg-success" style={{ width: `${(p.scoreGap / maxGap) * 100}%` }} />}
                </span>
              </span>
              <span className="text-right font-mono text-xs tabular-nums">{p.scoreGap > 0 ? "+" : ""}{p.scoreGap.toFixed(1)}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t.trajectories} note={t.trajectoriesNote}>
        <div className="grid gap-6 md:grid-cols-2">
          <div><p className="mb-1 text-sm font-medium">{t.ci}</p><Lines max={100} series={[{ label: "GitHub Actions", values: series("githubActions"), className: "text-primary" }, { label: "Travis CI", values: series("travis"), className: "text-destructive" }]} /></div>
          <div><p className="mb-1 text-sm font-medium">{t.sec}</p><Lines max={50} series={[{ label: "Dependabot", values: series("dependabot"), className: "text-primary" }, { label: "SECURITY.md", values: series("security"), className: "text-muted-foreground" }, { label: "CodeQL", values: series("codeql"), className: "text-warning" }]} /></div>
          <div><p className="mb-1 text-sm font-medium">{t.tooling}</p><Lines max={30} series={[{ label: "TypeScript", values: series("tsconfig"), className: "text-primary" }, { label: "ESLint flat", values: series("eslintFlat"), className: "text-warning" }, { label: "pnpm", values: series("pnpmLock"), className: "text-success" }]} /></div>
          <div><p className="mb-1 text-sm font-medium">{t.python}</p><Lines max={20} series={[{ label: "setup.py", values: series("setupPy"), className: "text-destructive" }, { label: "pyproject.toml", values: series("pyproject"), className: "text-primary" }]} /></div>
        </div>
        <div className="md:w-1/2">
          <p className="mb-1 text-sm font-medium">{t.activity}</p>
          <Lines max={150} unit="" series={[
            { label: t.commits, values: YEARS.map((y) => activity[y]?.medianCommits ?? 0), className: "text-primary" },
            { label: t.authors, values: YEARS.map((y) => activity[y]?.medianAuthors ?? 0), className: "text-warning" },
          ]} />
        </div>
      </Section>

      <Section title={t.vuln} note={t.vulnNote}>
        <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
          {stats.vulnerableApps.slice(0, 20).map((v) => (
            <div key={v.repo} className="flex items-baseline justify-between gap-2 text-sm">
              <a className="truncate underline-offset-2 hover:underline" href={`https://github.com/${v.repo}`} target="_blank" rel="noreferrer">{v.repo}</a>
              <span className="shrink-0 font-mono text-xs tabular-nums">
                <span className={v.high > 0 ? "text-success" : "text-muted-foreground"}>{v.high}</span>
                {v.crossFile > 0 && <span className="text-muted-foreground"> · {v.crossFile} {t.vulnCross}</span>}
              </span>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">{t.vulnHigh}</p>
      </Section>

      <Section title={t.accuracy} note={t.accuracyNote(stats.lowConfidenceHidden)}>
        {(["high", "medium", "low"] as const).map((c) => {
          const p = prec[c]
          const share = p.tp / Math.max(1, p.tp + p.fp)
          return <Bar key={c} label={`${t.conf[c]} · ${p.tp + p.fp}`} value={share} max={1} display={pct(share)} tone={c === "high" ? "success" : c === "medium" ? "warning" : "destructive"} />
        })}
      </Section>

      <Section title={t.extremes}>
        <div className="grid gap-6 sm:grid-cols-2">
          {[[t.clean, stats.best.slice(0, 8)], [t.messy, stats.worst]].map(([title, list]) => (
            <div key={title as string} className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{title as string}</p>
              {(list as { repo: string; score: number; findings: number }[]).map((r) => (
                <div key={r.repo} className="flex items-baseline gap-3 text-sm">
                  <span className="w-8 font-mono tabular-nums">{r.score}</span>
                  <a className="min-w-0 truncate underline-offset-2 hover:underline" href={`https://github.com/${r.repo}`} target="_blank" rel="noreferrer">{r.repo}</a>
                  <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{r.findings.toLocaleString(l)} {t.findings}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </Section>

      <p className="max-w-prose text-xs text-muted-foreground">{t.method}</p>
    </main>
  )
}
