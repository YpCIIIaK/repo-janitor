"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Callout, Empty, Panel, Skeleton, Stat, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";
import { EventDetail, ExecutionTimeline, type RunEvent } from "@/components/runs/ExecutionTimeline";

type Run = {
  id: string;
  slug: string;
  action: string;
  target: string;
  parent?: string;
  model?: string;
  at: string;
  endedAt?: string;
  steps: number;
  done: number;
  failed: number;
  candidates: number;
  ms: number | null;
  status: string;
  incomplete?: boolean;
  unexplained?: boolean;
  events: number;
};

type Event = {
  ts: string;
  seq: number;
  kind: string;
  name?: string;
  tool?: string;
  cmd?: string;
  status?: string;
  ms?: number;
  lines?: number;
  hits?: number;
  head?: string[];
  out?: string;
  text?: string;
  file?: string;
  line?: number;
  why?: string;
  source?: string;
  target?: string;
  action?: string;
  error?: string;
  [k: string]: unknown;
};

const time = (iso: string) => (iso || "").slice(11, 19);
const dur = (ms: number | null | undefined, locale: "ru" | "en") =>
  ms == null ? "" : ms >= 60000
    ? `${Math.round(ms / 6000) / 10} ${locale === "ru" ? "мин" : "min"}`
    : `${(ms / 1000).toFixed(1)} ${locale === "ru" ? "с" : "s"}`;

/** Переводим служебный вывод сигналов только при показе, не меняя run-файлы. */
function signalText(value: unknown, locale: "ru" | "en") {
  const text = String(value ?? "");
  if (locale === "ru") return text;
  return text
    .replace(/модификаторы:/gi, "modifiers:")
    .replace(/\(нет\)/gi, "(none)")
    .replace(/действие:/gi, "action:")
    .replace(/контрактов\s+(\d+)/gi, "$1 contracts")
    .replace(/сырых кандидатов\s+(\d+)/gi, "$1 raw candidates")
    .replace(/шлюз убил\s+(\d+)/gi, "gate rejected $1")
    .replace(/выжило\s+(\d+)/gi, "$1 survived")
    .replace(/\(лиды\)/gi, "(leads)")
    .replace(/произвольный внешний вызов/gi, "arbitrary external call")
    .replace(/перевод чужих средств/gi, "transfer of third-party funds")
    .replace(/минт\/жёг/gi, "mint/burn")
    .replace(/запись состояния/gi, "state write");
}

function eventKey(key: string, locale: "ru" | "en") {
  if (locale === "ru") return key;
  return ({
    files: "files",
    assets: "assets",
    lines: "lines",
    hits: "hits",
    weight: "weight",
    why: "reason",
    source: "signal",
    target: "target",
    action: "action",
  } as Record<string, string>)[key] || key.replaceAll("_", " ");
}

export default function RunsPage() {
  // useSearchParams требует границы Suspense — иначе сборка ругается.
  return (
    <Suspense fallback={<Skeleton tiles={4} />}>
      <Runs />
    </Suspense>
  );
}

