import type { Issue, Severity } from "@/lib/mock-data"
import { computeScore, type SeverityWeights } from "@/lib/score"

const rank: Record<Severity, number> = { critical: 0, warning: 1, info: 2 }
type Advice = { en: string; ru: string; verifyEn: string; verifyRu: string }
const advice: Record<string, Advice> = {
  "workflow-security": {
    en: "Set explicit least-privilege workflow permissions (start with contents: read), pin external actions to reviewed commit SHAs, and keep untrusted PR code away from jobs with secrets.",
    ru: "Задайте минимальные права workflow явно (начните с contents: read), закрепите внешние actions на проверенных SHA и не запускайте код чужого PR в заданиях с секретами.",
    verifyEn: "Run the workflow on a test branch and verify that every write permission is needed by its job.",
    verifyRu: "Запустите workflow на тестовой ветке и проверьте, что каждое разрешение на запись необходимо конкретному заданию.",
  },
  "duplicate-code": {
    en: "Compare both blocks and their callers. Extract shared behavior only if they should evolve together; keep intentionally independent implementations documented.",
    ru: "Сравните оба блока и их вызывающий код. Выделяйте общую функцию, только если поведение должно меняться синхронно; намеренную независимость задокументируйте.",
    verifyEn: "Run both callers' tests and confirm their edge cases remain intact.",
    verifyRu: "Выполните тесты обоих вызывающих участков и проверьте их граничные случаи.",
  },
  "commented-code": {
    en: "Check whether this is an executable example or obsolete code. Remove obsolete commented code; keep useful examples clearly labeled as documentation.",
    ru: "Проверьте, это полезный пример или устаревший код. Удалите устаревший закомментированный код, а полезный пример явно оформите как документацию.",
    verifyEn: "Review the diff and rerun the scanner; ensure documentation examples were preserved.",
    verifyRu: "Проверьте diff и повторите скан; убедитесь, что примеры документации сохранены.",
  },
  "skipped-tests": {
    en: "Identify why the test is skipped, reproduce the failing scenario, then restore the test or attach a tracked, time-bounded exception.",
    ru: "Выясните причину пропуска теста, воспроизведите сценарий и восстановите тест либо оформите отслеживаемое исключение со сроком.",
    verifyEn: "Confirm CI actually executes the restored test and that it fails on the original regression.",
    verifyRu: "Убедитесь, что CI выполняет восстановленный тест и что он ловит исходную регрессию.",
  },
  "bus-factor": {
    en: "Add a second reviewer and document operation of the affected area. Confirm the ownership signal against full Git history before drawing conclusions.",
    ru: "Подключите второго ревьюера и задокументируйте работу участка. Перед выводами сверьте данные об авторстве с полной историей Git.",
    verifyEn: "Have another maintainer build, test and explain the area using the documentation.",
    verifyRu: "Пусть другой участник соберёт, проверит и объяснит участок по документации.",
  },
  "repo-bloat": {
    en: "Check whether the binary or generated file belongs in Git. Move appropriate artifacts to releases or external storage; coordinate any history rewrite separately.",
    ru: "Проверьте, должен ли бинарный или сгенерированный файл храниться в Git. Перенесите подходящие артефакты в релизы или внешнее хранилище; переписывание истории согласуйте отдельно.",
    verifyEn: "Measure a fresh clone and verify that builds still retrieve required artifacts.",
    verifyRu: "Измерьте размер свежего клона и проверьте получение нужных артефактов при сборке.",
  },
  secrets: {
    en: "Revoke or rotate the credential first. Replace it with a secret-store reference, then inspect Git history and access logs.",
    ru: "Сначала отзовите или замените ключ. Перенесите его в хранилище секретов, затем проверьте историю Git и журнал доступа.",
    verifyEn: "Confirm the old credential is rejected; scan both the working tree and history.",
    verifyRu: "Убедитесь, что старый ключ больше не работает; проверьте файлы и историю Git.",
  },
  dependency: {
    en: "Check whether the dependency runs in production. Choose a maintained, patched version, update the manifest and lockfile together, and review migration notes.",
    ru: "Проверьте, используется ли зависимость в продакшене. Выберите поддерживаемую исправленную версию, обновите манифест и lockfile вместе и прочитайте заметки о миграции.",
    verifyEn: "Run a clean install and relevant tests, then rescan the dependency graph.",
    verifyRu: "Выполните чистую установку и профильные тесты, затем повторно проверьте граф зависимостей.",
  },
  security: {
    en: "Inspect the reported execution path and trust boundary. Restrict permissions or validate untrusted input at the boundary; keep a regression case for the reported behavior.",
    ru: "Проверьте указанный путь выполнения и границу доверия. Ограничьте права или валидируйте внешний ввод на этой границе; сохраните регрессионный пример.",
    verifyEn: "Verify the unsafe input is rejected while the legitimate scenario still works.",
    verifyRu: "Проверьте отказ на опасном вводе и работоспособность обычного сценария.",
  },
  env: {
    en: "Compare actual environment-variable usage with the example configuration. Document required values and defaults without copying real secrets.",
    ru: "Сверьте используемые переменные окружения с примером конфигурации. Опишите обязательные значения и значения по умолчанию без настоящих секретов.",
    verifyEn: "Start with only the documented configuration and rerun the env scanner.",
    verifyRu: "Запустите проект только с документированной конфигурацией и повторите проверку env.",
  },
  branch: {
    en: "Check the branch owner and unmerged changes before archiving or deleting the stale branch.",
    ru: "Перед архивацией или удалением ветки проверьте её владельца и неслитые изменения.",
    verifyEn: "Confirm valuable commits remain reachable and rerun with complete branch history.",
    verifyRu: "Убедитесь, что нужные коммиты сохранены, и повторите проверку с полной историей веток.",
  },
  "dead-code": {
    en: "Check dynamic imports, public exports and configuration references before removing the reported code.",
    ru: "Перед удалением проверьте динамические импорты, публичные экспорты и ссылки из конфигурации.",
    verifyEn: "Build all affected entry points and run their tests after removing the code.",
    verifyRu: "Соберите все затронутые точки входа и выполните их тесты после удаления кода.",
  },
  todo: {
    en: "Turn the note into an owned task with acceptance criteria, or remove it if the work is already complete.",
    ru: "Превратите заметку в задачу с ответственным и критериями готовности либо удалите её, если работа уже сделана.",
    verifyEn: "Link the task from the code and verify the described behavior.",
    verifyRu: "Добавьте ссылку на задачу в код и проверьте описанное поведение.",
  },
  hygiene: {
    en: "Check the finding against the project's conventions, fix the affected file or configuration, and record intentional exceptions with a reason.",
    ru: "Сверьте находку с правилами проекта, исправьте файл или конфигурацию; намеренные исключения оформите с объяснением.",
    verifyEn: "Run the affected workflow or documentation check and repeat this scanner.",
    verifyRu: "Запустите соответствующий workflow или проверку документации и повторите этот сканер.",
  },
}

export function remediationPlan(issues: Issue[], weights?: SeverityWeights, locale = "en") {
  const score = computeScore(issues, weights)
  return [...issues].sort((a, b) => rank[a.severity] - rank[b.severity] || b.ageDays - a.ageDays || a.id.localeCompare(b.id)).slice(0, 5).map((issue) => {
    const entry = advice[issue.scanner ?? ""] || advice[issue.category] || advice.hygiene
    return {
      issue,
      action: locale === "ru" ? entry.ru : entry.en,
      verify: locale === "ru" ? entry.verifyRu : entry.verifyEn,
      scoreGain: computeScore(issues.filter((other) => other.id !== issue.id), weights) - score,
    }
  })
}
