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
  "scan.famousLead": "Or try a known public repo — pick one, or compare two:",
  "scan.famousCompare": "Compare express vs zod",
  "scan.firstLookTitle": "Stay in the loop",
  "scan.firstLookLead":
    "Watch for drops and share a badge before diving into every finding. The full list is below.",
  "scan.quickWinsTitle": "Fix these first",
  "scan.showAllFindings": "Show all {count} findings",
  "scan.showFewer": "Show fewer",
  "scan.debtHint": "≈{debt} to clear",
  "scan.resultLead":
    "Findings, watch, share, and history live in the dashboard — this card is just the grade.",
  "scan.checksTitle": "Checks",
  "scan.checksAll": "all {total}",
  "scan.checksPartial": "{count} of {total}",
  "scan.checksLead":
    "Pick which scanners to run. Full scans are more complete; a subset is faster.",
  "scan.presetAll": "All checks",
  "scan.presetSecurity": "Security only",
  "scan.presetFast": "Fast pack",

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


  // What the scan actually covers. The landing page used to show three vague
  // cards for a tool that runs 26 checks, which undersold it and told a visitor
  // nothing they could judge. Scanner ids are printed verbatim: they are the
  // same strings the CLI, the JSON report and .repo-anti-rot.json use.
  // Where a score stands. Four cuts × two directions, written out rather than
  // assembled from fragments — a sentence stitched from clauses reads like one,
  // and this one is the first thing on the report.
  "pct.worse.languageSize": "Worse than {percent}% of {language} repositories this size",
  "pct.worse.language": "Worse than {percent}% of {language} repositories scanned",
  "pct.worse.size": "Worse than {percent}% of repositories this size",
  "pct.worse.all": "Worse than {percent}% of everything scanned",
  "pct.better.languageSize": "Better than {percent}% of {language} repositories this size",
  "pct.better.language": "Better than {percent}% of {language} repositories scanned",
  "pct.better.size": "Better than {percent}% of repositories this size",
  "pct.better.all": "Better than {percent}% of everything scanned",
  "pct.sample": "out of {count} scans",

  "landing.checks.title": "{count} checks, in six families",
  "landing.checks.lead":
    "Every one is calibrated against real repositories before it ships — the rule only stays if it stays quiet on projects that are doing it right.",
  "landing.cat.security.title": "Security",
  "landing.cat.security.body":
    "Credentials committed to the working tree or buried in history, dependencies with published advisories, dangerous constructs in your own code, and workflows that hand a stranger your token.",
  "landing.cat.deps.title": "Dependencies",
  "landing.cat.deps.body":
    "Packages that stopped being maintained, runtimes past their end-of-life date, lockfiles that disagree with the manifest, and licenses that are incompatible with the one you ship under.",
  "landing.cat.ci.title": "CI & configuration",
  "landing.cat.ci.body":
    "Whether the green badge means anything: silenced failures, tests no workflow runs, and two config files where one is silently ignored.",
  "landing.cat.docs.title": "Documentation",
  "landing.cat.docs.body":
    "Instructions that no longer work — a documented script that does not exist, a badge for a deleted workflow, links that have gone dead.",
  "landing.cat.decay.title": "Decay over time",
  "landing.cat.decay.body":
    "The findings that appear on their own, with no commit behind them: branches nobody came back to, TODOs that aged into archaeology, files only one person has ever touched.",
  "landing.cat.code.title": "Code weight",
  "landing.cat.code.body":
    "Exports nothing imports, blocks duplicated verbatim, commented-out code, forgotten debug statements and disabled tests.",

  "landing.grade.title": "How the grade is worked out",
  "landing.grade.lead":
    "A score out of 100, starting at 100 and losing points per finding: {critical} for a critical, {warning} for a warning, {info} for an info note. Past the first few of a kind, each additional finding costs less than the last — so a pile of small notes can never cost a whole grade band, and none of them is ever free.",

  "landing.privacy.title": "What happens to your code",
  "landing.privacy.clone":
    "The repository is cloned into a temporary directory on the server, read, and deleted when the scan finishes. Nothing is kept.",
  "landing.privacy.report":
    "The report stays in this browser. It is stored on the server only if you tick the share box, and then only as a summary — no file paths, no snippets.",
  "landing.privacy.usage":
    "Two rows per scan, in two tables that cannot be joined. One counts usage: a random browser id, the event, and the repository name — no score. The other records the result's shape — score, grade, main language, size band, findings per severity — with no name, no address and no browser id, so a score is never attached to a project. Never file paths, code, IP addresses or user agents.",

  "landing.ci.title": "Run it in CI instead",
  "landing.ci.lead":
    "The same engine runs as a GitHub Action on every push: it fails the build below a grade you choose, uploads SARIF so findings appear in the Security tab, and comments the breakdown on the pull request.",
  "landing.ci.badge":
    "Scans from CI also keep a health badge current — the one at the top of this project's own README.",
  "landing.ci.repo": "Setup is in the README",

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
  "share.existsOtherDevice":
    "A share link already exists for this repository. Open it from the browser that created it to update or revoke.",
  "share.copy": "Copy link",
  "share.copied": "Copied",
  "share.liveTitle": "Live share link",
  "share.liveLead":
    "One stable URL for this repository. New scans from this browser refresh the snapshot — README badges stay the same.",
  "share.update": "Update snapshot",
  "share.updating": "Updating…",
  "share.updated": "Snapshot updated.",
  "share.revoke": "Revoke link",
  "share.revokeFailed": "Could not revoke the link. Try again.",
  "share.revoked": "Share link revoked. You can create a new one below.",
  "share.rotate": "New URL",
  "share.rotateHint":
    "“New URL” invalidates the old link (and any README badge/card pointing at it). Prefer Update when you only need a fresher snapshot.",
  "share.rotated":
    "New public URL minted. Re-copy the badge/card markdown into your README — the old token now shows “unknown”.",
  "share.widgetsLabel": "README widgets",
  "share.tabBadge": "Badge",
  "share.tabCard": "Card",
  "share.tabEmbed": "Embed",
  "share.cardTitle": "Card for your README",
  "share.cardLead":
    "Larger plaque — grade, score, severity. Paste this markdown (not the small badge URL). After Update snapshot, re-copy if GitHub still shows old numbers.",
  "share.cardCopy": "Copy markdown",
  "share.embedTitle": "Embed on a website",
  "share.embedLead":
    "Mini dashboard iframe for docs or a status page. GitHub READMEs strip iframes — use the Card tab there.",
  "share.embedCopy": "Copy HTML",
  "share.badgeTitle": "Small badge",
  "share.badgeLead":
    "Shields-style strip for the title line. Same share token as the card — one live link per repo. If it says “unknown”, the token was rotated or doesn’t match owner/name.",
  "share.badgeCopy": "Copy markdown",
  "watch.title": "Watch for drops",
  "watch.lead":
    "Grade slipped? We’ll email you. No account — just this address and an unsubscribe link.",
  "watch.emailPlaceholder": "you@example.com",
  "watch.submit": "Watch",
  "watch.submitting": "Saving…",
  "watch.success": "Watching this repository",
  "watch.successLead": "You’ll get mail only when the score drops meaningfully.",
  "watch.manageLink": "Manage your watches",
  "watch.failed": "Could not save the watch. Try again.",
  "watch.pageTitle": "Your watches",
  "watch.pageLead": "Subscriptions for this email. Unsubscribe any time — no password.",
  "watch.pageEmpty": "No watches on this link.",
  "watch.pageUnsub": "Unsubscribe",
  "watch.pageScan": "Scan now",
  "watch.pageLastChecked": "Last checked {date}",
  "watch.pageBaseline": "Baseline {grade} {score}",
  "watch.magicTitle": "Email me my watches",
  "watch.magicSubmit": "Send link",
  "watch.magicSent": "If that address has watches, the link is on its way.",
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
  "gradeCard.scanned": "Scanned {when}",
  "gradeCard.notes": "notes",
  "gradeCard.points": "−{points}",
  "gradeCard.taperNote": "Each additional finding of a kind costs less than the last — never nothing, so clearing any of them still helps.",
  "gradeCard.clean": "No secrets, known vulnerabilities, end-of-life runtimes or workflow security issues found.",
  "gradeCard.cleanScoped": "No secrets, known vulnerabilities, end-of-life runtimes or workflow security issues found across {scope}.",
  "gradeLabel.A": "Pristine",
  "gradeLabel.B": "Healthy",
  "gradeLabel.C": "Aging",
  "gradeLabel.D": "Rotting",
  "gradeLabel.F": "Critical decay",
  "issues.count": "{count} findings",
  // English needs the singular spelled out. Russian sidesteps it with the
  // "находок: N" shape, which is why there is no matching key there.
  "issues.countOne": "1 finding",
  "issues.critical": "critical",
  "issues.warning": "warning",
  "issues.info": "info",

  "lang.label": "Language",

  "theme.label": "Theme",
  "theme.group.dark": "Dark",
  "theme.group.light": "Light",
  "theme.moss": "Moss",
  "theme.ocean": "Ocean",
  "theme.aurora": "Aurora",
  "theme.ember": "Ember",
  "theme.plum": "Plum",
  "theme.rose": "Rose",
  "theme.paper": "Paper",
  "theme.chalk": "Chalk",
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
  "scan.famousLead": "Или возьмите известный публичный репо — один или сравнение двух:",
  "scan.famousCompare": "Сравнить express и zod",
  "scan.firstLookTitle": "Оставайтесь в курсе",
  "scan.firstLookLead":
    "Сначала подписка на падения и бейдж — полный список находок ниже.",
  "scan.quickWinsTitle": "Сначала починить",
  "scan.showAllFindings": "Показать все {count}",
  "scan.showFewer": "Свернуть",
  "scan.debtHint": "≈{debt} на закрытие",
  "scan.resultLead":
    "Находки, watch, share и история — в дашборде. Здесь только оценка.",
  "scan.checksTitle": "Проверки",
  "scan.checksAll": "все {total}",
  "scan.checksPartial": "{count} из {total}",
  "scan.checksLead":
    "Выберите, какие сканеры запускать. Полный скан полнее; подмножество — быстрее.",
  "scan.presetAll": "Все проверки",
  "scan.presetSecurity": "Только security",
  "scan.presetFast": "Быстрый набор",

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


  "pct.worse.languageSize": "Хуже, чем {percent}% {language}-репозиториев такого же размера",
  "pct.worse.language": "Хуже, чем {percent}% просканированных {language}-репозиториев",
  "pct.worse.size": "Хуже, чем {percent}% репозиториев такого же размера",
  "pct.worse.all": "Хуже, чем {percent}% всего просканированного",
  "pct.better.languageSize": "Лучше, чем {percent}% {language}-репозиториев такого же размера",
  "pct.better.language": "Лучше, чем {percent}% просканированных {language}-репозиториев",
  "pct.better.size": "Лучше, чем {percent}% репозиториев такого же размера",
  "pct.better.all": "Лучше, чем {percent}% всего просканированного",
  "pct.sample": "из {count} сканов",

  "landing.checks.title": "{count} проверок, шесть семейств",
  "landing.checks.lead":
    "Каждая откалибрована на живых репозиториях до выхода: правило остаётся, только если молчит на проектах, где всё сделано правильно.",
  "landing.cat.security.title": "Безопасность",
  "landing.cat.security.body":
    "Ключи в рабочем дереве и в истории коммитов, зависимости с опубликованными адвизори, опасные конструкции в вашем коде и воркфлоу, отдающие токен постороннему.",
  "landing.cat.deps.title": "Зависимости",
  "landing.cat.deps.body":
    "Пакеты, которые перестали поддерживать; рантаймы, снятые с поддержки; локфайл, разошедшийся с манифестом; лицензии, несовместимые с вашей собственной.",
  "landing.cat.ci.title": "CI и конфигурация",
  "landing.cat.ci.body":
    "Значит ли что-нибудь зелёная галка: заглушённые падения, тесты, которых не гоняет ни один воркфлоу, и два конфига, один из которых молча игнорируется.",
  "landing.cat.docs.title": "Документация",
  "landing.cat.docs.body":
    "Инструкции, которые больше не работают: описанный скрипт, которого нет; бейдж удалённого воркфлоу; ссылки, которые больше не открываются.",
  "landing.cat.decay.title": "Распад во времени",
  "landing.cat.decay.body":
    "Находки, которые появляются сами, без единого коммита: ветки, к которым не вернулись; TODO, состарившиеся до археологии; файлы, которые трогал один человек.",
  "landing.cat.code.title": "Вес кода",
  "landing.cat.code.body":
    "Экспорты, которые никто не импортирует; дословно продублированные блоки; закомментированный код, забытая отладка и отключённые тесты.",

  "landing.grade.title": "Как считается оценка",
  "landing.grade.lead":
    "Сто баллов, из которых вычитается за каждую находку: {critical} за критичную, {warning} за предупреждение, {info} за заметку. После первых нескольких находок одного вида каждая следующая стоит меньше предыдущей — поэтому россыпь мелочи не может стоить целой ступени грейда, но и бесплатной не становится ни одна.",

  "landing.privacy.title": "Что происходит с вашим кодом",
  "landing.privacy.clone":
    "Репозиторий клонируется во временную папку на сервере, читается и удаляется по завершении скана. Ничего не остаётся.",
  "landing.privacy.report":
    "Отчёт остаётся в этом браузере. На сервер он попадает, только если вы отметите галочку «поделиться», и только выжимкой — без путей к файлам и фрагментов кода.",
  "landing.privacy.usage":
    "На скан пишутся две строки, в две таблицы, которые нельзя связать. Первая считает использование: случайный идентификатор браузера, событие и имя репозитория — без оценки. Вторая — форму результата: оценку, грейд, основной язык, класс размера, количество находок по severity — без имени, адреса и идентификатора браузера, так что оценка ни к какому проекту не привязывается. Никогда — пути к файлам, код, IP-адреса и user-agent.",

  "landing.ci.title": "Или запускайте в CI",
  "landing.ci.lead":
    "Тот же движок работает GitHub Action на каждый пуш: роняет сборку ниже выбранного грейда, выгружает SARIF — находки появляются во вкладке Security — и комментирует разбивку в пул-реквесте.",
  "landing.ci.badge":
    "Сканы из CI держат бейдж здоровья актуальным — тот самый, что стоит в README этого проекта.",
  "landing.ci.repo": "Настройка описана в README",

  "consent.label": "Сохранить результат, чтобы им можно было поделиться по ссылке",
  "consent.body":
    "Сохраняются оценка, грейд, количество находок по категориям, заголовки 10 главных и публичный адрес репозитория. Пути к файлам, номера строк, фрагменты кода и найденные значения секретов не записываются — они остаются в этом браузере.",
  "consent.optional":
    "По желанию. Если не отмечать, отчёт останется только в этом браузере.",

  "share.action": "Поделиться",
  "share.create": "Создать ссылку",
  "share.creating": "Создаём…",
  "share.failed": "Не удалось создать ссылку. Попробуйте ещё раз.",
  "share.existsOtherDevice":
    "Ссылка для этого репозитория уже есть. Откройте её в браузере, где создавали, чтобы обновить или отозвать.",
  "share.copy": "Скопировать ссылку",
  "share.copied": "Скопировано",
  "share.liveTitle": "Живая ссылка",
  "share.liveLead":
    "Один стабильный URL на репозиторий. Новые сканы из этого браузера обновляют снимок — бейджи в README не меняются.",
  "share.update": "Обновить снимок",
  "share.updating": "Обновляем…",
  "share.updated": "Снимок обновлён.",
  "share.revoke": "Отозвать ссылку",
  "share.revokeFailed": "Не удалось отозвать ссылку. Попробуйте ещё раз.",
  "share.revoked": "Ссылка отозвана. Ниже можно создать новую.",
  "share.rotate": "Новый URL",
  "share.rotateHint":
    "«Новый URL» инвалидирует старую ссылку (и бейдж/карточку в README). Если нужен только свежий снимок — жмите «Обновить».",
  "share.rotated":
    "Выпущен новый публичный URL. Заново вставьте markdown бейджа/карточки в README — старый токен теперь показывает «unknown».",
  "share.widgetsLabel": "Виджеты для README",
  "share.tabBadge": "Бейдж",
  "share.tabCard": "Карточка",
  "share.tabEmbed": "Embed",
  "share.cardTitle": "Карточка для README",
  "share.cardLead":
    "Крупная плашка — оценка, балл, severity. Вставляйте этот markdown (не URL маленького бейджа). После «Обновить снимок» перекопируйте, если GitHub ещё показывает старые цифры.",
  "share.cardCopy": "Скопировать markdown",
  "share.embedTitle": "Встроить на сайт",
  "share.embedLead":
    "Мини-дашборд в iframe для документации или status page. В README GitHub iframe вырезает — там вкладка «Карточка».",
  "share.embedCopy": "Скопировать HTML",
  "share.badgeTitle": "Маленький бейдж",
  "share.badgeLead":
    "Узкая полоска shields для строки заголовка. Тот же токен, что у карточки — одна живая ссылка на репо. Если «unknown» — токен сменили или не совпал owner/name.",
  "share.badgeCopy": "Скопировать markdown",
  "watch.title": "Следить за падениями",
  "watch.lead":
    "Оценка упала — пришлём письмо. Без аккаунта: только адрес и ссылка отписки.",
  "watch.emailPlaceholder": "you@example.com",
  "watch.submit": "Следить",
  "watch.submitting": "Сохраняем…",
  "watch.success": "Следим за этим репозиторием",
  "watch.successLead": "Письмо только при заметном падении оценки.",
  "watch.manageLink": "Управлять подписками",
  "watch.failed": "Не удалось сохранить. Попробуйте ещё раз.",
  "watch.pageTitle": "Ваши подписки",
  "watch.pageLead": "Подписки на этот адрес. Отписаться можно в любой момент — пароля нет.",
  "watch.pageEmpty": "На этой ссылке нет подписок.",
  "watch.pageUnsub": "Отписаться",
  "watch.pageScan": "Сканировать",
  "watch.pageLastChecked": "Проверено {date}",
  "watch.pageBaseline": "База {grade} {score}",
  "watch.magicTitle": "Прислать ссылку на подписки",
  "watch.magicSubmit": "Отправить",
  "watch.magicSent": "Если на этом адресе есть подписки — ссылка уже в пути.",
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
  "gradeCard.scanned": "Скан {when}",
  "gradeCard.notes": "заметок",
  "gradeCard.points": "−{points}",
  "gradeCard.taperNote": "Каждая следующая находка того же вида стоит дешевле предыдущей — но не бесплатна, поэтому убрать любую из них всё равно полезно.",
  "gradeCard.clean": "Ни секретов, ни известных уязвимостей, ни устаревших рантаймов, ни проблем с безопасностью workflow.",
  "gradeCard.cleanScoped": "Ни секретов, ни известных уязвимостей, ни устаревших рантаймов, ни проблем с безопасностью workflow — на объёме {scope}.",
  "gradeLabel.A": "Безупречно",
  "gradeLabel.B": "Здоров",
  "gradeLabel.C": "Стареет",
  "gradeLabel.D": "Гниёт",
  "gradeLabel.F": "Распад",
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
  "theme.group.dark": "Тёмные",
  "theme.group.light": "Светлые",
  "theme.moss": "Мох",
  "theme.ocean": "Океан",
  "theme.aurora": "Аврора",
  "theme.ember": "Янтарь",
  "theme.plum": "Слива",
  "theme.rose": "Роза",
  "theme.paper": "Бумага",
  "theme.chalk": "Мел",
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
