import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

interface Coverage {
  records: number
  inventories: number
  metadataSnapshots: number
  auditedMetadataSnapshots: number
  legacyMetadataSnapshots: number
  policyLimitedMetadataSnapshots: number
  metadataOldestDay: string | null
  metadataNewestDay: string | null
  formats: { name: string; records: number; files: number }[]
}

const copy = {
  en: {
    title: "What is in the dataset",
    note: "Technology and snapshot counts refer to pinned scan records, including historical aliases. A project can contain several technologies.",
    unique: "distinct GitHub projects", records: "pinned scan records", aliases: "historical alias records",
    footprint: "Technology footprint", format: "language / format", repos: "records with files", files: "files present",
    footprintNote: "File extensions across the pinned trees, including secondary languages, generated code and vendored files. This measures file presence, not files analysed or equal security coverage across languages.",
    snapshots: "Snapshot completeness", inventory: "file inventories at the pinned commit", metadata: "external metadata snapshots at the pinned commit",
    audited: "snapshots with a successful transport audit", legacy: "legacy snapshots without a transport audit", limited: "snapshots with provider response-size limits",
    date: "External metadata was checked between", and: "and",
    limits: "A successful transport audit verifies requests, not vulnerability coverage. Older snapshots predate that audit. Response limits can omit metadata; a missing finding is not proof of safety. These dates describe dependency and license lookups, not the date of the latest commit.",
  },
  ru: {
    title: "Из чего состоит набор данных",
    note: "Числа для технологий и снимков относятся к записям сканов на закреплённых коммитах, включая исторические псевдонимы. В одном проекте может быть несколько технологий.",
    unique: "уникальных проектов GitHub", records: "записей сканов", aliases: "исторических записей под другими именами",
    footprint: "Технологии во всех файлах", format: "язык / формат", repos: "записей с такими файлами", files: "файлов в дереве",
    footprintNote: "Расширения файлов на закреплённых коммитах, включая второстепенные языки, сгенерированный код и сторонние библиотеки. Это наличие файлов, а не число проанализированных файлов или равное покрытие языков проверками безопасности.",
    snapshots: "Полнота снимков", inventory: "инвентаризаций файлов на закреплённом коммите", metadata: "снимков внешних метаданных на закреплённом коммите",
    audited: "снимков с успешным аудитом сетевых запросов", legacy: "старых снимков без аудита запросов", limited: "снимков с ограничением размера ответа провайдера",
    date: "Внешние метаданные проверялись с", and: "по",
    limits: "Аудит подтверждает выполнение запросов, а не полноту поиска уязвимостей. Старые снимки сделаны до появления аудита. Лимиты ответа могут исключать часть метаданных; отсутствие предупреждения не доказывает безопасность. Эти даты относятся к проверкам зависимостей и лицензий, а не к последнему коммиту проекта.",
  },
}

export function BenchmarkCoverage({ coverage, unique, aliases, locale }: {
  coverage: Coverage; unique: number; aliases: number; locale: "en" | "ru"
}) {
  const t = copy[locale]
  const number = (value: number) => value.toLocaleString(locale === "ru" ? "ru-RU" : "en-US")
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.title}</CardTitle>
        <CardDescription>{t.note}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid gap-4 sm:grid-cols-3">
          {[[unique, t.unique], [coverage.records, t.records], [aliases, t.aliases]].map(([value, label]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="font-mono text-2xl font-semibold tabular-nums">{number(Number(value))}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-3">
          <h3 className="font-medium">{t.footprint}</h3>
          <p className="text-sm text-muted-foreground">{t.footprintNote}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-muted-foreground">
                <th scope="col" className="pb-2 font-medium">{t.format}</th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">{t.repos}</th>
                <th scope="col" className="pb-2 pl-3 text-right font-medium">{t.files}</th>
              </tr></thead>
              <tbody>{coverage.formats.map(row => (
                <tr key={row.name} className="border-t border-border">
                  <th scope="row" className="py-1.5 text-left font-normal">{row.name}</th>
                  <td className="pl-3 text-right font-mono tabular-nums">{number(row.records)}</td>
                  <td className="pl-3 text-right font-mono tabular-nums">{number(row.files)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
        <div className="space-y-3">
          <h3 className="font-medium">{t.snapshots}</h3>
          <dl className="space-y-2 text-sm">
            {[
              [coverage.inventories, t.inventory], [coverage.metadataSnapshots, t.metadata],
              [coverage.auditedMetadataSnapshots, t.audited], [coverage.legacyMetadataSnapshots, t.legacy],
              [coverage.policyLimitedMetadataSnapshots, t.limited],
            ].map(([value, label]) => (
              <div key={label} className="flex justify-between gap-4">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="shrink-0 font-mono tabular-nums">{number(Number(value))}</dd>
              </div>
            ))}
          </dl>
          {coverage.metadataOldestDay && coverage.metadataNewestDay && (
            <p className="text-sm text-muted-foreground">{t.date} <time dateTime={coverage.metadataOldestDay}>{coverage.metadataOldestDay}</time> {t.and} <time dateTime={coverage.metadataNewestDay}>{coverage.metadataNewestDay}</time>.</p>
          )}
          <p className="text-xs text-muted-foreground">{t.limits}</p>
        </div>
      </CardContent>
    </Card>
  )
}
