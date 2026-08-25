"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Callout, Empty, Panel, Stat } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Hit = { site: string; pid: string; name: string; url: string; reward: number };

export default function WebDesk() {
  const { tr } = useLocale();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [pick, setPick] = useState<Hit | null>(null);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [n, setN] = useState(0);

  useEffect(() => {
    fetch("/api/web/stats")
      .then((r) => r.json())
      .then((j) => setN(j.findings?.n || 0));
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) {
        setHits([]);
        return;
      }
      const j = await (await fetch(`/api/market?web=1&sc=0&q=${encodeURIComponent(q)}&limit=12`)).json();
      setHits(j.rows || []);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const ready = Boolean(pick || /^https:\/\/[^/]+/i.test(url.trim()));
  const label = useMemo(() => {
    if (pick) return pick.name;
    if (url.trim()) return url.trim();
    return "";
  }, [pick, url]);

  async function scan() {
    setErr("");
    setBusy(true);
    try {
      let slug = "";
      if (pick) {
        const j = await (
          await fetch("/api/web/targets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ add: [`${pick.site}:${pick.pid}`] }),
          })
        ).json();
        if (j.error) throw new Error(j.error);
        const list = await (await fetch("/api/web/targets")).json();
        const row = (list.rows || []).find((r: { pid: string; site: string }) => r.site === pick.site && r.pid === pick.pid);
        slug = row?.slug;
      } else {
        const j = await (
          await fetch("/api/web/targets", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ custom: { url: url.trim() } }),
          })
        ).json();
        if (j.error) throw new Error(j.error);
        slug = j.slug;
      }
      if (!slug) throw new Error(tr("не удалось завести сайт", "could not add site"));
      router.push(`/web/scan?slug=${encodeURIComponent(slug)}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "err");
      setBusy(false);
    }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Веб-аудит", "Web audit")}</h1>
          <p className="sub">
            {tr("Выбери программу или вставь https:// → Скан. Потом отчёт. XSS/SQLi не шлём.", "Pick a program or paste https:// → Scan. Then a report. No XSS/SQLi.")}
          </p>
        </div>
        <Stat label={tr("сигналов", "signals")} value={n} />
      </div>

      <Panel title={tr("Что сканируем", "What to scan")}>
        <input
          className="grow"
          style={{ width: "100%", marginBottom: 8 }}
          placeholder={tr("начни имя программы с рынка…", "type a program name…")}
          value={pick ? pick.name : q}
          onChange={(e) => {
            setPick(null);
            setQ(e.target.value);
          }}
        />
        {hits.length && !pick ? (
          <ul className="k-flush" style={{ marginBottom: 12 }}>
            {hits.map((h) => (
              <li key={`${h.site}:${h.pid}`}>
                <button
                  className="btn ghost"
                  style={{ width: "100%", textAlign: "left" }}
                  onClick={() => {
                    setPick(h);
                    setQ(h.name);
                    setHits([]);
                    setUrl("");
                  }}
                >
                  {h.name} <span className="snip mono">{h.site}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="snip" style={{ margin: "8px 0" }}>
          {tr("или любой https, на который есть право", "or any https you are allowed to test")}
        </div>
        <input
          className="grow"
          style={{ width: "100%" }}
          placeholder="https://app.example.com/"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setPick(null);
          }}
        />

        {label ? (
          <p style={{ marginTop: 12 }}>
            {tr("Выбрано:", "Selected:")} <b>{label}</b>
          </p>
        ) : null}

        {err ? (
          <div style={{ marginTop: 12 }}>
            <Callout tone="danger" title={tr("Не вышло", "Failed")}>
              {err}
            </Callout>
          </div>
        ) : null}

        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn primary" disabled={!ready || busy} onClick={scan}>
            {busy ? tr("открываю скан…", "opening scan…") : tr("Скан", "Scan")}
          </button>
        </div>
      </Panel>

      <Empty>
        {tr("Карта — список находок после сканов. Отчёт открывается оттуда или со страницы скана.", "The map lists findings after scans. Open a report from there or from the scan page.")}
      </Empty>
    </>
  );
}
