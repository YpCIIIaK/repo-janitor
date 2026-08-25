"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BarsH, Figure, SERIES, StackedBarsH, STATUS } from "@/components/charts";
import { FindingGroups } from "@/components/web/FindingGroups";
import { Empty, Stat } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Item = {
  kind: "signal" | "report";
  slug: string;
  name: string;
  id: string;
  title: string;
  cls: string;
  severity?: string;
  question?: string;
  at?: string;
  href: string;
};

type Stats = {
  findings: { byCls: Record<string, number>; bySev: Record<string, number>; n: number };
  picked: number;
  items?: Item[];
};

export default function WebMapPage() {
  const { tr } = useLocale();
  const [s, setS] = useState<Stats | null>(null);
  const [only, setOnly] = useState<"all" | "report" | "signal">("all");
  useEffect(() => {
    fetch("/api/web/stats")
      .then((r) => r.json())
      .then(setS);
  }, []);
  const items = useMemo(() => {
    const rows = s?.items || [];
    if (only === "all") return rows;
    return rows.filter((x) => x.kind === only);
  }, [s, only]);
  if (!s) return <Empty>{tr("загрузка", "loading")}</Empty>;
  const cls = Object.entries(s.findings.byCls || {}).sort((a, b) => b[1] - a[1]);
  const sev = s.findings.bySev || {};
  const reports = (s.items || []).filter((x) => x.kind === "report").length;
  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Карта", "Map")}</h1>
          <p className="sub">{tr("По сайтам. Проблемы развёрнуты, остальное — список.", "By site. Issues expanded, the rest is a list.")}</p>
        </div>
        <Link className="btn outline" href="/web">
          {tr("Новый скан", "New scan")}
        </Link>
      </div>
      <div className="grid stats">
        <Stat label={tr("сигналов", "signals")} value={s.findings.n} />
        <Stat label={tr("отчётов", "reports")} value={reports} />
        <Stat label={tr("сайтов", "sites")} value={s.picked} />
      </div>
      <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 16 }}>
        <Figure title={tr("По классу", "By class")}>
          {cls.length ? (
            <BarsH rows={cls.map(([label, value]) => ({ label, value }))} colors={cls.map((_, i) => SERIES[i % SERIES.length])} />
          ) : (
            <Empty>{tr("Сканов ещё не было.", "No scans yet.")}</Empty>
          )}
        </Figure>
        <Figure title={tr("По серьёзности", "By severity")}>
          <StackedBarsH
            rows={[{ label: tr("сейчас", "now"), parts: sev }]}
            keys={["high", "medium", "low", "info"]}
            colors={{ high: STATUS.High, medium: STATUS.Medium, low: STATUS.Low, info: SERIES[0] }}
          />
        </Figure>
      </div>
      <div className="k-group" style={{ margin: "16px 0" }}>
        {(["all", "report", "signal"] as const).map((k) => (
          <button key={k} className={`btn sm ${only === k ? "primary" : "ghost"}`} onClick={() => setOnly(k)}>
            {k === "all" ? tr("все", "all") : k === "report" ? tr("отчёты", "reports") : tr("сигналы", "signals")}
          </button>
        ))}
      </div>
      <FindingGroups items={items} />
    </>
  );
}
