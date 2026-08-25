"use client";

import { useEffect, useState } from "react";
import { Empty, Panel } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

export default function DisclosedPage() {
  const { tr } = useLocale();
  const [q, setQ] = useState("");
  const [sev, setSev] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  async function load() {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (sev) p.set("severity", sev);
    setRows(await (await fetch(`/api/disclosed?${p}`)).json());
  }
  useEffect(() => {
    load();
  }, [sev]);

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Открытые находки HP (топ-100)", "HP disclosed findings (top 100)")}</h1>
          <p className="sub">{tr("Паттерны, за которые уже платили. Не дублируй. Копируй классы в свой hunt.", "Patterns that have already been rewarded. Avoid duplicates. Copy classes into your hunt.")}</p>
        </div>
      </div>
      <div className="filters">
        <input className="grow" placeholder="cap, underflow, 7702…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <select value={sev} onChange={(e) => setSev(e.target.value)}>
          <option value="">{tr("все уровни", "all severities")}</option>
          <option value="Critical">{tr("Критический", "Critical")}</option>
          <option value="High">{tr("Высокий", "High")}</option>
          <option value="Medium">{tr("Средний", "Medium")}</option>
          <option value="Low">{tr("Низкий", "Low")}</option>
        </select>
        <button className="btn primary sm" onClick={load}>
          {tr("Искать", "Search")}
        </button>
      </div>
      <Panel title={tr("Чужие находки", "Disclosed findings")} meta={tr("{count} шт", "{count} total", { count: rows.length })} flush>
        <table>
          <thead>
            <tr>
              <th style={{ width: 90 }}>{tr("уровень", "severity")}</th>
              <th>{tr("находка", "finding")}</th>
              <th>{tr("программа", "program")}</th>
              <th className="num">$</th>
              <th>{tr("автор", "author")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>
                  <span className={`badge sm ${r.severity}`}>{String(r.severity)}</span>
                </td>
                <td>
                  {r.url ? (
                    <a href={String(r.url)} target="_blank" rel="noreferrer">
                      {String(r.title)}
                    </a>
                  ) : (
                    String(r.title)
                  )}
                </td>
                <td className="snip">{String(r.program)}</td>
                <td className="num mono">{r.bounty != null ? String(r.bounty) : "—"}</td>
                <td className="mono">@{String(r.handle)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty>{tr("Ничего не нашлось.", "Nothing found.")}</Empty> : null}
      </Panel>
    </>
  );
}
