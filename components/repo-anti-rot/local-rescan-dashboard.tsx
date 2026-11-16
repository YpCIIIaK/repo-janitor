"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { TopBar } from "./top-bar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ThemeSwitcher } from "@/components/theme-switcher"
import { LanguageSwitcher } from "@/components/i18n/language-switcher"
import { useLocale } from "@/components/i18n/locale-provider"
import type { LocalRun, LocalTarget } from "@/lib/local-rescan-types"

const endpoint = "/api/local-rescan"
async function api(query = "", body?: unknown) {
  const response = await fetch(endpoint + query, body ? {
    method: "POST", headers: { "content-type": "application/json", "x-repo-janitor-local": "1" }, body: JSON.stringify(body),
  } : { cache: "no-store" })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data
}
const STATUS: Record<string, [string, string]> = {
  queued: ["Queued", "В очереди"], preparing: ["Copying baseline", "Копирование исходных данных"], running: ["Running", "Выполняется"],
  paused: ["Paused", "На паузе"], interrupted: ["Interrupted", "Прерван"], cancelled: ["Stopped", "Остановлен"],
  pausing: ["Waiting for active tasks", "Ожидание текущих задач"], stopping: ["Stopping", "Останавливается"],
  completed: ["Complete", "Завершён"], completed_with_errors: ["Finished with errors", "Завершён с ошибками"], failed: ["Failed", "Ошибка"], done: ["Done", "Готово"],
}
function duration(ms: number) {
  const minutes = Math.max(0, Math.floor(ms / 60_000))
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

export function LocalRescanDashboard() {
  const router = useRouter()
  const { locale } = useLocale(), ru = locale === "ru"
  const tr = (en: string, russian: string) => ru ? russian : en
  const [repos, setRepos] = useState<LocalTarget[]>([]), [scanners, setScanners] = useState<string[]>([])
  const [baseline, setBaseline] = useState(0), [loaded, setLoaded] = useState(false)
  const [scope, setScope] = useState("all"), [filter, setFilter] = useState("")
  const [chosen, setChosen] = useState<Set<string>>(new Set()), [imported, setImported] = useState<LocalTarget[]>([])
  const [mode, setMode] = useState("changed"), [selectedScanners, setSelectedScanners] = useState<Set<string>>(new Set())
  const [baselineRun, setBaselineRun] = useState("")
  const [jobs, setJobs] = useState(4), [minFreeGiB, setMinFreeGiB] = useState(2), [timeoutMinutes, setTimeoutMinutes] = useState(30)
  const [refreshMetadata, setRefreshMetadata] = useState(false), [runs, setRuns] = useState<LocalRun[]>([])
  const [activeId, setActiveId] = useState(""), [error, setError] = useState(""), [busy, setBusy] = useState(false)
  const [log, setLog] = useState(""), [logRepo, setLogRepo] = useState("")
  const refresh = useCallback(async () => { const data = await api(); setRuns(data.runs) }, [])
  useEffect(() => {
    let disposed = false
    api("?catalog=1").then(data => {
      if (!disposed) { setRepos(data.repos); setScanners(data.scanners); setBaseline(data.baselineRecords); setLoaded(true) }
    }).catch(error => { if (!disposed) setError(error.message) })
    const poll = () => refresh().catch(error => { if (!disposed) setError(error.message) })
    poll(); const timer = setInterval(poll, 2500)
    return () => { disposed = true; clearInterval(timer) }
  }, [refresh])
  const filtered = useMemo(() => repos.filter(repo => `${repo.name} ${repo.url}`.toLowerCase().includes(filter.toLowerCase())), [repos, filter])
  const selection = scope === "imported" ? imported : scope === "scanned" ? repos.filter(repo => repo.scanned) : scope === "selected" ? repos.filter(repo => chosen.has(repo.name)) : repos
  const run = runs.find(item => item.id === activeId) ?? runs[0]
  const runId = run?.id
  useEffect(() => {
    if (!runId || !logRepo) return
    let disposed = false
    const timer = setInterval(() => {
      api(`?id=${runId}&repo=${encodeURIComponent(logRepo)}`).then(data => {
        if (!disposed) setLog(data.log)
      }).catch(() => { /* The main status poll reports connection failures. */ })
    }, 2500)
    return () => { disposed = true; clearInterval(timer) }
  }, [runId, logRepo])
  const working = runs.some(item => ["preparing", "running", "pausing", "stopping"].includes(item.status))
  const status = (value: string) => STATUS[value]?.[ru ? 1 : 0] ?? value
  const act = async (action: string) => {
    setBusy(true); setError("")
    try {
      if (action === "create") {
        const config = { names: selection.map(repo => repo.name), ...(scope === "imported" ? { targets: imported } : {}), mode, jobs, minFreeGiB, timeoutMinutes, refreshMetadata, scanners: [...selectedScanners], baselineRun: baselineRun || null }
        const data = await api("", { action, config }); setActiveId(data.id)
      } else await api("", { action, id: run?.id })
      await refresh()
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const showLog = async (name: string) => {
    try { const data = await api(`?id=${run.id}&repo=${encodeURIComponent(name)}`); setLogRepo(name); setLog(data.log) }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  const elapsed = run?.activeMs ?? 0
  const processed = run ? run.done + run.failed : 0
  const eta = processed >= 5 ? elapsed / processed * (run?.pending ?? 0) : null
  const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
  const tasks = run ? [...run.active, ...run.recent].filter((task, index, all) => all.findIndex(row => row.name === task.name) === index) : []

  return <div className="min-h-screen">
    <TopBar onHome={() => router.push("/")} extras={<><a href="/state" className="text-sm hover:underline">/state</a><ThemeSwitcher /><LanguageSwitcher /></>} />
    <main className="mx-auto max-w-6xl space-y-6 p-4 py-8">
      <header className="space-y-2"><h1 className="text-3xl font-semibold">{tr("Local rescan", "Локальный рескан")}</h1><p className="max-w-3xl text-muted-foreground">{tr("Runs on this computer. Each run freezes the scanner and copies its baseline into an isolated workspace. Published scans are never overwritten.", "Работает на этом компьютере. Каждый запуск сохраняет копию сканера и исходных результатов в отдельном каталоге. Готовые сканы не перезаписываются.")}</p></header>
      {error && <p role="alert" className="rounded-md border border-destructive/40 p-3 text-sm text-destructive">{error}</p>}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Card><CardHeader><CardTitle>{tr("New run", "Новый запуск")}</CardTitle></CardHeader><CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">{tr("Baseline snapshots found", "Найдено исходных снимков")}: {baseline.toLocaleString()} / {repos.length.toLocaleString()}</p>
          <label className="block space-y-1 text-sm"><span>{tr("Baseline results", "Исходные результаты")}</span><select className={field} value={baselineRun} onChange={event => setBaselineRun(event.target.value)}>
            <option value="">{tr("Published / existing benchmark", "Опубликованные / существующие benchmark-сканы")}</option>
            {runs.filter(item => item.status === "completed").map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {item.total} · {item.id.slice(0, 8)}</option>)}
          </select></label>
          {loaded && baseline === 0 && <p className="text-sm text-warning">{tr("No baseline installed. Missing repositories will be scanned from scratch; restore the benchmark archive first to reuse old scans.", "Исходные сканы не установлены. Недостающие репозитории будут проверены с нуля; восстановите benchmark-архив, чтобы использовать старые результаты.")}</p>}
          <label className="block space-y-1 text-sm"><span>{tr("Repositories", "Репозитории")}</span><select className={field} value={scope} onChange={event => setScope(event.target.value)}>
            <option value="all">{tr("Entire corpus", "Весь корпус")}</option><option value="scanned">{tr("Previously scanned only", "Только уже просканированные")}</option><option value="selected">{tr("Select repositories", "Выбрать репозитории")}</option>{imported.length > 0 && <option value="imported">{tr("Imported pinned list", "Импортированный список")}</option>}
          </select></label>
          <label className="block space-y-1 text-sm"><span>{tr("Import pinned JSON", "Импортировать JSON")}</span><input className="block w-full text-xs" type="file" accept=".json,application/json" onChange={async event => {
            const file = event.target.files?.[0]; if (!file) return
            try { const rows = JSON.parse(await file.text()); if (!Array.isArray(rows) || !rows.length) throw new Error("Expected a non-empty JSON array"); setImported(rows); setScope("imported") } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
          }} /><span className="text-xs text-muted-foreground">{tr("Array of {name, url, sha}; public GitHub URLs and full 40-character commit SHAs.", "Массив {name, url, sha}; публичные ссылки GitHub и полные SHA коммитов из 40 символов.")}</span></label>
          {scope === "selected" && <div className="space-y-2">
            <Input aria-label={tr("Filter repositories", "Поиск репозиториев")} placeholder={tr("Owner or repository", "Владелец или название")} value={filter} onChange={event => setFilter(event.target.value)} />
            <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => setChosen(new Set([...chosen, ...filtered.map(repo => repo.name)]))}>{tr("Select filtered", "Выбрать найденные")}</Button><Button variant="ghost" size="sm" onClick={() => setChosen(new Set())}>{tr("Clear", "Снять выбор")}</Button></div>
            <div className="max-h-52 overflow-auto rounded-md border p-2">{filtered.slice(0, 150).map(repo => <label key={repo.name} className="flex gap-2 py-1 text-xs"><input type="checkbox" checked={chosen.has(repo.name)} onChange={event => setChosen(previous => { const next = new Set(previous); if (event.target.checked) next.add(repo.name); else next.delete(repo.name); return next })} /><span className="break-all">{repo.name}</span></label>)}{filtered.length > 150 && <p className="text-xs text-muted-foreground">150 / {filtered.length.toLocaleString()}</p>}</div>
          </div>}
          <label className="block space-y-1 text-sm"><span>{tr("Scan mode", "Режим проверки")}</span><select className={field} value={mode} onChange={event => setMode(event.target.value)}><option value="changed">{tr("Changed scanners only", "Только изменившиеся сканеры")}</option><option value="full">{tr("Full offline rescan + git history", "Полный офлайн-рескан + история git")}</option><option value="scanners">{tr("Specific scanners", "Отдельные сканеры")}</option></select></label>
          {mode === "scanners" && <div className="grid max-h-48 grid-cols-2 gap-2 overflow-auto rounded-md border p-2">{scanners.map(id => <label key={id} className="flex items-start gap-2 text-xs"><input type="checkbox" checked={selectedScanners.has(id)} onChange={event => setSelectedScanners(previous => { const next = new Set(previous); if (event.target.checked) next.add(id); else next.delete(id); return next })} />{id}</label>)}</div>}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 text-sm"><span>{tr("Workers", "Потоки")}</span><Input type="number" min={1} max={32} value={jobs} onChange={event => setJobs(Number(event.target.value))} /></label>
            <label className="space-y-1 text-sm"><span>{tr("Keep free (GiB)", "Свободно (ГиБ)")}</span><Input type="number" min={0} max={1024} value={minFreeGiB} onChange={event => setMinFreeGiB(Number(event.target.value))} /></label>
          </div>
          <label className="block space-y-1 text-sm"><span>{tr("Timeout per stage (minutes)", "Таймаут этапа (минуты)")}</span><Input type="number" min={1} max={180} value={timeoutMinutes} onChange={event => setTimeoutMinutes(Number(event.target.value))} /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={refreshMetadata} onChange={event => setRefreshMetadata(event.target.checked)} />{tr("Refresh OSV and license metadata (network)", "Обновить OSV и метаданные лицензий (сеть)")}</label>
          <p className="text-xs text-muted-foreground">{tr("Full rescan reads git history. Changed mode reuses matching baseline snapshots. Network metadata is a separate optional stage; offline reports do not claim a fresh OSV check. Clones are removed after each repository.", "Полный рескан читает историю git. Режим изменений использует подходящие исходные снимки. Внешние метаданные — отдельный необязательный этап; офлайн-отчёт не означает свежую проверку OSV. Клоны удаляются после каждого репозитория.")}</p>
          <p className="text-sm">{selection.length.toLocaleString()} {tr("repositories selected", "репозиториев выбрано")}</p>
          <Button className="w-full" disabled={!loaded || busy || working || !selection.length || mode === "scanners" && !selectedScanners.size} onClick={() => act("create")}>{tr("Start isolated run", "Запустить отдельно от готовых сканов")}</Button>
        </CardContent></Card>
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>{tr("Runs", "Запуски")}</CardTitle></CardHeader><CardContent className="space-y-4">
            {!runs.length ? <p className="text-sm text-muted-foreground">{tr("No runs yet", "Пока нет запусков")}</p> : <>
              <select className={field} aria-label={tr("Runs", "Запуски")} value={run.id} onChange={event => { setActiveId(event.target.value); setLog(""); setLogRepo("") }}>{runs.map(item => <option key={item.id} value={item.id}>{new Date(item.createdAt).toLocaleString()} · {status(item.status)} · {item.total}</option>)}</select>
              <p className="text-sm font-medium">{status(run.status)} · {run.config.jobs} {tr("workers", "потока")}</p>
              {run.error && <p className="text-sm text-destructive">{run.error}</p>}
              <progress className="h-3 w-full accent-primary" value={run.done + run.failed} max={run.total} aria-label={tr("Progress", "Прогресс")} />
              <dl className="grid grid-cols-2 gap-3 text-sm">{[[tr("Done", "Готово"), run.done], [tr("Failed", "Ошибки"), run.failed], [tr("Pending", "В очереди"), run.pending], [tr("Active", "Работают"), run.active.length]].map(([label, value]) => <div key={label}><dt className="text-muted-foreground">{label}</dt><dd className="font-mono text-xl">{Number(value).toLocaleString()}</dd></div>)}</dl>
              <p className="text-xs text-muted-foreground">{tr("Elapsed", "Прошло")}: {duration(elapsed)} · {tr("Remaining estimate", "Осталось примерно")}: {eta === null ? "…" : duration(eta)} · {run.freeGiB ?? "—"} {tr("GiB free", "ГиБ свободно")}</p>
              <div className="flex flex-wrap gap-2">
                {["preparing", "running", "pausing"].includes(run.status) && <><Button variant="outline" size="sm" disabled={busy || run.status === "pausing"} onClick={() => act("pause")}>{tr("Pause after current tasks", "Пауза после текущих задач")}</Button><Button variant="outline" size="sm" disabled={busy} onClick={() => act("cancel")}>{tr("Stop now", "Остановить сейчас")}</Button></>}
                {["queued", "paused", "interrupted", "cancelled", "failed"].includes(run.status) && <Button size="sm" disabled={busy || working} onClick={() => act("resume")}>{tr("Continue", "Продолжить")}</Button>}
                {run.failed > 0 && !working && <Button variant="outline" size="sm" disabled={busy} onClick={() => act("retry")}>{tr("Retry errors", "Повторить ошибки")}</Button>}
              </div>
              <p className="break-all font-mono text-xs text-muted-foreground">{run.resultsPath}</p>
              {run.fingerprint && <p className="font-mono text-xs text-muted-foreground">Scanner: {run.fingerprint}</p>}
            </>}
          </CardContent></Card>
          {run && <Card><CardHeader><CardTitle>{tr("Recent results", "Последние результаты")}</CardTitle></CardHeader><CardContent className="space-y-3">
            {tasks.map(task => <div key={task.name} className="space-y-1 border-b border-border pb-2 text-sm">
              <p className="break-all font-medium">{task.name}</p><p className="text-xs text-muted-foreground">{status(task.status)}{task.findings !== undefined ? ` · ${task.findings}` : ""}</p>
              {task.error && <p className="text-xs text-destructive">{task.error}</p>}
              <div className="flex flex-wrap gap-3 text-xs text-primary"><button className="hover:underline" onClick={() => showLog(task.name)}>{tr("Show log", "Открыть лог")}</button>{task.status === "done" && <><a href={`${endpoint}?id=${run.id}&repo=${encodeURIComponent(task.name)}&report=offline`} target="_blank" rel="noreferrer">{tr("Report JSON", "Отчёт JSON")}</a>{run.config.refreshMetadata && <a href={`${endpoint}?id=${run.id}&repo=${encodeURIComponent(task.name)}&report=metadata`} target="_blank" rel="noreferrer">{tr("Metadata JSON", "Метаданные JSON")}</a>}</>}</div>
            </div>)}
            {run.errors.filter(task => !tasks.some(row => row.name === task.name)).map(task => <button key={task.name} className="block break-all text-left text-xs text-destructive hover:underline" onClick={() => showLog(task.name)}>{task.name}: {task.error}</button>)}
          </CardContent></Card>}
        </div>
      </div>
      {logRepo && <Card><CardHeader><CardTitle>{tr("Repository logs", "Логи репозитория")}: {logRepo}</CardTitle></CardHeader><CardContent><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-3 font-mono text-xs">{log || "…"}</pre></CardContent></Card>}
    </main>
  </div>
}
