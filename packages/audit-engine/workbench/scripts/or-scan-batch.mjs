import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const logPath = join(root, "data", "scan-batch.log");
const progressPath = join(root, "data", "scan-progress.json");

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(logPath, line + "\n");
}

const env = Object.fromEntries(
  readFileSync(join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
    })
);
const key = env.OPENROUTER_API_KEY || "";
if (!key) {
  log("NO_KEY");
  process.exit(1);
}

const db = new DatabaseSync(join(root, "data", "workbench.db"));
db.exec("PRAGMA busy_timeout = 8000");
db.exec("PRAGMA journal_mode = WAL");

const model =
  db.prepare("SELECT value FROM settings WHERE key = 'or_model'").get()?.value ||
  "nvidia/nemotron-3.5-lightning:free";
const maxRep = Number(db.prepare("SELECT value FROM settings WHERE key = 'hp_reputation'").get()?.value || 80);

const SYSTEM = `Ты аналитик bug bounty. Пиши только JSON, без markdown вокруг.
Задача: выжимка программы + гипотезы hotspots/leads для ЧЕЛОВЕКА. Не пиши эксплойты, payload, PoC-шаги атаки по шагам.
Правила:
- ворота важнее кода: private/paused, KYC/fee, min reputation, Crit-only+recoverable
- severity ≠ $; микро-пулы — низкий EV
- не предлагай то, что в OOS / known issues / FP families
- web XSS без impact — слабый EV; CEX web — только гипотезы IDOR/auth/вывод, без инструкций взлома
- EVM/Solidity приоритетнее, если программа смешанная
Поля JSON:
{"gates":{"ok":true,"rep":0,"fee":0,"notes":""},"scope":["..."],"oos":["..."],"payouts":"","hotspots":[{"code":"H1","title":"","why":"","severity":"High"}],"leads":[{"title":"","severity":"High","hypothesis":"","why_not_oos":"","p_dupe":"high|med|low"}],"kill":["..."],"summary":"3-6 предложений"}
Максимум 6 hotspots и 5 leads. Если ворота красные — leads пустой, gates.ok=false.`;

function htmlToText(html, max = 18000) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

async function fetchText(u) {
  try {
    const r = await fetch(u, {
      headers: { "User-Agent": "auditscout-workbench/0.2 (local research)" },
      signal: AbortSignal.timeout(20_000),
    });
    return htmlToText(await r.text());
  } catch {
    return "";
  }
}

