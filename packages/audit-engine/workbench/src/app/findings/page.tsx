"use client";

import { useEffect, useState } from "react";
import { Empty, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

export default function FindingsPage() {
  const { tr } = useLocale();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [status, setStatus] = useState("");
  const [msg, setMsg] = useState("");

  async function load() {
    const p = status ? `?status=${status}` : "";
    setRows(await (await fetch(`/api/findings${p}`)).json());
  }
  useEffect(() => {
    load();
  }, [status]);

  async function copyPack(f: Record<string, unknown>) {
    const pack = `## Finding — ${f.title}
Project: ${f.project_title || f.project_slug || "?"}
Status: ${f.status} · Severity: ${f.severity || "?"}

${f.body}

---
Локальная находка auditscout workbench. Проверь KILL/скоуп. PoC-or-KILL.`;
    await navigator.clipboard.writeText(pack);
    setMsg(tr("скопировано", "copied"));
  }

  async function setSt(id: unknown, st: string) {
    await fetch(`/api/findings/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: st }),
    });
    load();
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Мои находки", "My findings")}</h1>
          <p className="sub">{tr("LEAD → CLEAN/KILL/submit. Кнопка копирует пакет для чата в Cursor.", "LEAD → CLEAN/KILL/submit. The button copies a package for a Cursor chat.")}</p>
        </div>
        {msg ? <Status tone="success">{msg}</Status> : null}
      </div>
      <div className="k-group" style={{ marginBottom: 16 }}>
        {["", "lead", "clean", "kill", "submit"].map((s) => (
          <button key={s || "all"} className={`btn sm ${status === s ? "primary" : "ghost"}`} onClick={() => setStatus(s)}>
            {s || tr("все", "all")}
          </button>
        ))}
      </div>
      {rows.length === 0 ? <Empty>{tr("Находок с этим статусом нет.", "No findings with this status.")}</Empty> : null}
      {rows.map((f) => (
        <div className="card" key={String(f.id)} style={{ marginBottom: 10 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <b>{String(f.title)}</b> <span className="snip mono">{String(f.project_slug || "")}</span>{" "}
              <span className={`badge sm ${f.status}`}>{String(f.status)}</span>
            </div>
            <div className="row">
              <button className="btn outline sm" onClick={() => setSt(f.id, "clean")}>
                CLEAN
              </button>
              <button className="btn outline sm" onClick={() => setSt(f.id, "kill")}>
                KILL
              </button>
              <button className="btn primary sm" onClick={() => copyPack(f)}>
                {tr("В ИИ", "To AI")}
              </button>
            </div>
          </div>
          <p className="snip" style={{ marginTop: 8 }}>
            {String(f.body).slice(0, 400)}
          </p>
        </div>
      ))}
    </>
  );
}
