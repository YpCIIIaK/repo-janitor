"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useState } from "react";
import { Callout, Empty, Panel, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";
import { isWebProblem } from "@/lib/webSurface";

type Finding = { id: string; cls: string; severity: string; title: string; question: string; evidence: string };
type Probe = { kind: string; url: string; status: number; findings?: Finding[] };
type Site = { slug: string; name: string; hosts: string[]; url?: string };

function ScanInner() {
  const { tr } = useLocale();
  const router = useRouter();
  const sp = useSearchParams();
  const slug = sp.get("slug") || "";
  const [site, setSite] = useState<Site | null>(null);
  const [probes, setProbes] = useState<Probe[]>([]);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(true);
  const [param, setParam] = useState("q");
  const [pageUrl, setPageUrl] = useState("");
  const [markBusy, setMarkBusy] = useState(false);
  const [markMsg, setMarkMsg] = useState("");
  const [loopRunning, setLoopRunning] = useState(false);
  const [loopTail, setLoopTail] = useState("");
  const [loopCands, setLoopCands] = useState<{ kind: string; url: string; impact: string; detail: string }[]>([]);
  const [loopAt, setLoopAt] = useState("");
  type Recon = {
    map?: { count?: number; js_hits?: number; assets?: { path: string; source: string; confidence: number }[] };
    tech?: { category: string; name: string; version: string | null; confidence: number }[];
    cve?: { candidate_count?: number; candidates?: { id: string; package: string; severity?: string; summary?: string }[]; skipped?: { name: string; why: string }[]; unknown?: { name: string; error: string }[] };
    at?: string;
  };
  const [recon, setRecon] = useState<Recon | null>(null);
  const [reconBusy, setReconBusy] = useState(false);

  const run = useCallback(async () => {
    if (!slug) return;
    setBusy(true);
    setErr("");
    const list = await (await fetch("/api/web/targets")).json();
    const s = (list.rows || []).find((r: Site) => r.slug === slug) || null;
    setSite(s);
    const start = s?.hosts?.[0] ? `https://${s.hosts[0]}/` : s?.url || "";
    setPageUrl(start);
    const j = await (
      await fetch("/api/web/surface", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, url: start || undefined }),
      })
    ).json();
    if (j.error) setErr(j.error);
    setProbes(j.probes || []);
    setBusy(false);
  }, [slug]);

  useEffect(() => {
    if (!slug) {
      setBusy(false);
      return;
    }
    run();
  }, [slug, run]);

  const hits = probes.flatMap((p) => (p.findings || []).map((f) => ({ ...f, url: p.url })));
  const problems = hits.filter((f) => isWebProblem(f.severity));
  const noise = hits.filter((f) => !isWebProblem(f.severity));

  async function saveFinding(f: Finding & { url: string }) {
    const j = await (
      await fetch("/api/web/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "surface",
          slug,
          title: f.title,
          cls: f.cls,
          url: f.url,
          question: f.question,
          evidence: f.evidence,
          severity: f.severity,
        }),
      })
    ).json();
    if (j.id) router.push(`/web/report?id=${j.id}`);
    else setErr(j.error || "report");
  }

  async function marker() {
    setMarkBusy(true);
    setMarkMsg("");
    const j = await (
      await fetch("/api/web/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, url: pageUrl, method: "GET", param }),
      })
    ).json();
    if (j.error) {
      setMarkMsg(j.error);
      setMarkBusy(false);
      return;
    }
    if (!j.verdict?.valid) {
      setMarkMsg(j.verdict?.label || tr("не отразилось", "not reflected"));
      setMarkBusy(false);
      return;
    }
    const r = await (
      await fetch("/api/web/report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          title: `${tr("Отражение", "Reflection")} ${param}`,
          cls: "reflection",
          url: j.url,
          param: j.param,
          canary: j.canary,
          status: j.status,
          reflection: j.reflection,
          verdict: j.verdict.next,
        }),
      })
    ).json();
    setMarkBusy(false);
    if (r.id) router.push(`/web/report?id=${r.id}`);
    else setMarkMsg(r.error || "");
  }

  const pollLoop = useCallback(async () => {
    if (!slug) return;
    const j = await (await fetch(`/api/web/run?slug=${encodeURIComponent(slug)}`)).json();
    setLoopRunning(Boolean(j.running));
    setLoopTail(j.tail || "");
    setLoopCands(j.candidates || []);
    setLoopAt(j.at || "");
    return Boolean(j.running);
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    pollLoop();
  }, [slug, pollLoop]);

  useEffect(() => {
    if (!loopRunning) return;
    const id = setInterval(pollLoop, 2500);
    return () => clearInterval(id);
  }, [loopRunning, pollLoop]);

  useEffect(() => {
    if (!slug) return;
    fetch(`/api/web/recon?slug=${encodeURIComponent(slug)}`)
      .then((r) => r.json())
      .then((j) => setRecon(j?.map ? j : null))
      .catch(() => {});
  }, [slug]);

  async function runRecon() {
    setReconBusy(true);
    try {
      const j = await (
        await fetch("/api/web/recon", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug }),
        })
      ).json();
      if (j.error) setErr(j.error);
      else setRecon(j);
    } finally {
      setReconBusy(false);
    }
  }

  async function startLoop() {
    setLoopTail("");
    setLoopRunning(true);
    const j = await (
      await fetch("/api/web/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      })
    ).json();
    if (j.error) {
      setErr(j.error);
      setLoopRunning(false);
      return;
    }
    setTimeout(pollLoop, 1500);
  }

  if (!slug) {
    return (
      <Empty>
        {tr("Сначала выбери сайт на дашборде.", "Pick a site on the dashboard first.")}{" "}
        <Link href="/web">{tr("Назад", "Back")}</Link>
      </Empty>
    );
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Скан", "Scan")}</h1>
          <p className="sub">{site?.name || slug}</p>
        </div>
        <div className="row">
          <Link className="btn outline" href="/web">
            {tr("Дашборд", "Dashboard")}
          </Link>
          <button className="btn outline" disabled={busy} onClick={run}>
            {tr("Ещё раз", "Again")}
          </button>
        </div>
      </div>

      {busy ? (
        <Empty>
          <Status tone="accent" pulse>
            {tr("скан…", "scanning…")}
          </Status>
        </Empty>
      ) : null}
      {err ? <Callout tone="danger" title="err">{err}</Callout> : null}

      {!busy ? (
        <>
          <Panel title={tr("Проблемы", "Issues")} meta={String(problems.length)}>
            {problems.length === 0 ? (
              <Empty>{tr("Явных проблем нет. Ниже — обычные сигналы, не дыры.", "No clear issues. Signals below are not bugs.")}</Empty>
            ) : null}
            {problems.map((f) => (
              <div key={f.id + f.url} className="card" style={{ marginBottom: 8 }}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <div>
                    <b>{f.title}</b>{" "}
                    <span className="badge sm">{f.severity}</span>{" "}
                    <span className="snip">{f.cls}</span>
                  </div>
                  <div className="row">
                    <Link className="btn sm outline" href={`/web/report?slug=${slug}&hit=${encodeURIComponent(f.id)}`}>
                      {tr("Смотреть", "View")}
                    </Link>
                    <button className="btn sm primary" onClick={() => saveFinding(f)}>
                      {tr("В отчёт", "To report")}
                    </button>
                  </div>
                </div>
                <p>{f.question}</p>
                <pre>{f.evidence}</pre>
              </div>
            ))}
          </Panel>
          {noise.length ? (
            <Panel title={tr("Сигналы", "Signals")} meta={String(noise.length)}>
              <ul className="web-noise-list">
                {noise.map((f) => (
                  <li key={f.id + f.url}>
                    <Link href={`/web/report?slug=${slug}&hit=${encodeURIComponent(f.id)}`}>{f.title}</Link>
                    <span className="snip"> {f.severity}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </>
      ) : null}

      <Panel
        title={tr("Разведка", "Recon")}
        meta={recon?.map?.count != null ? `${recon.map.count} ${tr("активов", "assets")}` : ""}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <p className="snip">
            {tr(
              "Карта приложения (краул + добыча /api из JS), стек и CVE-кандидаты. Пассивно, только GET.",
              "App map (crawl + /api mined from JS), stack and CVE candidates. Passive, GET only.",
            )}
          </p>
          <button className="btn primary sm" disabled={reconBusy} onClick={runRecon}>
            {reconBusy ? <Status tone="accent" pulse>{tr("сбор…", "collecting…")}</Status> : tr("Собрать", "Collect")}
          </button>
        </div>

        {recon?.tech?.length ? (
          <div style={{ marginBottom: 8 }}>
            <b className="snip">{tr("Стек", "Stack")}</b>
            <div className="row" style={{ flexWrap: "wrap", gap: 4, marginTop: 4 }}>
              {recon.tech.map((t, i) => (
                <span key={i} className="badge sm">
                  {t.category}: {t.name}{t.version ? ` ${t.version}` : ""}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {recon?.cve ? (
          <div style={{ marginBottom: 8 }}>
            <b className="snip">
              {tr("CVE-кандидаты", "CVE candidates")}: {recon.cve.candidate_count ?? 0}
            </b>
            {(recon.cve.candidates || []).map((c, i) => (
              <div key={i} className="card" style={{ marginBottom: 4 }}>
                <div>
                  <b>{c.id}</b>{" "}
                  <span className="badge sm">{tr("кандидат", "candidate")}</span>{" "}
                  {c.severity ? <span className="snip">{c.severity}</span> : null}{" "}
                  <span className="snip">{c.package}</span>
                </div>
                {c.summary ? <p style={{ margin: "2px 0" }}>{c.summary}</p> : null}
              </div>
            ))}
            {recon.cve.candidate_count === 0 && (recon.cve.skipped?.length || recon.cve.unknown?.length) ? (
              <p className="snip" style={{ opacity: 0.7 }}>
                {tr("нет CVE: ", "no CVE: ")}
                {(recon.cve.skipped || []).map((s) => `${s.name} — ${s.why}`).join("; ")}
                {(recon.cve.unknown || []).map((u) => `${u.name} — ${tr("сеть", "net")}: ${u.error}`).join("; ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {recon?.map?.assets?.length ? (
          <div>
            <b className="snip">
              {tr("Эндпоинты", "Endpoints")}: {recon.map.count}
              {recon.map.js_hits ? ` (${recon.map.js_hits} ${tr("из JS", "from JS")})` : ""}
            </b>
            <ul className="web-noise-list" style={{ maxHeight: 240, overflow: "auto" }}>
              {recon.map.assets.map((a, i) => (
                <li key={i}>
                  <span className="snip">{a.confidence.toFixed(2)}</span> <code>{a.path}</code>
                  <span className="snip"> {a.source}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </Panel>

      <Panel
        title={tr("Петля модели", "Model loop")}
        meta="heavy"
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
          <p className="snip">
            {tr(
              "Модель (heavy) сама гонит пассивные блоки — заголовки, TLS, методы, забытые файлы, отражение — и регистрирует только то, что подтвердил ПОВТОРНЫЙ живой запрос.",
              "The heavy model runs passive blocks itself and registers only what a second live request confirmed.",
            )}
          </p>
          <button className="btn primary sm" disabled={loopRunning} onClick={startLoop}>
            {loopRunning ? <Status tone="accent" pulse>{tr("идёт…", "running…")}</Status> : tr("Запустить", "Run")}
          </button>
        </div>
        {loopCands.length ? (
          <div style={{ marginBottom: 8 }}>
            {loopCands.map((c, i) => (
              <div key={i} className="card" style={{ marginBottom: 6 }}>
                <div>
                  <b>{c.kind}</b> <span className="badge sm">{tr("сверено", "verified")}</span>{" "}
                  <span className="snip">{c.url}</span>
                </div>
                {/* факт — только сверенная гейтом улика */}
                <pre style={{ margin: "4px 0" }}>{c.detail}</pre>
                {/* проза модели — приглушённо и с меткой, чтобы выдуманную
                    конкретику нельзя было спутать с фактом */}
                {c.impact ? (
                  <p className="snip" style={{ margin: 0, opacity: 0.7 }}>
                    {tr("предположение модели (не сверено): ", "model claim (unverified): ")}
                    {c.impact}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        ) : loopAt ? (
          <Empty>{tr("Прошлый прогон: подтверждённых кандидатов нет.", "Last run: no confirmed candidates.")}</Empty>
        ) : null}
        {loopTail ? <pre style={{ maxHeight: 220, overflow: "auto" }}>{loopTail}</pre> : null}
      </Panel>

      {!busy ? (
        <Panel title={tr("Маркер (по желанию)", "Optional marker")} meta={tr("буквы и цифры, не payload", "alphanumeric, not a payload")}>
          <div className="filters">
            <input style={{ width: 100 }} value={param} onChange={(e) => setParam(e.target.value)} />
            <input className="grow" value={pageUrl} onChange={(e) => setPageUrl(e.target.value)} />
            <button className="btn primary sm" disabled={markBusy || !pageUrl} onClick={marker}>
              {markBusy ? "…" : tr("Проверить и в отчёт", "Check and report")}
            </button>
          </div>
          {markMsg ? <p className="snip">{markMsg}</p> : null}
        </Panel>
      ) : null}
    </>
  );
}

export default function WebScanPage() {
  return (
    <Suspense>
      <ScanInner />
    </Suspense>
  );
}
