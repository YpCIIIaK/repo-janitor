/**
 * Localisation for the public-facing pages.
 *
 * Deliberately a plain typed dictionary rather than an i18n library. The public
 * surface is a few dozen strings; a runtime, a loader and a message-format
 * parser would be more dependency than content. The dependency tree of this
 * project is a thing we report on, so it is a thing we keep honest.
 *
 * ## Where the boundary runs
 *
 * Three rules, in this order:
 *
 *  1. **Public pages are translated.** The landing page, the scan form embedded
 *     in it, the results it shows, and the shared-report page at `/r/…`. These
 *     are what a stranger who followed a link sees, and they see them before
 *     deciding whether this tool is for them.
 *
 *  2. **Consent text is translated wherever it appears** — including inside the
 *     English dashboard. Agreeing to something you cannot read is not consent,
 *     so this rule outranks rule 3 rather than being an exception to it.
 *
 *  3. **The dashboard is English.** Translating several hundred strings of table
 *     headers, filters and settings — and re-translating them with every feature
 *     — buys nothing until somebody actually asks.
 *
 * Scanner and category names (`Dependency Funeral`, `Env Lifecycle`) stay in
 * English everywhere: they are identifiers that appear in the CLI, the JSON
 * report and the config file, and a translated name would not match what the
 * user greps for.
 *
 * Adding a locale is one object here. Missing a key is a compile error, not a
 * blank space at runtime: every locale is typed against the English dictionary.
 */

export const LOCALES = ["en", "ru"] as const
export type Locale = (typeof LOCALES)[number]
export const DEFAULT_LOCALE: Locale = "en"

/** Cookie name, readable from both the server (SSR) and the browser. */
export const LOCALE_COOKIE = "rar_locale"

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  ru: "Русский",
}