function extractJson(s) {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fence ? fence[1] : s;
  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") depth--;
    if (depth === 0) {
      try {
        return JSON.parse(src.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function memoryBlock() {
  let kills = [];
  let items = [];
  try {
    kills = db.prepare(`SELECT title, status FROM findings WHERE status IN ('kill','clean') ORDER BY updated_at DESC LIMIT 16`).all();
    items = db.prepare(`SELECT title, kind FROM report_items WHERE kind IN ('kill','lead') ORDER BY id DESC LIMIT 16`).all();
  } catch {
    /* tables may be empty */
  }
  const lines = [
    ...kills.map((x) => `- ${x.status}: ${x.title}`),
    ...items.map((x) => `- ${x.kind}: ${x.title}`),
  ];
  return lines.slice(0, 24).join("\n") || "(пусто)";
}

function writeProgress(extra) {
  const counts = db.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all();
  const reports = db.prepare(`SELECT COUNT(*) AS n FROM reports`).get();
  writeFileSync(
    progressPath,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        model,
        maxRep,
        jobs: Object.fromEntries(counts.map((c) => [c.status, c.n])),
        reports: reports.n,
        ...extra,
      },
      null,
      2
    )
  );
}

db.exec(`
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL DEFAULT 'program',
  target TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT NOT NULL DEFAULT '',
  report_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
);
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  project_id INTEGER,
  program_slug TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS report_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT ''
);
`);

db.prepare(`UPDATE jobs SET status='queued', error='' WHERE status='running'`).run();

const pool = db
  .prepare(
    `SELECT slug, title, url, min_rep, max_bounty, languages, status
     FROM programs
     WHERE private = 0 AND unending = 1 AND audit_program = 0 AND min_rep <= ?
     ORDER BY (max_bounty IS NULL), max_bounty DESC, submissions ASC`
  )
  .all(maxRep);

const ins = db.prepare(`INSERT INTO jobs (kind, target, title, status) VALUES ('program', ?, ?, 'queued')`);
let queued = 0;
for (const p of pool) {
  const hasReport = db.prepare(`SELECT id FROM reports WHERE program_slug = ? LIMIT 1`).get(p.slug);
  if (hasReport) continue;
  const dup = db.prepare(`SELECT id FROM jobs WHERE target = ? AND status IN ('queued','running','done')`).get(p.slug);
  if (dup) continue;
  ins.run(p.slug, p.title);
  queued++;
}

log(`pool=${pool.length} newly_queued=${queued} model=${model} maxRep=${maxRep}`);
writeProgress({ phase: "queued", pool: pool.length, newly_queued: queued });

async function chat(user) {
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3333",
      "X-Title": "auditscout-workbench-batch",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await r.json();
  return { ok: r.ok, status: r.status, body };
}

async function runJob(job) {
  const slug = String(job.target);
  const program = db.prepare("SELECT * FROM programs WHERE slug = ?").get(slug);
  const title = String(job.title || program?.title || slug);
  const url = program?.url || `https://hackenproof.com/programs/${slug}`;
  const page = await fetchText(url);
  const gh = [...new Set(page.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g) || [])].slice(0, 2);
  const extras = [];
  for (const g of gh) {
    const m = g.match(/github\.com\/([^/]+)\/([^/]+)/);
    if (!m) continue;
    const raw = await fetchText(`https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/README.md`);
    if (raw.length > 40) extras.push(`SOURCE ${m[0]}\n${raw.slice(0, 6000)}`);
  }
  const user = `Программа: ${title}
URL: ${url}
Каталог HP: ${program ? JSON.stringify(program).slice(0, 3500) : "нет"}
Память прошлых CLEAN/KILL (не повторять):
${memoryBlock()}

Текст страницы:
${page.slice(0, 14000)}

${extras.join("\n\n")}
`;
  let last;
  for (let attempt = 0; attempt < 4; attempt++) {
    last = await chat(user);
    if (last.ok) break;
    const msg = last.body?.error?.message || `HTTP ${last.status}`;
    if (last.status === 429) {
      const daily = /daily|day|limit/i.test(String(msg));
      if (daily && attempt >= 1) throw new Error(`RATE_LIMIT_DAILY ${msg}`);
      const wait = daily ? 60_000 : 15_000 * (attempt + 1);
      log(`429 ${slug} wait ${wait}ms ${msg}`);
      await new Promise((res) => setTimeout(res, wait));
      continue;
    }
    throw new Error(msg);
  }
  if (!last?.ok) throw new Error(last.body?.error?.message || `HTTP ${last.status}`);
  const raw = last.body?.choices?.[0]?.message?.content || "";
  const payload = extractJson(raw) || { summary: raw.slice(0, 2000), parse_error: true };
  const r = db
    .prepare(`INSERT INTO reports (job_id, program_slug, title, model, summary, payload) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(job.id, slug, title, model, payload.summary || "", JSON.stringify(payload));
  const reportId = Number(r.lastInsertRowid);
  const add = db.prepare(`INSERT INTO report_items (report_id, kind, title, severity, body, extra) VALUES (?, ?, ?, ?, ?, ?)`);
  for (const h of payload.hotspots || []) add.run(reportId, "hotspot", `${h.code || ""} ${h.title || ""}`.trim(), h.severity || "", h.why || "", "");
  for (const l of payload.leads || []) {
    add.run(reportId, "lead", l.title || "lead", l.severity || "", `${l.hypothesis || ""}\nP(dupe): ${l.p_dupe || ""}`, JSON.stringify(l));
  }
  for (const k of payload.kill || []) add.run(reportId, "kill", String(k).slice(0, 180), "", k, "");
  for (const s of payload.scope || []) add.run(reportId, "scope", String(s).slice(0, 180), "", s, "");
  for (const s of payload.oos || []) add.run(reportId, "oos", String(s).slice(0, 180), "", s, "");
  return { reportId, gates: payload.gates, leads: (payload.leads || []).length, parse_ok: !payload.parse_error, usage: last.body?.usage };
}

let done = 0;
let errors = 0;
const started = Date.now();

while (true) {
  const job = db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY id ASC LIMIT 1`).get();
  if (!job) break;
  db.prepare(`UPDATE jobs SET status='running', started_at=datetime('now'), error='' WHERE id=?`).run(job.id);
  log(`start #${job.id} ${job.target}`);
  try {
    const out = await runJob(job);
    db.prepare(`UPDATE jobs SET status='done', finished_at=datetime('now'), report_id=? WHERE id=?`).run(out.reportId, job.id);
    done++;
    log(`ok #${job.id} report=${out.reportId} leads=${out.leads} parse=${out.parse_ok} gates=${out.gates?.ok}`);
    writeProgress({ phase: "running", last: job.target, done, errors });
  } catch (e) {
    const msg = String(e).slice(0, 800);
    db.prepare(`UPDATE jobs SET status='error', finished_at=datetime('now'), error=? WHERE id=?`).run(msg, job.id);
    errors++;
    log(`err #${job.id} ${job.target} ${msg}`);
    writeProgress({ phase: "error", last: job.target, done, errors, error: msg });
    if (msg.includes("RATE_LIMIT_DAILY")) {
      log("stop: daily rate limit");
      break;
    }
  }
}

const elapsed = Math.round((Date.now() - started) / 1000);
log(`finished done=${done} errors=${errors} sec=${elapsed}`);
writeProgress({ phase: "finished", done, errors, sec: elapsed });
