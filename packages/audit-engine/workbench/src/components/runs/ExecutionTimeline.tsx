"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocale } from "@/components/LocaleProvider";

export type RunLike = { id: string; target: string; action: string; model?: string; status: string };
export type RunEvent = { ts: string; seq: number; kind: string; name?: string; tool?: string; status?: string; ms?: number; hits?: number; ok?: boolean; [key: string]: unknown };
export type Lane = { run: RunLike; events: RunEvent[] };
export type Selection = { event: RunEvent; end?: RunEvent; lane: string };

const stamp = (ts: string) => Number.isFinite(Date.parse(ts || "")) ? Date.parse(ts) : 0;
const clock = (ts: string) => (ts || "").slice(11, 19);
const duration = (ms: number, ru: boolean) => ms >= 60000 ? `${Math.round(ms / 6000) / 10} ${ru ? "мин" : "min"}` : `${(ms / 1000).toFixed(1)} ${ru ? "с" : "s"}`;
const short = (s: string) => s.replace(/\(.*/, "").replace(/_[a-z0-9_-]+__[a-z0-9_-]+$/i, "").replace(/^agent\s+/, "agent · ");

export function ExecutionTimeline({ run, events, related, selected, onSelect }: {
  run: RunLike;
  events: RunEvent[];
  related: Lane[];
  selected: Selection | null;
  onSelect: (value: Selection | null) => void;
}) {
  const { locale, tr } = useLocale();
  const lanes = useMemo(() => [{ run, events }, ...related], [run, events, related]);
  const all = lanes.flatMap((lane) => lane.events);
  const times = all.map((event) => stamp(event.ts)).filter(Boolean);
  const min = Math.min(...times);
  const live = lanes.some((lane) => lane.run.status === "идёт");
  const max = Math.max(min + 1000, live ? Date.now() : Math.max(...times));
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const [brush, setBrush] = useState<{ lane: string; from: number; to: number } | null>(null);
  useEffect(() => {
    setZoom(null);
    setBrush(null);
  }, [run.id]);
  const viewMin = zoom?.[0] ?? min;
  const viewMax = zoom?.[1] ?? max;
  const total = viewMax - viewMin;
  const x = (n: number) => Math.max(0, Math.min(100, ((n - viewMin) / total) * 100));
  const marks = Array.from({ length: 6 }, (_, index) => viewMin + (total * index) / 5);
  const kinds = new Set(all.map((event) => event.kind));
  const hasErrors = all.some((event) => event.status === "err" || event.ok === false);
  const [tip, setTip] = useState<{ text: string; x: number; y: number } | null>(null);

  const isSelected = (event: RunEvent, lane: string) => selected?.lane === lane && selected.event.seq === event.seq;
  const choose = (value: Selection) => onSelect(isSelected(value.event, value.lane) ? null : value);
  const showTip = (event: React.MouseEvent, text: string) => {
    const width = 300;
    const height = 96;
    setTip({
      text,
      x: Math.max(8, Math.min(event.clientX + 12, window.innerWidth - width - 8)),
      y: Math.max(8, Math.min(event.clientY + 12, window.innerHeight - height - 8)),
    });
  };
  const startBrush = (event: React.PointerEvent<HTMLDivElement>, lane: string) => {
    if (event.target !== event.currentTarget) return;
    const track = event.currentTarget;
    const box = track.getBoundingClientRect();
    const at = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    setBrush({ lane, from: at, to: at });
    track.setPointerCapture(event.pointerId);
  };
  const moveBrush = (event: React.PointerEvent<HTMLDivElement>, lane: string) => {
    if (!brush || brush.lane !== lane) return;
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
    setBrush((value) => value ? { ...value, to: at } : null);
  };
  const finishBrush = (event: React.PointerEvent<HTMLDivElement>, lane: string) => {
    if (!brush || brush.lane !== lane) return;
    const distance = Math.abs(brush.to - brush.from);
    if (distance >= 0.015) {
      const left = Math.min(brush.from, brush.to);
      const right = Math.max(brush.from, brush.to);
      setZoom([viewMin + total * left, viewMin + total * right]);
    }
    setBrush(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return <div className="exec-wrap">
    {tip ? createPortal(<div className="exec-tooltip" style={{ left: tip.x, top: tip.y }}>{tip.text}</div>, document.body) : null}
    <div className="pipe-head">
      <span className="kit-label">{tr("ФАКТИЧЕСКОЕ ВРЕМЯ", "ACTUAL TIME")}</span>
      <span className="row">
        <span className="snip exec-zoom-hint">{tr("потяни по пустому месту для масштаба", "drag empty space to zoom")}</span>
        <span className="snip">{duration(total, locale === "ru")}</span>
        {zoom ? <button className="btn ghost xs" onClick={() => setZoom(null)}>{tr("Сбросить масштаб", "Reset zoom")}</button> : null}
      </span>
    </div>
    <div className="exec-scroll"><div className="exec-chart">
      <div className="exec-axis"><div className="exec-lane-label" /><div className="exec-track">
        {marks.map((mark) => <div className="exec-tick" key={mark} style={{ left: `${x(mark)}%` }}><span>{clock(new Date(mark).toISOString())}</span></div>)}
      </div></div>
      {lanes.map((lane, laneIndex) => {
        const starts = lane.events.filter((event) => event.kind === "step_start");
        const ends = new Map(lane.events.filter((event) => event.kind === "step_end").map((event) => [event.name, event]));
        const points = lane.events.filter((event) => ["model_call", "verdict", "candidate", "note", "error"].includes(event.kind));
        return <div className="exec-lane" key={lane.run.id}>
          <div className="exec-lane-label"><b>{laneIndex ? `${tr("агент", "agent")} ${laneIndex}` : tr("оркестратор", "orchestrator")}</b><span>{lane.run.target}</span><small>{lane.run.model || lane.run.action}</small></div>
          <div className={`exec-track ${brush?.lane === lane.run.id ? "brushing" : ""}`}
            onPointerDown={(event) => startBrush(event, lane.run.id)}
            onPointerMove={(event) => moveBrush(event, lane.run.id)}
            onPointerUp={(event) => finishBrush(event, lane.run.id)}
            onPointerCancel={() => setBrush(null)}>
            {marks.map((mark) => <span className="exec-gridline" key={mark} style={{ left: `${x(mark)}%` }} />)}
            {brush?.lane === lane.run.id ? <span className="exec-brush" style={{ left: `${Math.min(brush.from, brush.to) * 100}%`, width: `${Math.abs(brush.to - brush.from) * 100}%` }} /> : null}
            {starts.map((start, index) => {
              const end = ends.get(start.name);
              const finish = end ? stamp(end.ts) || stamp(start.ts) + Number(end.ms || 1) : Date.now();
              if (finish < viewMin || stamp(start.ts) > viewMax) return null;
              const text = `${start.name || start.tool || tr("шаг", "step")} · ${duration(finish - stamp(start.ts), locale === "ru")}`;
              return <button key={start.seq} className={`exec-bar ${end?.status === "err" ? "bad" : !end ? "live" : ""} ${isSelected(start, lane.run.id) ? "selected" : ""}`}
                style={{ left: `${x(stamp(start.ts))}%`, width: `${Math.max(.7, x(finish) - x(stamp(start.ts)))}%`, top: `${10 + index % 3 * 19}px` }}
                onClick={() => choose({ event: start, end, lane: lane.run.id })} onMouseMove={(e) => showTip(e, text)} onMouseLeave={() => setTip(null)}>
                <span>{short(String(start.name || start.tool || tr("шаг", "step")))}</span>
              </button>;
            })}
            {points.map((point, index) => {
              if (stamp(point.ts) < viewMin || stamp(point.ts) > viewMax) return null;
              const text = point.kind === "model_call" ? `${tr("модель", "model")}: ${String(point.model || "—")}` : point.kind === "verdict" ? `${tr("ворота", "gate")}: ${point.ok ? tr("подтверждено", "confirmed") : tr("отклонено", "rejected")}` : String(point.why || point.text || point.error || point.kind);
              return <button aria-label={text} key={point.seq} className={`exec-point ${point.kind} ${point.ok === false ? "bad" : ""} ${isSelected(point, lane.run.id) ? "selected" : ""}`}
                style={{ left: `${x(stamp(point.ts))}%`, top: `${14 + index % 3 * 19}px` }} onClick={() => choose({ event: point, lane: lane.run.id })}
                onMouseMove={(e) => showTip(e, text)} onMouseLeave={() => setTip(null)} />;
            })}
          </div>
        </div>;
      })}
    </div></div>
    <div className="exec-legend">
      {kinds.has("step_start") ? <span><i className="leg bar" /> {tr("инструмент / задача", "tool / task")}</span> : null}
      {kinds.has("model_call") ? <span><i className="leg model" /> {tr("модель", "model")}</span> : <span className="legend-missing">{tr("ходов модели нет в журнале", "no model calls in log")}</span>}
      {kinds.has("verdict") ? <span><i className="leg gate" /> {tr("ворота", "gate")}</span> : <span className="legend-missing">{tr("решений ворот нет в журнале", "no gate decisions in log")}</span>}
      {kinds.has("candidate") ? <span><i className="leg candidate" /> {tr("зацепка", "lead")}</span> : null}
      {hasErrors ? <span><i className="leg bad" /> {tr("ошибка / отказ", "error / rejection")}</span> : null}
    </div>
  </div>;
}

export function EventDetail({ selection, onClose }: { selection: Selection | null; onClose: () => void }) {
  const { locale, tr } = useLocale();
  const [copied, setCopied] = useState(false);
  const [width, setWidth] = useState(440);
  useEffect(() => {
    if (!selection) return;
    const escape = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [selection, onClose]);
  if (!selection) return null;
  const event = selection.event;
  const end = selection.end;
  const labels: Record<string, [string, string]> = { step_start: ["Шаг", "Step"], model_call: ["Модель", "Model"], verdict: ["Вердикт", "Verdict"], candidate: ["Зацепка", "Lead"], note: ["Заметка", "Note"], error: ["Ошибка", "Error"] };
  const fieldLabels: Record<string, [string, string]> = {
    name: ["шаг", "step"], cmd: ["команда", "command"], tool: ["инструмент", "tool"],
    status: ["статус", "status"], ms: ["время", "duration"], lines: ["строки", "lines"],
    hits: ["зацепки", "leads"], head: ["вывод", "output"], out: ["файл вывода", "output file"],
    model: ["модель", "model"], tier: ["уровень", "tier"], calls: ["вызовы", "calls"],
    tokens_in: ["токены вход", "input tokens"], tokens_out: ["токены выход", "output tokens"],
    file: ["файл", "file"], line: ["строка", "line"], why: ["причина", "reason"],
    reason: ["решение", "decision"], error: ["ошибка", "error"], text: ["текст", "text"],
  };
  const skip = new Set(["ts", "seq", "kind", "run"]);
  // step_start и step_end повторяют slug/name/tool. Объединяем по ключу,
  // чтобы панель не показывала одни и те же поля дважды.
  const rows = Object.entries({ ...event, ...(end || {}) }).filter(
    ([key, value]) => !skip.has(key) && value !== undefined && value !== null && value !== "",
  );
  const copy = async () => { await navigator.clipboard.writeText(JSON.stringify({ ...event, end }, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1200); };
  const startResize = (pointer: React.PointerEvent) => {
    pointer.preventDefault();
    const startX = pointer.clientX;
    const startWidth = width;
    const move = (event: PointerEvent) => {
      const max = Math.max(360, window.innerWidth - 280);
      setWidth(Math.max(320, Math.min(max, startWidth + startX - event.clientX)));
    };
    const stop = () => {
      document.body.classList.remove("drawer-resizing");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
    };
    document.body.classList.add("drawer-resizing");
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
  };
  return createPortal(<aside className="event-drawer" style={{ width }} role="dialog" aria-modal="false" aria-live="polite">
    <button className="event-drawer-resize" onPointerDown={startResize} aria-label={tr("Изменить ширину панели", "Resize detail panel")} />
    <div className="event-drawer-head"><div><span className="kit-label">{tr(...(labels[event.kind] || ["Событие", "Event"]))}</span><b>{String(event.name || event.model || event.file || event.text || event.kind)}</b></div>
      <div className="row"><button className="btn ghost xs" onClick={copy}>{copied ? tr("Скопировано", "Copied") : tr("Копировать", "Copy")}</button><button className="btn ghost xs" onClick={onClose} aria-label={tr("Закрыть", "Close")}>×</button></div>
    </div>
    <div className="event-drawer-body">{rows.map(([key, value], index) => {
      const pair = fieldLabels[key];
      const field = pair ? tr(...pair) : key.replaceAll("_", " ");
      const raw = Array.isArray(value) ? value.join("\n") : typeof value === "object" ? JSON.stringify(value) : String(value);
      const shown = key === "ms" ? duration(Number(value), locale === "ru") : raw;
      return <div className="event-field" key={`${key}-${index}`}><span>{field}</span><code>{shown}</code></div>;
    })}</div>
  </aside>, document.body);
}