const en = {
  "welcome.title": "Welcome to Repo Anti-Rot",
  "welcome.lead":
    "Point Repo Anti-Rot at any public git repo and it will measure the decay — secrets, stale branches, dead code and dependency rot — then hand you a health grade.",

  // The scan form. It sits on the landing page, so it is rule 1, not rule 3.
  "scan.formTitle": "Run a real scan",
  "scan.formLead":
    "Search GitHub or paste a repository URL, then add it to the list. Everything in the list is cloned and scanned by the Repo Anti-Rot engine — no mock data.",
  "scan.run": "Run scan",
  "scan.running": "Scanning…",
  "scan.urls": "{count} URL · max {max} per run",
  "scan.starting": "Starting…",
  "scan.working": "Working…",
  "scan.failed": "Scan failed",
  "scan.summary": "{total} scanned · {ok} succeeded",
  "scan.downloadAll": "Download all (JSON)",
  "scan.copyJson": "Copy JSON",
  "scan.copied": "Copied",
  "scan.downloadJson": "Download JSON",
  "scan.downloadMarkdown": "Download Markdown",
  "scan.openDashboard": "Open in dashboard",
  "scan.clean": "No issues detected — clean scan.",

  // The multi-repository summary, shown above the individual reports.
  "batch.title": "{count} repositories, together",
  "batch.findings": "findings in total",
  "batch.averageScore": "average score",
  "batch.repository": "Repository",
  "batch.grade": "Grade",
  "batch.score": "Score",
  "batch.mostly": "Mostly",
  "batch.sharedTitle": "Present in more than one repository",
  "batch.sharedLead":
    "One repository with a problem is a mistake; several is a convention. Fixing these where they come from fixes them everywhere.",
  "batch.inRepos": "{count} repos",
  "batch.failedTitle": "{count} could not be scanned",
  "batch.downloadMarkdown": "Download summary (Markdown)",

  // The explicit selection list. What gets scanned is what is shown in it.
  "scan.inputPlaceholder": "Search GitHub, or paste a repository URL",
  "scan.add": "Add",
  "scan.added": "Added",
  "scan.remove": "Remove from the list",
  "scan.clearAll": "Clear",
  "scan.selectedTitle": "Selected — {count} of {max}",
  "scan.selectedEmpty": "Nothing selected yet. Search above, or paste a repository URL.",
  "scan.duplicate": "Already in the list.",
  "scan.limit": "That is the limit of {max} repositories per run.",
  "scan.willScan": "{count} will be cloned and scanned",
  "scan.runCount": "Scan {count}",

  // The GitHub preview card and search. Part of the scan form, so rule 1.
  "repo.searchHint": "Type a name to search GitHub, or paste a repository URL.",
  "repo.searching": "Searching GitHub…",
  "repo.notFound": "No such repository on GitHub — check the owner and name.",
  "repo.noResults": "Nothing found on GitHub for that.",
  "repo.searchError": "Could not reach GitHub. You can still paste a URL and scan.",
  "repo.scanThis": "Scan",
  "repo.archived": "Archived",
  "repo.largeHint":
    "A large repository — cloning and scanning it takes longer, and may fail on a small server. GitHub reports the whole history; a shallow clone is usually smaller.",
  "repo.overHint":
    "Bigger than this server's {max} MB clone limit, so the scan will probably be refused part-way. GitHub reports the whole history, so a shallow clone may still fit — but expect trouble.",
  "repo.fork": "Fork",
  "repo.stars": "Stars",
  "repo.forks": "Forks",
  "repo.openIssues": "Open issues",
  "repo.license": "License",
  "repo.lastPush": "Last push {when}",
  "repo.results": "Results from GitHub",

  "feature.secrets.title": "Secrets & env drift",
  "feature.secrets.body":
    "Finds leaked keys in history and env vars referenced but missing from your example file.",
  "feature.dead.title": "Dead weight",
  "feature.dead.body":
    "Surfaces unused dependencies, dead exports and TODO debt that quietly rot the codebase.",
  "feature.branches.title": "Stale branches",
  "feature.branches.body":
    "Flags abandoned branches and decay trends so you know exactly what to prune.",

  // Consent. The wording has to match what the code actually stores — see
  // `lib/share-report.ts`. Promising more privacy than we deliver would be the
  // worst possible bug in a tool that reports on security.
  // Must describe `toSharedReport` in lib/share-report.ts exactly. Change one,
  // change the other in the same commit.
  "consent.label": "Save this result so it can be shared by link",
  "consent.body":
    "Stores the grade, score, counts per category, the titles of the top 10 findings, and the repository's public address. File paths, line numbers, code snippets and matched secret values are never written — they stay in this browser.",
  "consent.optional": "Optional. Leave it off and the report stays in this browser only.",

  "share.action": "Share",
  "share.create": "Create share link",
  "share.creating": "Creating…",
  "share.failed": "Could not create the link. Try again.",
  "share.copy": "Copy link",
  "share.copied": "Copied",
  "share.badgeTitle": "Badge for your README",
  // Says snapshot, because that is what it is. Sharing a newer scan mints a new
  // token and therefore a new badge URL — this one keeps showing this scan.
  // The earlier wording promised it would update, which it never does.
  "share.badgeLead":
    "Shows this scan's grade, and keeps showing it. Share a newer scan and you get a new badge to paste — this one stays as it is.",
  "share.badgeCopy": "Copy markdown",
  "share.heading": "Repository health",
  // The good-news wording. Every one of these states something the scan
  // actually established — what was read, and what was not found in it. None
  // claims the code is good, which is not something this tool measures.
  "verdict.clean.title": "Came back clean",
  "verdict.clean.body":
    "Nothing was found across {scope}. That covers secrets, known vulnerabilities, end-of-life runtimes, CI workflow security, dead code and dependency rot.",
  "verdict.strong.title": "In good shape",
  "verdict.strong.body":
    "No critical or warning-level findings across {scope} — only {count} minor notes.",
  "verdict.strong.bodyOne":
    "No critical or warning-level findings across {scope} — just one minor note.",
  "verdict.noScope.clean":
    "Nothing was found. That covers secrets, known vulnerabilities, end-of-life runtimes, CI workflow security, dead code and dependency rot.",
  "verdict.noScope.strong": "No critical or warning-level findings — only {count} minor notes.",
  "share.scannedAt": "Scanned {date}",
  "share.rescan": "Scan another repository",
  "share.snapshot": "This is a snapshot from {date}. The repository has moved on since.",
  "share.ageDays": "{days} days old",
  "share.freshTitle": "See it as it is today",
  "share.freshLead":
    "Run the same scan yourself against the current code. Nothing is stored unless you ask for a link.",
  "share.freshAction": "Scan {repo} now",
  "share.checking": "Checking whether the repository is still public…",
  "share.gone":
    "This repository can no longer be cloned — it may have been made private, renamed or deleted.",
  "share.notFound": "No shared report at this address.",
  "share.redactedNote":
    "This is a shared summary: code evidence and secret values are not included.",

  "grade.score": "{score}/100",
  "issues.count": "{count} findings",
  // English needs the singular spelled out. Russian sidesteps it with the
  // "находок: N" shape, which is why there is no matching key there.
  "issues.countOne": "1 finding",
  "issues.critical": "critical",
  "issues.warning": "warning",
  "issues.info": "info",

  "lang.label": "Language",

  "theme.label": "Theme",
  "theme.moss": "Moss",
  "theme.ocean": "Ocean",
  "theme.aurora": "Aurora",
} as const

/** Every locale must provide exactly the English key set. */
export type MessageKey = keyof typeof en
export type Messages = Record<MessageKey, string>

