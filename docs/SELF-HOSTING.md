# Windows + Docker: public Repo Anti-Rot

Use Docker Desktop with Linux containers/WSL 2. See the official
[Docker Windows guide](https://docs.docker.com/desktop/setup/install/windows-install/)
and [Caddy reverse proxy documentation](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).

## Local start

From the repository directory in PowerShell:

```powershell
node scripts/setup-local.mjs
docker compose --env-file .env.local up -d --build
docker compose --env-file .env.local ps
```

Open `http://localhost:3000`. Setup creates `.env.local` only if absent, generates
random internal secrets, and never prints them. It will not overwrite existing keys.
The short template is `deploy/server.env.example`; `.env.example` documents the
older and optional settings in more detail.

Always include `--env-file .env.local`: Compose uses it to provide only the cron
credential to maintenance and only the domain to Caddy. The full configuration is
available only to the app. Avoid printing `docker compose config` output because
it expands credentials; use `docker compose --env-file .env.local config --quiet`.

The app runs as a non-root user. Its port is bound to loopback, so the public
entry point is Caddy. One app process supports the configured concurrent scans;
do not add app replicas with the file-storage backend.

## Keys

| Variable | Purpose |
| --- | --- |
| `GITHUB_TOKEN` | Server-side public GitHub metadata requests; use a token without private repository permissions |
| `GITHUB_OAUTH_CLIENT_ID`, `GITHUB_OAUTH_CLIENT_SECRET` | GitHub sign-in; required for creating email watches |
| `OPENROUTER_API_KEY`, `OPENROUTER_MODEL` | Optional hosted AI; use an exact currently available model ID |
| `REPO_ANTI_ROT_AI_PUBLIC=true` | Allows visitors who opt in to use the hosted triage endpoint |
| `REPO_ANTI_ROT_AI_DAILY_REQUESTS` | Whole-instance daily hosted-triage request ceiling; failures reserve budget too |
| `RESEND_API_KEY`, `RESEND_FROM` | Optional watch emails; use a verified sender domain |
| `REPO_ANTI_ROT_OWNER_TOKEN` | Your browser's operator access, entered in Settings |
| `REPO_ANTI_ROT_INGEST_TOKEN`, `REPO_ANTI_ROT_READ_TOKEN` | CI upload/read API credentials |
| `CRON_SECRET` | Internal maintenance and backup API credential |

No external key is required for anonymous public-repository scans. The GitHub token
raises API quotas; it is intentionally not inherited by cloned-repository processes.
Hosted triage never accepts a caller-selected model, system prompt or tools. Its
ceiling counts requests, not dollars: also configure a spending limit with the AI
provider. The existing generic completion proxy remains token-protected when using
the server key, and accepts visitors' own keys separately.

Email watches require sign-in with a verified primary GitHub email. OAuth requests
`user:email`, without repository/write scopes. The signed HTTP-only session cookie
contains the login and verified address; creating a watch persists that address.
Sessions created before this change require signing in again to create watches.
Failed drop emails keep the previous baseline and are retried on a later due check.

## Domain and HTTPS

On the server, update only the three domain settings while preserving keys:

```powershell
node scripts/configure-domain.mjs repo-janitor.app
```

The resulting settings in `.env.local` are:

```dotenv
DOMAIN=repo-janitor.app
PUBLIC_ORIGIN=https://repo-janitor.app
REPO_ANTI_ROT_DASHBOARD_URL=https://repo-janitor.app
```

Point DNS at the server's public address; forward TCP 80/443 to the Windows host
and allow those ports in Windows Firewall. Caddy obtains/renews certificates when
the domain is reachable. If the ISP uses CGNAT, inbound forwarding will require a
public address or a separately configured tunnel. A tunnel adds another trusted
proxy: configure forwarding-header trust in Caddy and the application for the
actual topology. Direct Caddy access uses `REPO_ANTI_ROT_TRUSTED_PROXY_HOPS=1`.
Do not increase the hop count without verifying which headers each proxy trusts.
Publish an AAAA record only when IPv6 actually reaches this host too.

```powershell
docker compose --env-file .env.local --profile public up -d
```

For OAuth, register callback `https://repo-janitor.app/api/auth/github/callback`.
Change Render's deployment/domain only after the new service is verified. No DNS
or Render changes are performed by these files.

## Data and maintenance

`app-data` persists reports, shares, subscriptions and the hosted-AI budget/cache.
The maintenance service calls the authenticated watch endpoint every five minutes;
subscriptions become due according to the watch interval, so this does not rescan
every subscription every five minutes. It creates a backup once per UTC day.
Backup requests serialize against application storage mutations and keep the last
14 archives in the separate `backups` volume. A maintenance restart can produce an
additional archive that day. Provider-side Supabase data is not in these archives.

```powershell
docker compose --env-file .env.local logs --tail 100 app maintenance
docker compose --env-file .env.local exec app ls /backups
New-Item -ItemType Directory -Path ./backups -Force | Out-Null
docker compose --env-file .env.local cp app:/backups/. ./backups
```

Copy backups off the machine. A second Docker volume protects against application
mistakes, not a failed host drive. Never use `docker compose --env-file .env.local down -v` for routine
updates: `-v` deletes persistent volumes.

For a restore rehearsal, choose a trusted archive from the copied `backups`
directory. The following PowerShell commands create a uniquely named volume and
start a separate app at `http://localhost:3101`. Replace the example archive name.
They leave the production volume intact and run no maintenance or email scheduler:

```powershell
$restoreArchive = (Get-Item -LiteralPath '.\backups\repo-anti-rot-2026-09-05T12-00-00-000Z.tar.gz' -ErrorAction Stop).FullName
$restoreId = [Guid]::NewGuid().ToString('N')
$restoreVolume = "repo-anti-rot-restore-$restoreId"
$restoreContainer = "repo-anti-rot-restore-$restoreId"
docker volume create $restoreVolume
if ($LASTEXITCODE -ne 0) { throw 'Cannot create restore volume' }
docker run --rm --user 0 --mount "type=bind,source=$restoreArchive,target=/restore.tar.gz,readonly" --mount "type=volume,source=$restoreVolume,target=/restore" --entrypoint tar repo-anti-rot:local -xzf /restore.tar.gz -C /restore
if ($LASTEXITCODE -ne 0) { throw 'Restore failed; do not start the restored app' }
docker run --rm --user 0 --mount "type=volume,source=$restoreVolume,target=/restore" --entrypoint chown repo-anti-rot:local -R node:node /restore
if ($LASTEXITCODE -ne 0) { throw 'Cannot set restored data permissions' }
docker run -d --name $restoreContainer --env-file .env.local -e PUBLIC_ORIGIN=http://localhost:3101 -e REPO_ANTI_ROT_DASHBOARD_URL=http://localhost:3101 -e REPO_ANTI_ROT_PUBLIC=true -e REPO_ANTI_ROT_STORAGE_DURABLE=true -e SUPABASE_URL= -e SUPABASE_SERVICE_ROLE_KEY= -p 127.0.0.1:3101:3000 --mount "type=volume,source=$restoreVolume,target=/data" repo-anti-rot:local
if ($LASTEXITCODE -ne 0) { throw 'Cannot start restore rehearsal' }
```

Verify `/api/health`, saved reports and share links at port 3101, and inspect the
restored subscription records without triggering their cron endpoint. The empty
Supabase overrides ensure this checks the local archive, not a production database.
When finished, `docker stop $restoreContainer` stops the rehearsal; retain the
volume until you decide whether to promote it. These commands have to be validated
on the target server before relying on the recovery procedure.

For an actual cutover, stop production `app` and `maintenance`, retain the old
volume as rollback, and explicitly map `app-data` to the verified restored volume
with an external-volume Compose override. Restart using that override consistently.
Never extract an archive over the running application's data.

On Render with Supabase, keep the existing Supabase variables during migration so
share URLs retain their data. If moving to filesystem storage, export/migrate the
database explicitly; copying the repository does not copy the database.

## Resource tuning and checks

The starting Compose budget is 8 GiB / 4 CPUs, 3 concurrent scans, 1 GiB child heap,
20 queued requests. The clone cap remains 500 MiB per clone. Increase limits only
after observing actual scans; extra RAM does not make arbitrary unbounded work safe.
Process memory includes more than V8's heap. `/api/health` checks Git, the CLI and
temporary storage; Docker uses `canScan` for readiness. It reports whether persistent
storage was configured, not an independent guarantee about the host's disks.
An unhealthy status does not itself restart a container: `restart: unless-stopped`
restarts exited processes. Investigate an unhealthy service using its logs.

Before leaving the Windows server unattended:

- Configure Windows to stay awake on mains power and verify available disk space.
- Enable Docker Desktop startup at sign-in; verify how the host starts Docker after
  a cold boot. Startup at sign-in alone does not guarantee operation before login.
- Reboot and confirm the app, maintenance and Caddy return, HTTPS works externally,
  and previously saved reports/share links survive.
- Run one scan and then three concurrent scans while observing `docker stats` and
  host RAM, CPU and disk; check cancellation, queue behavior and another health request.
- Verify a new backup and the restore rehearsal above; copy backups off the host.
- Test configured OAuth, email and AI features with their real keys before opening
  the service to users. Keep Render available until migration checks pass.

Public mode only clones HTTPS repositories from `REPO_ANTI_ROT_GIT_HOSTS` (default:
GitHub, GitLab, Bitbucket) and refuses unauthenticated ingest/read APIs even when a
token was accidentally omitted. Git redirects and credential helpers are disabled
for scan children. Use canonical, non-redirecting repository URLs.

Web scans use shallow clones. Age, branch and authorship checks therefore have
limited history, explicitly disclosed in the report. Use the CLI on a full clone
for complete local history. Git history from a single clone still only reflects
the refs present locally.

History requests share the scan queue and public requests are capped at 20 commits.
History cache entries are reused for at most 24 hours, with at most 500 entries of
2 MiB each; expired entries are evicted on subsequent writes. The clone-size
watchdog remains active during history checkouts, not only during the initial clone.

With the local public-mode server running, execute `node scripts/smoke-local.mjs`
to check readiness, removed routes, API authorization, origin rejection and headers.

## CI baseline and gates

```powershell
node packages/cli/dist/index.js scan . --format json --output baseline.json
node packages/cli/dist/index.js scan . --baseline baseline.json --fail-on-new warning --min-score 75 --format json --output report.json
```

Exit 0 means the gate passed, exit 2 means new blocking findings, low score or a
failed scanner; exit 1 is an execution/configuration error. Use a baseline from
the same repository and the same scanner selection. Finding IDs are the comparison
key; a changed location/ID can be classified as new. `--fix` prints advice and does
not edit repository files.
