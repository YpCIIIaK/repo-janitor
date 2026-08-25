"use client";

import { useEffect, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";

export default function MethodPage() {
  const { tr } = useLocale();
  const [body, setBody] = useState(() => tr("загрузка…", "loading…"));
  useEffect(() => {
    fetch("/api/documents?kind=method")
      .then((r) => r.json())
      .then(async (rows: { id: number; title: string }[]) => {
        const m = rows.find((x) => x.title === "METHOD") || rows[0];
        if (!m) {
          setBody(tr("Сначала «Индексировать диск» на дашборде.", "Run “Index disk” on the dashboard first."));
          return;
        }
        const doc = await (await fetch(`/api/documents/${m.id}`)).json();
        setBody(doc.body || tr("пусто", "empty"));
      })
      .catch(() => setBody(tr("нет METHOD в индексе", "METHOD is not in the index")));
  }, [tr]);
  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Метод", "Method")}</h1>
          <p className="sub">{tr("data/bounty/METHOD.md — ворота, EV, стоп-лосс.", "data/bounty/METHOD.md — gates, EV, and stop-loss.")}</p>
        </div>
      </div>
      <div className="k-code-wrap">
        <pre style={{ maxHeight: "72vh" }}>{body}</pre>
      </div>
    </>
  );
}