const ru: Messages = {
  "welcome.title": "Repo Anti-Rot",
  "welcome.lead":
    "Укажите любой публичный git-репозиторий, и Repo Anti-Rot измерит его распад — секреты, заброшенные ветки, мёртвый код и гниль зависимостей — и выставит оценку здоровья.",

  "scan.formTitle": "Запустить настоящий скан",
  "scan.formLead":
    "Найдите репозиторий на GitHub или вставьте ссылку и добавьте в список. Всё, что в списке, будет склонировано и просканировано движком Repo Anti-Rot — без выдуманных данных.",
  "scan.run": "Запустить скан",
  "scan.running": "Сканируем…",
  "scan.urls": "ссылок: {count} · не больше {max} за раз",
  "scan.starting": "Начинаем…",
  "scan.working": "Работаем…",
  "scan.failed": "Скан не удался",
  "scan.summary": "просканировано: {total} · успешно: {ok}",
  "scan.downloadAll": "Скачать всё (JSON)",
  "scan.copyJson": "Скопировать JSON",
  "scan.copied": "Скопировано",
  "scan.downloadJson": "Скачать JSON",
  "scan.downloadMarkdown": "Скачать Markdown",
  "scan.openDashboard": "Открыть в дашборде",
  "scan.clean": "Ничего не найдено — репозиторий чист.",

  "batch.title": "Репозиториев вместе: {count}",
  "batch.findings": "находок всего",
  "batch.averageScore": "средний балл",
  "batch.repository": "Репозиторий",
  "batch.grade": "Оценка",
  "batch.score": "Балл",
  "batch.mostly": "В основном",
  "batch.sharedTitle": "Встречается больше чем в одном репозитории",
  "batch.sharedLead":
    "Одна проблема в одном репозитории — случайность, в нескольких — привычка. Если починить там, откуда это берётся, починится везде.",
  "batch.inRepos": "репозиториев: {count}",
  "batch.failedTitle": "не удалось просканировать: {count}",
  "batch.downloadMarkdown": "Скачать сводку (Markdown)",

  "scan.inputPlaceholder": "Найти на GitHub или вставить ссылку",
  "scan.add": "Добавить",
  "scan.added": "Добавлен",
  "scan.remove": "Убрать из списка",
  "scan.clearAll": "Очистить",
  "scan.selectedTitle": "Выбрано — {count} из {max}",
  "scan.selectedEmpty": "Пока ничего не выбрано. Найдите выше или вставьте ссылку.",
  "scan.duplicate": "Уже в списке.",
  "scan.limit": "Это предел — {max} репозиториев за раз.",
  "scan.willScan": "будет склонировано и просканировано: {count}",
  "scan.runCount": "Сканировать: {count}",

  "repo.searchHint": "Введите название, чтобы найти на GitHub, или вставьте ссылку.",
  "repo.searching": "Ищем на GitHub…",
  "repo.notFound": "На GitHub такого репозитория нет — проверьте владельца и название.",
  "repo.noResults": "На GitHub ничего не нашлось.",
  "repo.searchError": "GitHub недоступен. Ссылку можно вставить и просканировать как обычно.",
  "repo.scanThis": "Сканировать",
  "repo.archived": "В архиве",
  "repo.largeHint":
    "Большой репозиторий — клонирование и скан займут больше времени и могут не пройти на маленьком сервере. GitHub считает всю историю, поверхностный клон обычно меньше.",
  "repo.overHint":
    "Больше, чем лимит клона на этом сервере ({max} МБ), — скан скорее всего оборвётся на середине. GitHub считает всю историю, так что поверхностный клон может и уместиться, но рассчитывать на это не стоит.",
  "repo.fork": "Форк",
  "repo.stars": "Звёзды",
  "repo.forks": "Форки",
  "repo.openIssues": "Открытые issue",
  "repo.license": "Лицензия",
  "repo.lastPush": "Последний коммит {when}",
  "repo.results": "Результаты с GitHub",

  "feature.secrets.title": "Секреты и env",
  "feature.secrets.body":
    "Находит утёкшие ключи в истории и переменные окружения, которые используются, но не описаны в примере.",
  "feature.dead.title": "Мёртвый груз",
  "feature.dead.body":
    "Показывает неиспользуемые зависимости, мёртвые экспорты и долг из TODO, который тихо копится.",
  "feature.branches.title": "Заброшенные ветки",
  "feature.branches.body":
    "Отмечает брошенные ветки и динамику распада, чтобы было ясно, что можно удалять.",

  "consent.label": "Сохранить результат, чтобы им можно было поделиться по ссылке",
  "consent.body":
    "Сохраняются оценка, грейд, количество находок по категориям, заголовки 10 главных и публичный адрес репозитория. Пути к файлам, номера строк, фрагменты кода и найденные значения секретов не записываются — они остаются в этом браузере.",
  "consent.optional":
    "По желанию. Если не отмечать, отчёт останется только в этом браузере.",

  "share.action": "Поделиться",
  "share.create": "Создать ссылку",
  "share.creating": "Создаём…",
  "share.failed": "Не удалось создать ссылку. Попробуйте ещё раз.",
  "share.copy": "Скопировать ссылку",
  "share.copied": "Скопировано",
  "share.badgeTitle": "Бейдж для README",
  "share.badgeLead":
    "Показывает оценку этого скана — и продолжит показывать её. Поделитесь новым сканом, и получите новый бейдж; этот останется прежним.",
  "share.badgeCopy": "Скопировать markdown",
  "share.heading": "Здоровье репозитория",
  "verdict.clean.title": "Скан чист",
  "verdict.clean.body":
    "Ничего не найдено на объёме {scope}. Проверялись секреты, известные уязвимости, протухшие рантаймы, безопасность CI-воркфлоу, мёртвый код и гниль зависимостей.",
  "verdict.strong.title": "В хорошей форме",
  "verdict.strong.body":
    "Ни критичных, ни предупреждений на объёме {scope} — только мелких заметок: {count}.",
  "verdict.strong.bodyOne":
    "Ни критичных, ни предупреждений на объёме {scope} — только одна мелкая заметка.",
  "verdict.noScope.clean":
    "Ничего не найдено. Проверялись секреты, известные уязвимости, протухшие рантаймы, безопасность CI-воркфлоу, мёртвый код и гниль зависимостей.",
  "verdict.noScope.strong": "Ни критичных, ни предупреждений — только мелких заметок: {count}.",
  "share.scannedAt": "Скан от {date}",
  "share.rescan": "Просканировать другой репозиторий",
  "share.snapshot": "Это снимок от {date}. С тех пор репозиторий изменился.",
  "share.ageDays": "прошло дней: {days}",
  "share.freshTitle": "Посмотреть, как обстоят дела сейчас",
  "share.freshLead":
    "Запустите тот же скан по текущему коду. Ничего не сохраняется, пока вы сами не попросите ссылку.",
  "share.freshAction": "Просканировать {repo}",
  "share.checking": "Проверяем, публичен ли ещё репозиторий…",
  "share.gone":
    "Этот репозиторий больше нельзя склонировать — возможно, его сделали приватным, переименовали или удалили.",
  "share.notFound": "По этому адресу отчёта нет.",
  "share.redactedNote":
    "Это краткая сводка: фрагменты кода и значения секретов в неё не входят.",

  "grade.score": "{score}/100",
  "issues.count": "находок: {count}",
  // Unused at runtime — the "находок: N" shape above already reads correctly at
  // one. It exists so the dictionary stays complete, which is what the type
  // checks and what stops a key silently falling back to English.
  "issues.countOne": "находок: 1",
  "issues.critical": "критично",
  "issues.warning": "предупреждение",
  "issues.info": "инфо",

  "lang.label": "Язык",

  "theme.label": "Тема",
  "theme.moss": "Мох",
  "theme.ocean": "Океан",
  "theme.aurora": "Аврора",
}

