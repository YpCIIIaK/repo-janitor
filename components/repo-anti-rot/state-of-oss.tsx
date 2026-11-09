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
    facts: "In one glance",
    fact: {
      todo: "years: the age of the oldest TODO still in the code",
      solo: "of projects: one person wrote 80%+ of the commits",
      quiet: "have had no commit for a year or more",
      pin: "pin a GitHub Action to a tag that can be moved",
    },
    people: "People and time",
    bus: "Bus factor: how much rests on one person",
    busNote: (m: number) => `Share of all commits made by the single most active author. Median project has ${m} contributors over its life.`,
    busBySize: "One person wrote 80%+ of commits, by project size",
    sizeL: { small: "< 5k lines", "mid-size": "5k–50k", large: "50k–200k", "very large": "> 200k" } as Record<string, string>,
    age: "Older projects are not the worst ones",
    ageNote: "Median score by the year of the first commit. Very old and very young projects differ in why they score as they do: one carries legacy, the other has had less time to collect it.",
    contributors: "contributors",
    pulse: "Pulse",
    pulseL: { month: "committed in the last month", year: "quiet for a year or more", three: "quiet for three years or more" },
    pulseEol: (q: string, a: string) => `Quiet projects ship end-of-life runtimes less often than active ones: ${q} against ${a}. Many quiet projects are finished libraries with few runtime pins.`,
    tests: "Tests and CI by language",
    testsNote: "Languages with at least 30 projects. A test file anywhere counts; this says nothing about coverage.",
    testsL: "tests",
    ciL: "CI",
    messyAnon: "Lowest scores — anonymous",
    messyNote: "We do not name the projects with the most problems. Language, size and what dominates is the useful part.",
    sizeWord: { small: "small", "mid-size": "mid-size", large: "large", "very large": "very large" } as Record<string, string>,
    cat: { todo: "old TODOs", "dead-code": "dead code", security: "security", dependency: "dependencies", hygiene: "hygiene", env: "env vars", branch: "stale branches" } as Record<string, string>,
    outside: "Outside view",
    pop: "Popular projects score lower — because they are bigger",
    popNote: "Median score and findings per 1,000 lines by GitHub stars. Stars from deps.dev. Popular projects have fewer problems per line; they simply have many more lines.",
    popScore: "median score",
    popDensity: "findings / 1k lines",
    licensesT: "Licenses",
    licensesNote: "As reported by deps.dev for each repository.",
    scT: "Cross-checked with OpenSSF Scorecard",
    scNote: (n: number, rho: string) => `${n} of our repos have a Scorecard result on deps.dev. The overall scores measure different things — Scorecard rates security process, we rate the state of the code — and barely correlate (ρ = ${rho}). Where both check the same thing, they agree:`,
    scPinned: "pinning of actions and dependencies",
    scTokens: "workflow token permissions",
    scBad: "Scorecard 0–2: we flag",
    scGood: "Scorecard 8–10: we flag",
    vdeps: "Known vulnerabilities in dependencies",
    vdepsNote: (n: number, d: string) => `${n.toLocaleString("en-US")} repos checked against OSV (osv.dev) on ${d}, at their pinned commits. Versions come from lockfiles; without one, from the lowest version a manifest allows, which can overstate. Dev, test and docs dependencies count only in the first number.`,
    vdepsL: { any: "have at least one known vulnerability", shipped: "in dependencies that ship (not dev, test or docs)", critical: "have a critical one" },
    vdepsMedian: (m: number) => `An affected project typically carries ${m} of them.`,
    vdepsTop: "Packages most often behind them, share of all repos",
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
    facts: "Коротко",
    fact: {
      todo: "лет — возраст самого старого TODO в коде",
      solo: "проектов: один человек сделал 80%+ коммитов",
      quiet: "без единого коммита год и больше",
      pin: "держат GitHub Action на теге, который можно перевесить",
    },
    people: "Люди и время",
    bus: "Bus factor: сколько держится на одном человеке",
    busNote: (m: number) => `Доля всех коммитов самого активного автора. У медианного проекта за всю жизнь ${m} участников.`,
    busBySize: "Один человек сделал 80%+ коммитов, по размеру проекта",
    sizeL: { small: "< 5 тыс. строк", "mid-size": "5–50 тыс.", large: "50–200 тыс.", "very large": "> 200 тыс." } as Record<string, string>,
    age: "Старые проекты — не самые плохие",
    ageNote: "Медианная оценка по году первого коммита. У очень старых и очень молодых проектов разные причины: одни несут наследие, другие просто не успели его накопить.",
    contributors: "участников",
    pulse: "Пульс",
    pulseL: { month: "был коммит за последний месяц", year: "тишина год и больше", three: "тишина три года и больше" },
    pulseEol: (q: string, a: string) => `Затихшие проекты реже тянут устаревшие рантаймы, чем активные: ${q} против ${a}. Многие из них — законченные библиотеки, которым почти нечего закреплять.`,
    tests: "Тесты и CI по языкам",
    testsNote: "Языки, где хотя бы 30 проектов. Считается любой тестовый файл; о покрытии это ничего не говорит.",
    testsL: "тесты",
    ciL: "CI",
    messyAnon: "Самые низкие оценки — без имён",
    messyNote: "Мы не называем проекты, где больше всего проблем. Полезная часть — язык, размер и что преобладает.",
    sizeWord: { small: "небольшой", "mid-size": "средний", large: "крупный", "very large": "очень крупный" } as Record<string, string>,
    cat: { todo: "старые TODO", "dead-code": "мёртвый код", security: "безопасность", dependency: "зависимости", hygiene: "гигиена", env: "переменные окружения", branch: "старые ветки" } as Record<string, string>,
    outside: "Взгляд со стороны",
    pop: "Популярные проекты получают оценку ниже — потому что они больше",
    popNote: "Медианная оценка и находки на 1000 строк по числу звёзд на GitHub. Звёзды из deps.dev. На строку кода у популярных проектов проблем меньше; просто строк у них намного больше.",
    popScore: "медианная оценка",
    popDensity: "находок на 1000 строк",
    licensesT: "Лицензии",
    licensesNote: "По данным deps.dev для каждого репозитория.",
    scT: "Сверка с OpenSSF Scorecard",
    scNote: (n: number, rho: string) => `У ${n} наших репозиториев есть результат Scorecard на deps.dev. Общие оценки меряют разное — Scorecard оценивает процессы безопасности, мы оцениваем состояние кода — и почти не связаны (ρ = ${rho}). Там, где обе системы проверяют одно и то же, они сходятся:`,
    scPinned: "закрепление actions и зависимостей",
    scTokens: "права токена в workflow",
    scBad: "Scorecard 0–2: у нас находка",
    scGood: "Scorecard 8–10: у нас находка",
    vdeps: "Известные уязвимости в зависимостях",
    vdepsNote: (n: number, d: string) => `${n.toLocaleString("ru-RU")} репозиториев проверены по базе OSV (osv.dev) ${d}, на закреплённых коммитах. Версии берутся из lock-файлов, а без них — по нижней границе диапазона в манифесте, что может завышать. Зависимости для разработки, тестов и документации учитываются только в первой цифре.`,
    vdepsL: { any: "имеют хотя бы одну известную уязвимость", shipped: "в зависимостях, которые попадают в продукт", critical: "имеют критичную" },
    vdepsMedian: (m: number) => `У затронутого проекта их обычно ${m}.`,
    vdepsTop: "Пакеты, которые чаще всего за этим стоят, доля всех репозиториев",
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
    <main className="mx-auto grid max-w-4xl gap-6 px-4 py-10 [&>*]:min-w-0">
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

      <Section title={t.facts}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {[
            [String(Math.floor(stats.todo.oldest[0]?.years ?? 0)), t.fact.todo, "text-warning"],
            [pct(stats.busFactor.over80), t.fact.solo, "text-warning"],
            [pct(stats.pulse.quietOverYear), t.fact.quiet, "text-muted-foreground"],
            [pct(ci.unpinned / ci.withActions), t.fact.pin, "text-destructive"],
          ].map(([v, label, tone]) => (
            <div key={label} className="space-y-1">
              <span className={cn("font-mono text-3xl font-semibold tabular-nums", tone)}>{v}</span>
              <p className="text-xs text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
      </Section>

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

      {stats.vulnerableDeps && (
        <Section title={t.vdeps} note={t.vdepsNote(stats.vulnerableDeps.repos, stats.vulnerableDeps.checkedAt ?? "")}>
          <div className="grid gap-4 sm:grid-cols-3">
            {([
              [stats.vulnerableDeps.any, t.vdepsL.any, "text-warning"],
              [stats.vulnerableDeps.shipped, t.vdepsL.shipped, "text-warning"],
              [stats.vulnerableDeps.critical, t.vdepsL.critical, "text-destructive"],
            ] as const).map(([v, label, tone]) => (
              <div key={label} className="space-y-1">
                <span className={cn("font-mono text-3xl font-semibold tabular-nums", tone)}>{pct(v)}</span>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t.vdepsMedian(stats.vulnerableDeps.medianAffected)}</p>
          <p className="pt-2 text-xs text-muted-foreground">{t.vdepsTop}</p>
          {stats.vulnerableDeps.topPackages.map((x) => (
            <Bar key={x.name} label={x.name} value={x.share} max={stats.vulnerableDeps.topPackages[0].share} display={pct(x.share)} tone="destructive" />
          ))}
        </Section>
      )}

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

      <h2 className="pt-4 text-xl font-semibold tracking-tight">{t.people}</h2>

      <Section title={t.bus} note={t.busNote(stats.busFactor.medianAuthors)}>
        <div className="flex h-7 overflow-hidden rounded-md">
          {stats.busFactor.bands.map((b, i) => (
            <div key={b.label} className={["bg-success", "bg-primary", "bg-warning", "bg-destructive"][i]} style={{ width: `${b.share * 100}%` }} title={`${b.label}: ${pct(b.share)}`} />
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 text-xs text-muted-foreground">
          {stats.busFactor.bands.map((b) => <span key={b.label}>{b.label}: {pct(b.share)}</span>)}
        </div>
        <p className="pt-2 text-xs text-muted-foreground">{t.busBySize}</p>
        {stats.busFactor.bySize.map((b) => (
          <Bar key={b.size} label={t.sizeL[b.size]} value={b.over80 ?? 0} max={Math.max(...stats.busFactor.bySize.map((x) => x.over80 ?? 0))} display={pct(b.over80 ?? 0)} tone="warning" />
        ))}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title={t.age} note={t.ageNote}>
          {stats.age.map((a) => (
            <Bar key={a.label} label={`${a.label} · ${a.repos}`} value={a.medianScore} max={100} display={String(a.medianScore)} tone={a.medianScore >= 75 ? "success" : a.medianScore < 70 ? "warning" : "primary"} />
          ))}
        </Section>
        <Section title={t.pulse} note={t.pulseEol(pct(stats.pulse.dormantWithEol), pct(stats.pulse.activeWithEol))}>
          <div className="grid gap-4">
            {[
              [stats.pulse.activeLastMonth, t.pulseL.month, "text-success"],
              [stats.pulse.quietOverYear, t.pulseL.year, "text-warning"],
              [stats.pulse.quietOverThreeYears, t.pulseL.three, "text-muted-foreground"],
            ].map(([v, label, tone]) => (
              <div key={label as string} className="flex items-baseline gap-3">
                <span className={cn("w-16 font-mono text-2xl font-semibold tabular-nums", tone as string)}>{pct(v as number)}</span>
                <span className="text-sm text-muted-foreground">{label as string}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>

      <Section title={t.tests} note={t.testsNote}>
        <div className="grid grid-cols-[minmax(0,6rem)_1fr_1fr] gap-x-3 text-xs text-muted-foreground">
          <span />
          <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2 rounded-full bg-success" />{t.testsL}</span>
          <span className="inline-flex items-center gap-1.5"><span className="inline-block size-2 rounded-full bg-sky-500" />{t.ciL}</span>
        </div>
        {stats.testsByLanguage.map((x) => (
          <div key={x.language} className="grid grid-cols-[minmax(0,6rem)_1fr_1fr] items-center gap-x-3 text-sm">
            <span className="truncate">{x.language}</span>
            {([[x.withTests, "bg-success"], [x.withCi, "bg-sky-500"]] as const).map(([v, tone], i) => (
              <span key={i} className="flex min-w-0 items-center gap-2">
                <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"><span className={cn("block h-full rounded-full", tone)} style={{ width: `${v * 100}%` }} /></span>
                <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{pct(v)}</span>
              </span>
            ))}
          </div>
        ))}
      </Section>

      <h2 className="pt-4 text-xl font-semibold tracking-tight">{t.outside}</h2>

      <Section title={t.pop} note={t.popNote}>
        <div className="grid grid-cols-[minmax(0,6rem)_1fr_1fr] gap-x-3 text-xs text-muted-foreground">
          <span />
          <span>{t.popScore}</span>
          <span>{t.popDensity}</span>
        </div>
        {(() => {
          const bands = stats.popularity.bands.filter((b) => b.repos >= 30)
          const maxD = Math.max(...bands.map((b) => b.density ?? 0))
          return bands.map((b) => (
            <div key={b.label} className="grid grid-cols-[minmax(0,6rem)_1fr_1fr] items-center gap-x-3 text-sm">
              <span className="truncate">{b.label}<span className="text-muted-foreground"> · {b.repos}</span></span>
              {([[b.medianScore ?? 0, 100, "bg-primary", String(b.medianScore)], [b.density ?? 0, maxD, "bg-warning", (b.density ?? 0).toFixed(1)]] as const).map(([v, max, tone, label], i) => (
                <span key={i} className="flex min-w-0 items-center gap-2">
                  <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-secondary"><span className={cn("block h-full rounded-full", tone)} style={{ width: `${(v / max) * 100}%` }} /></span>
                  <span className="w-9 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{label}</span>
                </span>
              ))}
            </div>
          ))
        })()}
      </Section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title={t.scT} note={t.scNote(stats.scorecard.repos, stats.scorecard.spearman?.toFixed(2) ?? "—")}>
          {([[t.scPinned, stats.scorecard.pinned], [t.scTokens, stats.scorecard.tokens]] as const).map(([label, a]) => (
            <div key={label} className="space-y-1.5">
              <p className="text-sm font-medium">{label}</p>
              <Bar label={t.scBad} value={a.flaggedWhenScorecardBad ?? 0} max={1} display={pct(a.flaggedWhenScorecardBad ?? 0)} tone="destructive" />
              <Bar label={t.scGood} value={a.flaggedWhenScorecardGood ?? 0} max={1} display={pct(a.flaggedWhenScorecardGood ?? 0)} tone="success" />
            </div>
          ))}
        </Section>
        <Section title={t.licensesT} note={t.licensesNote}>
          {stats.licenses.map((x) => (
            <Bar key={x.license} label={x.license} value={x.share} max={stats.licenses[0].share} display={pct(x.share)} />
          ))}
        </Section>
      </div>

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
        <div className="grid gap-6 sm:grid-cols-2 [&>*]:min-w-0">
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t.clean}</p>
            {stats.best.slice(0, 8).map((r) => (
              <div key={r.repo} className="flex items-baseline gap-3 text-sm">
                <span className="w-8 font-mono tabular-nums">{r.score}</span>
                <a className="min-w-0 truncate underline-offset-2 hover:underline" href={`https://github.com/${r.repo}`} target="_blank" rel="noreferrer">{r.repo}</a>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{r.findings.toLocaleString(l)} {t.findings}</span>
              </div>
            ))}
          </div>
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground">{t.messyAnon}</p>
            {(stats.worst as { language: string; size: string; score: number; findings: number; top: string | null }[]).map((r, i) => (
              <div key={i} className="flex items-baseline gap-3 text-sm">
                <span className="w-8 font-mono tabular-nums">{r.score}</span>
                <span className="min-w-0 truncate">{t.sizeWord[r.size] ?? r.size} {r.language}{r.top ? <span className="text-muted-foreground"> · {t.cat[r.top] ?? r.top}</span> : null}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-muted-foreground">{r.findings.toLocaleString(l)} {t.findings}</span>
              </div>
            ))}
            <p className="pt-1 text-xs text-muted-foreground">{t.messyNote}</p>
          </div>
        </div>
      </Section>

      <p className="max-w-prose text-xs text-muted-foreground">{t.method}</p>
    </main>
  )
}
