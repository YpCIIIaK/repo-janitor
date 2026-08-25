"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Empty, Panel } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Report = {
  id: number;
  title: string;
  summary: string;
  model: string;
  created_at: string;
  project_id: number | null;
  leads_n: number;
  hotspots_n: number;
  kill_n: number;
};

export default function ReportsPage() {
  const { tr } = useLocale();
  const [rows, setRows] = useState<Report[]>([]);

  useEffect(() => {
    fetch("/api/reports")
      .then((r) => r.json())
      .then(setRows);
  }, []);

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Отчёты скана", "Scan reports")}</h1>
          <p className="sub">{tr("Картина по программам: выжимка, hotspots, leads, kill. Можно применить на диск как трек.", "Program overview: summary, hotspots, leads, kill. Can be applied to disk as a track.")}</p>
        </div>
      </div>
      <Panel title={tr("Отчёты", "Reports")} meta={tr(`${rows.length} шт`, `${rows.length} items`)} flush>
        <table>
          <thead>
            <tr>
              <th>{tr("программа", "program")}</th>
              <th className="num">{tr("зацепки", "leads")}</th>
              <th className="num">{tr("горячие точки", "hotspots")}</th>
              <th className="num">{tr("отброшено", "kill")}</th>
              <th>{tr("когда", "when")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/reports/${r.id}`}>
                    <b>{r.title}</b>
                  </Link>
                  <div className="snip">{r.summary?.slice(0, 180)}</div>
                </td>
                <td className="num mono">{r.leads_n}</td>
                <td className="num mono">{r.hotspots_n}</td>
                <td className="num mono">{r.kill_n}</td>
                <td className="snip mono">{String(r.created_at).slice(0, 16)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty>{tr("Пока нет. Поставь программы в очередь и нажми «Сканить».", "None yet. Queue programs and click “Scan”.")}</Empty> : null}
      </Panel>
    </>
  );
}