function Runs() {
  const { locale, tr } = useLocale();
  const params = useSearchParams();
  const want = params.get("id") || "";
  const wantSlug = params.get("slug") || "";
  const [runs, setRuns] = useState<Run[] | null>(null);
  const [open, setOpen] = useState<string>("");
  const [events, setEvents] = useState<Event[]>([]);
  const [related, setRelated] = useState<{ run: Run; events: Event[] }[]>([]);
  const [sum, setSum] = useState<Run | null>(null);
  const [selected, setSelected] = useState<{ event: RunEvent; end?: RunEvent; lane: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "active" | "leads">("all");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [history, setHistory] = useState<Record<string, boolean>>({});
  const [follow, setFollow] = useState(true);
  const feed = useRef<HTMLDivElement | null>(null);
  const runsRef = useRef<Run[]>([]);
  // Выбор руками важнее автоподбора: щёлкнул по прогону — за тобой не тянут.
  const touched = useRef(false);

  const loadRuns = useCallback(async () => {
    const j = await (await fetch("/api/runs")).json();
    const rows = (j.rows || []) as Run[];
    runsRef.current = rows;
    setRuns(rows);
    return rows;
  }, []);

  // Список прогонов ОБНОВЛЯЕТСЯ САМ. Иначе: нажал «Сканировать», сразу
  // перешёл сюда — а файл журнала ещё не создан, список пуст, и прогон
  // «не появился». Опрос дешёвый: это чтение имён файлов.
  useEffect(() => {
    let alive = true;
    let tries = 0;
    const tick = async () => {
      if (!alive) return;
      const rows = await loadRuns();
      const live = rows.find((r) => r.status === "идёт");
      // Пока пользователь ничего не выбрал руками, ведём его за свежим:
      // явный id из ссылки > свежий прогон нужной мишени > идущий > первый.
      setOpen((cur) => {
        if (cur && touched.current) return cur;
        const byId = want ? rows.find((r) => r.id === want) : null;
        const bySlug = wantSlug ? rows.find((r) => r.slug === wantSlug) : null;
        const pickRun = byId || bySlug || live || rows[0];
        return pickRun ? pickRun.id : cur;
      });
      tries++;
      // Часто, пока что-то идёт или пока ждём появления запрошенного
      // прогона; потом редко — просто чтобы список не устаревал.
      const soon = live || ((want || wantSlug) && tries < 15);
      setTimeout(tick, soon ? 2000 : 15000);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [loadRuns, want, wantSlug]);

  // Живой опрос: пока прогон идёт, тянем только НОВЫЕ события (since=seq).
  useEffect(() => {
    if (!open) return;
    let alive = true;
    let since = 0;
    setEvents([]);
    setRelated([]);
    setSelected(null);
    const children = runsRef.current.filter((r) => r.parent === open);
    if (children.length) {
      Promise.all(
        children.map(async (run) => {
          const j = await (await fetch(`/api/runs?id=${run.id}`)).json();
          return { run, events: (j.events || []) as Event[] };
        })
      ).then((rows) => {
        if (alive) setRelated(rows);
      });
    }
    const tick = async () => {
      if (!alive) return;
      const j = await (await fetch(`/api/runs?id=${open}&since=${since}`)).json();
      if (!alive) return;
      if (j.events?.length) {
        since = j.last;
        setEvents((prev) => [...prev, ...j.events]);
      }
      setSum(j.summary || null);
      if (j.summary?.status === "идёт") setTimeout(tick, 1200);
      else loadRuns();
    };
    tick();
    return () => {
      alive = false;
    };
  }, [open, loadRuns]);

  useEffect(() => {
    if (follow && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [events, follow]);

  useEffect(() => {
    if (!selected || selected.lane !== open || !feed.current) return;
    feed.current.querySelector(`[data-seq="${selected.event.seq}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const steps = events.filter((e) => e.kind === "step_start");
  const ends = new Map(events.filter((e) => e.kind === "step_end").map((e) => [e.name, e]));
  const cands = events.filter((e) => e.kind === "candidate");
  const calls = events.filter((e) => e.kind === "model_call");
  const verdicts = events.filter((e) => e.kind === "verdict");
  const tokens = calls.reduce(
    (a, c) => a + Number(c.tokens_in || 0) + Number(c.tokens_out || 0),
    0
  );
  /* Лента показывает шаги, ходы модели и вердикты ворот ОДНИМ потоком:
     важен порядок событий, а не их вид. */
  const stream = events.filter((e) =>
    ["step_start", "note", "model_call", "verdict"].includes(e.kind)
  );
  const running = sum?.status === "идёт";
  if (!runs) return <Skeleton tiles={4} />;

  const grouped = runs.reduce<Record<string, Run[]>>((groups, run) => {
    const key = run.slug || tr("без slug", "no slug");
    (groups[key] ||= []).push(run);
    return groups;
  }, {});
  const visible = (run: Run) => filter === "all" || (filter === "active" ? run.status === "идёт" : run.candidates > 0);

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Прогоны", "Runs")}</h1>
          <p className="sub">
            {tr("Что делали инструменты и модель, по шагам и в прямом эфире. Источник —", "What the tools and model did, step by step and live. Source:")}{" "}
            <code>runs/*.jsonl</code>, {tr("те же файлы пишет консоль.", "the same files are written by the CLI.")}
          </p>
        </div>
        <div className="row">
          {running ? <Status tone="accent" pulse>{tr("идёт", "running")}</Status> : null}
          <Link className="btn primary" href="/targets">
            {tr("Мишени", "Targets")}
          </Link>
        </div>
      </div>

      <div className="split">
        <Panel title={tr("Таймлайн", "Timeline")} meta={`${runs.length}`} flush>
          <div className="run-filters" role="group" aria-label={tr("Фильтр прогонов", "Run filter")}>
            {(["all", "active", "leads"] as const).map((value) => <button key={value} className={`btn xs ${filter === value ? "primary" : "ghost"}`} onClick={() => setFilter(value)}>
              {value === "all" ? tr("все", "all") : value === "active" ? tr("активные", "active") : tr("с зацепками", "leads")}
            </button>)}
          </div>
          <div className="runlist">
            {Object.entries(grouped).map(([slug, rows]) => {
              const shown = rows.filter(visible);
              if (!shown.length) return null;
              const isOpen = expanded[slug] ?? rows.some((run) => run.id === open);
              const groupTitle = rows[0]?.target || slug;
              const latestByAction = new Map<string, Run>();
              for (const run of shown) if (!latestByAction.has(run.action)) latestByAction.set(run.action, run);
              const compact = [...latestByAction.values()];
              const selectedRun = shown.find((run) => run.id === open);
              if (selectedRun && !compact.some((run) => run.id === selectedRun.id)) compact.push(selectedRun);
              compact.sort((a, b) => b.at.localeCompare(a.at));
              const visibleRuns = history[slug] ? shown : compact;
              const hiddenCount = shown.length - compact.length;
              return <div className="run-group" key={slug}>
                <button className="run-group-head" onClick={() => setExpanded((old) => ({ ...old, [slug]: !isOpen }))} aria-expanded={isOpen}>
                  <span>{isOpen ? "▾" : "▸"} <b>{groupTitle}</b><small>{slug}</small></span><span className="badge sm">{shown.length}</span>
                </button>
                {isOpen ? visibleRuns.map((r) => (
              <button
                key={r.id}
                className={`runrow ${r.id === open ? "on" : ""}`}
                onClick={() => {
                  touched.current = true;
                  setSelected(null);
                  setOpen(r.id);
                }}
              >
                <span className="runrow-t">
                  <b>{r.action.toUpperCase()}</b>
                  <span className={`badge sm ${r.status === "идёт" ? "running" : r.failed ? "danger" : r.candidates ? "warning" : "done"}`}>
                    {r.status === "идёт" ? tr("идёт", "running") : r.failed ? tr("ошибка", "error") : r.candidates ? tr("зацепки", "leads") : tr("готово", "done")}
                  </span>
                </span>
                <span className="snip mono">
                  {r.at.slice(5, 10)} {time(r.at)} · {tr("шагов", "steps")} {r.done}/{r.steps}
                  {r.candidates ? ` · ${r.candidates} ${tr("зацепок", "leads")}` : ""}
                  {r.status === "идёт" ? ` · ${tr("идёт", "running")}` : r.ms ? ` · ${dur(r.ms, locale)}` : ""}
                  {r.failed ? ` · ${tr("ошибок", "errors")} ${r.failed}` : ""}
                  {r.incomplete ? ` · ${tr("НЕПОЛНЫЙ", "INCOMPLETE")}` : ""}
                </span>
              </button>
                )) : null}
                {isOpen && hiddenCount > 0 ? (
                  <button className="run-history-toggle" onClick={() => setHistory((old) => ({ ...old, [slug]: !old[slug] }))}>
                    {history[slug]
                      ? tr("скрыть историю", "hide history")
                      : tr("ещё {count} старых прогонов", "{count} older runs", { count: hiddenCount })}
                  </button>
                ) : null}
              </div>;
            })}
            {runs.length === 0 ? <Empty>{tr("Прогонов ещё не было.", "No runs yet.")}</Empty> : null}
          </div>
        </Panel>

        <div className="grid" style={{ gap: 12 }}>
          {sum ? (
            <div className="grid stats" style={{ marginBottom: 0 }}>
              <Stat label={tr("мишень", "target")} value={<span style={{ fontSize: 15 }}>{sum.target}</span>} hint={sum.action} />
              <Stat label={tr("шагов", "steps")} value={`${sum.done}/${sum.steps}`} hint={sum.failed ? `${tr("ошибок", "errors")} ${sum.failed}` : undefined} />
              <Stat label={tr("зацепок", "leads")} value={sum.candidates} hint={tr("файл:строка из вывода", "file:line from output")} />
              {calls.length ? (
                <Stat
                  label={tr("ходов модели", "model calls")}
                  value={calls.length}
                  hint={tokens ? `${tokens.toLocaleString()} ${tr("токенов", "tokens")}` : undefined}
                />
              ) : null}
              {verdicts.length ? (
                <Stat
                  label={tr("ворота", "gates")}
                  value={`${verdicts.filter((v) => v.ok).length}/${verdicts.length}`}
                  hint={tr("подтверждено сверкой с кодом", "confirmed against code")}
                />
              ) : null}
              <Stat label={tr("время", "time")} value={running ? tr("идёт", "running") : dur(sum.ms, locale) || "—"} />
            </div>
          ) : null}

          {sum && events.length ? (
            <Panel
              title={tr("Ход выполнения", "Execution")}
              meta={related.length ? `${tr("агентов", "agents")} ${related.length + 1}` : tr("один процесс", "single process")}
              flush
            >
              <ExecutionTimeline run={sum} events={events} related={related} selected={selected} onSelect={setSelected} />
            </Panel>
          ) : null}

          {sum?.unexplained && !sum?.incomplete ? (
            <Callout tone="warning" title={tr("Ноль без объяснения", "Zero with no reason")}>
              {tr(
                "Прогон завершился успехом, но не дал ни одной зацепки и нигде не сказал почему. Это не «чисто», а «неизвестно»: ровно так выглядели Starknet и Spark, где скан шёл по недокачанному исходнику. Стоит открыть шаги и посмотреть, что на самом деле запускалось.",
                "The run finished successfully, produced no leads, and never said why. That is not \u00abclean\u00bb, it is \u00abunknown\u00bb: exactly how Starknet and Spark looked when the scan ran against a half-downloaded source. Open the steps and check what actually ran.")}
            </Callout>
          ) : null}

          {sum?.incomplete ? (
            <Callout tone="warning" title={tr("Прогон неполный", "Incomplete run")}>
              {tr("Исходник не был скачан, поэтому сигналы от дерева (siblings, statesync, ungated, msgauth) не запускались. Ноль зацепок здесь означает «не смотрели», а не «чисто». Скан теперь скачивает исходник сам, так что этот случай значит, что скачать не удалось: смотри прогон", "Source code was not downloaded, so tree signals (siblings, statesync, ungated, msgauth) did not run. Zero leads means “not checked”, not “clean”. Scans now download source automatically, so this means the download failed: see the")}{" "}
              <code>prep</code> {tr("по этой мишени — какие репозитории не дались.", "run for this target to see which repositories failed.")}
            </Callout>
          ) : null}

          <Panel
            title={tr("Шаги", "Steps")}
            meta={running ? tr("в прямом эфире", "live") : tr("завершён", "completed")}
            actions={
              <label className="btn ghost xs">
                <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> {tr("следить", "follow")}
              </label>
            }
            flush
          >
            <div className="feed" ref={feed}>
              {stream.map((e) => {
                if (e.kind === "step_start") {
                  const end = ends.get(e.name);
                  const bad = end?.status === "err";
                  return (
                    <button data-seq={e.seq}
                      key={e.seq}
                      className={`feedrow ${selected?.event.seq === e.seq ? "on" : ""}`}
                      onClick={() => {
                        setSelected(selected?.event.seq === e.seq ? null : { event: e, end, lane: open });
                      }}
                    >
                      <span className="mono feed-time">{time(e.ts)}</span>
                      <span className={`dot ${bad ? "bad" : end ? "ok" : "run"}`} />
                      <span className="feed-name">{e.name}</span>
                      <span className="snip mono feed-meta">
                        {end
                          ? `${end.lines ?? 0} ${tr("строк", "lines")}${end.hits ? ` · ${end.hits} ${tr("зацепок", "leads")}` : ""} · ${dur(end.ms, locale)}`
                          : tr("идёт…", "running…")}
                      </span>
                    </button>
                  );
                }
                if (e.kind === "model_call") {
                  const named = (e.calls as string[] | undefined) || [];
                  return (
                    <button data-seq={e.seq} key={e.seq} className={`feedrow model ${selected?.event.seq === e.seq ? "on" : ""}`} onClick={() => setSelected(selected?.event.seq === e.seq ? null : { event: e, lane: open })}>
                      <span className="mono feed-time">{time(e.ts)}</span>
                      <span className="dot model" />
                      <span className="feed-name">
                        {tr("модель", "model")} {String(e.model)} ({String(e.tier)}) →{" "}
                        {named.length ? named.join(", ") : tr("ответ текстом", "text response")}
                      </span>
                      <span className="snip mono feed-meta">
                        {e.tokens_in ? `${e.tokens_in}→${e.tokens_out ?? 0} ${tr("ткн", "tok")}` : ""}
                      </span>
                    </button>
                  );
                }
                if (e.kind === "verdict") {
                  return (
                    <button data-seq={e.seq} key={e.seq} className={`feedrow verdict ${e.ok ? "" : "no"} ${selected?.event.seq === e.seq ? "on" : ""}`} onClick={() => setSelected(selected?.event.seq === e.seq ? null : { event: e, lane: open })}>
                      <span className="mono feed-time">{time(e.ts)}</span>
                      <span className={`dot ${e.ok ? "ok" : "bad"}`} />
                      <span className="feed-name">
                        {tr("ворота", "gate")}: {e.ok ? tr("подтверждено", "confirmed") : tr("отклонено", "rejected")} — {String(e.file).split(/[\\/]/).pop()}
                        {e.line ? `:${e.line}` : ""} {e.symbol ? `:: ${e.symbol}` : ""}
                      </span>
                      <span className="snip mono feed-meta">{String(e.reason || "").slice(0, 40)}</span>
                    </button>
                  );
                }
                return (
                  <button data-seq={e.seq} key={e.seq} className={`feedrow note ${selected?.event.seq === e.seq ? "on" : ""}`} onClick={() => setSelected(selected?.event.seq === e.seq ? null : { event: e, lane: open })}>
                    <span className="mono feed-time">{time(e.ts)}</span>
                    <span className="dot" />
                    <span className="feed-name">{signalText(e.text, locale)}</span>
                  </button>
                );
              })}
              {stream.length === 0 ? <Empty>{tr("События появятся, как только прогон начнётся.", "Events will appear when the run starts.")}</Empty> : null}
            </div>
          </Panel>

          <Panel title={tr("Зацепки", "Leads")} meta={`${cands.length}`} flush>
            {cands.length ? (
              <table>
                <thead>
                  <tr>
                    <th>{tr("файл", "file")}</th>
                    <th className="num">{tr("строка", "line")}</th>
                    <th>{tr("чем смущает", "concern")}</th>
                    <th>{tr("сигнал", "signal")}</th>
                  </tr>
                </thead>
                <tbody>
                  {cands.slice(0, 60).map((c) => (
                    <tr key={c.seq} className={selected?.event.seq === c.seq ? "event-row-selected" : ""} onClick={() => setSelected(selected?.event.seq === c.seq ? null : { event: c, lane: open })}>
                      <td className="mono">{String(c.file).split(/[\\/]/).pop()}</td>
                      <td className="num mono">{c.line}</td>
                      <td className="snip">{signalText(c.why, locale)}</td>
                      <td className="mono snip">{c.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{tr("Зацепок пока нет — это нормально: большинство сигналов молчат.", "No leads yet; this is normal, as most signals stay quiet.")}</Empty>
            )}
          </Panel>

          <Callout tone="info" title={tr("Что здесь считается зацепкой", "What counts as a lead")}>
            {tr("Строка вывода инструмента с точным адресом", "A tool output line with an exact")} <code>{tr("файл:строка", "file:line")}</code>.{" "}
            {tr("Это ВОПРОС к коду, а не находка: подтверждает её чтение и PoC, а не журнал.", "It is a QUESTION about the code, not a finding: code review and a PoC confirm it, not the log.")}
          </Callout>
        </div>
      </div>
      <EventDetail selection={selected} onClose={() => setSelected(null)} />
    </>
  );
}

type Lane = { run: Run; events: Event[] };
type Span = {
  id: string;
  label: string;
  tool: string;
  start: number;
  end: number;
  status: string;
  hits: number;
};

function stamp(ts: string) {
  const n = Date.parse(ts || "");
  return Number.isFinite(n) ? n : 0;
}

function spansOf(events: Event[], fallbackLabel: string): Span[] {
  const open = new Map<string, Event[]>();
  const spans: Span[] = [];
  for (const e of events) {
    if (e.kind === "step_start") {
      const key = String(e.name || e.seq);
      const list = open.get(key) || [];
      list.push(e);
      open.set(key, list);
    }
    if (e.kind === "step_end") {
      const key = String(e.name || e.seq);
      const start = open.get(key)?.shift();
      if (!start) continue;
      spans.push({
        id: `${start.seq}-${e.seq}`,
        label: String(start.name || start.tool || fallbackLabel),
        tool: String(start.tool || ""),
        start: stamp(start.ts),
        end: stamp(e.ts) || stamp(start.ts) + Number(e.ms || 1),
        status: String(e.status || "ok"),
        hits: Number(e.hits || 0),
      });
    }
  }
  for (const list of open.values()) {
    for (const start of list) {
      spans.push({
        id: `${start.seq}-live`,
        label: String(start.name || start.tool || fallbackLabel),
        tool: String(start.tool || ""),
        start: stamp(start.ts),
        end: Date.now(),
        status: "run",
        hits: 0,
      });
    }
  }
  return spans;
}

function shortStep(s: string) {
  return s
    .replace(/\(.*/, "")
    .replace(/_[a-z0-9_-]+__[a-z0-9_-]+$/i, "")
    .replace(/^agent\s+/, "agent · ");
}

function LegacyExecutionTimeline({
  run,
  events,
  related,
}: {
  run: Run;
  events: Event[];
  related: Lane[];
}) {
  const { locale, tr } = useLocale();
  const lanes: Lane[] = [{ run, events }, ...related];
  const all = lanes.flatMap((l) => l.events);
  const times = all.map((e) => stamp(e.ts)).filter(Boolean);
  const min = Math.min(...times);
  const maxEvent = Math.max(...times);
  const live = lanes.some((l) => l.run.status === "идёт");
  const max = Math.max(min + 1000, live ? Date.now() : maxEvent);
  const total = max - min;
  const x = (n: number) => Math.max(0, Math.min(100, ((n - min) / total) * 100));
  const marks = Array.from({ length: 6 }, (_, i) => min + (total * i) / 5);

  const pipeline = events
    .filter((e) => ["step_start", "model_call", "verdict"].includes(e.kind))
    .slice(0, 18);

  return (
    <div className="exec-wrap">
      <div className="pipe-head">
        <span className="kit-label">{tr("СХЕМА ПАЙПЛАЙНА", "PIPELINE FLOW")}</span>
        <span className="snip">{tr("логический порядок — слева направо", "logical order — left to right")}</span>
      </div>
      <div className="pipe-flow">
        <div className="pipe-node start">
          <span className="pipe-k">{tr("СТАРТ", "START")}</span>
          <b>{run.action}</b>
        </div>
        {pipeline.map((e) => (
          <div className="pipe-chain" key={`pipe-${e.seq}`}>
            <span className="pipe-arrow" />
            <div className={`pipe-node ${e.kind}`}>
              <span className="pipe-k">
                {e.kind === "model_call" ? tr("МОДЕЛЬ", "MODEL") : e.kind === "verdict" ? tr("ВОРОТА", "GATE") : tr("ИНСТРУМЕНТ", "TOOL")}
              </span>
              <b>
                {e.kind === "model_call"
                  ? String(e.model || tr("модель", "model"))
                  : e.kind === "verdict"
                    ? String(e.ok ? tr("подтверждено", "confirmed") : tr("отклонено", "rejected"))
                    : shortStep(String(e.name || e.tool || tr("шаг", "step")))}
              </b>
            </div>
          </div>
        ))}
        <div className="pipe-chain">
          <span className="pipe-arrow" />
          <div className="pipe-node finish">
            <span className="pipe-k">{tr("КОНЕЦ", "END")}</span>
            <b>{run.status === "идёт" ? tr("идёт", "running") : run.status}</b>
          </div>
        </div>
      </div>

      <div className="exec-divider" />

      <div className="pipe-head">
        <span className="kit-label">{tr("ФАКТИЧЕСКОЕ ВРЕМЯ", "ACTUAL TIME")}</span>
        <span className="snip">{dur(total, locale)} · {tr("полосы — работа, ромбы — решения модели/ворот", "bars are work, diamonds are model/gate decisions")}</span>
      </div>
      <div className="exec-scroll">
        <div className="exec-chart">
          <div className="exec-axis">
            <div className="exec-lane-label" />
            <div className="exec-track">
              {marks.map((m) => (
                <div className="exec-tick" key={m} style={{ left: `${x(m)}%` }}>
                  <span>{time(new Date(m).toISOString())}</span>
                </div>
              ))}
            </div>
          </div>
          {lanes.map((lane, li) => {
            const spans = spansOf(lane.events, tr("шаг", "step"));
            const points = lane.events.filter((e) => ["model_call", "verdict", "candidate", "note"].includes(e.kind));
            return (
              <div className="exec-lane" key={lane.run.id}>
                <div className="exec-lane-label">
                  <b>{li === 0 ? tr("оркестратор", "orchestrator") : `${tr("агент", "agent")} ${li}`}</b>
                  <span>{lane.run.target}</span>
                  <small>{lane.run.model || lane.run.action}</small>
                </div>
                <div className="exec-track">
                  {marks.map((m) => (
                    <span className="exec-gridline" key={m} style={{ left: `${x(m)}%` }} />
                  ))}
                  {spans.map((s, i) => {
                    const left = x(s.start);
                    const width = Math.max(0.7, x(s.end) - left);
                    return (
                      <div
                        key={s.id}
                        className={`exec-bar ${s.status === "err" ? "bad" : s.status === "run" ? "live" : ""}`}
                        style={{ left: `${left}%`, width: `${width}%`, top: `${10 + (i % 3) * 19}px` }}
                        title={`${s.label}\n${dur(s.end - s.start, locale)}${s.hits ? ` · ${s.hits} ${tr("зацепок", "leads")}` : ""}`}
                      >
                        <span>{shortStep(s.label)}</span>
                      </div>
                    );
                  })}
                  {points.map((p, i) => (
                    <span
                      key={`point-${p.seq}`}
                      className={`exec-point ${p.kind} ${p.ok === false ? "bad" : ""}`}
                      style={{ left: `${x(stamp(p.ts))}%`, top: `${14 + (i % 3) * 19}px` }}
                      title={
                        p.kind === "model_call"
                          ? `${tr("модель", "model")}: ${String(p.model || "")}`
                          : p.kind === "verdict"
                            ? `${tr("ворота", "gate")}: ${p.ok ? tr("подтверждено", "confirmed") : tr("отклонено", "rejected")}`
                            : `${p.kind}: ${signalText(p.why || p.text || "", locale)}`
                      }
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="exec-legend">
        <span><i className="leg bar" /> {tr("инструмент / задача", "tool / task")}</span>
        <span><i className="leg model" /> {tr("модель", "model")}</span>
        <span><i className="leg gate" /> {tr("ворота", "gate")}</span>
        <span><i className="leg bad" /> {tr("ошибка / отказ", "error / rejection")}</span>
      </div>
    </div>
  );
}
