"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useLocale } from "@/components/LocaleProvider";
import { useHuntMode } from "@/components/HuntModeProvider";
import { formatRelativeDate } from "@/lib/i18n";

type Meta = { marketAt: string; marketKb: number; targets: number; scanned: number };

export function Shell({ children }: { children: React.ReactNode }) {
  const { locale, toggleLocale, tr } = useLocale();
  const { track, setTrack } = useHuntMode();
  const path = usePathname();
  const router = useRouter();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [palette, setPalette] = useState(false);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (path.startsWith("/web")) setTrack("web");
    else if (
      path === "/" ||
      ["/market", "/targets", "/runs", "/scan", "/picture", "/stats", "/queue", "/reports", "/projects"].some(
        (p) => path === p || path.startsWith(p + "/"),
      )
    ) {
      setTrack("web3");
    }
  }, [path, setTrack]);

  const groups = useMemo<{ title: string; links: [string, string][] }[]>(
    () =>
      track === "web"
        ? [
            {
              title: tr("Веб-аудит", "Web audit"),
              links: [
                ["/web", tr("Дашборд", "Dashboard")],
                ["/web/map", tr("Карта", "Map")],
              ],
            },
            {
              title: tr("Справка", "Reference"),
              links: [
                ["/settings", tr("Настройки", "Settings")],
              ],
            },
          ]
        : [
            {
              title: tr("Охота Web3", "Web3 hunt"),
              links: [
                ["/", tr("Дашборд", "Dashboard")],
                ["/market", tr("Рынок баунти", "Bounty market")],
                ["/targets", tr("Мишени", "Targets")],
                ["/runs", tr("Прогоны", "Runs")],
                ["/scan", tr("Мультискан", "Multi-scan")],
                ["/picture", tr("Картина", "Overview")],
                ["/stats", tr("Разбор", "Analytics")],
                ["/queue", tr("Очередь", "Queue")],
                ["/reports", tr("Отчёты", "Reports")],
                ["/projects", tr("Проекты", "Projects")],
              ],
            },
            {
              title: tr("Каталог", "Catalog"),
              links: [
                ["/programs", tr("Программы HP", "HP programs")],
                ["/audits", tr("Аудиты", "Audits")],
                ["/disclosed", tr("Чужие находки", "Disclosed findings")],
                ["/findings", tr("Мои находки", "My findings")],
              ],
            },
            {
              title: tr("Справка", "Reference"),
              links: [
                ["/search", tr("Поиск", "Search")],
                ["/method", tr("Метод", "Method")],
                ["/settings", tr("Настройки", "Settings")],
              ],
            },
          ],
    [tr, track],
  );
  const all = useMemo(
    () => groups.flatMap((g) => g.links.map(([href, label]) => ({ href, label, group: g.title }))),
    [groups],
  );

  useEffect(() => {
    fetch("/api/meta")
      .then((r) => r.json())
      .then(setMeta)
      .catch(() => setMeta(null));
  }, [path]);

  // Вкладок в браузере обычно открыто несколько, и все они назывались
  // одинаково. Заголовок ставим по адресу — это дешевле, чем разносить
  // metadata по клиентским страницам.
  useEffect(() => {
    const hit = all.find((l) => l.href === path) || all.find((l) => l.href !== "/" && path.startsWith(l.href));
    document.title = hit && hit.href !== "/" ? `${hit.label} · auditscout` : "auditscout workbench";
  }, [path, all]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setQ("");
        setPalette((v) => !v);
      }
      if (e.key === "Escape") setPalette(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = q
    ? all.filter((l) => (l.label + " " + l.href).toLowerCase().includes(q.toLowerCase()))
    : all;

  return (
    <div className="app">
      <aside className="side">
        <Link href={track === "web" ? "/web" : "/"} className="brand">
          auditscout <span>{track === "web" ? "web" : "wb"}</span>
        </Link>
        <div className="track-switch" role="tablist" aria-label={tr("режим охоты", "hunt track")}>
          <button
            type="button"
            className={track === "web3" ? "active" : ""}
            onClick={() => {
              setTrack("web3");
              router.push("/");
            }}
          >
            Web3
          </button>
          <button
            type="button"
            className={track === "web" ? "active" : ""}
            onClick={() => {
              setTrack("web");
              router.push("/web");
            }}
          >
            {tr("Веб", "Web")}
          </button>
        </div>
        <nav className="nav">
          {groups.map((g, gi) => (
            <div key={g.title} className="nav-group">
              <div className="nav-label">{g.title}</div>
              {g.links.map(([href, label], i) => (
                <Link
                  key={href}
                  href={href}
                  className={path === href || (href !== "/" && path.startsWith(href)) ? "active" : ""}
                >
                  <span className="n-idx">{String(gi * 10 + i + 1).padStart(2, "0")}</span>
                  {label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="foot">
          {meta?.marketAt ? (
            <>
              {tr("Рынок", "Market")} · {formatRelativeDate(meta.marketAt, locale)}
              <br />
              {tr("Мишеней {targets} · сканов {scanned}", "{targets} targets · {scanned} scans", {
                targets: meta.targets,
                scanned: meta.scanned,
              })}
            </>
          ) : (
            <>
              {tr("Снимка рынка нет", "No market snapshot")}
              <br />
              market.py --refresh
            </>
          )}
          <br />
          <span style={{ opacity: 0.7 }}>{tr("Ctrl+K — переход", "Ctrl+K — navigate")}</span>
          <button className="locale-switch" onClick={toggleLocale} aria-label={tr("Переключить язык", "Switch language")}>
            <span className={locale === "ru" ? "active" : ""}>RU</span>
            <span>/</span>
            <span className={locale === "en" ? "active" : ""}>EN</span>
          </button>
        </div>
      </aside>
      <main className="main">{children}</main>

      {palette ? (
        <div className="palette-back" onClick={() => setPalette(false)}>
          <div className="palette" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              placeholder={tr("куда идём…", "where to…")}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hits[0]) {
                  router.push(hits[0].href);
                  setPalette(false);
                }
              }}
            />
            <div className="palette-list">
              {hits.map((l) => (
                <button
                  key={l.href}
                  className="palette-row"
                  onClick={() => {
                    router.push(l.href);
                    setPalette(false);
                  }}
                >
                  <span>{l.label}</span>
                  <span className="kit-label">{l.group}</span>
                </button>
              ))}
              {hits.length === 0 ? <div className="palette-row muted">{tr("ничего не нашлось", "nothing found")}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
