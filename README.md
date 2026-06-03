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

## Scoring

Starts at 100 and subtracts weighted penalties: **critical −10**, **warning −3**,
**info −0.5**, then rounds and clamps to 0. Grades: **A** ≥ 90, **B** ≥ 75,
**C** ≥ 60, **D** ≥ 40, else **F**.
