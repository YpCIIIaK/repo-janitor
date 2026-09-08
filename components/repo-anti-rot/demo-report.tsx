"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowRight, CheckCircle2, Code2, Search } from "lucide-react"
import { useLocale } from "@/components/i18n/locale-provider"
import { LanguageSwitcher } from "@/components/i18n/language-switcher"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { TopBar } from "@/components/repo-anti-rot/top-bar"
import { Button } from "@/components/ui/button"
import data from "@/lib/demo-report.json"
import fixture from "@/lib/demo-fixture.json"

export function DemoReport() {
  const { locale } = useLocale()
  const router = useRouter()
  const ru = locale === "ru"
  const [phase, setPhase] = useState<"before" | "after">("before")
  const report = data[phase]
  const titles = ru
    ? ["Отладочный console.log в исходниках", "Забытый debugger", "Тест с .only исключает остальные тесты"]
    : data.before.issues.map((issue) => issue.title)
  const actions = ru
    ? ["Проверить назначение console.log и удалить отладочный вывод.", "Убрать debugger из исходников.", "Заменить it.only на it, чтобы запускались все тесты."]
    : ["Check whether console.log is debugging output and remove it if so.", "Remove the debugger statement from source.", "Replace it.only with it so all tests can run."]

  return (
    <div className="min-h-screen bg-background">
      <TopBar onHome={() => router.push("/")} extras={<><ThemeSwitcher /><LanguageSwitcher /></>} />
      <main className="mx-auto max-w-5xl space-y-8 px-4 py-10 md:px-6 md:py-16">
        <header className="max-w-3xl space-y-4">
          <span className="inline-flex items-center gap-2 rounded-full border px-3 py-1 font-mono text-xs text-muted-foreground"><Code2 className="size-3.5" />{ru ? "Интерактивный пример" : "Interactive example"}</span>
          <h1 className="text-3xl font-semibold tracking-tight md:text-5xl">{ru ? "От находки до проверенного исправления" : "From a finding to a verified fix"}</h1>
          <p className="text-base leading-relaxed text-muted-foreground">{ru ? "Небольшой учебный проект с корзиной покупок. Посмотрите, что обнаружил сканер, откройте код и сравните результат после исправлений." : "A small educational shopping-cart project. Explore the findings, inspect the code, and compare the scan after the fixes."}</p>
        </header>

        <section className="overflow-hidden rounded-xl border bg-card" aria-label={ru ? "Результат проверки" : "Scan result"}>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
            <span className="font-mono text-sm">demo / cart-example</span>
            <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label={ru ? "Версия проекта" : "Project version"}>
              {(["before", "after"] as const).map((value) => <Button key={value} size="sm" variant={phase === value ? "secondary" : "ghost"} aria-pressed={phase === value} onClick={() => setPhase(value)}>{value === "before" ? (ru ? "До исправлений" : "Before fixes") : (ru ? "После исправлений" : "After fixes")}</Button>)}
            </div>
          </div>
          <div className="grid gap-6 p-5 md:grid-cols-[180px_1fr] md:p-7" aria-live="polite">
            <div>
              <div className="font-mono text-5xl font-semibold text-emerald-500">{report.score}<span className="text-lg text-muted-foreground">/100</span></div>
              <p className="mt-2 text-sm text-muted-foreground">{ru ? "Оценка обслуживания" : "Maintenance score"} · {report.grade}</p>
            </div>
            <div className="space-y-3">
              <h2 className="text-lg font-medium">{phase === "before" ? (ru ? "3 находки: 1 предупреждение и 2 замечания" : "3 findings: 1 warning and 2 notes") : (ru ? "Все три находки устранены" : "All three findings resolved")}</h2>
              <p className="text-sm leading-relaxed text-muted-foreground">{phase === "before" ? (ru ? "Оценка остаётся высокой: отладочный мусор не делает весь проект плохим. Главное здесь — .only: часть тестов не запускается." : "The score stays high: debugging leftovers do not make the whole project unhealthy. The priority here is .only, which prevents other tests from running.") : (ru ? "Повторный запуск тех же проверок больше не находит эти проблемы. Оценка 100 относится только к трём выбранным сканерам и не доказывает безопасность проекта." : "Running the same checks again no longer finds these issues. A score of 100 covers only the three selected scanners and does not prove the project is secure.")}</p>
            </div>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-semibold">{ru ? "Находки и действия" : "Findings and actions"}</h2>
          {data.before.issues.map((issue, index) => <details key={issue.id} className="group rounded-lg border bg-card">
            <summary className="flex cursor-pointer list-none items-start gap-3 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {phase === "after" ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-500" /> : <Search className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
              <span className="flex-1"><span className="block text-sm font-medium">{titles[index]}</span><span className="mt-1 block font-mono text-xs text-muted-foreground">{issue.location}</span></span>
              <span className="text-xs text-muted-foreground">{phase === "after" ? (ru ? "Устранено" : "Resolved") : issue.severity === "warning" ? (ru ? "Предупреждение" : "Warning") : (ru ? "Замечание" : "Note")}</span>
              <span aria-hidden className="text-muted-foreground group-open:rotate-45">+</span>
            </summary>
            <div className="space-y-3 border-t px-4 py-4">
              <p className="text-sm leading-relaxed">{actions[index]}</p>
              <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs leading-relaxed"><code>{fixture[phase][issue.scanner === "skipped-tests" ? "tests/cart.test.ts" : "src/cart.ts"]}</code></pre>
            </div>
          </details>)}
        </section>

        <aside className="rounded-lg border border-dashed p-4 text-sm leading-relaxed text-muted-foreground">
          {ru ? "Это сохранённые результаты реального запуска Repo Janitor на нашем учебном примере, а не оценка стороннего репозитория. Здесь проверяются только гигиена проекта, пропущенные тесты и отладочный код. Зависимости, секреты и остальные категории в этом демо не проверялись." : "These are saved results from real Repo Janitor runs on our educational fixture, not a rating of a third-party repository. Only project hygiene, skipped tests, and debugging leftovers are checked here. Dependencies, secrets, and other categories were not scanned in this demo."}
        </aside>

        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-muted/50 p-6">
          <p className="font-medium">{ru ? "Теперь посмотрите, что происходит в вашем проекте." : "Now see what is happening in your project."}</p>
          <Button asChild><Link href="/#scan">{ru ? "Проверить репозиторий" : "Scan a repository"}<ArrowRight className="ml-2 size-4" /></Link></Button>
        </div>
      </main>
    </div>
  )
}
