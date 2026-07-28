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
    "Paste one or more public git repository URLs, one per line. Each is cloned and scanned by the Repo Anti-Rot engine — no mock data.",
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
    "Stores the grade, score, counts per category and the titles of the top 10 findings. File paths, line numbers, code snippets and matched secret values are never written — they stay in this browser.",
  "consent.optional": "Optional. Leave it off and the report stays in this browser only.",

  "share.action": "Share",
  "share.create": "Create share link",
  "share.creating": "Creating…",
  "share.failed": "Could not create the link. Try again.",
  "share.copy": "Copy link",
  "share.copied": "Copied",
  "share.heading": "Repository health",
  "share.scannedAt": "Scanned {date}",
  "share.rescan": "Scan another repository",
  "share.notFound": "No shared report at this address.",
  "share.redactedNote":
    "This is a shared summary: code evidence and secret values are not included.",

  "grade.score": "{score}/100",
  "issues.count": "{count} findings",
  "issues.critical": "critical",
  "issues.warning": "warning",
  "issues.info": "info",

  "lang.label": "Language",
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
    "Вставьте ссылки на публичные git-репозитории, по одной в строке. Каждый будет склонирован и просканирован движком Repo Anti-Rot — без выдуманных данных.",
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
    "Сохраняются оценка, грейд, количество находок по категориям и заголовки 10 главных. Пути к файлам, номера строк, фрагменты кода и найденные значения секретов не записываются — они остаются в этом браузере.",
  "consent.optional":
    "По желанию. Если не отмечать, отчёт останется только в этом браузере.",

  "share.action": "Поделиться",
  "share.create": "Создать ссылку",
  "share.creating": "Создаём…",
  "share.failed": "Не удалось создать ссылку. Попробуйте ещё раз.",
  "share.copy": "Скопировать ссылку",
  "share.copied": "Скопировано",
  "share.heading": "Здоровье репозитория",
  "share.scannedAt": "Скан от {date}",
  "share.rescan": "Просканировать другой репозиторий",
  "share.notFound": "По этому адресу отчёта нет.",
  "share.redactedNote":
    "Это краткая сводка: фрагменты кода и значения секретов в неё не входят.",

  "grade.score": "{score}/100",
  "issues.count": "находок: {count}",
  "issues.critical": "критично",
  "issues.warning": "предупреждение",
  "issues.info": "инфо",

  "lang.label": "Язык",
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
