import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const envPath = join(root, ".env.local");
const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
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
const modelRow = db.prepare("SELECT value FROM settings WHERE key = 'or_model'").get();
const model = modelRow?.value || "nvidia/nemotron-3.5-lightning:free";
const prog = db
  .prepare(
    `SELECT slug, title, url FROM programs
     WHERE unending = 1 AND private = 0 AND languages LIKE '%Solidity%' AND min_rep <= 80
     ORDER BY max_bounty DESC LIMIT 1`
  )
  .get();

console.log(JSON.stringify({ key_len: key.length, model, sample: prog }, null, 2));

const ping = await fetch("https://openrouter.ai/api/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    "HTTP-Referer": "http://localhost:3333",
    "X-Title": "auditscout-workbench-smoke",
  },
  body: JSON.stringify({
    model,
    temperature: 0,
    messages: [
      {
        role: "system",
        content: 'Reply with JSON only: {"ok":true,"model":"<your name>","ping":"pong"}',
      },
      { role: "user", content: "ping" },
    ],
  }),
  signal: AbortSignal.timeout(90_000),
});
const body = await ping.json();
if (!ping.ok) {
  console.error("OR_HTTP", ping.status, body?.error || body);
  process.exit(2);
}
const content = body?.choices?.[0]?.message?.content || "";
console.log(
  JSON.stringify(
    {
      http: ping.status,
      id: body.id,
      or_model: body.model,
      usage: body.usage,
      content: String(content).slice(0, 500),
    },
    null,
    2
  )
);
