"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Callout, Empty, Panel } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

export default function ProgramsPage() {
  const { tr } = useLocale();
  const [q, setQ] = useState("");
  const [eligible, setEligible] = useState(true);
  const [ongoing, setOngoing] = useState(true);
  const [solidity, setSolidity] = useState(true);
  const [data, setData] = useState<{ maxRep: number; count: number; rows: Record<string, unknown>[] } | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");
  const statusLabel = (s: string) => (({ active: tr("активна", "active"), ongoing: tr("идёт", "ongoing"), paused: tr("пауза", "paused"), closed: tr("закрыта", "closed") } as Record<string, string>)[s.toLowerCase()] || s);

  async function load() {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (eligible) p.set("eligible", "1");
    if (ongoing) p.set("ongoing", "1");
    if (solidity) p.set("solidity", "1");
    setData(await (await fetch(`/api/programs?${p}`)).json());
  }
  useEffect(() => {
    load();
  }, [eligible, ongoing, solidity]);

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Программы HackenProof", "HackenProof programs")}</h1>
          <p className="sub">
            {tr("Фильтр по твоей репутации", "Filtered by your reputation")} ({data?.maxRep ?? "…"}). {tr("Отметь пачку → в очередь скана.", "Select a batch → scan queue.")}
          </p>
        </div>
        <div className="row">
          <button className="btn outline" onClick={() => {
            const next: Record<string, boolean> = {};
            for (const r of data?.rows || []) next[String(r.slug)] = true;
            setPicked(next);
          }}>
            {tr("Все на экране", "Select all visible")}
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              const slugs = Object.keys(picked).filter((s) => picked[s]);
              const titles: Record<string, string> = {};
              for (const r of data?.rows || []) {
                if (picked[String(r.slug)]) titles[String(r.slug)] = String(r.title);
              }
              const j = await (
                await fetch("/api/jobs", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ slugs, titles }),
                })
              ).json();
              setMsg(tr(`в очередь: ${j.queued ?? j.error}. Открой /queue`, `queued: ${j.queued ?? j.error}. Open /queue`));
            }}
          >
            {tr("В очередь", "Queue")} ({Object.values(picked).filter(Boolean).length})
          </button>
        </div>
      </div>
      {msg ? (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="accent" title={tr("В очередь", "Queued")}>
            {msg} · <Link href="/queue">{tr("открыть очередь", "open queue")}</Link>
          </Callout>
        </div>
      ) : null}
      <div className="filters">
        <input className="grow" placeholder={tr("поиск", "search")} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <label className="btn outline sm">
          <input type="checkbox" checked={eligible} onChange={(e) => setEligible(e.target.checked)} /> ≤ {tr("реп", "rep")}
        </label>
        <label className="btn outline sm">
          <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} /> ongoing BB
        </label>
        <label className="btn outline sm">
          <input type="checkbox" checked={solidity} onChange={(e) => setSolidity(e.target.checked)} /> Solidity
        </label>
        <button className="btn primary sm" onClick={load}>
          {tr("Искать", "Search")}
        </button>
      </div>
      <Panel
        title={tr("Каталог", "Catalog")}
        meta={data ? tr(`${data.count} программ`, `${data.count} programs`) : "…"}
        footer={
          <>
            <span className="kit-label">{tr("отмечено", "selected")} {Object.values(picked).filter(Boolean).length}</span>
            <span className="kit-label">{tr("реп", "rep")} ≤ {data?.maxRep ?? "…"}</span>
          </>
        }
        flush
      >
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th className="num">{tr("реп", "rep")}</th>
              <th>{tr("программа", "program")}</th>
              <th className="num">{tr("макс.", "max")}</th>
              <th className="num">{tr("выплачено", "paid")}</th>
              <th className="num">{tr("заявки", "subs")}</th>
              <th className="num">{tr("комиссия", "fee")}</th>
              <th>{tr("язык", "lang")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows || []).map((r) => (
              <tr key={String(r.slug)}>
                <td>
                  <input
                    type="checkbox"
                    checked={Boolean(picked[String(r.slug)])}
                    onChange={(e) => setPicked({ ...picked, [String(r.slug)]: e.target.checked })}
                  />
                </td>
                <td className="num mono">{String(r.min_rep)}</td>
                <td>
                  <a href={String(r.url)} target="_blank" rel="noreferrer">
                    {String(r.title)}
                  </a>
                  <div className="snip mono">{statusLabel(String(r.status))}</div>
                </td>
                <td className="num mono">{r.max_bounty != null ? Number(r.max_bounty).toLocaleString() : "—"}</td>
                <td className="num mono">{r.paid != null ? Number(r.paid).toLocaleString() : "—"}</td>
                <td className="num mono">{String(r.submissions)}</td>
                <td className="num mono">{String(r.fee ?? "—")}</td>
                <td className="snip mono">{String(r.languages)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.rows.length === 0 ? <Empty>{tr("Ничего не нашлось — ослабь фильтры.", "Nothing found — loosen the filters.")}</Empty> : null}
      </Panel>
    </>
  );
}
