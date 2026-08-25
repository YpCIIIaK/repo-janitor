"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, Panel, Stat, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Pic = {
  stats: Record<string, number>;
  top: Record<string, unknown>[];
  topSolidity: Record<string, unknown>[];
  skip: Record<string, unknown>[];
  leads: Record<string, unknown>[];
  hotspots: Record<string, unknown>[];
  findings: Record<string, unknown>[];
  memory: Record<string, unknown>[];
};

export default function PicturePage() {
  const { tr } = useLocale();
  const [d, setD] = useState<Pic | null>(null);
  const [tab, setTab] = useState<"top" | "leads" | "hotspots" | "findings" | "memory">("top");
  const [memTitle, setMemTitle] = useState("");
  const [memKind, setMemKind] = useState("kill");
  const [memBody, setMemBody] = useState("");
  const statusLabel = (s: string) => (({
    active: tr("активен", "active"), paused: tr("пауза", "paused"), done: tr("готово", "done"),
    lead: tr("зацепка", "lead"), kill: tr("отброшено", "kill"), clean: tr("чисто", "clean"),
    low: tr("низкий", "low"), medium: tr("средний", "medium"), high: tr("высокий", "high"), critical: tr("критический", "critical"),
    trope: tr("шаблон", "pattern"), gate: tr("ворота", "gate"),
  } as Record<string, string>)[s] || s);

  async function load() {
    setD(await (await fetch("/api/picture")).json());
  }
  useEffect(() => {
    load();
  }, []);

  async function addMem() {
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: memKind, title: memTitle, body: memBody, source: "ui" }),
    });
    setMemTitle("");
    setMemBody("");
    await load();
  }

  async function pin(kind: string, title: string, body = "") {
    await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, title, body, source: "pin" }),
    });
    await load();
  }

  if (!d)
    return (
      <Empty>
        <Status tone="accent" pulse>
          {tr("загрузка", "loading")}
        </Status>
      </Empty>
    );
  const money = (v: unknown) => (v == null ? "—" : `$${Number(v).toLocaleString()}`);

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Полный отчёт скана", "Full scan report")}</h1>
          <p className="sub">{tr("Топы, все зацепки и находки, память сканера. Гипотезы модели, не PoC.", "Top programs, all leads and findings, scanner memory. Model hypotheses, not PoCs.")}</p>
        </div>
        <div className="row">
          <Link className="btn outline" href="/scan">
            {tr("Мультискан", "Multi-scan")}
          </Link>
          <button className="btn outline" onClick={load}>
            {tr("Обновить", "Refresh")}
          </button>
        </div>
      </div>

      <div className="grid stats">
        {Object.entries(d.stats).map(([k, v]) => (
          <Stat key={k} label={k} value={v} />
        ))}
      </div>

      <div className="k-group tabs">
        {(
          [
            ["top", tr("Топ", "Top")],
            ["leads", tr("Зацепки", "Leads")],
            ["hotspots", "Hotspots"],
            ["findings", tr("Находки", "Findings")],
            ["memory", tr("Память", "Memory")],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`btn sm ${tab === id ? "primary" : "ghost"}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "top" ? (
        <>
          <div style={{ marginTop: 16 }}>
          <Panel title={tr("Топ Solidity", "Top Solidity")} meta={tr("открытые ворота + зацепки", "open gates + leads")} flush>
            <table>
              <thead>
                <tr>
                  <th>{tr("программа", "program")}</th>
                  <th className="num">{tr("макс.", "max")}</th>
                  <th className="num">{tr("выплачено", "paid")}</th>
                  <th className="num">{tr("заявки", "subs")}</th>
                  <th className="num">{tr("зацепки", "leads")}</th>
                </tr>
              </thead>
              <tbody>
                {d.topSolidity.map((r) => (
                  <tr key={String(r.id)}>
                    <td>
                      <Link href={`/reports/${r.id}`}>{String(r.title)}</Link>
                      <div className="snip mono">{String(r.slug)}</div>
                    </td>
                    <td className="num mono">{money(r.max_bounty)}</td>
                    <td className="num mono">{money(r.paid)}</td>
                    <td className="num mono">{String(r.submissions ?? "—")}</td>
                    <td className="num mono">{String(r.leads_n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          </div>
          <div style={{ marginTop: 12 }}>
          <Panel title={tr("Топ по max bounty", "Top by max bounty")} meta={tr(`${d.top.length} шт`, `${d.top.length} items`)} flush>
            <table>
              <thead>
                <tr>
                  <th>{tr("программа", "program")}</th>
                  <th className="num">{tr("макс.", "max")}</th>
                  <th className="num">{tr("зацепки", "leads")}</th>
                  <th>{tr("язык", "lang")}</th>
                </tr>
              </thead>
              <tbody>
                {d.top.map((r) => (
                  <tr key={String(r.id)}>
                    <td>
                      <Link href={`/reports/${r.id}`}>{String(r.title)}</Link>
                    </td>
                    <td className="num mono">{money(r.max_bounty)}</td>
                    <td className="num mono">{String(r.leads_n)}</td>
                    <td className="snip mono">{String(r.languages || "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          </div>
          <div style={{ marginTop: 12 }}>
          <Panel title={tr("Пропуск", "Skip")} meta={tr("красные ворота", "failed gates")} flush>
            <table>
              <thead>
                <tr>
                  <th>{tr("программа", "program")}</th>
                  <th>{tr("почему", "why")}</th>
                </tr>
              </thead>
              <tbody>
                {d.skip.map((r) => (
                  <tr key={String(r.id)}>
                    <td>
                      <Link href={`/reports/${r.id}`}>{String(r.title)}</Link>
                    </td>
                    <td className="snip">{String(r.gates_notes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          </div>
        </>
      ) : null}

      {tab === "leads" ? (
        <div style={{ marginTop: 16 }}>
        <Panel title={tr("Зацепки", "Leads")} meta={tr(`${d.leads.length} шт`, `${d.leads.length} items`)}>
          {d.leads.length === 0 ? <Empty>{tr("Пусто.", "Empty.")}</Empty> : null}
          {d.leads.map((l) => (
            <div className="item-block" key={String(l.id)}>
              <div>
                <Link href={`/reports/${l.report_id}`}>{String(l.program)}</Link> · <b>{String(l.title)}</b>{" "}
                {l.severity ? <span className={`badge ${l.severity}`}>{statusLabel(String(l.severity))}</span> : null}
                <button className="btn ghost xs" style={{ marginLeft: 8 }} onClick={() => pin("kill", String(l.title), "FP/шаблон с UI")}>
                  {tr("в память как kill", "save to memory as kill")}
                </button>
                <button className="btn ghost xs" onClick={() => pin("trope", String(l.title), "шаблон")}>
                  {tr("шаблон", "pattern")}
                </button>
              </div>
              {l.body ? <pre className="log-sm">{String(l.body)}</pre> : null}
            </div>
          ))}
        </Panel>
        </div>
      ) : null}

      {tab === "hotspots" ? (
        <div style={{ marginTop: 16 }}>
        <Panel title={tr("Горячие точки", "Hotspots")} meta={tr(`${d.hotspots.length} шт`, `${d.hotspots.length} items`)}>
          {d.hotspots.length === 0 ? <Empty>{tr("Пусто.", "Empty.")}</Empty> : null}
          {d.hotspots.map((h) => (
            <div className="item-block" key={String(h.id)}>
              <div>
                <Link href={`/reports/${h.report_id}`}>{String(h.program)}</Link> · <b>{String(h.title)}</b>{" "}
                {h.severity ? <span className={`badge ${h.severity}`}>{statusLabel(String(h.severity))}</span> : null}
              </div>
              {h.body ? <p className="snip">{String(h.body)}</p> : null}
            </div>
          ))}
        </Panel>
        </div>
      ) : null}

      {tab === "findings" ? (
        <div style={{ marginTop: 16 }}>
        <Panel title={tr("Находки", "Findings")} meta={tr(`${d.findings.length} шт`, `${d.findings.length} items`)}>
          {d.findings.length === 0 ? (
            <Empty>{tr("Пока пусто. «Применить» на отчёте пишет LEAD на диск и сюда.", "Empty for now. “Apply” in a report writes a LEAD to disk and here.")}</Empty>
          ) : (
            d.findings.map((f) => (
              <div className="item-block" key={String(f.id)}>
                <div>
                  <span className={`badge ${f.status}`}>{statusLabel(String(f.status))}</span> {String(f.project_title || "")} ·{" "}
                  <b>{String(f.title)}</b>
                  <button className="btn ghost xs" style={{ marginLeft: 8 }} onClick={() => pin(String(f.status || "kill"), String(f.title))}>
                    {tr("в память", "save to memory")}
                  </button>
                </div>
                {f.body ? <pre className="log-sm">{String(f.body).slice(0, 800)}</pre> : null}
              </div>
            ))
          )}
        </Panel>
        </div>
      ) : null}

      {tab === "memory" ? (
        <div style={{ marginTop: 16 }}>
          <div style={{ marginBottom: 12 }}>
          <Panel title={tr("Записать в память", "Save to memory")} meta={tr("идёт в промпт следующего скана", "included in the next scan prompt")}>
            <div className="row">
              <select value={memKind} onChange={(e) => setMemKind(e.target.value)}>
                <option value="kill">{tr("отброшено", "kill")}</option>
                <option value="clean">{tr("чисто", "clean")}</option>
                <option value="trope">{tr("шаблон", "pattern")}</option>
                <option value="gate">{tr("ворота", "gate")}</option>
              </select>
              <input className="grow" placeholder={tr("заголовок", "title")} value={memTitle} onChange={(e) => setMemTitle(e.target.value)} />
              <button className="btn primary" disabled={!memTitle} onClick={addMem}>
                {tr("Записать", "Save")}
              </button>
            </div>
            <textarea
              placeholder={tr("почему / не повторять", "why / do not repeat")}
              value={memBody}
              onChange={(e) => setMemBody(e.target.value)}
              style={{ marginTop: 8, minHeight: 70 }}
            />
            <p className="snip">{tr("Скан сам пишет paused/kill/шаблоны после каждого отчёта.", "The scanner records paused/kill/pattern entries after each report.")}</p>
          </Panel>
          </div>
          <Panel title={tr("Память", "Memory")} meta={tr(`${d.memory.length} записей`, `${d.memory.length} entries`)}>
            {d.memory.length === 0 ? <Empty>{tr("Память пуста.", "Memory is empty.")}</Empty> : null}
            {d.memory.map((m) => (
              <div className="item-block" key={String(m.id)}>
                <div>
                  <span className={`badge ${m.kind}`}>{statusLabel(String(m.kind))}</span> <b>{String(m.title)}</b>
                  <span className="snip"> · w{String(m.weight)}</span>
                  <button
                    className="btn danger xs"
                    style={{ marginLeft: 8 }}
                    onClick={async () => {
                      await fetch(`/api/memory?id=${m.id}`, { method: "DELETE" });
                      await load();
                    }}
                  >
                    {tr("удалить", "delete")}
                  </button>
                </div>
                {m.body ? <p className="snip">{String(m.body)}</p> : null}
              </div>
            ))}
          </Panel>
        </div>
      ) : null}
    </>
  );
}
