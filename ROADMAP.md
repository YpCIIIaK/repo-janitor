# Repo Anti-Rot — Roadmap & Improvement Options

Status snapshot (2026-06): engine runs end-to-end, one real scanner (`env-lifecycle`, AST-based),
CLI (`scan` + `batch`), dashboard with Live Scan, localStorage persistence, real-data dashboard,
semantic-lite issue search, category breakdown chart.

Effort: **S** ≈ hours · **M** ≈ a day · **L** ≈ multi-day. Value is product impact.

---

## A. Scanners — the real power of the engine

Each scanner = one file in `packages/core/src/scanners/`, registered in `defaultScanners`. Pure,
isolated, IO via `ScanContext`. Priority order roughly = impact ÷ effort.

### A1. Dependency Funeral — outdated & unused npm modules ⭐ flagship
**Detects:** packages in `package.json` that are (a) unused (installed, zero imports),
(b) outdated (behind latest), (c) deprecated, (d) abandoned (no release in N years).
**How:**
- unused → reuse the AST walker (like env scanner): parse all source, collect `import`/`require`
  specifiers, diff against `dependencies`. (alt: `depcheck`/`knip` logic.)
- outdated → read `package.json` + `package-lock`/`pnpm-lock`; query the npm registry
  (`https://registry.npmjs.org/<pkg>`) for `dist-tags.latest` + `time` (last publish, deprecation).
- severity: deprecated/abandoned = warning, outdated-major = warning, outdated-minor = info, unused = info.
**Notes:** offline mode (lockfile only, no registry) for air-gapped/datamine runs. Cache registry
responses. **Effort M · Value very high** (this is the headline feature users expect).

### A2. Secrets in History ⭐ high-impact
**Detects:** committed credentials (AWS `AKIA…`, Stripe `rk_live`/`sk_live`, GitHub PATs, private
keys, generic high-entropy strings) — in working tree **and** git history.
**How:** wrap `gitleaks` (shell out if installed) with a built-in regex/entropy fallback over
`git log -p`. Use `git.blameAgeDays` for age. severity: critical.
**Notes:** history scan is slow on big repos → make it opt-in (`--deep`) or depth-limited.
**Effort M · Value very high** (security wins are the most shareable).

### A3. Stale Branch — `ScanContext.git.listBranches` already exists
**Detects:** remote branches long behind default / abandoned / already-merged-but-not-deleted.
**How:** `git.listBranches()` → flag `behind > N` or `lastCommit` older than threshold. severity:
warning (stale) / info (merged). **Effort S · Value medium** (the context API is already wired —
cheapest real scanner to ship).

### A4. TODO Debt
**Detects:** `TODO` / `FIXME` / `HACK` / `XXX` comments, ranked by age via `git.blameAgeDays`.
**How:** AST comment nodes (we already parse for env) or line regex; blame each hit for age.
severity: info, escalating with age. **Effort S · Value medium.**

### A5. Dead Code
**Detects:** exported symbols with zero references across the import graph; unreachable files.
**How:** `ts-morph` or `knip` for the reference graph (heavier dep). severity: info.
**Effort L · Value medium** (most false-positive-prone — do last, behind a confidence threshold).

> After A1–A5 the score becomes meaningful across all 6 categories the schema already defines.

---

## B. Engine & accuracy

- **B1. Wire the real git adapter** — `blameAgeDays`/`listBranches` in the CLI's `ScanContext`
  (simple-git). Today `ageDays` is hardcoded `0`. Unlocks A2–A4 age signals. **M · high.**
- **B2. Config file** `.repo-anti-rotrc.json` — enable/disable scanners, custom severity weights,
  ignore globs, per-rule thresholds. **M · high** (every real user needs ignores).
- **B3. Inline ignores** — `// repo-anti-rot-ignore` / allowlist for known-safe findings (kills the
  "fallback default, may be optional" class of false positives). **S · high.**
