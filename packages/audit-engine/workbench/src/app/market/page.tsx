"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BarsH, Figure, ScatterLog, SERIES, fmtMoney, type Dot } from "@/components/charts";
import { Callout, Empty, Panel, Skeleton } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Row = {
  site: string;
  pid: string;
  name: string;
  url: string;
  reward: number;
  fee: number;
  kyc: boolean;
  reports: number;
  assets: number;
  repos: number;
  density: number | null;
  chosen: boolean;
};

type Stats = {
  total: number;
  scope: number;
  hasPrev: boolean;
  sites: { site: string; n: number; sc: number; repos: number; pot: number }[];
  dots: { label: string; x: number; y: number; group: string; extra?: string }[];
  fresh: { site: string; pid: string; name: string; url: string; reward: number; assets: number }[];
  updated: { site: string; pid: string; name: string; url: string; reward: number; age: number; repos: number }[];
};

export default function MarketPage() {
  const { tr } = useLocale();
  const [q, setQ] = useState("");
  const [site, setSite] = useState("");
  const [sc, setSc] = useState(true);
  const [repos, setRepos] = useState(false);
  const [nofee, setNofee] = useState(false);
  const [limit, setLimit] = useState(60);
  const [data, setData] = useState<{ sites: string[]; total: number; all: number; rows: Row[] } | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState("");
  const [stats, setStats] = useState<Stats | null>(null);

  const load = useCallback(async () => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (site) p.set("site", site);
    p.set("sc", sc ? "1" : "0");
    if (repos) p.set("repos", "1");
    if (nofee) p.set("nofee", "1");
    p.set("limit", String(limit));
    setData(await (await fetch(`/api/market?${p}`)).json());
  }, [q, site, sc, repos, nofee, limit]);

  useEffect(() => {
    load();
  }, [site, sc, repos, nofee, limit, load]);

  useEffect(() => {
    fetch(`/api/market/stats?sc=${sc ? "1" : "0"}`)
      .then((r) => r.json())
      .then(setStats);
  }, [sc]);

  const count = Object.values(picked).filter(Boolean).length;

  // Цвет закреплён за площадкой по её месту в общем порядке, а не по числу
  // точек: иначе фильтр перекрашивал бы уцелевших.
  const siteColor = new Map((stats?.sites || []).map((s, i) => [s.site, SERIES[i % SERIES.length]]));
  const dotSites = [...new Set((stats?.dots || []).map((d) => d.group))];
  const groups = dotSites.map((g) => ({ key: g, color: siteColor.get(g) || SERIES[0] }));

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Рынок баунти", "Bounty market")}</h1>
          <p className="sub">
            {tr("Девять площадок в одном формате:", "Nine platforms in one format:")} immunefi, hackerone, bugcrowd, standoff365, intigriti,
            hackenproof, yeswehack, cantina, sherlock. {tr("Отметь пачку с разных площадок → в мишени.", "Select a batch across platforms → add to targets.")}
          </p>
        </div>
        <div className="row">
          <button
            className="btn outline"
            onClick={() => {
              const next: Record<string, boolean> = {};
              for (const r of data?.rows || []) next[`${r.site}:${r.pid}`] = true;
              setPicked(next);
            }}
          >
            {tr("Все на экране", "Select visible")}
          </button>
          <button
            className="btn primary"
            onClick={async () => {
              const add = Object.keys(picked).filter((k) => picked[k]);
              if (!add.length) return setMsg(tr("ничего не отмечено", "nothing selected"));
              const j = await (
                await fetch("/api/targets", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ add }),
                })
              ).json();
              setMsg(`${tr("добавлено", "added")} ${j.added ?? j.error}, ${tr("всего мишеней", "total targets")} ${j.count ?? "?"}`);
              setPicked({});
              load();
            }}
          >
            {tr("В мишени", "Add to targets")} ({count})
          </button>
        </div>
      </div>

      {msg ? (
        <div style={{ marginBottom: 16 }}>
          <Callout tone="accent" title={tr("Мишени", "Targets")}>
            {msg} · <Link href="/targets">{tr("открыть мишени", "open targets")}</Link>
          </Callout>
        </div>
      ) : null}

      {!stats && !data ? <Skeleton tiles={5} /> : null}

      {stats ? (
        <div className="grid-2" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <Figure
            title={tr("Программы по площадкам", "Programs by platform")}
            note={`${stats.total} ${tr("всего", "total")} · ${stats.scope} ${tr("в выборке", "in selection")}`}
            table={
              <table>
                <thead>
                  <tr>
                    <th>{tr("площадка", "platform")}</th>
                    <th className="num">{tr("всего", "total")}</th>
                    <th className="num">{tr("контрактных", "contract")}</th>
                    <th className="num">{tr("с GitHub", "with GitHub")}</th>
                    <th className="num">{tr("потолок", "maximum")}</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.sites.map((s) => (
                    <tr key={s.site}>
                      <td className="mono">{s.site}</td>
                      <td className="num mono">{s.n}</td>
                      <td className="num mono">{s.sc}</td>
                      <td className="num mono">{s.repos}</td>
                      <td className="num mono">{fmtMoney(s.pot)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <BarsH
              rows={stats.sites.map((s) => ({
                label: s.site,
                value: s.n,
                hint: `${s.sc} ${tr("контрактных", "contract")} · ${s.repos} ${tr("с GitHub", "with GitHub")} · ${tr("потолок", "maximum")} ${fmtMoney(s.pot)}`,
              }))}
              colors={stats.sites.map((s) => siteColor.get(s.site) || SERIES[0])}
            />
          </Figure>

          <Figure
            title={tr("Теснота против потолка", "Competition vs reward cap")}
            note={tr("точки только там, где площадка публикует число заявок", "dots only where the platform publishes report counts")}
            legend={groups.map((g) => ({ label: g.key, color: g.color }))}
            table={
              <table>
                <thead>
                  <tr>
                    <th>{tr("программа", "program")}</th>
                    <th>{tr("площадка", "platform")}</th>
                    <th className="num">{tr("заявок/актив", "reports/asset")}</th>
                    <th className="num">{tr("потолок", "maximum")}</th>
                  </tr>
                </thead>
                <tbody>
                  {[...(stats.dots || [])]
                    .sort((a, b) => a.x - b.x)
                    .slice(0, 25)
                    .map((d) => (
                      <tr key={d.label + d.group}>
                        <td>{d.label}</td>
                        <td className="mono">{d.group}</td>
                        <td className="num mono">{d.x.toFixed(1)}</td>
                        <td className="num mono">{fmtMoney(d.y)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            }
          >
            <ScatterLog
              dots={stats.dots as Dot[]}
              groups={groups}
              xLabel={tr("заявок на актив", "reports per asset")}
              yLabel={tr("потолок награды", "reward cap")}
            />
          </Figure>
        </div>
      ) : null}

      {stats && (stats.fresh.length || stats.updated.length) ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
          <Panel
            title={tr("Новые с прошлого снимка", "New since last snapshot")}
            meta={stats.hasPrev ? `${stats.fresh.length}` : tr("нет прошлого снимка", "no previous snapshot")}
            flush
          >
            {stats.fresh.length ? (
              <table>
                <tbody>
                  {stats.fresh.map((p) => (
                    <tr key={`${p.site}:${p.pid}`}>
                      <td>
                        <a href={p.url} target="_blank" rel="noreferrer">
                          {p.name}
                        </a>
                      </td>
                      <td className="mono">{p.site}</td>
                      <td className="num mono">{p.reward ? fmtMoney(p.reward) : "—"}</td>
                      <td className="num mono">{p.assets || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>
                {stats.hasPrev
                  ? tr("с прошлого раза новых не появилось", "nothing new since last time")
                  : tr("дифф появится со второго python market.py --refresh", "the diff will appear after the second python market.py --refresh")}
              </Empty>
            )}
          </Panel>

          <Panel title={tr("Обновлены за 30 дней", "Updated within 30 days")} meta={`${stats.updated.length}`} flush>
            {stats.updated.length ? (
              <table>
                <tbody>
                  {stats.updated.map((p) => (
                    <tr key={`${p.site}:${p.pid}`}>
                      <td>
                        <a href={p.url} target="_blank" rel="noreferrer">
                          {p.name}
                        </a>
                      </td>
                      <td className="mono">{p.site}</td>
                      <td className="num mono">{p.age}{tr("д", "d")}</td>
                      <td className="num mono">{p.reward ? fmtMoney(p.reward) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <Empty>{tr("Площадки не проставили дату обновления.", "Platforms did not provide an update date.")}</Empty>
            )}
          </Panel>
        </div>
      ) : null}

      <div className="filters">
        <input
          className="grow"
          placeholder={tr("поиск по имени", "search by name")}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()}
        />
        <select className="btn outline sm" value={site} onChange={(e) => setSite(e.target.value)}>
          <option value="">{tr("все площадки", "all platforms")}</option>
          {(data?.sites || []).map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <label className="btn outline sm">
          <input type="checkbox" checked={sc} onChange={(e) => setSc(e.target.checked)} /> {tr("контракты", "contracts")}
        </label>
        <label className="btn outline sm">
          <input type="checkbox" checked={repos} onChange={(e) => setRepos(e.target.checked)} /> {tr("с GitHub", "with GitHub")}
        </label>
        <label className="btn outline sm">
          <input type="checkbox" checked={nofee} onChange={(e) => setNofee(e.target.checked)} /> {tr("без комиссии и KYC", "no fee or KYC")}
        </label>
        <select className="btn outline sm" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {[30, 60, 120, 300].map((n) => (
            <option key={n} value={n}>
              {n} {tr("строк", "rows")}
            </option>
          ))}
        </select>
        <button className="btn primary sm" onClick={load}>
          {tr("Искать", "Search")}
        </button>
      </div>

      <Panel
        title={tr("Программы", "Programs")}
        meta={data ? `${data.total} ${tr("по фильтру из", "filtered out of")} ${data.all}` : "…"}
        footer={
          <>
            <span className="kit-label">{tr("отмечено", "selected")} {count}</span>
            <span className="kit-label">
              {tr("порядок: без комиссии → по плотности заявок на актив (меньше — лучше)", "order: no fee → reports per asset density (lower is better)")}
            </span>
          </>
        }
        flush
      >
        <table>
          <thead>
            <tr>
              <th style={{ width: 36 }}></th>
              <th>{tr("программа", "program")}</th>
              <th>{tr("площадка", "platform")}</th>
              <th className="num">{tr("макс. $", "max $")}</th>
              <th className="num">{tr("активов", "assets")}</th>
              <th className="num">{tr("заявок", "reports")}</th>
              <th className="num">{tr("на актив", "per asset")}</th>
              <th className="num">{tr("комис.", "fee")}</th>
              <th className="num">{tr("репо", "repos")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows || []).map((r) => {
              const id = `${r.site}:${r.pid}`;
              return (
                <tr key={id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={Boolean(picked[id]) || r.chosen}
                      disabled={r.chosen}
                      onChange={(e) => setPicked({ ...picked, [id]: e.target.checked })}
                    />
                  </td>
                  <td>
                    <a href={r.url} target="_blank" rel="noreferrer">
                      {r.name}
                    </a>
                    {r.chosen ? <div className="snip mono">{tr("уже в мишенях", "already in targets")}</div> : null}
                  </td>
                  <td className="mono">{r.site}</td>
                  <td className="num mono">{r.reward ? Math.round(r.reward).toLocaleString() : "—"}</td>
                  <td className="num mono">{r.assets || "—"}</td>
                  <td className="num mono">{r.reports >= 0 ? r.reports : "?"}</td>
                  <td className="num mono">{r.density === null ? "?" : r.density.toFixed(1)}</td>
                  <td className="num mono">{r.fee ? `${r.fee}$` : r.kyc ? "KYC" : tr("нет", "none")}</td>
                  <td className="num mono">{r.repos || ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {data && data.rows.length === 0 ? <Empty>{tr("Ничего не нашлось — ослабь фильтры.", "Nothing found — loosen the filters.")}</Empty> : null}
      </Panel>

      <div style={{ marginTop: 16 }}>
        <Callout tone="info" title={tr("Про «?» в колонке заявок", "About “?” in the reports column")}>
          {tr("Immunefi не публикует число заявок ни по одной программе, поэтому плотность там неизвестна. «?» — это незнание, а не ноль: ноль означал бы «никто не искал». В сортировке неизвестность стоит между разреженными и тесными. Снимок обновляется командой", "Immunefi does not publish report counts for any program, so density is unknown. “?” means unknown, not zero; zero would mean “nobody searched”. In sorting, unknown sits between sparse and crowded. Refresh the snapshot with")}{" "}
          <code>python market.py --refresh</code>.
        </Callout>
      </div>
    </>
  );
}
