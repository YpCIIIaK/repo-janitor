"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, Panel } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

export default function AuditsPage() {
  const { tr } = useLocale();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);

  async function load() {
    const p = q ? `?q=${encodeURIComponent(q)}` : "";
    setRows(await (await fetch(`/api/audits${p}`)).json());
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Аудиты", "Audits")}</h1>
          <p className="sub">{tr("Тексты из data/audits и */audits-text. Ищи заплатки, Fixed, половины.", "Texts from data/audits and */audits-text. Search for patches, Fixed, and incomplete fixes.")}</p>
        </div>
      </div>
      <div className="filters">
        <input className="grow" placeholder="fixed, commit, underflow…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load()} />
        <button className="btn primary sm" onClick={load}>
          {tr("Искать", "Search")}
        </button>
      </div>
      <Panel title={tr("Тексты аудитов", "Audit texts")} meta={tr("{count} файлов", "{count} files", { count: rows.length })} flush>
        <table>
          <thead>
            <tr>
              <th>{tr("файл", "file")}</th>
              <th>{tr("путь", "path")}</th>
              <th className="num">{tr("байт", "bytes")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={String(r.id)}>
                <td>
                  <Link href={`/audits/${r.id}`}>{String(r.title)}</Link>
                </td>
                <td className="snip mono">{String(r.source_path)}</td>
                <td className="num mono">{Number(r.bytes).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty>{tr("Ничего не нашлось.", "Nothing found.")}</Empty> : null}
      </Panel>
    </>
  );
}
