# Repo Anti-Rot

A repository **health & decay monitor**. It scans a codebase for the kinds of rot
that accumulate silently — undocumented env vars, abandoned dependencies, stale
branches, aging TODOs, committed secrets, and dead code — scores it A–F, and shows
everything in a dashboard. An optional AI pass adds a short, decisive verdict to
each finding via OpenRouter.

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

- Node.js 20+
- [pnpm](https://pnpm.io) (the repo is a pnpm workspace)
- `git` on PATH (used by the scan engine)

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

Rebuild the CLI any time you change `packages/core` or `packages/cli`:

```bash
pnpm run build:cli
```

## Run the dashboard

```bash
pnpm dev          # http://localhost:3000
```

Paste one or more public git URLs into **New scan**, or **Rescan** a repo already
in the sidebar. Reports are stored in the browser (localStorage); a real progress
bar streams live clone → per-scanner → AI progress.

## Use the CLI directly

```bash
# scan a local checkout
node packages/cli/dist/index.js scan --path . --format terminal

# write a JSON report
node packages/cli/dist/index.js scan --path . --format json --output report.json

# scan many cloned repos under a directory
node packages/cli/dist/index.js batch ./repos --out-dir ./reports
```

During development you can run the CLI from source without building:

```bash
pnpm --filter @repo-anti-rot/cli dev -- scan --path .
```

## AI analysis (optional)

Open the **Settings** (gear icon), paste an
[OpenRouter API key](https://openrouter.ai/keys), pick a model id (free presets
provided), and enable the scanner categories you want analyzed. The key is stored
only in your browser and is sent through the app's own `/api/ai/complete` proxy —
never directly to a third party. For secret findings the snippet is redacted
before it leaves the machine.

A shared key can also be provided server-side via the `OPENROUTER_API_KEY`
environment variable.

### Executive summary

The Overview tab has an on-demand **executive summary** — one short, decisive
paragraph on the repo's overall health (verdict, the biggest concrete risks, and
the single highest-leverage next action). It costs exactly one model call and is
cached by model + the exact set of findings, so reopening the repo or rescanning
with no changes never re-asks. Only finding metadata (title, location, category,
severity) is sent — never the `evidence` snippet — so a redacted secret's masked
value still never leaves the machine.

### Per-finding enrichment

The per-finding enrichment is tuned to stay cheap on small/free models:

- **Cached** — verdicts are cached by model + stable issue id, so rescanning a
  repo never re-asks for an unchanged finding.
- **Batched** — findings of the same category go out in one request (one verdict
  per finding) instead of one request each.
- **Resilient** — rate-limited (429) or transient (5xx) responses back off and
  retry; the prompt forbids hedging so even a small model commits to a verdict.

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
