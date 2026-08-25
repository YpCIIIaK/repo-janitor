"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Callout, Empty, Panel } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

export default function ProjectsPage() {
  const { tr } = useLocale();
  const router = useRouter();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [platform, setPlatform] = useState("hackenproof");
  const [err, setErr] = useState("");

  async function load() {
    setRows(await (await fetch("/api/projects")).json());
  }
  useEffect(() => {
    load();
  }, []);

  async function create() {
    setErr("");
    const r = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug,
        title,
        status: "active",
        platform,
        program_url: url,
      }),
    });
    const j = await r.json();
    if (!r.ok) {
      setErr(j.error || tr("ошибка", "error"));
      return;
    }
    setSlug("");
    setTitle("");
    setUrl("");
    if (j.id) router.push(`/projects/${j.id}`);
    else load();
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Проекты", "Projects")}</h1>
          <p className="sub">
            {tr("Создать = папка", "Create = folder")} <span className="mono">data/bounty/slug/</span> (NOTES / HOTSPOTS / KILL / DIG) + {tr("запись в SQLite.", "a SQLite record.")}
            {" "}{tr("Новые папки на диске подхватываются сами при открытии этой страницы.", "New folders on disk are detected automatically when this page opens.")}
          </p>
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
      <Panel title={tr("Новый трек", "New track")} meta={tr("папка + запись в SQLite", "folder + SQLite record")}>
        <div className="row">
          <input placeholder={tr("slug (обязательно)", "slug (required)")} value={slug} onChange={(e) => setSlug(e.target.value)} />
          <input className="grow" placeholder={tr("название", "title")} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="grow" placeholder="https://hackenproof.com/programs/…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <select value={platform} onChange={(e) => setPlatform(e.target.value)}>
            <option value="hackenproof">HackenProof</option>
            <option value="immunefi">Immunefi</option>
            <option value="cantina">Cantina</option>
            <option value="other">{tr("другое", "other")}</option>
          </select>
          <button className="btn primary" onClick={create} disabled={!slug || !title}>
            {tr("Создать трек", "Create track")}
          </button>
        </div>
        {err ? (
          <div style={{ marginTop: 12 }}>
            <Callout tone="danger">{err}</Callout>
          </div>
        ) : null}
      </Panel>
      </div>
      <Panel title={tr("Треки", "Tracks")} meta={tr("{count} шт", "{count} total", { count: rows.length })} flush>
        <table>
          <thead>
            <tr>
              <th>{tr("проект", "project")}</th>
              <th>{tr("статус", "status")}</th>
              <th>{tr("платформа", "platform")}</th>
              <th className="num">hs</th>
              <th className="num">{tr("находки", "findings")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={String(p.id)}>
                <td>
                  <Link href={`/projects/${p.id}`}>
                    <b>{String(p.title)}</b>
                  </Link>
                  <div className="snip mono">{String(p.slug)}</div>
                </td>
                <td>
                  <span className={`badge sm ${p.status}`}>{String(p.status)}</span>
                </td>
                <td className="mono">{String(p.platform || "—")}</td>
                <td className="num mono">{String(p.hotspots_count)}</td>
                <td className="num mono">{String(p.findings_count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? <Empty>{tr("Треков пока нет — заведи первый выше.", "No tracks yet — create the first one above.")}</Empty> : null}
      </Panel>
    </>
  );
}
