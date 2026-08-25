import { db, getSetting } from "@/lib/db";
import { ok } from "@/lib/http";
import { density, isSmartContract, loadMarket, loadTargets, targetState } from "@/lib/market";

export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

const SEV = ["Critical", "High", "Medium", "Low"] as const;

function normSev(s: unknown): string {
  const v = String(s || "").trim().toLowerCase();
  if (v.startsWith("crit")) return "Critical";
  if (v.startsWith("high") || v === "medium-high") return "High";
  if (v.startsWith("med")) return "Medium";
  if (v.startsWith("low")) return "Low";
  return "прочее";
}

export function GET() {
  const d = db();
  const one = (sql: string) => Number((d.prepare(sql).get() as Row)?.n ?? 0);
  const all = (sql: string) => d.prepare(sql).all() as Row[];

  const rep = Number(getSetting("hp_reputation") || "80");

  /* воронка: от поставленных задач до собственных зацепок */
  const jobsTotal = one("SELECT COUNT(*) n FROM jobs");
  const jobsDone = one("SELECT COUNT(*) n FROM jobs WHERE status='done'");
  const reportsN = one("SELECT COUNT(*) n FROM reports");
  const leadsN = one("SELECT COUNT(*) n FROM report_items WHERE kind='lead'");
  const leadsHot = one(
    "SELECT COUNT(*) n FROM report_items WHERE kind='lead' AND (severity LIKE 'Crit%' OR severity LIKE 'High%')"
  );
  const ownN = one("SELECT COUNT(*) n FROM findings");
  const funnel = [
    { stage: "программ в очереди", n: jobsTotal },
    { stage: "просканировано", n: jobsDone },
    { stage: "отчётов получено", n: reportsN },
    { stage: "зацепок в отчётах", n: leadsN },
    { stage: "из них Crit/High", n: leadsHot },
    { stage: "свои LEAD в треках", n: ownN },
  ];

  /* состав по серьёзности: зацепки против hotspots */
  const sevRows = all(
    "SELECT kind, severity, COUNT(*) n FROM report_items WHERE kind IN ('lead','hotspot') GROUP BY 1,2"
  );
  const sevMix: Record<string, Record<string, number>> = { lead: {}, hotspot: {} };
  for (const r of sevRows) {
    const k = String(r.kind);
    const s = normSev(r.severity);
    sevMix[k][s] = (sevMix[k][s] || 0) + Number(r.n);
  }

  /* программы: приз против тесноты */
  const programs = all(
    `SELECT slug, title, min_rep, max_bounty, submissions, paid, fee, languages
       FROM programs
      WHERE max_bounty IS NOT NULL AND max_bounty > 0`
  ).map((r) => ({
    slug: String(r.slug),
    title: String(r.title),
    minRep: Number(r.min_rep || 0),
    maxBounty: Number(r.max_bounty || 0),
    submissions: Number(r.submissions || 0),
    paid: Number(r.paid || 0),
    solidity: String(r.languages || "").toLowerCase().includes("solidity"),
    open: Number(r.min_rep || 0) <= rep,
  }));

  /* порог репутации: сколько программ за каким забором */
  const repRows = all(
    "SELECT min_rep, COUNT(*) n, SUM(COALESCE(max_bounty,0)) mb FROM programs GROUP BY 1 ORDER BY 1"
  ).map((r) => ({
    minRep: Number(r.min_rep || 0),
    n: Number(r.n),
    maxBounty: Number(r.mb || 0),
    open: Number(r.min_rep || 0) <= rep,
  }));

  /* чужие находки: что реально платят по серьёзности */
  const disclosed = all(
    `SELECT severity, COUNT(*) n, AVG(bounty) avg, SUM(bounty) sum, MAX(bounty) max
       FROM disclosed WHERE bounty IS NOT NULL GROUP BY 1`
  )
    .map((r) => ({
      sev: normSev(r.severity),
      n: Number(r.n),
      avg: Number(r.avg || 0),
      sum: Number(r.sum || 0),
      max: Number(r.max || 0),
    }))
    .filter((r) => r.sev !== "прочее")
    .sort((a, b) => SEV.indexOf(a.sev as never) - SEV.indexOf(b.sev as never));

  /* ход работы по часам: отчёты и свои находки нарастающим итогом */
  const byHour = (sql: string) =>
    all(sql).map((r) => ({ h: String(r.h), n: Number(r.n) }));
  const repHours = byHour(
    "SELECT substr(created_at,1,13) h, COUNT(*) n FROM reports GROUP BY 1 ORDER BY 1"
  );
  const findHours = byHour(
    "SELECT substr(created_at,1,13) h, COUNT(*) n FROM findings GROUP BY 1 ORDER BY 1"
  );
  const hours = Array.from(new Set([...repHours, ...findHours].map((r) => r.h))).sort();
  let ar = 0;
  let af = 0;
  const timeline = hours.map((h) => {
    ar += repHours.find((r) => r.h === h)?.n || 0;
    af += findHours.find((r) => r.h === h)?.n || 0;
    return { h, reports: ar, findings: af };
  });

  /* прочитано с диска: объём по видам документов */
  const docs = all(
    "SELECT kind, COUNT(*) n, SUM(LENGTH(body)) bytes FROM documents GROUP BY 1 ORDER BY 3 DESC"
  ).map((r) => ({ kind: String(r.kind), n: Number(r.n), bytes: Number(r.bytes || 0) }));

  /* треки по состоянию */
  const projects = all("SELECT status, COUNT(*) n FROM projects GROUP BY 1 ORDER BY 2 DESC").map(
    (r) => ({ status: String(r.status), n: Number(r.n) })
  );

  /* самые урожайные отчёты */
  const topReports = all(
    `SELECT r.id, r.title,
            SUM(CASE WHEN i.kind='lead' THEN 1 ELSE 0 END) leads,
            SUM(CASE WHEN i.kind='hotspot' THEN 1 ELSE 0 END) hotspots,
            SUM(CASE WHEN i.kind='kill' THEN 1 ELSE 0 END) kill
       FROM reports r LEFT JOIN report_items i ON i.report_id = r.id
      GROUP BY r.id ORDER BY leads DESC, hotspots DESC LIMIT 12`
  ).map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    leads: Number(r.leads || 0),
    hotspots: Number(r.hotspots || 0),
    kill: Number(r.kill || 0),
  }));

  const headline = {
    rep,
    programsSeen: one("SELECT COUNT(*) n FROM programs"),
    programsOpen: one(`SELECT COUNT(*) n FROM programs WHERE min_rep <= ${rep}`),
    scanned: jobsDone,
    leads: leadsN,
    own: ownN,
    kill: one("SELECT COUNT(*) n FROM report_items WHERE kind='kill'"),
    bytesRead: one("SELECT COALESCE(SUM(LENGTH(body)),0) n FROM documents"),
  };

  /* Рынок и мишени лежат НЕ в этой базе, а в файлах `data/market.json` и
     `data/targets.json` — их пишет CLI, и они общие с ним. Поэтому цифры
     сюда добавляются отдельным блоком: смешивать их с таблицей `programs`
     (это импорт каталога HackenProof) нельзя, счёт получился бы двойной. */
  const marketRows = loadMarket();
  const targets = loadTargets();
  const tstate = targets.map((t) => targetState(t.slug));
  const market = {
    total: marketRows.length,
    sites: [...new Set(marketRows.map((p) => p.site))].length,
    sc: marketRows.filter(isSmartContract).length,
    withRepos: marketRows.filter((p) => p.repos.length > 0).length,
    known: marketRows.filter((p) => density(p) !== null).length,
    targets: targets.length,
    prepped: tstate.filter((s) => s.brief).length,
    scanned: tstate.filter((s) => s.signals > 0).length,
    signals: tstate.reduce((a, s) => a + s.signals, 0),
    bySite: [...marketRows.reduce((m, p) => m.set(p.site, (m.get(p.site) || 0) + 1), new Map<string, number>())]
      .map(([site, n]) => ({ site, n }))
      .sort((a, b) => b.n - a.n),
    /* «приз против тесноты» по всему рынку. Точка есть только там, где
       площадка публикует число заявок: у immunefi, hackerone, bugcrowd и
       intigriti его нет, и ноль вместо него означал бы «никто не искал». */
    dots: marketRows
      .map((p) => ({ p, d: density(p) }))
      .filter((x) => x.d !== null && (x.d as number) > 0 && x.p.reward > 0)
      .map((x) => ({
        label: x.p.name,
        x: x.d as number,
        y: x.p.reward,
        group: x.p.site,
        extra: `${x.p.assets.length} активов · ${x.p.reports} заявок${x.p.fee ? ` · комиссия ${x.p.fee}$` : ""}${
          x.p.repos.length ? ` · ${x.p.repos.length} репо` : ""
        }`,
        repos: x.p.repos.length,
        sc: isSmartContract(x.p),
        fee: x.p.fee,
      })),
  };

  return ok({ headline, funnel, sevMix, programs, repRows, disclosed, timeline, docs, projects, topReports, market });
}
