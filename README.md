# Repo Anti-Rot

[![CI](https://github.com/YpCIIIaK/repo-janitor/actions/workflows/ci.yml/badge.svg)](https://github.com/YpCIIIaK/repo-janitor/actions/workflows/ci.yml)

A repository **health & decay monitor**. It scans a codebase for the kinds of rot
that accumulate silently — undocumented env vars, abandoned & vulnerable
dependencies, stale branches, aging TODOs, committed secrets, dead & commented-out
code, disabled tests, and binary bloat — scores it A–F, and shows everything in a
dashboard. An optional AI pass adds a short, decisive verdict to each finding via
OpenRouter.

## Structure

This is a monorepo:

| Path | Package | Role |
| --- | --- | --- |
| `packages/core` | `@repo-anti-rot/core` | Scanner engine, scoring, report schema, reporters |
| `packages/cli` | `@repo-anti-rot/cli` | `repo-anti-rot` CLI — clones/scans a repo, emits a report |
| `packages/action` | `@repo-anti-rot/action` | GitHub Action wrapper around the CLI |
| `app/`, `components/`, `lib/` | — | Next.js dashboard (App Router) |

The dashboard's `/api/scan` route shells out to the **built** CLI
(`packages/cli/dist/index.js`) to clone and scan repositories.

## Prerequisites

- Node.js 20+ (uses the built-in global `fetch`)
- [pnpm](https://pnpm.io) (the repo is a pnpm workspace) — or just run
  `corepack enable` and the pinned version (`packageManager` in `package.json`)
  is provisioned automatically
- `git` on PATH (used by the scan engine and by the dashboard to clone repos)

Works the same on **macOS, Linux and Windows** — every command below is a
portable `pnpm`/`node` invocation (no shell-specific syntax), the engine shells
out to `git`/`node` directly (no `.cmd`/`.sh` wrappers), and all paths go through
Node's `path`/`os.tmpdir()` so separators and temp dirs are handled per-OS.

## Setup

> **Important:** `packages/*/dist` is git-ignored, so the compiled CLI is **not**
> in the repo. After cloning you must build it once — otherwise the dashboard's
> "New scan" / "Rescan" buttons will fail with "scan failed" because
> `packages/cli/dist/index.js` doesn't exist yet.

```bash
git clone https://github.com/YpCIIIaK/repo-janitor.git
cd repo-janitor

# install deps + build the CLI in one step
pnpm run setup
```

`pnpm run setup` is just:

```bash
pnpm install          # installs deps and links the workspace packages
pnpm run build:cli    # builds packages/cli/dist (required for dashboard scans)
```

The CLI is rebuilt **automatically** before the dashboard starts: `pnpm dev`
runs a fast ESM-only rebuild first (`predev` → `build:cli` without type
declarations, ~50 ms), and `pnpm build` runs the full build (`prebuild`). This
means the dashboard always scans with the **current** engine — no more "I changed
a scanner but the dashboard still shows the old score" (the dashboard executes the
bundled `packages/cli/dist/index.js`, which otherwise goes stale silently).

To rebuild by hand after changing `packages/core` or `packages/cli`:

```bash
pnpm run build:cli      # full build (esm + cjs + .d.ts)
pnpm --filter @repo-anti-rot/cli build:fast   # fast esm-only (what predev uses)
```

## Tests

The whole workspace is covered by [Vitest](https://vitest.dev) — suites in each
package (`packages/*/test`) plus the dashboard's pure modules (`test/`). They
exercise the scoring engine, every scanner and all reporters through an in-memory
`ScanContext` (`packages/core/test/helpers.ts`) — no real filesystem, git, or
network — plus the CLI/Action helpers and the dashboard's `lib/*` logic.
Everything is fast and deterministic.

```bash
pnpm test                                # run everything (dashboard + all packages)
pnpm test:dashboard                      # just the dashboard lib/* tests
pnpm --filter @repo-anti-rot/core test   # scoped to the engine
pnpm --filter @repo-anti-rot/cli test    # CLI helpers
pnpm --filter @repo-anti-rot/action test # Action helpers
```

Coverage highlights (290+ tests):

- **engine** — scoring, grade thresholds, per-scanner isolation on throw, inline
  `repo-anti-rot-ignore` markers, config-driven weights, the lines-of-code metric
  and progress callbacks
- **scanners** — all 17 scanners, each with positive *and* negative
  (no-false-positive) cases: secrets (incl. the redaction invariant — a raw key
  never appears in evidence), env-lifecycle, todo-debt, dead-code (JS/TS +
  Python/Go), leftover-debug, commented-code, skipped-tests, dockerfile,
  repo-bloat, project-hygiene, broken-doc-links, bus-factor, stale-branch, and the
  dependency scanners (vulnerable/outdated/funeral/lockfile-drift) driven through
  stubbed OSV / npm / PyPI registry adapters
- **config** — `.repo-anti-rot.json` loading, weight merge, ignore globs, and
  graceful fallback on malformed/invalid input
- **reporters** — JSON round-trip, Markdown escaping, and SARIF 2.1.0 shape
  (severity→level mapping, one rule per category, physical locations, fingerprints)
- **CLI** — git-remote → owner/name parsing (https & SSH, `.git` stripping, local
  fallback), safe report filenames, and the real git blame-age adapter (driven
  against a throwaway repo with a back-dated commit, so finding ages can't
  silently regress to zero)
- **Action** — input parsing, the `fail-on` grade threshold, the ingest endpoint
  builder, and PR-comment rendering (severity breakdown, 10-row cap, pipe escaping)
- **dashboard** — the pure `lib/*` modules: client score mirror, age histogram &
  median, hotspot ranking, synonym/typo-tolerant issue search, report export
  (JSON/Markdown/CSV with RFC-4180 escaping + UTF-8 BOM), schedule due-logic,
  GitHub permalink building, and prefilled new-issue URL composition
- **dashboard AI & stores** — the localStorage-backed client stores and AI layer,
  driven through an in-memory `window` stub and a mocked completion transport:
  snooze/won't-fix partitioning, AI settings (normalize, legacy migration, enabled
  categories), the verdict cache (model scoping + LRU eviction), the proxy client's
  429/5xx retry-with-backoff, and the enrichment/summary orchestration (per-category
  batching, cache re-use, order-independent fingerprints, graceful no-key/empty paths)

Add a new scanner test under `packages/core/test/scanners/`, build a context with
`makeContext` from `packages/core/test/helpers.ts`, and assert on the returned issues.
Dashboard `lib/*` tests live in the root `test/` directory.

**Continuous integration.** `.github/workflows/ci.yml` builds the packages,
typechecks, runs the full test suite and builds the dashboard on a matrix of
**Ubuntu, macOS and Windows** (Node 20) for every push and pull request — so the
cross-platform support (path/line-ending normalization, the CLI shebang, git
invocation) is verified continuously, not just claimed.

## Run the dashboard

```bash
pnpm dev          # http://localhost:3000
```

Paste one or more public git URLs into **New scan**, or **Rescan** a repo already
in the sidebar. Reports are stored in the browser (localStorage); a real progress
bar streams live clone → per-scanner → AI progress.

Click any finding in the **Issues** tab to open a detail drawer with its full
context, code evidence, an on-demand AI verdict (one cheap model call, cached),
and quick actions — open the GitHub permalink, copy as Markdown, snooze it, or
**Create issue**. The last opens GitHub's own new-issue form with the title,
body (severity, category, detail, evidence and a permalink) and labels
(`repo-anti-rot`, severity) prefilled, so a finding becomes a tracked task in one
click. No token and no API call are involved — the link just prefills the form,
and you review and submit it on GitHub yourself.

Use **Export** (top-right, next to Rescan) to download the current report as
**Markdown** (grouped by category, for PRs/docs), **CSV** (one row per finding,
for spreadsheets) or **JSON** (the raw report). Everything is generated in the
browser — nothing leaves your machine.

Press **⌘K / Ctrl+K** (or the command button in the toolbar) to open the command
palette: jump between repositories, switch tabs, start a new scan, or export the
current report — all from the keyboard.

### Scheduled scans

In **Settings ▸ Scheduled scans** you can have the dashboard auto-rescan your
tracked repos on a flexible schedule:

- **Every N hours** — re-scan each repo N hours after *its* last scan (any value
  from 15 min upward).
- **Daily at a time** — re-scan once a day at any local `HH:MM`, with catch-up if
  the tab was closed at that moment.

Because repos and reports live in your browser, the scheduler runs **only while a
tab is open** (it checks once a minute and shows a toast when it runs). For truly
unattended scanning — machine asleep, no tab open — use the GitHub Action's
`schedule:` trigger in CI instead.

## Use the CLI directly

```bash
# scan a local checkout
node packages/cli/dist/index.js scan --path . --format terminal

# write a JSON report
node packages/cli/dist/index.js scan --path . --format json --output report.json

# write a SARIF file for GitHub code scanning
node packages/cli/dist/index.js scan --path . --format sarif --output repo-anti-rot.sarif

# scan many cloned repos under a directory
node packages/cli/dist/index.js batch ./repos --out-dir ./reports
```

Formats: `terminal` (default), `json`, `md`, `sarif`.

During development you can run the CLI from source without building:

```bash
pnpm --filter @repo-anti-rot/cli dev -- scan --path .
```

## AI analysis (optional)

Open the **Settings** (gear icon), paste an
[OpenRouter API key](https://openrouter.ai/keys), pick a model id (free presets
provided — `openai/gpt-oss-120b:free` is the recommended free default and the
strongest of the free options for code reasoning, or
`nvidia/nemotron-3-ultra-550b-a55b:free` for a 1M-token window), and enable the
scanner categories you want analyzed. The key is stored
only in your browser and is sent through the app's own `/api/ai/complete` proxy —
never directly to a third party. For secret findings the snippet is redacted
before it leaves the machine.

A shared key can also be provided server-side via the `OPENROUTER_API_KEY`
environment variable. To stop that shared key from becoming an open, billable
proxy, the shared-key path requires `Authorization: Bearer <RAR_AI_PROXY_TOKEN>`
and (optionally) an `OPENROUTER_ALLOWED_MODELS` whitelist; requests that carry
the user's own key are unaffected. Output size is always clamped. See
[Security & hardening](#security--hardening).

### Web search for advisories (optional)

Findings in the **security** and **dependency** categories point at external
advisories (CVE/GHSA pages, package registries) that may be newer than the model's
training data — so the model can end up just paraphrasing the finding text. Toggle
**Web search for advisories** in Settings to let it consult the live advisory via
OpenRouter's web plugin: it then describes what the vulnerability *actually* allows
and which versions are affected, instead of echoing the finding.

It's **off by default** (the web plugin is billed per use) and only ever fires for
those two advisory-bearing categories — repo-internal findings (dead code, TODOs,
hygiene) never trigger a web call. Web-informed verdicts are cached in a separate
namespace, so toggling the option re-asks rather than serving a stale answer.

### Executive summary

The Overview tab has an on-demand **executive summary** — one short, decisive
paragraph on the repo's overall health (verdict, the biggest concrete risks, and
the single highest-leverage next action). It costs exactly one model call and is
cached by model + the exact set of findings, so reopening the repo or rescanning
with no changes never re-asks. Only finding metadata (title, location, category,
severity) is sent — never the `evidence` snippet — so a redacted secret's masked
value still never leaves the machine. When **web search** is on and the repo has a
security or dependency finding, the summary call also consults live advisories to
weight CVE severity accurately.

### Per-finding enrichment

The per-finding enrichment is tuned to stay cheap on small/free models:

- **Cached** — verdicts are cached by model + stable issue id, so rescanning a
  repo never re-asks for an unchanged finding.
- **Batched** — findings of the same category go out in one request (one verdict
  per finding) instead of one request each.
- **Resilient** — rate-limited (429) or transient (5xx) responses back off and
  retry; the prompt forbids hedging so even a small model commits to a verdict.
- **Context-aware** — the amount fed to the model scales to its context window. A
  large-context model (≥400K tokens, e.g. Nemotron 3 Ultra at 1M or Gemini Flash)
  gets far more findings per pass, bigger batches, and a longer, more grounded
  executive summary; a small model keeps the lean, cheap budget. The Settings panel
  shows a "Large context" hint when the picked model qualifies.

## Health badge

Once a repo's report has been ingested (via the GitHub Action's `dashboard-url`),
the dashboard serves a live SVG badge for it:

```
![rot](https://your-deploy.example.com/api/badge/<owner>/<name>)
```

It renders `repo anti-rot | <grade> <score>`, colored by grade (green → amber →
red), and falls back to a neutral `unknown` badge for repos with no report (so a
README image never 404s). Optional query params: `?label=health` (left text) and
`?style=flat-square` (square corners).

## GitHub code scanning (SARIF)

The scanner can emit [SARIF 2.1.0](https://sarifweb.azurewebsites.net/), the
format GitHub code scanning consumes. Findings then appear as native annotations
in the **Security ▸ Code scanning** tab and inline on pull-request diffs — no
dashboard required.

The Action writes a SARIF file when given a `sarif-file` input; pair it with
`github/codeql-action/upload-sarif`:

```yaml
permissions:
  contents: read
  security-events: write # required for upload-sarif

jobs:
  anti-rot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 } # full history for git-blame ages
      - uses: YpCIIIaK/repo-janitor@main
        with:
          sarif-file: repo-anti-rot.sarif
      - uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: repo-anti-rot.sarif
```

Mapping: each finding becomes a SARIF result with `level` derived from severity
(critical → `error`, warning → `warning`, info → `note`), grouped into one rule
per category. File-anchored findings carry a `path:line` location; repo-level
ones (stale branches, missing standard files) are still reported, just without a
code location. A stable per-finding fingerprint lets GitHub track an alert across
runs instead of reopening it each scan.

## Score-drop alerts (webhook)

When a report is ingested via `POST /api/ingest` (i.e. from the GitHub Action in
CI) and the repo's score is **lower than its previous scan**, the server can fire
a webhook so the team is alerted to the regression immediately. Opt-in via env:

| Variable | Description |
| --- | --- |
| `RAR_WEBHOOK_URL` | Destination URL. Unset → feature off. The body is Slack/Discord-compatible (`{ "text": "…" }`), which most custom receivers also accept. |
| `RAR_WEBHOOK_MIN_DROP` | Minimum score drop to alert on (default `1`, i.e. any drop). Raise it to ignore small dips. |
| `RAR_DASHBOARD_URL` | Optional; appended to the message as a link. |

Example message:

```
🔴 acme/api health dropped: B (85) → D (52), −33. +2 new criticals. https://your-dashboard
```

It only fires on a real regression (score held or improved → silent), never on
the first scan (nothing to compare), and a failed webhook never blocks ingestion.
Note this is server-side: it works for reports POSTed to the dashboard (CI), not
for local browser-only scans.

## Security & hardening

The server-side API routes are written to be safe to expose:

| Concern | Mitigation |
| --- | --- |
| **SSRF via `/api/scan`** | The clone target must be a public `http(s)` URL. Loopback, private (`10/8`, `172.16/12`, `192.168/16`), link-local (`169.254/16`, incl. cloud metadata), CGNAT and reserved ranges are rejected — for IP literals **and** for DNS names whose resolved addresses land in private space (which also blunts DNS rebinding). |
| **Open AI proxy / billing abuse** | Using the shared `OPENROUTER_API_KEY` requires `Authorization: Bearer <RAR_AI_PROXY_TOKEN>`; an optional `OPENROUTER_ALLOWED_MODELS` whitelist restricts models; `maxTokens` is clamped. Requests with the user's own key are unaffected. |
| **Report ingestion** | `POST /api/ingest` accepts a `Bearer` token in `REPO_ANTI_ROT_INGEST_TOKEN` (constant-time compared). Unset → open (local dev). |
| **Report read access** | `GET /api/reports` returns full reports (paths + redacted evidence). Set `REPO_ANTI_ROT_READ_TOKEN` to require a `Bearer` token for reads; unset → open so the in-browser dashboard works. (The badge endpoint stays open — it exposes only grade + score.) |
| **Secrets → AI** | For committed-secret findings the evidence snippet is redacted by the scanner before it ever reaches the AI proxy, and the executive summary sends finding metadata only — never `evidence`. |
| **Command injection** | `git`/`node` are spawned with an argv array (no shell), and the clone URL must parse as `http(s)`, so it can't be coerced into a flag. |

All tokens are compared in constant time (`crypto.timingSafeEqual` over hashed
inputs). Token-gated checks are **default-off** so local development needs no
configuration; set the relevant env var to switch each one on.

## Committed secrets

The `secrets` scanner flags credentials committed to the repo using
high-confidence provider patterns (AWS, Stripe, GitHub, Slack, Google, private
keys) plus a generic high-entropy fallback for `secret = "…"`-style assignments.
It runs **two passes**, both reported under the **Security** category:

- **Working tree** — every line of the current checkout.
- **Git history** — lines introduced by past commits (via `git log -p`). This
  catches a credential that was committed and **later deleted**: gone from the
  tree, but still recoverable from history. History findings are located as
  `path @ <short-sha>`, deduped (one finding per credential, newest commit wins),
  and never double-reported when the secret still lives in the working tree. The
  pass is bounded (recent commits, capped findings) and degrades to a no-op when
  git isn't available — so a non-git directory still gets the working-tree scan.

Evidence is **always redacted** (a 4-char prefix, the rest masked) before it
leaves the machine, in both passes. Secrets in test/example/fixture paths are
downgraded to `info` rather than dropped; `.env.example` and lockfiles are
skipped. A history secret is still `critical`: it remains in history until the
repo is rewritten (`git filter-repo` / BFG) and the key is rotated.

## Vulnerable dependencies (OSV)

The `vulnerable-deps` scanner cross-references the project's dependencies against
the public [OSV database](https://osv.dev) and flags packages with known security
advisories (CVEs / GHSAs). **No API key is required.**

It is **polyglot** — Python, Go, Rust, Ruby and PHP projects get real findings
too, not just npm. Each ecosystem is read from its manifests and lockfiles:

| Ecosystem  | Manifest (floor)                       | Lockfile (exact)                                  |
| ---------- | -------------------------------------- | ------------------------------------------------- |
| `npm`      | `package.json`                         | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `npm-shrinkwrap.json` |
| `PyPI`     | `requirements.txt`, `pyproject.toml`   | `poetry.lock`, `Pipfile.lock`                     |
| `Go`       | `go.mod`                               | (versions are pinned in `go.mod`)                 |
| `crates.io`| `Cargo.toml`                           | `Cargo.lock`                                       |
| `RubyGems` | `Gemfile`                              | `Gemfile.lock`                                     |
| `Packagist`| `composer.json`                        | `composer.lock`                                    |

- **Transitive (npm)** — when an npm lockfile is committed the **entire installed
  tree** is checked (direct *and* transitive deps, like `npm audit`), not just the
  handful in `package.json`. Transitive findings are labelled as such. Without a
  lockfile it falls back to the declared deps only.
- **Precise versions** — the exact installed version is read from a committed
  lockfile when present; otherwise it falls back to the floor of the declared
  range, so the result is transparent but may over-report.
- **Cheap** — the dependency set is checked in OSV-sized batches (1000/req);
  advisory details are fetched only for the (usually few) packages that match, so
  a clean repo costs ~1 network call.
- **Severity-mapped** — GHSA `CRITICAL`/`HIGH` → critical, `MODERATE` → warning,
  `LOW` → info; each finding links to the advisory on osv.dev, names the affected
  ecosystem, and points at the fixed version to upgrade to.

Like the other registry-backed checks, it degrades to a no-op offline (no network
adapter) rather than failing the scan. npm dev dependencies are labelled.

> Vulnerability findings and committed-secret findings share a single **Security**
> category in the dashboard and reports, so everything that is a genuine security
> risk surfaces together — separate from ordinary dependency-health issues.

## Outdated & abandoned dependencies

Separate from vulnerabilities, two scanners flag dependencies that are simply
falling behind:

- **npm** — `dependency-funeral` checks `package.json` deps for *unused* (static
  import analysis), *deprecated*, *abandoned* and *outdated* (major/minor behind)
  against the npm registry. *Abandoned* is graduated by publish gap: a 2-3 year
  gap is an `info` note (many micro-libs are simply feature-complete), only a 3+
  year gap is a `warning`. The *unused* check
  also counts deps referenced only by an npm script or a build-config file
  (postcss/eslint/etc.) and skips framework-implicit runtimes (e.g. `react-dom`),
  so build tools and renderers aren't mistaken for dead deps. The *outdated*
  check is range-aware — a caret (`^`) that already auto-accepts a newer minor
  isn't reported as behind; only a true major gap (or a pinned/tilde dep behind
  by a minor) is flagged.
- **PyPI, crates.io, RubyGems, Go, Packagist** — `outdated-deps` checks **direct**
  deps from the manifest (`requirements.txt` / `pyproject.toml`, `Cargo.toml`,
  `Gemfile`, `go.mod`, `composer.json`) against each registry: *outdated* (major →
  warning, minor → info) and
  *abandoned* where the registry exposes a publish date (PyPI, crates.io, Go;
  RubyGems' single-call endpoint has none, so it's outdated-only).

`outdated-deps` checks only direct dependencies (one registry call each, capped)
and is a no-op offline. No API keys are required for any registry.

## Hygiene checks

Beyond the headline scanners, a set of lightweight `hygiene` checks catch everyday
rot:

- **Repo bloat** (`repo-bloat`) — binary artifacts and oversized files committed
  to git: archives, compiled binaries, db dumps (flagged regardless of size) and
  any file over 5 MB or heavy media over 2 MB. Sizes come from `fs.stat` (no file
  read), ranked largest-first. Suggests `.gitignore` / Git LFS.
- **Skipped & focused tests** (`skipped-tests`) — `it.skip` / `xit` / `it.todo`
  and pytest `@skip` mark coverage that no longer runs (info); `it.only` / `fit` /
  `fdescribe` are flagged as a **warning** because focusing silently disables every
  other test in the file, so CI can stay green while almost nothing runs.
- **Commented-out code** (`commented-code`) — blocks of commented-out *code* (not
  prose). Git already remembers deleted code, so these are pure noise. The check is
  deliberately conservative: it fires only on runs of 3+ consecutive `//` lines
  with structural code punctuation, skipping doc comments, license headers, inline
  back-ticked prose and directives.
- **Dockerfile hygiene** (`dockerfile`) — scans `Dockerfile` / `*.dockerfile` for
  an **unpinned base image** (`:latest` or no tag → non-reproducible builds,
  warning), **running as root** (no non-root `USER`, info) and **`ADD` of a remote
  URL** (info). Digest-pinned images, `scratch`, build-args and multi-stage aliases
  are exempt.

These join the existing hygiene scanners (missing project files / tests / CI,
leftover `console`/`debugger`, broken doc links, bus-factor risk).

## Language support

Some checks are language-agnostic (git history, doc links, repo bloat); others are
per-language. Coverage by scanner:

| Scanner            | Languages                                                                 |
| ------------------ | ------------------------------------------------------------------------- |
| `secrets`          | language-agnostic (provider patterns + entropy); working tree + git history |
| `vulnerable-deps`  | npm, PyPI, Go, crates.io, RubyGems, Packagist (see above)                 |
| `env-lifecycle`    | JS/TS (AST), Python, Go, Ruby, PHP (incl. Laravel `env()`)               |
| `leftover-debug`   | JS/TS (AST), Python, Go, Rust, Ruby, PHP                                  |
| `todo-debt`        | JS/TS + Python, Go, Rust, Java, Ruby, PHP, C/C++, C#, Kotlin, Swift, Scala |
| `skipped-tests`    | JS/TS, Python                                                             |
| `commented-code`   | JS/TS, Java, C/C++, C#, Go, Rust, Swift, Kotlin, Scala, PHP               |
| `bus-factor`       | all common source extensions                                             |
| `dockerfile`       | `Dockerfile`, `*.dockerfile`                                              |
| `lockfile-drift`   | npm (missing-lockfile + drift); Python, Rust, Ruby, Go, PHP (missing-lockfile) |
| `outdated-deps`    | PyPI, crates.io, RubyGems, Go, Packagist (npm covered by `dependency-funeral`) |
| `dead-code`        | JS/TS (cross-module unused exports, incl. dynamic `import()`/`require` and the `@/` alias); Python, Go (unused symbols) |
| `dependency-funeral` | JS/TS only                                                              |

For env vars, the scanner understands the idiomatic readers per language —
`process.env.X` (JS/TS), `os.environ` / `os.getenv` (Python), `os.Getenv` /
`os.LookupEnv` (Go), `ENV["X"]` / `ENV.fetch` (Ruby), `getenv` / `$_ENV` / Laravel
`env()` (PHP) —
and compares them against the first of `.env.example`, `.env.sample`,
`.env.template` or `.env.dist`. A reader with an in-code default is reported as
*optional* (info); a required, undocumented var is a warning. Platform/CI-provided
vars (`GITHUB_*`, `RUNNER_*`, `INPUT_*`, `CI`, `NODE_ENV`, `NO_COLOR`, …) are
excluded — they're injected by the runtime, not documented in `.env.example`.

`leftover-debug` treats `console.log` as the program's output (not debug) inside
**CLI / GitHub Action entrypoints** — files with a `#!` shebang, or the `bin` /
`action.yml` `runs.main` target of their package — so a CLI that prints results
isn't flagged. A stray `debugger` is still reported everywhere. `todo-debt` only
counts a marker that **leads** the comment (mirroring eslint `no-warning-comments`
with `location: "start"`), so prose that merely mentions "TODO" mid-sentence is
ignored.

## Configuration (`.repo-anti-rot.json`)

An **optional** file at the repo root tunes the scanner for that project. It is
committed with the repo, so its rules travel to CI and teammates (unlike Snooze,
which is browser-local). Everything is optional and merges over the defaults — no
file means default behaviour, and a partial file only overrides what it sets.

```json
{
  "ignore": ["vendor/**", "**/*.generated.ts"],
  "weights": { "critical": 20, "warning": 3, "info": 0 }
}
```

- **`ignore`** — extra glob patterns excluded from the scanned file set (on top of
  the built-in `node_modules`, `dist`, etc.). Affects all file-based scanners.
- **`weights`** — override the per-severity score penalties. Partial is fine
  (e.g. just `"info": 0`); unspecified severities keep their defaults. The
  effective weights are echoed into the report so the dashboard recomputes the
  score identically.

Invalid JSON or unknown shapes are ignored with a warning (the scan never breaks).

### Inline ignore

Suppress a single false positive directly in code (eslint-style):

```ts
const legacyKey = process.env.OLD_TOKEN // repo-anti-rot-ignore

// repo-anti-rot-ignore-next-line
const noisy = computeThing()
```

- `// repo-anti-rot-ignore` — suppresses a finding on **that** line.
- `// repo-anti-rot-ignore-next-line` — suppresses a finding on the **next** line.

Only findings that resolve to a `file:line` location can be inline-ignored;
file-level findings (e.g. `package.json`, branches) use `ignore` or Snooze.

## Scoring

Starts at 100 and subtracts weighted penalties: **critical −10**, **warning −3**,
**info −0.5**, then rounds and clamps to 0. Grades: **A** ≥ 90, **B** ≥ 75,
**C** ≥ 60, **D** ≥ 40, else **F**. Penalties are configurable per-repo via the
`weights` field in `.repo-anti-rot.json` (see above).

Alongside the score the dashboard shows **issue density** — findings per 1000
lines of code — so repos of very different sizes can be compared fairly (raw
issue count alone favours small repos). The scan records non-blank source
lines in `report.metrics.linesOfCode`.

The Overview tab also surfaces **hotspot files** — the source files attracting
the most rot, ranked by weighted penalty — so a fix can be targeted at the few
files where decay concentrates instead of chasing scattered findings. Each file
links straight to the pinned commit on GitHub.

### Repository map (Tree view)

The **Tree** tab visualizes a scan as an interactive graph (built on
[React Flow](https://reactflow.dev)): only the *affected* paths are drawn, folded
into a directory hierarchy, so you see exactly where rot concentrates without the
clutter of the whole repo. Each node aggregates the subtree's severity counts and
is colored by its worst finding; linear single-child directory chains are
collapsed (`src/legacy/handler.js` → one `src/legacy` node), and stale branches /
repo-wide findings sit in dedicated "Branches" / "Repository" buckets. Click a
folder to expand or collapse it, or a file to open an in-canvas card listing its
findings — with a jump straight to the filtered Issues tab or the file on GitHub.
Large trees (30+ nodes) auto-switch to a left-to-right layout and collapse deep
levels on first paint.

A toolbar keeps the map manageable: **severity toggles** (mute info, or focus on
criticals only — the tree rebuilds from just the active severities), a **path
search** that expands ancestors and pans/zooms to the first match, **expand /
collapse all**, and **export to PNG or SVG**. The tree-building, collapse and
search logic lives in `lib/file-tree.ts` (pure + unit-tested); the React Flow view
is lazy-loaded so it stays out of the initial bundle.

### Repository profile (About tab)

The **About** tab answers "what is this repo made of?" at a glance: a **language
breakdown** (by file count and non-blank lines, with the long tail folded into an
"Other" bucket) and the **ecosystems/tooling** detected from manifest files
(Node.js, pnpm/Yarn/npm, TypeScript, Next.js, Vite, Tailwind, Docker, GitHub
Actions, Go modules, pip/Poetry, Cargo, Bundler, Composer, Maven/Gradle, …), plus
headline facts (files scanned, lines of code, grade). The data is produced by the
engine during its single read pass and shipped in the report's optional `profile`
field (`packages/core/src/profile.ts` — pure language/tool classification, unit-
tested); the dashboard renders shares via `lib/repo-profile.ts`. Reports created
before profiling shipped simply prompt for a rescan.
