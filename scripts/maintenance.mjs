const origin = process.env.INTERNAL_ORIGIN || "http://127.0.0.1:3000";
let lastBackup = "";
async function backup() {
  const today = new Date().toISOString().slice(0, 10);
  if (lastBackup === today) return;
  const response = await fetch(`${origin}/api/admin/backup`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
    signal: AbortSignal.timeout(150_000),
  });
  await response.body?.cancel();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  lastBackup = today;
  console.info(`Backup completed: ${today}`);
}

async function tick() {
  if (!process.env.CRON_SECRET) return;
  try { await backup(); } catch (error) { console.error("Backup failed:", String(error)); }
  try {
    const response = await fetch(`${origin}/api/cron/watch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      signal: AbortSignal.timeout(15 * 60_000),
    });
    if (!response.ok) console.error(`Watch maintenance failed: HTTP ${response.status}`);
    else await response.body?.cancel();
  } catch (error) { console.error("Watch maintenance failed:", String(error)); }
}

// Sequential: a slow batch never overlaps the next scheduled batch.
for (;;) {
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 5 * 60_000));
}
