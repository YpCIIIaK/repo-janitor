"use client";

import { useEffect, useState } from "react";
import { Callout, Empty, Panel, Status } from "@/components/kit";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useLocale } from "@/components/LocaleProvider";

type Hot = { id?: number; code: string; title: string; verdict: string };

const WEB_TMPL: Hot[] = [
  { code: "W1", title: "Auth / session", verdict: "угон сессии, cookie, JWT, reset" },
  { code: "W2", title: "IDOR ордера / баланс", verdict: "чужой user id в API" },
  { code: "W3", title: "Вывод / internal transfer", verdict: "без 2FA / смена адреса" },
  { code: "W4", title: "API без проверки user", verdict: "IDOR на KYC/карточки/ключи" },
  { code: "W5", title: "XSS → takeover", verdict: "stored в тикетах/чате/профиле" },
];

export default function ProjectPage() {
  const { tr } = useLocale();
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [tab, setTab] = useState<"hot" | "notes" | "kill" | "find" | "docs">("notes");
  const [ft, setFt] = useState("");
  const [fb, setFb] = useState("");
  const [fs, setFs] = useState("lead");
  const [sev, setSev] = useState("");
  const [status, setStatus] = useState("");
  const [programUrl, setProgramUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [kill, setKill] = useState("");
  const [hots, setHots] = useState<Hot[]>([]);
  const [msg, setMsg] = useState("");

  async function load() {
    const r = await fetch(`/api/projects/${id}`);
    const j = await r.json();
    setData(j);
    if (j.project) {
      setStatus(j.project.status);
      setProgramUrl(j.project.program_url || "");
      setNotes(j.project.notes || "");
    }
    setHots(
      (j.hotspots || []).map((h: Record<string, string>) => ({
        id: h.id as unknown as number,
        code: h.code || "",
        title: h.title || "",
        verdict: h.verdict || "",
      }))
    );
    const k = await (await fetch(`/api/projects/${id}/kill`)).json();
    setKill(k.body || "");
  }
  useEffect(() => {
    load();
  }, [id]);

  if (!data?.project)
    return (
      <Empty>
        <Status tone="accent" pulse>
          {tr("загрузка", "loading")}
        </Status>
      </Empty>
    );
  const p = data.project as Record<string, unknown>;
  const findings = (data.findings as Record<string, unknown>[]) || [];
  const documents = (data.documents as Record<string, unknown>[]) || [];

  async function saveMeta() {
    await fetch(`/api/projects/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, program_url: programUrl, notes }),
    });
    setMsg(tr("NOTES.md сохранён", "NOTES.md saved"));
    load();
  }

  async function saveKill() {
    await fetch(`/api/projects/${id}/kill`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: kill }),
    });
    setMsg(tr("KILL.md сохранён", "KILL.md saved"));
  }

  async function saveHots() {
    const r = await fetch(`/api/projects/${id}/hotspots`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: hots }),
    });
    const j = await r.json();
    if (j.hotspots) {
      setHots(
        j.hotspots.map((h: Record<string, string>) => ({
          code: h.code,
          title: h.title,
          verdict: h.verdict,
        }))
      );
    }
    setMsg(tr("HOTSPOTS.md сохранён", "HOTSPOTS.md saved"));
  }

  function addHot() {
    const n = hots.length + 1;
    setHots([...hots, { code: `X${n}`, title: "", verdict: "" }]);
  }

  function setHot(i: number, patch: Partial<Hot>) {
    setHots(hots.map((h, j) => (j === i ? { ...h, ...patch } : h)));
  }

  function delHot(i: number) {
    setHots(hots.filter((_, j) => j !== i));
  }

  async function leadFrom(h: Hot) {
    setTab("find");
    setFt(`${h.code} ${h.title}`.trim());
    setFb(`Поверхность: ${h.title}\nВердикт/почему: ${h.verdict}\n\nГипотеза:\n`);
    setFs("lead");
  }

  async function addFinding() {
    await fetch("/api/findings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ project_id: Number(id), title: ft, body: fb, status: fs, severity: sev }),
    });
    setFt("");
    setFb("");
    setMsg(tr("LEAD записан", "LEAD saved"));
    load();
  }

  async function copyPack(f: Record<string, unknown>) {
    const pack = `## Finding — ${f.title}
Project: ${p.title} (${p.slug})
Status: ${f.status} · Severity: ${f.severity || "?"}
Files: ${f.files || "—"}

${f.body}

---
Это локальная находка из auditscout workbench. Проверь против KILL-карты и скоупа программы. Не сабмитить без PoC-or-KILL.`;
    await navigator.clipboard.writeText(pack);
    setMsg(tr("скопировано в буфер — вставь в Cursor", "copied to clipboard — paste into Cursor"));
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>{String(p.title)}</h1>
          <p className="sub mono">
            {String(p.slug)} · {String(p.path || "")}
          </p>
        </div>
        <div className="row">
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="active">{tr("активный", "active")}</option>
            <option value="parked">{tr("отложен", "parked")}</option>
            <option value="watch">{tr("наблюдение", "watch")}</option>
            <option value="killed">{tr("закрыт", "killed")}</option>
          </select>
          {programUrl ? (
            <a className="btn outline" href={programUrl} target="_blank" rel="noreferrer">
              {tr("Программа", "Program")}
            </a>
          ) : null}
        </div>
      </div>
      {msg ? (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="accent">{msg}</Callout>
        </div>
      ) : null}

      <div className="k-group" style={{ marginBottom: 16 }}>
        {(["notes", "hot", "kill", "find", "docs"] as const).map((t) => (
          <button key={t} className={`btn sm ${tab === t ? "primary" : "ghost"}`} onClick={() => setTab(t)}>
            {t === "hot" ? tr("Хотспоты", "Hotspots") : t === "notes" ? tr("Скоуп / заметки", "Scope / notes") : t === "kill" ? tr("KILL", "KILL") : t === "find" ? tr("Находки", "Findings") : tr("Документы", "Documents")}
          </button>
        ))}
      </div>

      {tab === "notes" ? (
        <Panel
          title={tr("Скоуп / заметки", "Scope / notes")}
          meta="NOTES.md"
          actions={
            <button className="btn primary sm" onClick={saveMeta}>
              {tr("Сохранить", "Save")}
            </button>
          }
        >
          <p className="snip">{tr("Открой программу → вставь сюда in-scope URL, Crit/High, OOS. Пишется в NOTES.md", "Open the program → paste in-scope URLs, Crit/High, and OOS here. Saved to NOTES.md")}</p>
          <input
            className="grow"
            style={{ width: "100%", margin: "8px 0" }}
            placeholder="https://hackenproof.com/programs/…"
            value={programUrl}
            onChange={(e) => setProgramUrl(e.target.value)}
          />
          <textarea
            style={{ minHeight: 320 }}
            placeholder={tr("## Скоуп\n- url\n\n## Crit / High\n\n## OOS\n", "## Scope\n- url\n\n## Crit / High\n\n## OOS\n")}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </Panel>
      ) : null}

      {tab === "hot" ? (
        <Panel
          title={tr("Хотспоты", "Hotspots")}
          meta={tr("{count} строк · HOTSPOTS.md", "{count} rows · HOTSPOTS.md", { count: hots.length })}
          actions={
            <>
              <button className="btn ghost sm" onClick={addHot}>
                {tr("+ строка", "+ row")}
              </button>
              <button className="btn ghost sm" onClick={() => setHots(WEB_TMPL)}>
                {tr("Шаблон web", "Web template")}
              </button>
              <button className="btn primary sm" onClick={saveHots}>
                {tr("Сохранить", "Save")}
              </button>
            </>
          }
          flush
        >
          {hots.length === 0 ? <Empty>{tr("Пусто — добавь строку или возьми шаблон.", "Empty — add a row or use the template.")}</Empty> : null}
          <table>
            <thead>
              <tr>
                <th style={{ width: 90 }}>{tr("id", "id")}</th>
                <th>{tr("поверхность", "surface")}</th>
                <th>{tr("почему / вердикт", "reason / verdict")}</th>
                <th style={{ width: 120 }}></th>
              </tr>
            </thead>
            <tbody>
              {hots.map((h, i) => (
                <tr key={i}>
                  <td>
                    <input value={h.code} onChange={(e) => setHot(i, { code: e.target.value })} style={{ width: 72 }} />
                  </td>
                  <td>
                    <input className="grow" value={h.title} onChange={(e) => setHot(i, { title: e.target.value })} style={{ width: "100%" }} />
                  </td>
                  <td>
                    <input className="grow" value={h.verdict} onChange={(e) => setHot(i, { verdict: e.target.value })} style={{ width: "100%" }} />
                  </td>
                  <td className="row">
                    <button className="btn ghost xs" onClick={() => leadFrom(h)}>
                      {tr("→ LEAD", "→ LEAD")}
                    </button>
                    <button className="btn danger xs" onClick={() => delHot(i)}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}

      {tab === "kill" ? (
        <Panel
          title={tr("KILL-карта", "KILL map")}
          meta="KILL.md"
          actions={
            <button className="btn primary sm" onClick={saveKill}>
              {tr("Сохранить", "Save")}
            </button>
          }
        >
          <textarea style={{ minHeight: 280 }} value={kill} onChange={(e) => setKill(e.target.value)} />
        </Panel>
      ) : null}

      {tab === "find" ? (
        <>
          <div style={{ marginBottom: 12 }}>
          <Panel
            title={tr("Новая находка", "New finding")}
            meta={tr("LEAD", "LEAD")}
            actions={
              <button className="btn primary sm" onClick={addFinding} disabled={!ft}>
                {tr("Сохранить", "Save")}
              </button>
            }
          >
            <div className="row" style={{ marginBottom: 8 }}>
              <input className="grow" placeholder={tr("заголовок LEAD", "LEAD title")} value={ft} onChange={(e) => setFt(e.target.value)} />
              <select value={fs} onChange={(e) => setFs(e.target.value)}>
                <option value="lead">{tr("лид", "lead")}</option>
                <option value="clean">{tr("чисто", "clean")}</option>
                <option value="kill">{tr("отклонить", "kill")}</option>
                <option value="submit">{tr("отправить", "submit")}</option>
              </select>
              <select value={sev} onChange={(e) => setSev(e.target.value)}>
                <option value="">{tr("уровень", "severity")}</option>
                <option value="Critical">{tr("Критический", "Critical")}</option>
                <option value="High">{tr("Высокий", "High")}</option>
                <option value="Medium">{tr("Средний", "Medium")}</option>
                <option value="Low">{tr("Низкий", "Low")}</option>
              </select>
            </div>
            <textarea placeholder={tr("гипотеза, путь, impact, почему не OOS", "hypothesis, path, impact, why it is not OOS")} value={fb} onChange={(e) => setFb(e.target.value)} />
          </Panel>
          </div>
          {findings.length === 0 ? <Empty>{tr("Находок пока нет.", "No findings yet.")}</Empty> : null}
          {findings.map((f) => (
            <div className="card" key={String(f.id)} style={{ marginBottom: 10 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <b>{String(f.title)}</b>{" "}
                  <span className={`badge sm ${f.status}`}>{String(f.status)}</span>{" "}
                  {f.severity ? <span className={`badge sm ${f.severity}`}>{String(f.severity)}</span> : null}
                </div>
                <button className="btn primary sm" onClick={() => copyPack(f)}>
                  {tr("Копировать в ИИ", "Copy to AI")}
                </button>
              </div>
              <pre style={{ marginTop: 10 }}>{String(f.body)}</pre>
            </div>
          ))}
        </>
      ) : null}

      {tab === "docs" ? (
        <Panel title={tr("Документы", "Documents")} meta={tr("{count} файлов", "{count} files", { count: documents.length })} flush>
          {documents.length === 0 ? <Empty>{tr("Документов нет — нажми «Индексировать диск» на дашборде.", "No documents — click “Index disk” on the dashboard.")}</Empty> : null}
          <table>
            <thead>
              <tr>
                <th style={{ width: 110 }}>{tr("вид", "kind")}</th>
                <th>{tr("файл", "file")}</th>
                <th className="num">{tr("размер", "size")}</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((d) => (
                <tr key={String(d.id)}>
                  <td>
                    <span className="badge sm">{String(d.kind)}</span>
                  </td>
                  <td>
                    <Link href={`/audits/${d.id}`}>{String(d.title)}</Link>
                    <div className="snip mono">{String(d.source_path)}</div>
                  </td>
                  <td className="num mono">{Number(d.bytes).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      ) : null}
    </>
  );
}
