"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Callout, Empty, Panel, Stat, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Job = {
  id: number;
  title: string;
  target: string;
  status: string;
  error: string;
  report_id: number | null;
  run_id: string | null;
  attempt?: number;
  stop_requested_at?: string | null;
  canceled_at?: string | null;
};
type Runner = { paused: boolean; capacity: number; active: number[]; running: number[]; available: number };

export default function ScanPage() {
  const { tr } = useLocale();
  const [text, setText] = useState(`[
  "cronos-smart-contracts",
  "deltaprime-smart-contracts",
  "risc-zero-blockchain-verifiers"
]`);
  const [msg, setMsg] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [counts, setCounts] = useState<{ status: string; n: number }[]>([]);
  const [runner, setRunner] = useState<Runner>({ paused: true, capacity: 1, active: [], running: [], available: 1 });
  const [busy, setBusy] = useState("");
  const [skipReported, setSkipReported] = useState(true);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const j = await (await fetch("/api/jobs")).json();
    setJobs(j.jobs || []);
    setCounts(j.counts || []);
    if (j.runner) setRunner(j.runner);
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function enqueue() {
    setMsg(tr("парсю…", "parsing…"));
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      /* plain slugs / urls */
    }
    const j = await (
      await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json, skipReported }),
      })
    ).json();
    setMsg(j.error || tr(`разобрал ${j.parsed}, в очередь ${j.queued}`, `parsed ${j.parsed}, queued ${j.queued}`) + (j.programsIngested ? tr(`, каталог +${j.programsIngested}`, `, catalog +${j.programsIngested}`) : ""));
    await load();
  }

  async function onFile(f: File) {
    setText(await f.text());
  }

  const request = useCallback(async (key: string, url: string, method: "POST" | "PATCH", body: object) => {
    setBusy(key); setMsg("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || response.statusText);
      await load();
    } catch (error) { setMsg(String(error)); } finally { setBusy(""); }
  }, [load]);

  const control = (action: string) => request(action, "/api/jobs/control", "POST", { action });
  const jobAction = (id: number, action: string) => request(`${id}:${action}`, `/api/jobs/${id}`, "PATCH", { action });
  const startAuto = () => request("auto", "/api/jobs/run", "POST", { pause: false, capacity: runner.capacity });
  const stopAuto = async () => {
    setBusy("stop"); setMsg("");
    try {
      for (const action of ["pause", "stop_running"]) {
        const response = await fetch("/api/jobs/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || response.statusText);
      }
      await load();
    } catch (error) { setMsg(String(error)); } finally { setBusy(""); }
  };

  const n = (s: string) => counts.find((c) => c.status === s)?.n || 0;
  const statusLabel = (s: string) => (({ queued: tr("в очереди", "queued"), running: tr("в работе", "running"), done: tr("готово", "done"), error: tr("ошибка", "error"), stopped: tr("остановлено", "stopped"), canceled: tr("отменено", "canceled") } as Record<string, string>)[s] || s);

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Мультискан", "Multi-scan")}</h1>
          <p className="sub">
            {tr("Это", "This is")} <b>{tr("шаг 0 + выжимка", "step 0 + summary")}</b> {tr("(страница HP + README, ворота, гипотезы). Не полный диг как с Cursor: нет bytecode, forge, prod-vs-repo, AA-цепочки.", "(HP page + README, gates, hypotheses). Not a full Cursor investigation: no bytecode, forge, prod-vs-repo, or AA chains.")}
          </p>
        </div>
        <Link className="btn primary" href="/picture">
          {tr("Полный отчёт", "Full report")}
        </Link>
      </div>

      <div style={{ marginBottom: 16 }}>
      <Panel
        title={tr("Вход", "Input")}
        meta={tr("json / slug / url", "json / slug / url")}
        actions={
          !runner.paused ? (
            <Status tone="success" pulse>
              {tr("runner активен", "runner active")}
            </Status>
          ) : null
        }
      >
        <p className="snip">
          {tr("Вставь JSON: массив slug/URL, объект с", "Paste JSON: a slug/URL array, an object with")} <span className="mono">programs</span> /{" "}
          <span className="mono">slugs</span>, {tr("или сырой", "or raw")} <span className="mono">programs_raw.json</span> {tr("с HP. Либо загрузи файл.", "from HP. Or upload a file.")}
        </p>
        <textarea
          className="json-paste"
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.txt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
          <button className="btn outline sm" onClick={() => fileRef.current?.click()}>
            {tr("Файл JSON", "JSON file")}
          </button>
          <button className="btn sm" onClick={enqueue}>
            {tr("В очередь", "Queue")}
          </button>
          <label className="btn outline sm">
            <input type="checkbox" checked={skipReported} onChange={(e) => setSkipReported(e.target.checked)} /> {tr("уже сканированные — пропуск", "skip already scanned")}
          </label>
          <label className="btn outline sm queue-capacity">
            {tr("параллельно", "parallel")}
            <select
              value={runner.capacity}
              disabled={!!busy}
              onChange={(e) => request("capacity", "/api/jobs/run", "POST", { capacity: Number(e.target.value), pause: runner.paused })}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
          <button className={`btn sm ${runner.paused ? "primary" : "danger"}`} disabled={!!busy} onClick={runner.paused ? startAuto : stopAuto}>
            {runner.paused ? tr("Запустить мультискан", "Start multi-scan") : tr("Стоп", "Stop")}
          </button>
          <button className="btn outline sm" disabled={!!busy || n("queued") === 0} onClick={() => control("cancel_queued")}>{tr("Отменить очередь", "Cancel queued")}</button>
          <button className="btn outline sm" disabled={!!busy || (n("error") + n("stopped") + n("canceled") === 0)} onClick={() => control("retry_failed")}>{tr("Повторить неудачные", "Retry failed")}</button>
        </div>
        {msg ? (
          <div style={{ marginTop: 12 }}>
            <Callout tone="accent">{msg}</Callout>
          </div>
        ) : null}
      </Panel>
      </div>

      <div className="grid stats">
        {(["queued", "running", "done", "error", "stopped", "canceled"] as const).map((s) => (
          <Stat key={s} label={statusLabel(s)} value={n(s)} />
        ))}
      </div>

      <Panel title={tr("Очередь", "Queue")} meta={tr(`${jobs.length} задач · свободно ${runner.available}/${runner.capacity}`, `${jobs.length} jobs · available ${runner.available}/${runner.capacity}`)} flush>
        {jobs.length === 0 ? <Empty>{tr("Пусто — вставь список и нажми «В очередь».", "Empty — paste a list and click “Queue”.")}</Empty> : null}
        <div className="queue-table-wrap"><table className="queue-table">
          <thead>
            <tr>
              <th className="num">#</th>
              <th>{tr("цель", "target")}</th>
              <th>{tr("статус", "status")}</th>
              <th>{tr("отчёт", "report")}</th>
              <th>{tr("действия", "actions")}</th>
            </tr>
          </thead>
          <tbody>
            {jobs.slice(0, 60).map((j) => (
              <tr key={j.id}>
                <td className="num mono">{j.id}</td>
                <td>
                  {j.title}
                  <div className="snip mono">{j.target}</div>
                  {j.error ? <div className="snip bad mono">{j.error}</div> : null}
                </td>
                <td>
                  <span className={`badge sm ${j.status}`}>{statusLabel(j.status)}</span>
                </td>
                <td className="mono">
                  <div className="queue-links">
                    {j.run_id ? <Link href={`/runs?id=${encodeURIComponent(j.run_id)}`}>{tr("прогон", "run")} #{j.run_id}</Link> : null}
                    {j.report_id ? <Link href={`/reports/${j.report_id}`}>{tr("отчёт", "report")} #{j.report_id}</Link> : null}
                    {!j.run_id && !j.report_id ? "—" : null}
                  </div>
                </td>
                <td><div className="row queue-actions">
                  {j.status === "queued" ? <><button className="btn primary xs" disabled={!!busy} onClick={() => jobAction(j.id, "run")}>{tr("Запустить", "Run now")}</button><button className="btn outline xs" disabled={!!busy} onClick={() => jobAction(j.id, "cancel")}>{tr("Отменить", "Cancel")}</button></> : null}
                  {j.status === "running" ? <button className="btn danger xs" disabled={!!busy || !!j.stop_requested_at} onClick={() => jobAction(j.id, "stop")}>{tr("Остановить", "Stop")}</button> : null}
                  {["error", "stopped", "canceled"].includes(j.status) ? <button className="btn outline xs" disabled={!!busy} onClick={() => jobAction(j.id, "retry")}>{tr("Повторить", "Retry")}</button> : null}
                </div></td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </Panel>
    </>
  );
}