- **B4. Confidence field** on issues + a "hide low-confidence" toggle. **S · medium.**
- **B5. Scanner unit tests** (vitest) — fixture repos per scanner; lock behavior before adding more. **M · high.**

---

## C. Dashboard / UX

- **C1. Rescan button** in the dashboard — re-run a stored repo, append a history point, refresh
  Breakdown/stats. Closes the loop with the history we already persist. **S · high.**
- **C2. Real trend over time** — once C1 lands and repos have ≥2 scans, bring back the time-series
  chart alongside Breakdown (data already stored in `reports-store`). **S · medium.**
- **C3. Cross-repo overview** — a portfolio screen: all scanned repos, grades, worst offenders,
  average score (mirrors the CLI `batch` summary). **M · high** for the datamine use case.
- **C4. True semantic search** — upgrade `issue-search.ts` from synonyms to embeddings
  (transformers.js local model, or an embeddings API with a key). Only if cross-meaning recall
  matters. **M–L · medium.**
- **C5. Scan diff** — compare two scans of a repo: fixed / new / unchanged issues. **M · high**
  (this is what makes it a "monitor", not a one-shot linter).
- **C6. Issue actions** — copy as Markdown, "explain", link to file/line, group-by toggles. **S · low.**
- **C7. Mobile/empty-state polish, keyboard nav, loading skeletons.** **S · low.**

---

## D. Persistence & backend (graduation path)

Current: localStorage (per-browser). Natural escalation:
- **D1. Server filesystem** — API writes `.repo-anti-rot/reports/*.json`; survives browser/device, matches
  CLI/datamine output, inspectable & committable. **M.**
- **D2. SQLite (or Neon/Postgres)** — scan history, trends, multi-repo queries. HANDOFF fixes the DB
  as SQL-compatible (Neon default). **L.**
- **D3. `/api/ingest`** — the endpoint HANDOFF describes: CI POSTs reports in; dashboard reads real
  data instead of running scans itself. **M.**

---

## E. Distribution (push model — how real teams adopt it)

- **E1. GitHub Action** (`packages/action`) — run in user CI on `schedule` + `pull_request`,
  POST JSON to `/api/ingest`. This is the HANDOFF endgame that replaces mocks with real data. **L · high.**
- **E2. PR comment reporter** — Markdown summary + score delta posted on PRs (uses C5 diff). **M · high.**
- **E3. `npx repo-anti-rot`** / publish CLI to npm; `--format md|json|terminal` already scaffolded. **S–M.**
- **E4. Score badge** (`repo-anti-rot-score: B`) for READMEs. **S · medium** (free marketing).

---

## F. Hardening & infra

- **F1. CI pipeline** (lint + typecheck + vitest + build) for the monorepo. **M · high.**
- **F2. API limits** — clone size cap, total timeout, concurrency control, disk cleanup on crash;
  guard against huge/malicious repos in the dashboard scan endpoint. **M · medium.**
- **F3. pnpm workspace** — real `pnpm-workspace.yaml` instead of per-package installs/symlinks. **S · low.**
- **F4. Error surfaces** — structured scanner errors shown in the report (partial-failure UX). **S · medium.**

---

## Suggested sequencing

1. **Make the score real:** A3 (stale branch, cheapest) → B1 (git adapter) → A4 (todo) → A1 (deps ⭐) → A2 (secrets ⭐).
2. **Make it a monitor:** C1 (rescan) → C5 (scan diff) → C2 (real trend) → C3 (cross-repo).
3. **Make it trustworthy:** B5 + F1 (tests + CI) → B2/B3 (config + ignores).
4. **Make it adopted:** D1/D3 (persist + ingest) → E1/E2 (Action + PR comments) → E3/E4 (npm + badge).

Top 3 by impact-to-effort: **A1 (outdated/unused npm), A2 (secrets), C1 (rescan + history loop).**
