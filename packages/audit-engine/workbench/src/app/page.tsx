"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Badge, Callout, Empty, Panel, Stat, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Dash = {
  stats: Record<string, number>;
  hp_reputation: number;
  current: string;
  currentRow: Record<string, unknown> | null;
  projects: Record<string, unknown>[];
  recentFindings: Record<string, unknown>[];
  recentReports?: Record<string, unknown>[];
};

export default function Home() {
  const { tr } = useLocale();
  const [d, setD] = useState<Dash | null>(null);
  const [imp, setImp] = useState<string>("");
  const statusLabel = (s: string) =>
    ({ active: tr("активен", "active"), paused: tr("пауза", "paused"), done: tr("готово", "done"), lead: tr("зацепка", "lead"), kill: tr("отброшено", "kill"), clean: tr("чисто", "clean") } as Record<string, string>)[s] || s;

  async function load() {
    const r = await fetch("/api/dashboard");
    setD(await r.json());
  }
  useEffect(() => {
    load();
  }, []);

  async function doImport() {
    setImp(tr("импорт…", "importing…"));
    const r = await fetch("/api/import", { method: "POST" });
    const j = await r.json();
    setImp(JSON.stringify(j));
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
  const cur = d.currentRow as Record<string, unknown> | null;

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Стол охоты", "Hunt desk")}</h1>
          <p className="sub">{tr("Локальный индекс + очередь скана. Репутация HP:", "Local index + scan queue. HP reputation:")} {d.hp_reputation}</p>
        </div>
        <div className="row">
          <Link className="btn outline" href="/scan">
            {tr("В очередь", "Queue")}
          </Link>
          <button className="btn outline" onClick={doImport}>
            {tr("Индексировать диск", "Index disk")}
          </button>
          <Link className="btn primary" href="/picture">
            {tr("Картина", "Overview")}
          </Link>
        </div>
      </div>
      {imp ? (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="accent" title={tr("Импорт", "Import")}>
            <span className="mono">{imp}</span>
          </Callout>
        </div>
      ) : null}

      <div className="grid stats">
        {Object.entries(d.stats).map(([k, v]) => (
          <Stat key={k} label={k} value={v} />
        ))}
      </div>

      <div className="grid cards">
        <Panel title={tr("Где остановились", "Where we stopped")} meta={cur ? statusLabel(String(cur.status)) : "—"}>
          {cur ? (
            <>
              <p className="row" style={{ justifyContent: "space-between" }}>
                <Link href={`/projects/${cur.id}`}>
                  <b>{String(cur.title)}</b>
                </Link>
                <span className={`badge ${cur.status}`}>{statusLabel(String(cur.status))}</span>
              </p>
              <pre>{String(cur.stopped_at || cur.notes || "").slice(0, 1800)}</pre>
            </>
          ) : (
            <Empty>{tr("Нажми «Индексировать диск», чтобы подтянуть data/bounty.", "Click “Index disk” to load data/bounty.")}</Empty>
          )}
        </Panel>

        <Panel title={tr("Последние отчёты скана", "Latest scan reports")} meta={String((d.recentReports || []).length)}>
          {(d.recentReports || []).length === 0 ? (
            <Empty>{tr("Пусто — отметь программы HP и поставь в очередь.", "Empty — select HP programs and queue them.")}</Empty>
          ) : (
            <ul>
              {(d.recentReports || []).map((r) => (
                <li key={String(r.id)}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <Link href={`/reports/${r.id}`}>{String(r.title)}</Link>
                    <Badge tone="accent" sm>
                      {tr("зацепки", "leads")} {String(r.leads_n)}
                    </Badge>
                  </div>
                  <div className="snip">{String(r.summary || "").slice(0, 120)}</div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={tr("Последние находки", "Latest findings")} meta={String(d.recentFindings.length)}>
          {d.recentFindings.length === 0 ? (
            <Empty>{tr("Пока пусто — заведи LEAD на странице проекта.", "Empty for now — create a LEAD on the project page.")}</Empty>
          ) : (
            <ul>
              {d.recentFindings.map((f) => (
                <li key={String(f.id)}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <Link href="/findings">{String(f.title)}</Link>
                    <span className={`badge sm ${f.status}`}>{statusLabel(String(f.status))}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <div style={{ marginTop: 16 }}>
        <Panel title={tr("Треки", "Tracks")} meta={tr(`${d.projects.length} шт`, `${d.projects.length} items`)} flush>
          <table>
            <thead>
              <tr>
                <th>{tr("проект", "project")}</th>
                <th>{tr("статус", "status")}</th>
                <th className="num">{tr("горячие точки", "hotspots")}</th>
                <th className="num">{tr("находки", "findings")}</th>
              </tr>
            </thead>
            <tbody>
              {d.projects.map((p) => (
                <tr key={String(p.id)}>
                  <td>
                    <Link href={`/projects/${p.id}`}>{String(p.title)}</Link>
                    <div className="snip mono">{String(p.slug)}</div>
                  </td>
                  <td>
                    <span className={`badge sm ${p.status}`}>{statusLabel(String(p.status))}</span>
                  </td>
                  <td className="num">{String(p.hotspots_count)}</td>
                  <td className="num">{String(p.findings_count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>
    </>
  );
}
