import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
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
  console.error("NO_KEY");
  process.exit(1);
}

const db = new DatabaseSync(join(root, "data", "workbench.db"));
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
  report_id INTEGER NOT NULL REFERENCES reports(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT ''
);
`);

const model =
  db.prepare("SELECT value FROM settings WHERE key = 'or_model'").get()?.value ||
  "nvidia/nemotron-3.5-lightning:free";
const prog = db
  .prepare(
    `SELECT slug, title, url FROM programs
     WHERE slug = 'near-intents-bridges'
        OR (unending = 1 AND private = 0 AND languages LIKE '%Solidity%' AND min_rep <= 80)
     ORDER BY CASE slug WHEN 'near-intents-bridges' THEN 0 ELSE 1 END, max_bounty DESC LIMIT 1`
  )
  .get();

const url = prog.url || `https://hackenproof.com/programs/${prog.slug}`;
console.log(JSON.stringify({ model, slug: prog.slug, title: prog.title, url }, null, 2));

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

const page = await fetchText(url);
const gh = [...new Set(page.match(/https?:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/g) || [])].slice(0, 2);
const extras = [];
for (const g of gh) {
  const m = g.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!m) continue;
  const raw = `https://raw.githubusercontent.com/${m[1]}/${m[2]}/HEAD/README.md`;
  const t = await fetchText(raw);
  if (t.length > 40) extras.push(`SOURCE ${raw}\n${t.slice(0, 4000)}`);
}

const SYSTEM = `Ты аналитик bug bounty. Пиши только JSON, без markdown вокруг.
Задача: выжимка программы + гипотезы hotspots/leads для ЧЕЛОВЕКА. Не пиши эксплойты, payload, PoC-шаги атаки по шагам.
Правила:
- ворота важнее кода: private/paused, KYC/fee, min reputation, Crit-only+recoverable
- severity ≠ $; микро-пулы — низкий EV
- не предлагай то, что в OOS / known issues / FP families
- web XSS без impact — слабый EV
- EVM/Solidity приоритетнее, если программа смешанная
Поля JSON:
{"gates":{"ok":true,"rep":0,"fee":0,"notes":""},"scope":["..."],"oos":["..."],"payouts":"","hotspots":[{"code":"H1","title":"","why":"","severity":"High"}],"leads":[{"title":"","severity":"High","hypothesis":"","why_not_oos":"","p_dupe":"high|med|low"}],"kill":["..."],"summary":"3-6 предложений"}
Максимум 6 hotspots и 5 leads. Если ворота красные — leads пустой, gates.ok=false.`;

const user = `Программа: ${prog.title}
URL: ${url}
Каталог HP: ${JSON.stringify(prog)}
Текст страницы:
${page.slice(0, 12000)}

${extras.join("\n\n")}
`;

const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:3333",
    "X-Title": "auditscout-workbench-smoke",
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
const j = await r.json();
if (!r.ok) {
  console.error("OR_HTTP", r.status, j.error || j);
  process.exit(2);
}
const raw = j.choices?.[0]?.message?.content || "";
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
const payload = extractJson(raw) || { summary: raw.slice(0, 1500), parse_error: true };

const job = db
  .prepare(`INSERT INTO jobs (kind, target, title, status, started_at) VALUES ('program', ?, ?, 'running', datetime('now'))`)
  .run(prog.slug, `[smoke] ${prog.title}`);
const jobId = Number(job.lastInsertRowid);
const ins = db
  .prepare(
    `INSERT INTO reports (job_id, program_slug, title, model, summary, payload) VALUES (?, ?, ?, ?, ?, ?)`
  )
  .run(jobId, prog.slug, prog.title, model, payload.summary || "", JSON.stringify(payload));
const reportId = Number(ins.lastInsertRowid);
const add = db.prepare(`INSERT INTO report_items (report_id, kind, title, severity, body, extra) VALUES (?, ?, ?, ?, ?, ?)`);
for (const h of payload.hotspots || []) add.run(reportId, "hotspot", `${h.code || ""} ${h.title || ""}`.trim(), h.severity || "", h.why || "", "");
for (const l of payload.leads || []) {
  add.run(reportId, "lead", l.title || "lead", l.severity || "", `${l.hypothesis || ""}\nP(dupe): ${l.p_dupe || ""}`, JSON.stringify(l));
}
for (const k of payload.kill || []) add.run(reportId, "kill", String(k).slice(0, 180), "", k, "");
db.prepare(`UPDATE jobs SET status='done', finished_at=datetime('now'), report_id=? WHERE id=?`).run(reportId, jobId);

console.log(
  JSON.stringify(
    {
      usage: j.usage,
      parse_ok: !payload.parse_error,
      jobId,
      reportId,
      gates: payload.gates,
      summary: payload.summary,
      hotspots: (payload.hotspots || []).map((h) => `${h.code} ${h.title}`),
      leads: (payload.leads || []).map((l) => l.title),
      kill: payload.kill,
      ui: `http://localhost:3333/reports/${reportId}`,
    },
    null,
    2
  )
);
