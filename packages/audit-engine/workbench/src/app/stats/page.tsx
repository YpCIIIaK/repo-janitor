"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Callout, Empty, Skeleton, Stat } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";
import {
  BarsH,
  Dot,
  Figure,
  RAMP,
  ScatterLog,
  SERIES,
  STATUS,
  StackedBarsH,
  StepArea,
  fmtMoney,
} from "@/components/charts";

type Stats = {
  headline: {
    rep: number;
    programsSeen: number;
    programsOpen: number;
    scanned: number;
    leads: number;
    own: number;
    kill: number;
    bytesRead: number;
  };
  funnel: { stage: string; n: number }[];
  sevMix: Record<string, Record<string, number>>;
  programs: {
    slug: string;
    title: string;
    minRep: number;
    maxBounty: number;
    submissions: number;
    paid: number;
    solidity: boolean;
    open: boolean;
  }[];
  repRows: { minRep: number; n: number; maxBounty: number; open: boolean }[];
  disclosed: { sev: string; n: number; avg: number; sum: number; max: number }[];
  timeline: { h: string; reports: number; findings: number }[];
  docs: { kind: string; n: number; bytes: number }[];
  projects: { status: string; n: number }[];
  topReports: { id: number; title: string; leads: number; hotspots: number; kill: number }[];
  market?: {
    total: number;
    sites: number;
    sc: number;
    withRepos: number;
    known: number;
    targets: number;
    prepped: number;
    scanned: number;
    signals: number;
    bySite: { site: string; n: number }[];
    dots: {
      label: string;
      x: number;
      y: number;
      group: string;
      extra?: string;
      repos: number;
      sc: boolean;
      fee: number;
    }[];
  };
};

const SEV_KEYS = ["Critical", "High", "Medium", "Low", "CLEAN", "прочее"];

const fmtBytes = (b: number, locale: "ru" | "en") =>
  b >= 1024 * 1024
    ? `${(b / 1024 / 1024).toLocaleString(locale === "ru" ? "ru-RU" : "en-US", { maximumFractionDigits: 1 })} ${locale === "ru" ? "МБ" : "MB"}`
    : `${Math.round(b / 1024).toLocaleString(locale === "ru" ? "ru-RU" : "en-US")} ${locale === "ru" ? "КБ" : "KB"}`;

/* этапы не убывают монотонно: из одного отчёта выходит несколько зацепок,
   поэтому доля к предыдущему этапу бывает больше единицы */
const ratio = (cur: number, prev: number) => {
  const k = cur / (prev || 1);
  return k >= 1 ? `×${k.toFixed(1)}` : `${Math.round(k * 100)}%`;
};

