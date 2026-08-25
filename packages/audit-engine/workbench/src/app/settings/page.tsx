"use client";

import { useEffect, useState } from "react";
import { Callout, Panel, Status } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

export default function SettingsPage() {
  const { tr } = useLocale();
  const [s, setS] = useState<{ workspace?: string; openrouter_configured?: boolean }>({});
  const [rep, setRep] = useState("80");
  const [cur, setCur] = useState("aa-4337");
  const [model, setModel] = useState("nvidia/nemotron-3.5-lightning:free");
  const [orKey, setOrKey] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((j) => {
        setS(j);
        setRep(j.hp_reputation || "80");
        setCur(j.current_project || "aa-4337");
        setModel(j.or_model || "nvidia/nemotron-3.5-lightning:free");
      });
  }, []);

  async function save() {
    await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        hp_reputation: rep,
        current_project: cur,
        or_model: model,
        ...(orKey.trim() ? { openrouter_key: orKey.trim() } : {}),
      }),
    });
    setMsg(tr("сохранено", "saved"));
    const j = await (await fetch("/api/settings")).json();
    setS(j);
    setOrKey("");
  }

  async function reindex() {
    setMsg(tr("индексация…", "indexing…"));
    const j = await (await fetch("/api/import", { method: "POST" })).json();
    setMsg(JSON.stringify(j));
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Настройки", "Settings")}</h1>
          <p className="sub">{tr("Локально: workbench/data/workbench.db · ключ OpenRouter в .env.local", "Local: workbench/data/workbench.db · OpenRouter key in .env.local")}</p>
        </div>
      </div>
      <Panel
        title={tr("Окружение", "Environment")}
        meta={s.workspace}
        actions={
          <Status tone={s.openrouter_configured ? "success" : "warning"}>
            {s.openrouter_configured ? tr("ключ есть", "key configured") : tr("нет ключа", "no key")}
          </Status>
        }
      >
        <div className="row" style={{ margin: "0 0 12px" }}>
          <label className="k-field">
            <span className="kit-label">{tr("Репутация HP", "HP reputation")}</span>
            <input type="number" value={rep} onChange={(e) => setRep(e.target.value)} style={{ width: 110 }} />
          </label>
          <label className="k-field grow">
            <span className="kit-label">{tr("текущий трек", "current track")}</span>
            <input className="grow" value={cur} onChange={(e) => setCur(e.target.value)} />
          </label>
        </div>
        <div style={{ marginBottom: 12 }}>
          <Callout tone={s.openrouter_configured ? "neutral" : "warning"} title="OpenRouter">
            {tr("Ключ", "Put the")} <span className="mono">OPENROUTER_API_KEY</span> {tr("кладётся в", "key in")}{" "}
            <span className="mono">workbench/.env.local</span>
          </Callout>
        </div>
        <div className="row" style={{ margin: "12px 0", alignItems: "flex-end" }}>
          <label className="k-field grow">
            <span className="kit-label">{tr("модель", "model")}</span>
            <input className="grow mono" value={model} onChange={(e) => setModel(e.target.value)} />
          </label>
          <label className="k-field grow">
            <span className="kit-label">{tr("ключ вручную", "manual key")}</span>
            <input
              className="grow"
              type="password"
              placeholder={tr("лучше через .env.local", "prefer .env.local")}
              value={orKey}
              onChange={(e) => setOrKey(e.target.value)}
            />
          </label>
        </div>
        <div className="row">
          <button className="btn primary" onClick={save}>
            {tr("Сохранить", "Save")}
          </button>
          <button className="btn outline" onClick={reindex}>
            {tr("Переиндексировать диск", "Reindex disk")}
          </button>
        </div>
        {msg ? (
          <div style={{ marginTop: 12 }}>
            <Callout tone="accent">
              <span className="mono">{msg}</span>
            </Callout>
          </div>
        ) : null}
      </Panel>
      <div style={{ marginTop: 16 }}>
      <Panel title={tr("Как пользоваться", "How to use")} meta={tr("6 шагов", "6 steps")}>
        <ol className="snip" style={{ paddingLeft: 18, listStyle: "decimal" }}>
          <li>{tr("Проекты → Создать трек (папка на диске создаётся сама)", "Projects → Create track (the disk folder is created automatically)")}</li>
          <li>{tr("Программы HP — фильтр ≤ реп, Solidity, ongoing", "HP Programs — filter by ≤ reputation, Solidity, ongoing")}</li>
          <li>{tr("Открыть проект → hotspots / аудиты / новая находка", "Open project → hotspots / audits / new finding")}</li>
          <li>{tr("Программы HP → отметить → в очередь → Очередь → сканить", "HP Programs → select → enqueue → Queue → scan")}</li>
          <li>{tr("Отчёт → «Применить» пишет NOTES/HOTSPOTS и LEAD на диск", "Report → “Apply” writes NOTES/HOTSPOTS and LEAD to disk")}</li>
          <li>{tr("«В ИИ» копирует пакет в буфер → вставь в Cursor", "“To AI” copies the package → paste it into Cursor")}</li>
        </ol>
      </Panel>
      </div>
    </>
  );
}
