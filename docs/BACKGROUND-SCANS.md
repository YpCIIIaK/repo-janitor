# Recoverable background scans

The scan form submits a random 256-bit capability in `X-Scan-Job` to
`POST /api/scan`. The existing URL, rate, concurrency and queue limits apply.
Next.js `after()` runs the task independently of the browser connection.
Requests without this header retain the original streaming API (including Rescan).

`GET /api/scan/job` uses `Authorization: Bearer <capability>`, never a URL token.
Treat the capability as a secret. The browser retains it until Dismiss recovery;
Reconnect retrieves the job without launching another scan. AI enrichment still
runs in the browser; neither API keys nor AI-enriched results are stored in jobs.

## Existing Supabase deployment

Apply `supabase/migrations/202610090001_scan_jobs.sql` to the existing Supabase
project before deploying this feature. It uses the existing `SUPABASE_URL` and
`SUPABASE_SERVICE_ROLE_KEY`, creates a separate RLS-protected `scan_jobs` table
with no anon/authenticated access, and schedules expiration through Supabase Cron.
It does not touch shared reports, share tokens or badges.
If Cron is not enabled, enable it under Integrations > Cron, then rerun the migration.
See https://supabase.com/docs/guides/cron/install .

No database migration is applied automatically by the application. A configured
but unavailable/missing database fails explicitly; it never silently uses disk.
Without Supabase configuration, local development uses atomic files instead.

## Cost and retention bounds

- Metadata progress writes at most every 15 seconds, plus lifecycle transitions.
- Client polls every 15 seconds, selecting metadata only until completion.
- Entire result JSON is gzip-compressed and base64-encoded once when work finishes.
  Opening a completed report automatically decompresses it. No findings are cut.
- 2 MiB maximum gzip archive (base64 adds about one third); 64 MiB raw safety cap
  prevents excessive compression/decompression memory use. Overflow produces an
  explicit failure, not a partial report or a false success. Use the CLI for those
  repositories; the browser never received that oversized report.
- 24-hour retention measured from submission; API access expires immediately,
  physical cleanup runs every 15 minutes and during new admissions.
- At most 32 retained jobs, enforced in the database under an admission lock.
  Rough upper bound is 86 MiB encoded archive text plus metadata/index/WAL overhead.
  Capacity exhaustion rejects new jobs rather than deleting unexpired reports.
- Browser recovery remains available until dismissed even if browser report
  storage is full; UI recommends downloading JSON and displays exact expiration.

## Execution is not a durable worker queue

Only storage is durable. One Render process executes tasks with a 700-second
deadline. A restarted worker does not automatically replay work: unfinished jobs
are reported failed after the deadline (12 minutes including persistence grace).
Completed Supabase archives survive deploys. Partial results are archived if the
executor catches an error, but process termination before archiving loses them.
Limits are process-local; do not scale this executor horizontally without a
shared limiter/worker queue. Local fallback files are not durable on Render.