export default function StatsPage() {
  const { locale, tr } = useLocale();
  const money = (n: number) => fmtMoney(n, locale);
  const bytes = (n: number) => fmtBytes(n, locale);
  const severityLabel = (key: string) => (key === "прочее" ? tr("прочее", "other") : key);
  const [d, setD] = useState<Stats | null>(null);
  const [tab, setTab] = useState<"overview" | "hackenproof">("overview");
  const [mSites, setMSites] = useState<string[]>([]);
  const [mRepos, setMRepos] = useState(false);
  const [mSc, setMSc] = useState(false);
  const [mFree, setMFree] = useState(false);
  const [onlyOpen, setOnlyOpen] = useState(false);
  const [onlySol, setOnlySol] = useState(false);

  useEffect(() => {
    fetch("/api/stats")
      .then((r) => r.json())
      .then(setD);
  }, []);

  if (!d) return <Skeleton tiles={5} />;

  const h = d.headline;

  /* воронка — порядковая шкала: чем дальше по этапу, тем темнее */
  const funnelColors = d.funnel.map((_, i) => RAMP[Math.min(RAMP.length - 1, i + 1)]);

  /* цвет закреплён за площадкой по её месту в общем порядке, а не по числу
     точек: фильтр не должен перекрашивать уцелевших */
  const siteColor = new Map((d.market?.bySite || []).map((s, i) => [s.site, SERIES[i % SERIES.length]]));
  const allMarketDots = d.market?.dots || [];
  /* прореживаем по смыслу, а не по случайности: чем меньше точек в поле,
     тем больше говорит каждая. Фильтры — над графиком, одной строкой. */
  const marketDots: Dot[] = allMarketDots.filter(
    (x) =>
      (mSites.length === 0 || mSites.includes(x.group)) &&
      (!mRepos || x.repos > 0) &&
      (!mSc || x.sc) &&
      (!mFree || x.fee === 0)
  ) as Dot[];
  const marketGroups = [...new Set(marketDots.map((x) => x.group))].map((g) => ({
    key: g,
    color: siteColor.get(g) || SERIES[0],
  }));
  /* подписываем пять самых свободных: ради них график и рисуется */
  const namedLeft = new Set(
    [...marketDots].sort((a, b) => a.x - b.x).slice(0, 5).map((x) => `${x.group}:${x.label}`)
  );

  /* путь мишени: выбрали -> подготовили -> прогнали сигналы */
  const targetFunnel = [
    { stage: tr("выбрано мишеней", "targets selected"), n: d.market?.targets || 0 },
    { stage: tr("подготовлено", "prepared"), n: d.market?.prepped || 0 },
    { stage: tr("просканировано", "scanned"), n: d.market?.scanned || 0 },
    { stage: tr("файлов сигналов", "signal files"), n: d.market?.signals || 0 },
  ];

  /* рассеяние: приз против тесноты */
  const dots: Dot[] = d.programs
    .filter((p) => (onlyOpen ? p.open : true))
    .filter((p) => (onlySol ? p.solidity : true))
    .map((p) => ({
      label: p.title,
      x: Math.max(1, p.submissions),
      y: p.maxBounty,
      group: p.open ? tr("доступна", "available") : tr("закрыта репутацией", "reputation-locked"),
      extra: `${tr("реп", "rep")} ${p.minRep} · ${tr("выплачено", "paid")} ${money(p.paid)}${p.solidity ? " · Solidity" : ""}`,
    }));
  const scatterGroups = [
    { key: tr("доступна", "available"), color: SERIES[0] },
    { key: tr("закрыта репутацией", "reputation-locked"), color: SERIES[1] },
  ];

  /* если прогоны шли в разные дни, час без даты читается как ход назад */
  const multiDay = new Set(d.timeline.map((t) => t.h.slice(0, 10))).size > 1;
  const hours = d.timeline.map((t) =>
    multiDay ? `${t.h.slice(8, 10)}.${t.h.slice(5, 7)} ${t.h.slice(11)}:00` : `${t.h.slice(11)}:00`
  );

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Разбор работы", "Work analysis")}</h1>
          <p className="sub">{tr("Что сделано и что это дало.", "What was done and what it achieved.")}</p>
        </div>
        <div className="row">
          <Link className="btn outline" href="/picture">
            {tr("Картина", "Overview")}
          </Link>
          <Link className="btn primary" href="/scan">
            {tr("Мультискан", "Multi-scan")}
          </Link>
        </div>
      </div>

      <div className="k-group tabs">
        {(
          [
            ["overview", tr("Общая", "Overview")],
            ["hackenproof", "HackenProof"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} className={`btn sm ${tab === id ? "primary" : "ghost"}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" ? (
        <>
          {d.market ? (
            <div className="grid stats">
              <Stat
                label={tr("программ на рынке", "programs on the market")}
                value={d.market.total}
                hint={`${d.market.sites} ${tr("площадок", "platforms")} · ${d.market.sc} ${tr("контрактных", "smart-contract")} · ${d.market.withRepos} ${tr("с GitHub", "with GitHub")}`}
              />
              <Stat
                label={tr("плотность известна", "known density")}
                value={d.market.known}
                hint={tr("у остальных площадка не публикует число заявок", "other platforms do not publish submission counts")}
              />
              <Stat label={tr("мишеней выбрано", "targets selected")} value={d.market.targets} />
              <Stat label={tr("подготовлено", "prepared")} value={d.market.prepped} hint={tr("скачан исходник, собран BRIEF", "source downloaded, BRIEF generated")} />
              <Stat label={tr("просканировано", "scanned")} value={d.market.scanned} hint={`${d.market.signals} ${tr("файлов сигналов", "signal files")}`} />
            </div>
          ) : null}

          <div className="grid stats">
            <Stat label={tr("просканировано моделью", "scanned by model")} value={h.scanned} hint={tr("программ прошло через прогон", "programs processed")} />
            <Stat label={tr("зацепок в отчётах", "leads in reports")} value={h.leads} />
            <Stat label={tr("своих LEAD", "own LEADs")} value={h.own} />
            <Stat label={tr("отсеяно (kill)", "discarded (kill)")} value={h.kill} />
            <Stat label={tr("прочитано текста", "text read")} value={bytes(h.bytesRead)} />
          </div>

          {d.market ? (
            <div className="grid" style={{ gap: 12 }}>
              <Figure
                title={tr("Программы по площадкам", "Programs by platform")}
                note={`${d.market.total} ${tr("живых программ", "active programs")}`}
                table={
                  <table>
                    <thead>
                      <tr>
                        <th>{tr("площадка", "platform")}</th>
                        <th className="num">{tr("программ", "programs")}</th>
                        <th className="num">{tr("доля", "share")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.market.bySite.map((s) => (
                        <tr key={s.site}>
                          <td className="mono">{s.site}</td>
                          <td className="num mono">{s.n}</td>
                          <td className="num mono">{Math.round((s.n / (d.market?.total || 1)) * 100)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              >
                <BarsH
                  rows={d.market.bySite.map((s) => ({
                    label: s.site,
                    value: s.n,
                    hint: `${Math.round((s.n / (d.market?.total || 1)) * 100)}% ${tr("рынка", "of market")}`,
                  }))}
                  colors={d.market.bySite.map((_, i) => SERIES[i % SERIES.length])}
                />
              </Figure>

              <Figure
                title={tr("Приз против тесноты", "Reward versus crowding")}
                note={tr("каждая точка — программа, обе оси логарифмические", "each point is a program; both axes are logarithmic")}
                legend={marketGroups.map((g) => ({ label: g.key, color: g.color }))}
                table={
                  <table>
                    <thead>
                      <tr>
                        <th>{tr("программа", "program")}</th>
                        <th>{tr("площадка", "platform")}</th>
                        <th className="num">{tr("заявок/актив", "submissions/asset")}</th>
                        <th className="num">{tr("потолок", "maximum")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...marketDots]
                        .sort((a, b) => a.x - b.x)
                        .slice(0, 30)
                        .map((x) => (
                          <tr key={`${x.group}:${x.label}`}>
                            <td>{x.label}</td>
                            <td className="mono">{x.group}</td>
                            <td className="num mono">{x.x.toFixed(1)}</td>
                            <td className="num mono">{money(x.y)}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                }
              >
                <div className="filters">
                  {[...new Set(allMarketDots.map((x) => x.group))].map((s) => (
                    <label key={s} className="btn outline sm">
                      <input
                        type="checkbox"
                        checked={mSites.length === 0 || mSites.includes(s)}
                        onChange={(e) =>
                          setMSites((prev) => {
                            const cur = prev.length ? prev : [...new Set(allMarketDots.map((x) => x.group))];
                            const next = e.target.checked ? [...new Set([...cur, s])] : cur.filter((v) => v !== s);
                            return next;
                          })
                        }
                      />{" "}
                      {s}
                    </label>
                  ))}
                  <label className="btn outline sm">
                    <input type="checkbox" checked={mSc} onChange={(e) => setMSc(e.target.checked)} /> {tr("контракты", "contracts")}
                  </label>
                  <label className="btn outline sm">
                    <input type="checkbox" checked={mRepos} onChange={(e) => setMRepos(e.target.checked)} /> {tr("с GitHub", "with GitHub")}
                  </label>
                  <label className="btn outline sm">
                    <input type="checkbox" checked={mFree} onChange={(e) => setMFree(e.target.checked)} /> {tr("без комиссии", "no fee")}
                  </label>
                  <span className="kit-label">
                    {tr("показано", "showing")} {marketDots.length} {tr("из", "of")} {allMarketDots.length}
                  </span>
                </div>
                <ScatterLog
                  dots={marketDots}
                  groups={marketGroups}
                  xLabel={tr("заявок на актив", "submissions per asset")}
                  yLabel={tr("потолок награды", "maximum reward")}
                  height={360}
                  mark={{ x: 5, label: tr("свободнее этого", "less crowded than this") }}
                  labelFor={(x) => (namedLeft.has(`${x.group}:${x.label}`) ? x.label.slice(0, 22) : null)}
                />
                <p className="snip" style={{ marginTop: 12 }}>
                  {tr(
                    `Левее — свободнее: плотность заявок на актив это единственный измеренный предиктор шанса оказаться единственным нашедшим (r = −0.67). Подписаны пять самых свободных, пунктир — граница пяти заявок на актив. Точек ${allMarketDots.length} из ${d.market.total}: столько программ, где площадка вообще публикует число заявок — hackenproof, yeswehack и cantina. У immunefi, hackerone, bugcrowd и intigriti его нет, и ноль вместо него означал бы «никто не искал».`,
                    `Further left means less crowded: submissions per asset is the only measured predictor of being the sole finder (r = −0.67). The five least crowded programs are labeled; the dashed line marks five submissions per asset. There are ${allMarketDots.length} points out of ${d.market.total}: only programs whose platform publishes submission counts—hackenproof, yeswehack, and cantina. Immunefi, hackerone, bugcrowd, and intigriti do not, and using zero would incorrectly mean “nobody searched”.`
                  )}
                </p>
              </Figure>

              <Figure
                title={tr("Работа по мишеням", "Target workflow")}
                note={tr("от выбранного к просканированному", "from selection to scanning")}
                table={
                  <table>
                    <tbody>
                      {targetFunnel.map((f) => (
                        <tr key={f.stage}>
                          <td>{f.stage}</td>
                          <td className="num mono">{f.n}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                }
              >
                <BarsH rows={targetFunnel.map((f) => ({ label: f.stage, value: f.n }))} colors={RAMP.slice(2)} />
                <p className="snip" style={{ marginTop: 12 }}>
                  {tr("Рынок и мишени берутся из", "Market and targets come from")} <code>market.json</code> {tr("и", "and")} <code>targets.json</code>
                  {" — "}{tr("тех же файлов, что читает консоль. Полные графики рынка и выбор мишеней — на", "the same files read by the console. Full market charts and target selection are on the")}{" "}
                  <Link href="/market">{tr("странице рынка", "market page")}</Link>.
                </p>
              </Figure>
            </div>
          ) : (
            <Empty>
              {tr("Снимка рынка нет. Собрать:", "No market snapshot. Build it with:")} <code>python market.py --refresh</code>
            </Empty>
          )}
        </>
      ) : null}

      {tab !== "hackenproof" ? null : (
      <>
      <div className="grid stats">
        <Stat
          label={tr("программ HackenProof в базе", "HackenProof programs in database")}
          value={h.programsSeen}
          hint={`${tr("доступно", "available")} ${h.programsOpen} ${tr("при репе", "at reputation")} ${h.rep}`}
        />
        <Stat label={tr("просканировано моделью", "scanned by model")} value={h.scanned} />
        <Stat label={tr("зацепок в отчётах", "leads in reports")} value={h.leads} />
        <Stat label={tr("своих LEAD", "own LEADs")} value={h.own} />
        <Stat label={tr("отсеяно (kill)", "discarded (kill)")} value={h.kill} />
        <Stat label={tr("прочитано текста", "text read")} value={bytes(h.bytesRead)} />
      </div>

      <div className="grid" style={{ gap: 12 }}>
        <Figure
          title={tr("Путь работы", "Work funnel")}
          note={tr("от очереди до своей зацепки", "from queue to an original lead")}
          table={
            <table>
              <thead>
                <tr>
                  <th>{tr("этап", "stage")}</th>
                  <th className="num">{tr("штук", "count")}</th>
                  <th className="num">{tr("к предыдущему", "vs previous")}</th>
                </tr>
              </thead>
              <tbody>
                {d.funnel.map((f, i) => (
                  <tr key={f.stage}>
                    <td>{f.stage}</td>
                    <td className="num mono">{f.n}</td>
                    <td className="num mono">{i === 0 ? "—" : ratio(f.n, d.funnel[i - 1].n)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <BarsH
            rows={d.funnel.map((f, i) => ({
              label: f.stage,
              value: f.n,
              hint: i === 0 ? undefined : `${ratio(f.n, d.funnel[i - 1].n)} ${tr("к предыдущему этапу", "vs previous stage")}`,
            }))}
            colors={funnelColors}
          />
        </Figure>

        <div className="grid cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Figure
            title={tr("Состав по серьёзности", "Severity breakdown")}
            note={tr("что скан вообще находит", "what the scan finds")}
            legend={SEV_KEYS.filter((k) =>
              Object.values(d.sevMix).some((m) => m[k])
            ).map((k) => ({ label: severityLabel(k), color: STATUS[k] }))}
            table={
              <table>
                <thead>
                  <tr>
                    <th>{tr("вид", "type")}</th>
                    {SEV_KEYS.map((k) => (
                      <th key={k} className="num">
                        {severityLabel(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(d.sevMix).map(([kind, parts]) => (
                    <tr key={kind}>
                      <td>{kind}</td>
                      {SEV_KEYS.map((k) => (
                        <td key={k} className="num mono">
                          {parts[k] || 0}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <StackedBarsH
              rows={[
                { label: tr("зацепки", "leads"), parts: d.sevMix.lead || {} },
                { label: "hotspots", parts: d.sevMix.hotspot || {} },
              ]}
              keys={SEV_KEYS}
              colors={STATUS}
            />
            <p className="snip" style={{ marginTop: 12 }}>
              {tr("Модель почти всё помечает High — значит её severity нельзя брать за чистую монету, это лишь порядок чтения.", "The model marks almost everything as High, so its severity should not be taken at face value; it only sets the reading order.")}
            </p>
          </Figure>

          <Figure
            title={tr("Что платят на самом деле", "What actually gets paid")}
            note={tr("чужие раскрытые находки", "disclosed findings by others")}
            table={
              <table>
                <thead>
                  <tr>
                    <th>severity</th>
                    <th className="num">{tr("находок", "findings")}</th>
                    <th className="num">{tr("средняя", "average")}</th>
                    <th className="num">{tr("максимум", "maximum")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.disclosed.map((r) => (
                    <tr key={r.sev}>
                      <td>
                        <span className={`badge sm ${r.sev}`}>{r.sev}</span>
                      </td>
                      <td className="num mono">{r.n}</td>
                      <td className="num mono">{money(r.avg)}</td>
                      <td className="num mono">{money(r.max)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <BarsH
              rows={d.disclosed.map((r) => ({
                label: `${r.sev} · ${r.n} ${tr("шт", "items")}`,
                value: Math.round(r.avg),
                hint: `${tr("максимум", "maximum")} ${money(r.max)}, ${tr("всего", "total")} ${money(r.sum)}`,
              }))}
              colors={d.disclosed.map((r) => STATUS[r.sev])}
              format={money}
            />
            <p className="snip" style={{ marginTop: 12 }}>
              {tr("Средняя выплата — не по возрастанию severity. Метка «Critical» сама по себе денег не обещает.", "Average payout does not increase with severity. A “Critical” label alone does not guarantee a payout.")}
            </p>
          </Figure>
        </div>

        <Figure
          title={tr("Приз против тесноты", "Reward versus crowding")}
          note={tr("каждая точка — программа, обе оси логарифмические", "each point is a program; both axes are logarithmic")}
          legend={scatterGroups.map((g) => ({ label: g.key, color: g.color }))}
          table={
            <table>
              <thead>
                <tr>
                  <th>{tr("программа", "program")}</th>
                  <th className="num">{tr("реп", "rep")}</th>
                  <th className="num">max</th>
                  <th className="num">{tr("заявок", "submissions")}</th>
                </tr>
              </thead>
              <tbody>
                {[...d.programs]
                  .sort((a, b) => b.maxBounty - a.maxBounty)
                  .slice(0, 40)
                  .map((p) => (
                    <tr key={p.slug}>
                      <td>{p.title}</td>
                      <td className="num mono">{p.minRep}</td>
                      <td className="num mono">{money(p.maxBounty)}</td>
                      <td className="num mono">{p.submissions}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          }
        >
          <div className="k-toolbar" style={{ marginBottom: 12 }}>
            <label className="btn ghost xs">
              <input type="checkbox" checked={onlyOpen} onChange={(e) => setOnlyOpen(e.target.checked)} /> {tr("только доступные мне", "only available to me")}
            </label>
            <label className="btn ghost xs">
              <input type="checkbox" checked={onlySol} onChange={(e) => setOnlySol(e.target.checked)} /> {tr("только Solidity", "Solidity only")}
            </label>
            <span className="kit-label">{dots.length} {tr("программ", "programs")}</span>
          </div>
          <ScatterLog
            dots={dots}
            groups={scatterGroups}
            xLabel={tr("заявок подано", "submissions")}
            yLabel={tr("максимальная выплата", "maximum payout")}
            height={340}
          />
          <p className="snip" style={{ marginTop: 12 }}>
            {tr("Верх-лево — крупный приз при малом числе заявок. Низ-право — толпа за копейки.", "Top-left means a large reward with few submissions. Bottom-right means a crowd chasing small payouts.")}
          </p>
        </Figure>

        <div className="grid cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Figure
            title={tr("Ход работы", "Work progress")}
            note={tr("нарастающим итогом по часам", "cumulative by hour")}
            legend={[
              { label: tr("отчёты скана", "scan reports"), color: SERIES[0] },
              { label: tr("свои LEAD", "own LEADs"), color: SERIES[2] },
            ]}
            table={
              <table>
                <thead>
                  <tr>
                    <th>{tr("час", "hour")}</th>
                    <th className="num">{tr("отчётов", "reports")}</th>
                    <th className="num">{tr("своих LEAD", "own LEADs")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.timeline.map((t) => (
                    <tr key={t.h}>
                      <td className="mono">{t.h}</td>
                      <td className="num mono">{t.reports}</td>
                      <td className="num mono">{t.findings}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            {d.timeline.length < 2 ? (
              <Empty>{tr("Слишком мало точек во времени — вернись после следующего прогона.", "Too few timeline points—come back after the next run.")}</Empty>
            ) : (
              <StepArea
                labels={hours}
                series={[
                  { name: tr("отчёты", "reports"), color: SERIES[0], data: d.timeline.map((t) => t.reports) },
                  { name: "LEAD", color: SERIES[2], data: d.timeline.map((t) => t.findings) },
                ]}
              />
            )}
          </Figure>

          <Figure
            title={tr("Забор по репутации", "Reputation barrier")}
            note={`${tr("твоя репутация", "your reputation")} ${h.rep}`}
            legend={[
              { label: tr("доступно", "available"), color: SERIES[0] },
              { label: tr("закрыто", "locked"), color: SERIES[1] },
            ]}
            table={
              <table>
                <thead>
                  <tr>
                    <th className="num">{tr("порог", "threshold")}</th>
                    <th className="num">{tr("программ", "programs")}</th>
                    <th className="num">{tr("сумма max", "total max")}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.repRows.map((r) => (
                    <tr key={r.minRep}>
                      <td className="num mono">{r.minRep}</td>
                      <td className="num mono">{r.n}</td>
                      <td className="num mono">{money(r.maxBounty)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <BarsH
              rows={d.repRows.map((r) => ({
                label: `${tr("порог", "threshold")} ${r.minRep}`,
                value: r.n,
                hint: `${r.open ? tr("доступно", "available") : tr("закрыто", "locked")} · ${tr("сумма max", "total max")} ${money(r.maxBounty)}`,
              }))}
              colors={d.repRows.map((r) => (r.open ? SERIES[0] : SERIES[1]))}
            />
          </Figure>
        </div>

        <div className="grid cards" style={{ gridTemplateColumns: "1fr 1fr" }}>
          <Figure
            title={tr("Самые урожайные отчёты", "Most productive reports")}
            note={tr("по числу зацепок", "by lead count")}
            table={
              <table>
                <thead>
                  <tr>
                    <th>{tr("отчёт", "report")}</th>
                    <th className="num">leads</th>
                    <th className="num">hotspots</th>
                    <th className="num">kill</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topReports.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={`/reports/${r.id}`}>{r.title}</Link>
                      </td>
                      <td className="num mono">{r.leads}</td>
                      <td className="num mono">{r.hotspots}</td>
                      <td className="num mono">{r.kill}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <BarsH
              rows={d.topReports.map((r) => ({
                label: r.title,
                value: r.leads,
                hint: `hotspots ${r.hotspots} · kill ${r.kill}`,
              }))}
              colors={d.topReports.map(() => SERIES[0])}
            />
          </Figure>

          <Figure
            title={tr("Прочитано с диска", "Read from disk")}
            note={tr("объём по видам документов", "volume by document type")}
            table={
              <table>
                <thead>
                  <tr>
                    <th>{tr("вид", "type")}</th>
                    <th className="num">{tr("файлов", "files")}</th>
                    <th className="num">{locale === "ru" ? "КБ" : "KB"}</th>
                  </tr>
                </thead>
                <tbody>
                  {d.docs.map((r) => (
                    <tr key={r.kind}>
                      <td>{r.kind}</td>
                      <td className="num mono">{r.n}</td>
                      <td className="num mono">{Math.round(r.bytes / 1024)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          >
            <BarsH
              rows={d.docs.map((r) => ({
                label: r.kind,
                value: r.bytes,
                hint: `${r.n} ${tr("файлов", "files")}`,
              }))}
              colors={d.docs.map((_, i) => RAMP[Math.min(RAMP.length - 1, 7 - i)])}
              format={bytes}
            />
          </Figure>
        </div>

        <Callout tone="accent" title={tr("Как читать", "How to read this")}>
          {tr("Цвет здесь работает по роли: синяя ступенчатая шкала — величина (воронка, объём), две категориальные — принадлежность (доступна / закрыта), статусные красный-оранжевый-жёлтый — только severity и никогда как «серия N». Любой график переключается в таблицу кнопкой в шапке.", "Color is role-based: the stepped blue scale shows magnitude (funnel, volume), two categorical colors show availability (available / locked), and status red-orange-yellow is used only for severity, never as “series N”. Every chart can be switched to a table using its header button.")}
        </Callout>
      </div>
      </>
      )}
    </>
  );
}
