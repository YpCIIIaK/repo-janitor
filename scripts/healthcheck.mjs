try {
  const response = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(10_000) });
  const health = await response.json();
  process.exit(response.ok && health.canScan ? 0 : 1);
} catch { process.exit(1); }
