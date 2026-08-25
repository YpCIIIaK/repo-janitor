"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Callout, Empty, Panel, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Item = { id: number; kind: string; title: string; severity: string; body: string };
type Payload = {
  hunted?: boolean;
  gates?: { ok?: boolean; notes?: string; rep?: number; fee?: number };
  summary?: string;
  payouts?: string;
};

export default function ReportPage() {
  const { tr } = useLocale();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [report, setReport] = useState<Record<string, unknown> | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [msg, setMsg] = useState("");
  const statusLabel = (s: string) => (({ low: tr("низкий", "low"), medium: tr("средний", "medium"), high: tr("высокий", "high"), critical: tr("критический", "critical") } as Record<string, string>)[s] || s);
  const kindLabel = (s: string) => (({ lead: tr("Зацепки", "Leads"), hotspot: tr("Горячие точки", "Hotspots"), kill: tr("Отброшено", "Kill"), scope: tr("Область", "Scope"), oos: tr("Вне области", "Out of scope") } as Record<string, string>)[s] || s);

  async function load() {
    const j = await (await fetch(`/api/reports/${id}`)).json();
    setReport(j.report);
    setItems(j.items || []);
  }
  useEffect(() => {
    load();
  }, [id]);

  async function apply() {
    setMsg(tr("пишу на диск…", "writing to disk…"));
    const r = await fetch(`/api/reports/${id}/apply`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) {
      setMsg(j.error || tr("ошибка", "error"));
      return;
    }
    setMsg(
      j.skippedWrite
        ? tr(`трек уже на диске (#${j.projectId}) — NOTES не трогал`, `track already exists on disk (#${j.projectId}) — NOTES unchanged`)
        : tr(`трек #${j.projectId}: зацепки ${j.leads}, hotspots ${j.hotspots}`, `track #${j.projectId}: leads ${j.leads}, hotspots ${j.hotspots}`)
    );
    if (j.projectId) router.push(`/projects/${j.projectId}`);
  }

  if (!report)
    return (
      <Empty>
        <Status tone="accent" pulse>
          {tr("загрузка", "loading")}
        </Status>
      </Empty>
    );
  let payload: Payload = {};
  try {
    payload = JSON.parse(String(report.payload || "{}"));
  } catch {
    payload = {};
  }
  const by = (k: string) => items.filter((i) => i.kind === k);

  return (
    <>
      <div className="top">
        <div>
          <h1>{String(report.title)}</h1>
          <p className="sub">
            {payload.hunted ? <Badge tone="success">{tr("локальный трек", "local track")}</Badge> : null}
          </p>
        </div>
        <div className="row">
          <a className="btn outline" href={`https://hackenproof.com/programs/${report.program_slug}`} target="_blank" rel="noreferrer">
            HP
          </a>
          <button className="btn primary" onClick={apply}>
            {tr("Применить → трек", "Apply → track")}
          </button>
        </div>
      </div>
      {msg ? (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="accent">{msg}</Callout>
        </div>
      ) : null}

      <div className="grid cards">
        <div style={{ gridColumn: "span 2" }}>
        <Panel
          title={tr("Выжимка", "Summary")}
          meta={payload.gates?.ok === false ? tr("ворота красные", "gates failed") : tr("ворота ок", "gates OK")}
          actions={
            <Status tone={payload.gates?.ok === false ? "danger" : "success"}>
              {payload.gates?.ok === false ? tr("красные", "failed") : tr("ок", "OK")}
            </Status>
          }
        >
          {payload.gates?.notes ? (
            <div style={{ marginBottom: 12 }}>
              <Callout tone={payload.gates?.ok === false ? "danger" : "neutral"} title={tr("Ворота", "Gates")}>
                {payload.gates?.notes}
              </Callout>
            </div>
          ) : null}
          <p>{payload.summary || String(report.summary)}</p>
          {payload.payouts ? <p className="snip">{tr("выплаты", "payouts")}: {payload.payouts}</p> : null}
        </Panel>
        </div>
        <Panel title={tr("Картина", "Overview")} meta={tr(`${items.length} пунктов`, `${items.length} items`)}>
          <ul>
            <li>{tr("зацепки", "leads")}: {by("lead").length}</li>
            <li>{tr("горячие точки", "hotspots")}: {by("hotspot").length}</li>
            <li>{tr("отброшено", "kill")}: {by("kill").length}</li>
            <li>{tr("область", "scope")}: {by("scope").length}</li>
            <li>{tr("вне области", "oos")}: {by("oos").length}</li>
          </ul>
          {report.project_id ? (
            <p style={{ marginTop: 12 }}>
              <Link href={`/projects/${report.project_id}`}>{tr("открыть трек →", "open track →")}</Link>
            </p>
          ) : (
            <p className="snip" style={{ marginTop: 12 }}>
              {tr("Ещё не применён на диск.", "Not yet applied to disk.")}
            </p>
          )}
        </Panel>
      </div>

      {(["lead", "hotspot", "kill", "scope", "oos"] as const).map((k) => {
        const list = by(k);
        if (!list.length) return null;
        return (
          <div key={k} style={{ marginTop: 16 }}>
          <Panel title={kindLabel(k)} meta={tr(`${list.length} шт`, `${list.length} items`)}>
            {list.map((i) => (
              <div key={i.id} className="item-block">
                <div>
                  <b>{i.title}</b> {i.severity ? <span className={`badge ${i.severity}`}>{statusLabel(i.severity)}</span> : null}
                </div>
                {i.body ? <pre className="log-sm">{i.body}</pre> : null}
              </div>
            ))}
          </Panel>
          </div>
        );
      })}
    </>
  );
}
