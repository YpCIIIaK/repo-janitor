"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { Callout, Empty, Panel, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Finding = { id: string; cls: string; severity: string; title: string; question: string; evidence: string };

function ReportInner() {
  const { tr } = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const id = sp.get("id") || "";
  const slug = sp.get("slug") || "";
  const hit = sp.get("hit") || "";
  const [md, setMd] = useState("");
  const [title, setTitle] = useState("");
  const [finding, setFinding] = useState<Finding | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const u = id ? `/api/web/report?id=${encodeURIComponent(id)}` : slug && hit ? `/api/web/report?slug=${encodeURIComponent(slug)}&hit=${encodeURIComponent(hit)}` : "";
    if (!u) return;
    fetch(u)
      .then((r) => r.json())
      .then((j) => {
        if (j.error) return setErr(j.error);
        setMd(j.md || "");
        setTitle(j.title || j.finding?.title || "");
        setFinding(j.finding || null);
      });
  }, [id, slug, hit]);

  async function persist() {
    if (!finding || !slug) return;
    setSaving(true);
    const j = await (
      await fetch("/api/web/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "surface",
          slug,
          title: finding.title,
          cls: finding.cls,
          question: finding.question,
          evidence: finding.evidence,
          severity: finding.severity,
        }),
      })
    ).json();
    setSaving(false);
    if (j.id) router.replace(`/web/report?id=${j.id}`);
    else setErr(j.error || "");
  }

  if (!id && !hit) {
    return (
      <Empty>
        {tr("Отчёт открывается из скана или карты.", "Open a report from a scan or the map.")}{" "}
        <Link href="/web/map">{tr("Карта", "Map")}</Link>
      </Empty>
    );
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>{title || tr("Отчёт", "Report")}</h1>
          <p className="sub">{id ? tr("черновик для портала программы", "draft for the program portal") : tr("сигнал скана — можно сохранить как отчёт", "scan signal — you can save it as a report")}</p>
        </div>
        <div className="row">
          <Link className="btn outline" href="/web/map">
            {tr("Карта", "Map")}
          </Link>
          {finding && !id ? (
            <button className="btn primary" disabled={saving} onClick={persist}>
              {tr("Сохранить отчёт", "Save report")}
            </button>
          ) : null}
          {md ? (
            <button
              className="btn primary"
              onClick={async () => {
                await navigator.clipboard.writeText(md);
                setCopied(tr("скопировано", "copied"));
              }}
            >
              {tr("Копировать", "Copy")}
            </button>
          ) : null}
        </div>
      </div>
      {copied ? <Status tone="success">{copied}</Status> : null}
      {err ? <Callout tone="danger" title="err">{err}</Callout> : null}
      {finding ? (
        <Panel title={finding.title} meta={finding.severity}>
          <p>{finding.question}</p>
          <pre>{finding.evidence}</pre>
        </Panel>
      ) : null}
      {md ? (
        <Panel title={tr("Текст отчёта", "Report text")}>
          <pre style={{ maxHeight: "60vh" }}>{md}</pre>
        </Panel>
      ) : (
        <Empty>
          <Status pulse>{tr("загрузка", "loading")}</Status>
        </Empty>
      )}
    </>
  );
}

export default function WebReportPage() {
  return (
    <Suspense>
      <ReportInner />
    </Suspense>
  );
}
