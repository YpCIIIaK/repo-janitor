"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Callout, Empty, Panel, Skeleton } from "@/components/kit";
import { useLocale } from "@/components/LocaleProvider";

type Row = {
  site: string;
  pid: string;
  name: string;
  url: string;
  slug: string;
  reward: number;
  fee: number;
  kyc: boolean;
  reports: number;
  assets: number;
  repos: string[];
  state: { brief: boolean; src: boolean; signals: number; lastRun: string };
};

// цвет бейджа по источнику закрытия лида — этапы пайплайна визуально различимы
function srcColor(source?: string): string {
  switch (source) {
    case "killcheck": return "#8b949e"; // механический шлюз
    case "scope": return "#d29922";     // вне скоупа (OOS)
    case "model": return "#58a6ff";     // суждение модели
    case "poc": return "#a371f7";       // форк-PoC (доказано исполнением)
    case "manual": return "#f0f6fc";
    default: return "#6e7681";
  }
}

export default function TargetsPage() {
  const { tr } = useLocale();
  const [data, setData] = useState<{ count: number; rows: Row[] } | null>(null);
  const [open, setOpen] = useState<string>("");
  const [action, setAction] = useState<"prep" | "scan" | "check" | "rescan">("prep");
  const [log, setLog] = useState<{ running: boolean; tail: string; lines: number } | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [inName, setInName] = useState("");
  const [inUrl, setInUrl] = useState("");
  const [inTerms, setInTerms] = useState("");
  const [inLog, setInLog] = useState<{ running: boolean; tail: string; slug: string } | null>(null);
  // Память шлюза: рабочее состояние охоты (лиды/закрытое) по мишени.
  type Gm = {
    leads: { key: string; reason: string; count: number }[];
    cleans: { key: string; reason: string; source: string; count: number }[];
  };
  const [gmOpen, setGmOpen] = useState<string>("");
  const [gm, setGm] = useState<Record<string, Gm>>({});
  const toggleGm = useCallback(async (slug: string) => {
    if (gmOpen === slug) {
      setGmOpen("");
      return;
    }
    setGmOpen(slug);
    const j = (await (await fetch(`/api/targets/gatemem?slug=${slug}`)).json()) as Gm;
    setGm((prev) => ({ ...prev, [slug]: j }));
  }, [gmOpen]);

  // Форк-PoC гейт по одному кандидату: адрес/сигнатура/актив -> verified|killed.
  const [pocFor, setPocFor] = useState<string>("");
  const [poc, setPoc] = useState({ target: "", sig: "", args: "", asset: "", key: "" });
  const [pocLog, setPocLog] = useState<{ running: boolean; tail: string } | null>(null);
  const pollPoc = useCallback(async (slug: string) => {
    const j = await (await fetch(`/api/targets/poc?slug=${slug}`)).json();
    setPocLog(j);
    return j.running as boolean;
  }, []);
  const startPoc = useCallback(async (slug: string) => {
    setPocLog({ running: true, tail: tr("запуск форка…", "forking…") });
    const j = await (
      await fetch("/api/targets/poc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, ...poc }),
      })
    ).json();
    if (j.error) {
      setPocLog({ running: false, tail: String(j.error) });
      return;
    }
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const running = await pollPoc(slug);
      if (!running) {
        if (gmOpen === slug) {
          const g = (await (await fetch(`/api/targets/gatemem?slug=${slug}`)).json()) as Gm;
          setGm((prev) => ({ ...prev, [slug]: g }));
        }
        return;
      }
      setTimeout(tick, 2500);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [poc, pollPoc, gmOpen, tr]);

  const load = useCallback(async () => {
    setData(await (await fetch("/api/targets")).json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const poll = useCallback(async (slug: string, act: string) => {
    const j = await (await fetch(`/api/targets/run?slug=${slug}&action=${act}`)).json();
    setLog(j);
    return j.running as boolean;
  }, []);

  // Пока процесс жив — опрашиваем лог; когда закончился, обновляем состояние
  // мишеней, чтобы «готово» стало правдой без перезагрузки страницы.
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const tick = async () => {
      if (!alive) return;
      const running = await poll(open, action);
      if (!running) {
        load();
        return;
      }
      setTimeout(tick, 2000);
    };
    tick();
    return () => {
      alive = false;
    };
  }, [open, action, poll, load]);

  // Приём идёт секунды-минуты (страница, GitHub по каждому репозиторию,
  // код по каждому адресу), поэтому тот же приём, что у сканов: процесс
  // отвязан от запроса, а страница читает хвост лога.
  const pollIntake = useCallback(async () => {
    const j = await (await fetch("/api/intake")).json();
    setInLog(j);
    return j.running as boolean;
  }, []);

  async function startIntake() {
    if (!inName.trim() || (!inUrl.trim() && !inTerms.trim())) return;
    setInLog({ running: true, tail: tr("запуск…", "starting…"), slug: "" });
    const j = await (
      await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: inName, url: inUrl, terms: inTerms }),
      })
    ).json();
    if (j.started === false || j.error) {
      setInLog({ running: false, tail: j.error || tr("не запустилось", "did not start"), slug: "" });
      return;
    }
    const tick = async () => {
      const alive = await pollIntake();
      if (alive) setTimeout(tick, 1500);
      else load();
    };
    setTimeout(tick, 1200);
  }

  const lastRunOf = (slug: string) =>
    (data?.rows || []).find((r) => r.slug === slug)?.state.lastRun || "";

  async function run(slug: string, act: "prep" | "scan" | "check" | "rescan") {
    setOpen(slug);
    setAction(act);
    setLog({ running: true, tail: tr("запуск…", "starting…"), lines: 0 });
    const j = await (
      await fetch("/api/targets/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, action: act }),
      })
    ).json();
    // Отказ запуска надо ПОКАЗАТЬ: молчаливый отказ выглядит как зависание,
    // а раньше вместо него шёл параллельный скан по пустой папке.
    if (j.started === false) {
      setLog({ running: false, tail: j.error || tr("уже идёт", "already running"), lines: 0 });
    }
  }

  return (
    <>
      <div className="top">
        <div>
          <h1>{tr("Мишени", "Targets")}</h1>
          <p className="sub">
            {tr("Выбранное с любых площадок вперемешку. Тот же файл, что у CLI:", "Selections from all platforms together. The same file used by the CLI:")}{" "}
            <code>data/targets.json</code>.
          </p>
        </div>
        <div className="row">
          <button className="btn outline" onClick={() => setIntakeOpen((v) => !v)}>
            {intakeOpen ? tr("Скрыть приём", "Hide intake") : tr("Принять вручную", "Manual intake")}
          </button>
          <button className="btn outline" onClick={() => run("_all", "check")}>
            {tr("Проверить все", "Check all")}
          </button>
          <Link className="btn primary" href="/market">
            {tr("Выбрать на рынке", "Choose from market")}
          </Link>
        </div>
      </div>

      {!data ? <Skeleton tiles={4} chart={false} /> : null}

      {intakeOpen ? (
        <div style={{ marginBottom: 16 }}>
          <Panel
            title={tr("Приём мишени вручную", "Manual target intake")}
            meta={inLog?.running ? tr("идёт…", "running…") : ""}
            actions={
              <button
                className="btn primary sm"
                disabled={!inName.trim() || (!inUrl.trim() && !inTerms.trim()) || inLog?.running}
                onClick={startIntake}
              >
                {tr("Принять", "Intake")}
              </button>
            }
          >
            <div className="formgrid">
              <label>
                <span>{tr("название", "name")}</span>
                <input value={inName} onChange={(e) => setInName(e.target.value)}
                       placeholder="Acme Protocol" />
              </label>
              <label>
                <span>{tr("ссылка на программу", "program URL")}</span>
                <input value={inUrl} onChange={(e) => setInUrl(e.target.value)}
                       placeholder="https://..." />
              </label>
            </div>
            <label className="formfull">
              <span>{tr("условия: вставь текст со страницы", "terms: paste the page text")}</span>
              <textarea rows={7} value={inTerms} onChange={(e) => setInTerms(e.target.value)}
                        placeholder={tr(
                          "Скоуп, адреса контрактов, ссылки на GitHub, что вне скоупа…",
                          "Scope, contract addresses, GitHub links, what is out of scope…")} />
            </label>
            {inLog ? (
              <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12, marginTop: 12 }}>
                {inLog.tail}
              </pre>
            ) : null}
            {inLog?.slug && !inLog.running ? (
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn primary sm" onClick={() => run(inLog.slug, "scan")}>
                  {tr("Сканировать", "Scan")} {inLog.slug}
                </button>
              </div>
            ) : null}
            <div style={{ marginTop: 12 }}>
              <Callout tone="info" title={tr("Зачем вставлять текст", "Why paste the text")}>
                {tr(
                  "Половина площадок отдаёт страницу только вошедшему, а часть закрыта Cloudflare — тогда по ссылке придёт пусто, и приём скажет об этом прямо. Вставленный текст в этом случае единственный источник. Факты из него достаются регулярками, а не моделью: репозиторий проверяется по GitHub, адрес — по коду в сети, и всё, что не подтвердилось, печатается отдельным списком с причиной.",
                  "Half the platforms serve the page only to logged-in users, and some sit behind Cloudflare — then the URL returns nothing and intake says so plainly. Pasted text is the only source in that case. Facts are extracted by regex, not by the model: repos are checked against GitHub, addresses against on-chain code, and whatever fails is printed with a reason.")}
              </Callout>
            </div>
          </Panel>
        </div>
      ) : null}

      <Panel title={tr("Выбрано", "Selected")} meta={data ? `${data.count}` : "…"} flush>
        <table>
          <thead>
            <tr>
              <th>{tr("мишень", "target")}</th>
              <th>{tr("площадка", "platform")}</th>
              <th className="num">{tr("макс. $", "max $")}</th>
              <th className="num">{tr("активов", "assets")}</th>
              <th className="num">{tr("репо", "repos")}</th>
              <th>{tr("готово", "ready")}</th>
              <th style={{ width: 300 }}>{tr("работа", "actions")}</th>
            </tr>
          </thead>
          <tbody>
            {(data?.rows || []).map((r) => ([
              <tr key={r.slug}>
                <td>
                  <a href={r.url} target="_blank" rel="noreferrer">
                    {r.name}
                  </a>
                  <div className="snip mono">{r.slug}</div>
                </td>
                <td className="mono">{r.site}</td>
                <td className="num mono">{r.reward ? Math.round(r.reward).toLocaleString() : "—"}</td>
                <td className="num mono">{r.assets || "—"}</td>
                <td className="num mono">{r.repos.length || "—"}</td>
                <td className="mono snip">
                  {[r.state.brief && "brief", r.state.src && "src", r.state.signals && `${tr("сигналов", "signals")} ${r.state.signals}`]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                  {r.state.lastRun ? (
                    <div>
                      <Link className="snip" href={`/runs?id=${r.state.lastRun}`}>
                        {tr("последний прогон", "last run")} →
                      </Link>
                    </div>
                  ) : null}
                </td>
                <td>
                  <div className="row">
                    <button className="btn outline sm" onClick={() => run(r.slug, "prep")}>
                      {tr("Подготовить", "Prepare")}
                    </button>
                    <button className="btn outline sm" onClick={() => run(r.slug, "scan")}>
                      {tr("Сканировать", "Scan")}
                    </button>
                    {r.state.signals ? (
                      <button
                        className="btn outline sm"
                        title={tr("прошлые сигналы уедут в archive/vN, в конце — разница", "previous signals move to archive/vN, followed by the diff")}
                        onClick={() => run(r.slug, "rescan")}
                      >
                        {tr("Заново", "Rescan")}
                      </button>
                    ) : null}
                    <button
                      className="btn outline sm"
                      title={tr("память шлюза: открытые лиды и закрытое с причиной", "gate memory: open leads and closed items with reasons")}
                      onClick={() => toggleGm(r.slug)}
                    >
                      {gmOpen === r.slug ? tr("Лиды ▾", "Leads ▾") : tr("Лиды ▸", "Leads ▸")}
                    </button>
                    <button
                      className="btn outline sm"
                      title={tr("форк-PoC гейт: verified или killed по одному кандидату (mainnet только чтение)", "fork-PoC gate: verified or killed for one candidate (mainnet read-only)")}
                      onClick={() => { setPocFor(pocFor === r.slug ? "" : r.slug); setPocLog(null); }}
                    >
                      {pocFor === r.slug ? tr("PoC ▾", "PoC ▾") : tr("PoC ▸", "PoC ▸")}
                    </button>
                    <button
                      className="btn outline sm"
                      onClick={async () => {
                        await fetch("/api/targets", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ drop: r.slug }),
                        });
                        load();
                      }}
                    >
                      {tr("Убрать", "Remove")}
                    </button>
                  </div>
                </td>
              </tr>,
              gmOpen === r.slug ? (
                <tr key={`${r.slug}-gm`}>
                  <td colSpan={7} style={{ background: "var(--panel-2, rgba(127,127,127,.06))" }}>
                    {!gm[r.slug] ? (
                      <div className="snip">{tr("загрузка…", "loading…")}</div>
                    ) : gm[r.slug].leads.length === 0 && gm[r.slug].cleans.length === 0 ? (
                      <div className="snip">
                        {tr("память пуста — прогони скан (шлюз запишет вердикты)", "memory empty — run a scan (the gate writes verdicts)")}
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: 24, flexWrap: "wrap", padding: "4px 0" }}>
                        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
                          <div className="snip mono" style={{ marginBottom: 4 }}>
                            {tr("ОТКРЫТЫЕ ЛИДЫ", "OPEN LEADS")} — {gm[r.slug].leads.length} ({tr("копать / PoC", "dig / PoC")})
                          </div>
                          {gm[r.slug].leads.length === 0 ? (
                            <div className="snip">—</div>
                          ) : (
                            gm[r.slug].leads.map((l) => {
                              const cand = /PROFIT|КАНДИДАТ/i.test(l.reason || "");
                              return (
                                <div key={l.key} className="snip" style={{ padding: "2px 0" }}>
                                  <span className="mono" style={cand ? { color: "#2ea043", fontWeight: 600 } : undefined}>{l.key}</span>
                                  {cand ? <span className="tag mono" style={{ color: "#2ea043" }}> ✓PoC</span> : null}
                                  {l.reason ? <span className="snip"> — {l.reason}</span> : null}
                                </div>
                              );
                            })
                          )}
                        </div>
                        <div style={{ flex: "1 1 320px", minWidth: 280 }}>
                          <div className="snip mono" style={{ marginBottom: 4 }}>
                            {tr("ЗАКРЫТО", "CLOSED")} — {gm[r.slug].cleans.length} ({tr("не всплывёт снова", "won’t resurface")})
                          </div>
                          {gm[r.slug].cleans.map((c) => (
                            <div key={c.key} className="snip" style={{ padding: "2px 0" }}>
                              <span className="mono">{c.key}</span>{" "}
                              <span className="tag mono" style={{ opacity: 0.85, color: srcColor(c.source) }}>[{c.source || "?"}]</span>
                              {c.reason ? <span className="snip"> — {c.reason}</span> : null}
                            </div>
                          ))}
                          <div className="snip mono" style={{ marginTop: 6, opacity: 0.6, fontSize: 11 }}>
                            {tr("источник закрытия", "closed by")}:{" "}
                            <span style={{ color: srcColor("killcheck") }}>killcheck</span> ·{" "}
                            <span style={{ color: srcColor("scope") }}>scope(OOS)</span> ·{" "}
                            <span style={{ color: srcColor("model") }}>model</span> ·{" "}
                            <span style={{ color: srcColor("poc") }}>poc(форк)</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </td>
                </tr>
              ) : null,
              pocFor === r.slug ? (
                <tr key={r.slug + "-poc"}>
                  <td colSpan={7} style={{ background: "var(--panel-2, rgba(127,127,127,.06))" }}>
                    <div className="snip mono" style={{ marginBottom: 6 }}>
                      {tr("ФОРК-PoC ГЕЙТ", "FORK-PoC GATE")} — {tr("verified или killed по одному кандидату; mainnet только чтение", "verified or killed for one candidate; mainnet read-only")}
                    </div>
                    <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "flex-end" }}>
                      <label className="snip" style={{ display: "flex", flexDirection: "column" }}>
                        {tr("контракт-цель (адрес)", "target contract (address)")}
                        <input className="mono" style={{ width: 320 }} placeholder="0x…" value={poc.target} onChange={(e) => setPoc({ ...poc, target: e.target.value })} />
                      </label>
                      <label className="snip" style={{ display: "flex", flexDirection: "column" }}>
                        {tr("сигнатура функции", "function signature")}
                        <input className="mono" style={{ width: 220 }} placeholder="my2Wei(address)" value={poc.sig} onChange={(e) => setPoc({ ...poc, sig: e.target.value })} />
                      </label>
                      <label className="snip" style={{ display: "flex", flexDirection: "column" }}>
                        {tr("аргументы (через запятую)", "args (comma-separated)")}
                        <input className="mono" style={{ width: 220 }} placeholder="0xTOKEN" value={poc.args} onChange={(e) => setPoc({ ...poc, args: e.target.value })} />
                      </label>
                      <label className="snip" style={{ display: "flex", flexDirection: "column" }}>
                        {tr("актив для замера дельты", "asset for delta")}
                        <input className="mono" style={{ width: 320 }} placeholder="0xTOKEN" value={poc.asset} onChange={(e) => setPoc({ ...poc, asset: e.target.value })} />
                      </label>
                      <label className="snip" style={{ display: "flex", flexDirection: "column" }}>
                        {tr("ключ Contract.func (в память)", "key Contract.func (to memory)")}
                        <input className="mono" style={{ width: 220 }} placeholder="FLFeeFaucet.my2Wei" value={poc.key} onChange={(e) => setPoc({ ...poc, key: e.target.value })} />
                      </label>
                      <button className="btn sm" disabled={pocLog?.running} onClick={() => startPoc(r.slug)}>
                        {pocLog?.running ? tr("форк идёт…", "forking…") : tr("Запустить PoC", "Run PoC")}
                      </button>
                    </div>
                    {pocLog ? (
                      <pre className="mono" style={{ marginTop: 8, maxHeight: 220, overflow: "auto", fontSize: 12, opacity: 0.9 }}>
                        {pocLog.tail}
                      </pre>
                    ) : null}
                  </td>
                </tr>
              ) : null,
            ]))}
          </tbody>
        </table>
        {data && data.rows.length === 0 ? (
          <Empty>
            {tr("Мишеней нет.", "No targets.")} <Link href="/market">{tr("Выбери на рынке", "Choose from market")}</Link>{" "}
            — {tr("мультивыбор, площадки вперемешку.", "multi-select across platforms.")}
          </Empty>
        ) : null}
      </Panel>

      {open ? (
        <div style={{ marginTop: 16 }}>
          <Panel
            title={
              action === "check"
                ? tr("Проверка мишеней", "Checking targets")
                : `${action === "prep" ? tr("Подготовка", "Preparation") : action === "rescan" ? tr("Пересканирование", "Rescan") : tr("Сигналы", "Signals")}: ${open}`
            }
            meta={log?.running ? tr("идёт…", "running…") : tr("готово", "done")}
            actions={
              <>
                {/* Пока прогон идёт, страница «Прогоны» сама открывает идущий,
                    поэтому ссылке не нужен id — он ещё и не известен здесь. */}
                <Link className="btn outline sm" href={log?.running ? `/runs?slug=${open}` : `/runs?id=${lastRunOf(open)}`}>
                  {tr("Шаги в прогонах", "Steps in runs")} →
                </Link>
                <button className="btn outline sm" onClick={() => setOpen("")}>
                  {tr("Закрыть", "Close")}
                </button>
              </>
            }
          >
            <pre className="mono" style={{ whiteSpace: "pre-wrap", fontSize: 12, margin: 0 }}>
              {log?.tail || "…"}
            </pre>
          </Panel>
        </div>
      ) : null}

      <div style={{ marginTop: 16 }}>
        <Callout tone="info" title={tr("Что делают кнопки", "What the buttons do")}>
          {tr("«Подготовить» заводит", "“Prepare” creates")} <code>data/bounty/&lt;slug&gt;/</code>:{" "}
          {tr("BRIEF.md со скоупом и адресами, машиночитаемый scope.json (in-scope/OOS, исключённые папки), скачанные исходники. Отдельно жать её не обязательно: «Сканировать» сам сделает подготовку, если исходника ещё нет, — но первый запуск тогда затянется, потому что молча тянет все репозитории из скоупа. «Сканировать» гоняет сигналы (audits, blindspots, recodiff по репозиторию; siblings, statesync, ungated, msgauth по дереву) и складывает вывод целиком в", "BRIEF.md with scope and addresses, a machine-readable scope.json (in-scope/OOS, excluded folders), plus downloaded source. You do not have to run it separately: “Scan” prepares automatically if source is missing, but the first run takes longer because it silently fetches every scoped repository. “Scan” runs signals (audits, blindspots, recodiff on the repository; siblings, statesync, ungated, msgauth on the tree) and stores complete output in")}{" "}
          <code>signals/*.txt</code>. {tr("Читать заходами, вычёркивая. «Заново» делает то же, но прошлые сигналы уезжают в", "Review it in passes, crossing items out. “Rescan” does the same, but previous signals move to")}{" "}
          <code>archive/vN</code>, {tr("а в конце печатается разница — это ответ на вопрос «что изменилось после правки пайплайна». Все кнопки запускают тот же", "then prints a diff answering “what changed after the pipeline update”. Every button runs the same")}{" "}
          <code>targets.py</code>, {tr("что и консоль, и идут минутами. Второе действие по одной мишени не запустится, пока идёт первое: скан по недокачанному исходнику молча пропускает половину сигналов.", "as the CLI and can take minutes. A second action for the same target will not start while the first is running: scanning incomplete source silently skips half the signals.")}
        </Callout>
      </div>
    </>
  );
}
