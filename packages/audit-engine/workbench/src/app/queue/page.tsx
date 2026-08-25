"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Empty, Panel, Stat, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Job = {
  id: number; title: string; target: string; status: string; error?: string | null;
  report_id: number | null; run_id: string | null; attempt?: number;
  stop_requested_at?: string | null; canceled_at?: string | null;
};
type Runner = { paused: boolean; capacity: number; active: number[]; running: number[]; available: number };
type JobsResponse = { jobs?: Job[]; counts?: { status: string; n: number }[]; runner?: Runner; error?: string };

export default function QueuePage() {
  const { tr } = useLocale();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [counts, setCounts] = useState<{ status: string; n: number }[]>([]);
  const [runner, setRunner] = useState<Runner>({ paused: true, capacity: 1, active: [], running: [], available: 1 });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      const data: JobsResponse = await response.json();
      if (!response.ok) throw new Error(data.error || response.statusText);
      setJobs(data.jobs || []);
      setCounts(data.counts || []);
      if (data.runner) setRunner(data.runner);
    } catch (error) {
      setMessage(String(error));
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 2000);
    return () => window.clearInterval(timer);
  }, [load]);

  const request = useCallback(async (key: string, url: string, method: "POST" | "PATCH", body: object) => {
    setBusy(key);
    setMessage("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || response.statusText);
      await load();
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy("");
    }
  }, [load]);

  const control = (action: string) => request(action, "/api/jobs/control", "POST", { action });
  const jobAction = (id: number, action: string) => request(`${id}:${action}`, `/api/jobs/${id}`, "PATCH", { action });
  const stopAll = async () => {
    setBusy("stop_all"); setMessage("");
    try {
      for (const action of ["pause", "stop_running"]) {
        const response = await fetch("/api/jobs/control", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || response.statusText);
      }
      await load();
    } catch (error) { setMessage(String(error)); } finally { setBusy(""); }
  };
  const setCapacity = (capacity: number) => request("capacity", "/api/jobs/run", "POST", { capacity, pause: runner.paused });
  const n = (status: string) => Number(counts.find((item) => item.status === status)?.n || 0);
  const label = (status: string) => ({
    queued: tr("в очереди", "queued"), running: tr("в работе", "running"), done: tr("готово", "done"),
    error: tr("ошибка", "error"), stopped: tr("остановлено", "stopped"), canceled: tr("отменено", "canceled"),
  } as Record<string, string>)[status] || status;
  const retryable = (status: string) => ["error", "stopped", "canceled"].includes(status);

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Очередь скана", "Scan queue")}</h1>
          <p className="sub">{tr("Фоновый runner обрабатывает очередь; состояние обновляется каждые 2 секунды.", "The background runner processes the queue; status refreshes every 2 seconds.")}</p>
        </div>
        <Status tone={runner.paused ? "neutral" : "success"} pulse={!runner.paused}>
          {runner.paused ? tr("на паузе", "paused") : tr("runner активен", "runner active")}
        </Status>
      </div>

      <div className="k-toolbar queue-toolbar">
        <button className={`btn sm ${runner.paused ? "primary" : "outline"}`} disabled={!!busy} onClick={() => control(runner.paused ? "resume" : "pause")}>
          {runner.paused ? tr("Продолжить", "Resume") : tr("Пауза", "Pause")}
        </button>
        <button className="btn danger sm" disabled={!!busy} onClick={stopAll}>{tr("Остановить всё", "Stop all")}</button>
        <button className="btn outline sm" disabled={!!busy || n("queued") === 0} onClick={() => control("cancel_queued")}>{tr("Отменить очередь", "Cancel queued")}</button>
        <button className="btn outline sm" disabled={!!busy || (n("error") + n("stopped") + n("canceled") === 0)} onClick={() => control("retry_failed")}>{tr("Повторить неудачные", "Retry failed")}</button>
        <label className="btn outline sm queue-capacity">
          {tr("Параллельно", "Parallel")}
          <select value={runner.capacity} disabled={!!busy} onChange={(event) => setCapacity(Number(event.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7, 8].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      {message ? <div className="snip bad" style={{ marginBottom: 12 }}>{message}</div> : null}

      <div className="grid stats">
        {["queued", "running", "done", "error", "stopped", "canceled"].map((status) => <Stat key={status} label={label(status)} value={n(status)} />)}
      </div>

      <Panel title={tr("Задачи", "Jobs")} meta={tr(`${jobs.length} задач · свободно ${runner.available}/${runner.capacity}`, `${jobs.length} jobs · available ${runner.available}/${runner.capacity}`)} flush>
        <div className="queue-table-wrap">
          <table className="queue-table">
            <thead><tr><th className="num">#</th><th>{tr("цель", "target")}</th><th>{tr("статус", "status")}</th><th>{tr("ссылки", "links")}</th><th>{tr("действия", "actions")}</th></tr></thead>
            <tbody>{jobs.map((job) => (
              <tr key={job.id}>
                <td className="num mono">{job.id}</td>
                <td><b>{job.title}</b><div className="snip mono">{job.target}</div>{job.error ? <div className="snip bad mono">{job.error}</div> : null}</td>
                <td><span className={`badge sm ${job.status}`}>{label(job.status)}</span><div className="snip mono">{tr("попытка", "attempt")} {job.attempt || 0}{job.stop_requested_at ? ` · ${tr("остановка запрошена", "stop requested")}` : ""}</div></td>
                <td className="mono queue-links">
                  {job.run_id ? <Link href={`/runs?id=${encodeURIComponent(job.run_id)}`}>{tr("прогон", "run")} #{job.run_id}</Link> : null}
                  {job.report_id ? <Link href={`/reports/${job.report_id}`}>{tr("отчёт", "report")} #{job.report_id}</Link> : null}
                  {!job.run_id && !job.report_id ? "—" : null}
                </td>
                <td><div className="row queue-actions">
                  {job.status === "queued" ? <><button className="btn primary xs" disabled={!!busy} onClick={() => jobAction(job.id, "run")}>{tr("Запустить", "Run now")}</button><button className="btn outline xs" disabled={!!busy} onClick={() => jobAction(job.id, "cancel")}>{tr("Отменить", "Cancel")}</button></> : null}
                  {job.status === "running" ? <button className="btn danger xs" disabled={!!busy || !!job.stop_requested_at} onClick={() => jobAction(job.id, "stop")}>{tr("Остановить", "Stop")}</button> : null}
                  {retryable(job.status) ? <button className="btn outline xs" disabled={!!busy} onClick={() => jobAction(job.id, "retry")}>{tr("Повторить", "Retry")}</button> : null}
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {jobs.length === 0 ? <Empty>{tr("Очередь пуста.", "The queue is empty.")}</Empty> : null}
      </Panel>
    </>
  );
}
