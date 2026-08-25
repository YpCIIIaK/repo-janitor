"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, Empty } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

export default function SearchPage() {
  const { tr } = useLocale();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Record<string, unknown>[]>([]);

  async function go() {
    const j = await (await fetch(`/api/search?q=${encodeURIComponent(q)}`)).json();
    setHits(j.hits || []);
  }

  function href(h: Record<string, unknown>) {
    const origin = String(h.origin);
    const id = String(h.origin_id);
    if (origin.startsWith("doc:")) return `/audits/${id}`;
    if (origin === "finding") return "/findings";
    if (origin === "project") return `/projects/${id}`;
    return "/";
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Поиск", "Search")}</h1>
          <p className="sub">{tr("FTS по NOTES, DIG, аудитам, hotspots и находкам.", "Full-text search across NOTES, DIG, audits, hotspots, and findings.")}</p>
        </div>
      </div>
      <div className="filters">
        <input className="grow" placeholder="lzCompose, 7702, underflow, AA10…" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && go()} />
        <button className="btn primary sm" onClick={go}>
          {tr("Искать", "Search")}
        </button>
      </div>
      {q && hits.length === 0 ? <Empty>{tr("Ничего не нашлось по «{query}».", "Nothing found for “{query}”.", { query: q })}</Empty> : null}
      {hits.map((h, i) => (
        <div className="card" key={i} style={{ marginBottom: 8 }}>
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
            <Link href={href(h)}>
              <b>{String(h.title)}</b>
            </Link>
            <Badge sm>
              {String(h.origin)} · {String(h.origin_id)}
            </Badge>
          </div>
          <p className="snip">{String(h.snip)}</p>
        </div>
      ))}
    </>
  );
}
