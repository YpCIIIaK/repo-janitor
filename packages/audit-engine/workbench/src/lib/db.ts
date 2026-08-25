import { DatabaseSync } from "node:sqlite";
import { dbPath } from "./paths";

let cached: DatabaseSync | null = null;

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  platform TEXT NOT NULL DEFAULT '',
  program_url TEXT NOT NULL DEFAULT '',
  min_rep INTEGER NOT NULL DEFAULT 0,
  max_bounty REAL,
  path TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  stopped_at TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS hotspots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL,
  verdict TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS findings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'lead',
  body TEXT NOT NULL DEFAULT '',
  files TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  source_path TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS programs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'hackenproof',
  min_rep INTEGER NOT NULL DEFAULT 0,
  max_bounty REAL,
  min_bounty REAL,
  paid REAL,
  submissions INTEGER NOT NULL DEFAULT 0,
  fee REAL,
  kyc INTEGER NOT NULL DEFAULT 0,
  poc INTEGER NOT NULL DEFAULT 0,
  unending INTEGER NOT NULL DEFAULT 0,
  audit_program INTEGER NOT NULL DEFAULT 0,
  private INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT '',
  languages TEXT NOT NULL DEFAULT '[]',
  types TEXT NOT NULL DEFAULT '[]',
  url TEXT NOT NULL DEFAULT '',
  extra TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS disclosed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  handle TEXT NOT NULL,
  rank INTEGER,
  title TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT '',
  program TEXT NOT NULL DEFAULT '',
  bounty REAL,
  url TEXT NOT NULL DEFAULT '',
  report_id TEXT NOT NULL DEFAULT '',
  disclosed_at TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_findings_project ON findings(project_id);
CREATE INDEX IF NOT EXISTS idx_docs_kind ON documents(kind);
CREATE INDEX IF NOT EXISTS idx_docs_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_hotspots_project ON hotspots(project_id);
CREATE INDEX IF NOT EXISTS idx_programs_rep ON programs(min_rep);
CREATE INDEX IF NOT EXISTS idx_disclosed_sev ON disclosed(severity);

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
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
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

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports(created_at);

CREATE TABLE IF NOT EXISTS scanner_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',
  weight INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(kind, title)
);
CREATE INDEX IF NOT EXISTS idx_memory_kind ON scanner_memory(kind);
`;

export function db(): DatabaseSync {
  if (cached) return cached;
  const database = new DatabaseSync(dbPath());
  database.exec(SCHEMA);
  migrateJobs(database);
  seedSettings(database);
  seedMemory(database);
  cached = database;
  return database;
}

function migrateJobs(database: DatabaseSync) {
  const columns = database.prepare("PRAGMA table_info(jobs)").all() as { name: string }[];
  const have = new Set(columns.map((column) => column.name));
  const additions: [string, string][] = [
    ["stop_requested_at", "TEXT"],
    ["canceled_at", "TEXT"],
    ["worker_token", "TEXT"],
    ["attempt", "INTEGER NOT NULL DEFAULT 0"],
    ["run_id", "TEXT"],
  ];
  for (const [name, definition] of additions) {
    if (!have.has(name)) database.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${definition}`);
  }
  const runtime = globalThis as typeof globalThis & { __auditScoutJobsReconciled?: boolean };
  if (!runtime.__auditScoutJobsReconciled) {
    database.prepare(
      `UPDATE jobs SET status='stopped', finished_at=datetime('now'), worker_token=NULL,
       error=CASE WHEN error='' THEN 'server restarted while job was running' ELSE error END
       WHERE status='running'`
    ).run();
    runtime.__auditScoutJobsReconciled = true;
  }
}

function seedSettings(database: DatabaseSync) {
  const row = database.prepare("SELECT value FROM settings WHERE key = ?").get("hp_reputation") as
    | { value: string }
    | undefined;
  if (!row) {
    database.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("hp_reputation", "80");
    database.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("current_project", "aa-4337");
    database.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run("or_model", "nvidia/nemotron-3.5-lightning:free");
  }
  const model = database.prepare("SELECT value FROM settings WHERE key = ?").get("or_model") as { value: string } | undefined;
  if (!model) {
    database.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "or_model",
      "nvidia/nemotron-3.5-lightning:free"
    );
  } else if (model.value === "nvidia/nemotron-3-nano-128k-instruct:free") {
    database.prepare("UPDATE settings SET value = ? WHERE key = 'or_model'").run("nvidia/nemotron-3.5-lightning:free");
  }
}

function seedMemory(database: DatabaseSync) {
  const ins = database.prepare(
    `INSERT OR IGNORE INTO scanner_memory (kind, title, body, source, weight) VALUES (?, ?, ?, 'seed', 2)`
  );
  const tropes: [string, string][] = [
    [
      "generic pause/timelock/proxy-admin",
      "Не предлагай missing pause, timelock на upgrade и proxy admin key leak как уникальный lead — шаблон, пока нет привязки к контракту в скоупе.",
    ],
    [
      "generic fee-on-transfer",
      "Fee-on-transfer / unbounded loop / predictable nonce — шаблон. Только если в скоупе явно такой токен или custom nonce.",
    ],
    ["CEX web XSS", "CEX/web XSS без impact на вывод/IDOR/auth — слабый EV, не lead."],
    ["paused program", "Paused / private / contest not live → gates.ok=false, leads пустой."],
  ];
  for (const [title, body] of tropes) ins.run("trope", title, body);
}

export function getSetting(key: string, fallback = ""): string {
  const row = db().prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string) {
  db()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run(key, value);
}

export function ftsRebuild() {
  /* Node sqlite build has no FTS5; search uses LIKE. */
}

export type Row = Record<string, unknown>;

export function qall(sql: string, args: unknown[] = []) {
  const stmt = db().prepare(sql);
  return (stmt.all as (...a: unknown[]) => unknown[]).apply(stmt, args);
}

export function qrun(sql: string, args: unknown[] = []) {
  const stmt = db().prepare(sql);
  return (stmt.run as (...a: unknown[]) => { lastInsertRowid: number | bigint; changes: number }).apply(
    stmt,
    args
  );
}
