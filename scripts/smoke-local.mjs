import assert from "node:assert/strict";

const base = process.argv[2] || "http://localhost:3000";
if (!["localhost", "127.0.0.1", "[::1]"].includes(new URL(base).hostname)) throw new Error("Smoke tests only run against localhost");
async function check(path, status, init) {
  const response = await fetch(`${base}${path}`, { ...init, signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, status, `${path}: unexpected HTTP status`);
  console.info(`PASS ${path}: ${status}`);
  return response;
}
const health = await (await check("/api/health", 200)).json();
assert.equal(health.canScan, true, "scanner prerequisites");
await check("/app/audit", 404);
await check("/api/audit/market", 404);
await check("/api/reports", 401);
await check("/api/ingest", 401, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
await check("/api/admin/backup", 401, { method: "POST" });
await check("/api/watch", 401, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
await check("/api/unlock", 403, { method: "POST", headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}" });
await check("/api/scan", 400, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls: ["http://127.0.0.1/internal"] }) });
await check("/api/ai/complete", 400, { method: "POST", headers: { "Content-Type": "application/json" }, body: "null" });
const page = await check("/", 200);
assert.equal(page.headers.get("x-content-type-options"), "nosniff");
assert.equal(page.headers.get("referrer-policy"), "no-referrer");
console.info("Local smoke checks passed.");