export const messages: Record<Locale, Messages> = { en, ru }

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value)
}

/**
 * Look up a message, substituting `{name}` placeholders.
 *
 * An unknown locale falls back to English rather than throwing: a wrong cookie
 * value should degrade the page, not break it.
 */
export function t(
  locale: Locale,
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const table = messages[locale] ?? messages[DEFAULT_LOCALE]
  const raw = table[key] ?? messages[DEFAULT_LOCALE][key]
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  )
}

/**
 * Pick a locale from an `Accept-Language` header.
 *
 * Quality values are honoured, so `ru;q=0.4, en;q=0.9` resolves to English, and a
 * region subtag matches its base language (`ru-RU` → `ru`). Anything we do not
 * speak falls through to the default.
 */
export function negotiateLocale(header: string | null | undefined): Locale {
  if (!header) return DEFAULT_LOCALE

  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";")
      const q = params
        .map((p) => p.trim())
        .find((p) => p.startsWith("q="))
        ?.slice(2)
      const quality = q === undefined ? 1 : Number.parseFloat(q)
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(quality) ? quality : 0 }
    })
    .filter((x) => x.tag && x.q > 0)
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    const base = tag.split("-")[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

/** Resolve the locale for a request: explicit cookie choice wins over the browser's guess. */
export function resolveLocale(cookieValue: string | undefined, acceptLanguage: string | null): Locale {
  if (isLocale(cookieValue)) return cookieValue
  return negotiateLocale(acceptLanguage)
}
