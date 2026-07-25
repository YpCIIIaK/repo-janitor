# Repo Anti-Rot — Roadmap

Status snapshot: **2026-07**. This file tracks *what exists* and *what's next*.
The long-form product reasoning behind the "next" section lives in [PLAN.md](PLAN.md).

Effort: **S** ≈ hours · **M** ≈ a day · **L** ≈ multi-day.

---

## Shipped

### Engine (`packages/core`)

17 scanners, all pure, isolated, IO through `ScanContext`:

| Category | Scanners |
| --- | --- |
| Security | `secrets` (working tree + git history, with allowlists), `vulnerable-deps` (OSV, 6 ecosystems) |
| Dependencies | `dependency-funeral` (unused / deprecated / abandoned), `outdated-deps`, `lockfile-drift` |
| Decay | `todo-debt` (age-ranked via `git blame`), `dead-code`, `commented-code`, `skipped-tests`, `leftover-debug` |
| Repo health | `stale-branch`, `repo-bloat`, `bus-factor`, `project-hygiene`, `broken-doc-links` |
| Config | `env-lifecycle` (AST-based), `dockerfile` |

Plus: A–F scoring with category breakdown, report schema + versioning, reporters for
`terminal` / `json` / `md` / `sarif` (SARIF 2.1.0), real git adapter (`blameAgeDays`,
`listBranches`, commit history), `.repo-anti-rot.json` config with ignore globs, per-rule
thresholds and **mute rules**, inline ignores, and 290+ tests.

### CLI (`packages/cli`, published as `repo-anti-rot`)

`scan` and `batch`, all four output formats, `--version` stamped at build time,
`repo-anti-rot/context` subpath export consumed by the Action.

### GitHub Action (`packages/action`)

Runs in user CI, emits SARIF for code scanning, posts a PR comment with the score
**delta** against the previous scan, and POSTs the report to `/api/ingest`.

### Dashboard (`app/`, `components/`, `lib/`)

Live Scan (clone + scan server-side, with SSRF guard, clone-size cap and timeouts),
localStorage persistence plus a server-side JSON store, `/api/ingest` + `/api/reports`
(bearer-gated reads), score badge endpoint, cross-repo overview, scan diff, rescan +
scheduling, hotspot analysis, repo profile / About tab, **commit health tree** (sampled
history scan, all/sample scope), issue search, snooze, GitHub issue export, report export,
and an optional AI layer (enrichment + executive summary) with caching, batching and
secret redaction before any model call.

---

## Next

Ordered by product impact, not by engineering appeal. See [PLAN.md](PLAN.md) §3 for
the reasoning and the phase gates.

### Phase A — housekeeping (in progress)

- [x] `GET /api/reports` route + tests — closes the CI → dashboard loop
- [x] Root package renamed off the `my-project` scaffold; `images.unoptimized` dropped
- [x] CLI package prepared for npm (`repo-anti-rot`, metadata, `files`, `prepublishOnly`)
- [ ] Publish `repo-anti-rot` to npm so `npx repo-anti-rot scan .` actually works — **needs an npm token**
- [ ] GitHub repo description, topics, website link — **needs repo admin**

### Phase B — public diagnostic ⭐ the main bet · M

Paste a repo URL → 30 seconds later, a grade and the top problems. No signup, no clone.

- [ ] Real landing page at `/`, dashboard moves to `/app`
- [ ] Host the demo somewhere that tolerates a long clone (not serverless)
- [ ] Public-scan limits: queue, concurrency, timeout (clone-size cap already exists)
- [ ] Shareable static result at `/r/<owner>/<name>` — the viral hook
- [ ] Open Graph image with the grade

### Phase D — engine gaps that make the report sellable · S–M each

- [ ] **Rot cost in hours** — per-finding fix estimate, summed into "technical debt: ~34h".
      Cheapest feature with the biggest effect on a non-technical reader.
- [ ] **Benchmark comparison** — "score 62 is worse than 78% of scanned repos"; needs
      anonymous aggregate stats from our own scans.
- [ ] **Trend forecast** — the history time series already exists: "at this rate, grade D in 6 months".
- [ ] **Licence scanner** — GPL in a commercial dependency tree kills an acquisition.
      Manifests for all six ecosystems are already parsed; the data is right there.
- [ ] **Abandonment score** — commit frequency, active contributors, issue lifetime.
- [ ] **`--fix`** for mechanical findings: strip commented-out code, delete merged branches,
      sync `.env.example`.

### Phase C — Due Diligence Report · M–L · gated

One paid PDF/HTML report per repo: grade, health trajectory, bus-factor, hotspots,
security, executive summary, full appendix. Needs a PDF renderer, a payment provider
(merchant-of-record), and a queue for long history scans.

> **Do not start Phase C before Phase B has real users.** See PLAN.md §5 — checkpoint 3
> is a genuine stop condition, not a formality.

### Not doing

Deeper secret detection and deeper CVE coverage. Both are at parity with free tools
(GitHub secret scanning, Dependabot); further investment there buys nothing.

---

## Infra backlog

- [ ] CI pipeline for the monorepo (lint + typecheck + vitest + build)
- [ ] Smoke test: the Action running against a live dashboard, not just URL-shape unit tests
- [ ] SQLite/Postgres behind the JSON store — only when history volume actually demands it
