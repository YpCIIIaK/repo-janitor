# Benchmark workflow — handoff for the next agent

This file is everything needed to continue improving repo-janitor's scanners with
the benchmark, without the conversation that built it. Read it top to bottom once.

## 1. What the project is

repo-janitor scans a git repository and reports maintenance and security problems
with a 0–100 health score.

- `packages/core` — the engine and all scanners (`src/scanners/*.ts`), the rule
  taxonomy (`src/rules.ts`), the confidence scale (`src/confidence.ts` +
  generated `src/confidence-data.ts`), score (`src/engine.ts`).
- `packages/cli` — the `repo-janitor` npm CLI (`scan <dir> --format json`). The
  benchmark runs THIS built CLI (`packages/cli/dist`).
- `packages/action` — GitHub Action.
- Next.js app at the repo root (`app/`, `components/`, `lib/`) — the website
  (repo-janitor.app). `/state` is the public "State of open source" page fed by
  `benchmark/stats.json` and `benchmark/history.json`.
- `benchmark/` — the corpus, runner, labels and stats (this file lives here).

Branching: work on the session branch, then merge into `main` and push `main`
(the owner wants changes on main). Never force-push. Commit messages: no
backticks inside `-m` (the shell expands them).

## 2. The benchmark in one picture

```
corpus.json ──run.mjs──▶ .results/<repo>.json (+ .report.json)   ◀── labels/<repo>.json
                    │                                                 (hand labels tp/fp)
                    └─history.mjs──▶ .history/<repo>.json
score.mjs ── reads results + labels ──▶ REPORT.md, baseline.json, ../packages/core/src/confidence-data.ts (--update)
stats.mjs ── reads reports + history ──▶ STATS.md, stats.json   (feeds /state)
history.mjs ─ aggregate ─────────────▶ history.json             (feeds /state)
archive.mjs ─ pack/push/pull ────────▶ orphan branch `bench-data` (compressed results/history)
```

- `corpus.json`: ~1,270 public repos, each pinned to a commit SHA.
- `.cache/`, `.results/`, `.history/`, `.archive/` are gitignored. Results are
  restored with `node benchmark/archive.mjs pull` (all) or `pull <repo…>`.

## 3. Commands

| Command | What it does |
|---|---|
| `pnpm run build:cli` | Rebuild the CLI the benchmark runs. **Do this after every scanner change**, and never while a run is in progress (a mid-run rebuild mixes versions). |
| `BENCH_DROP_CLONES=1 node benchmark/run.mjs <repo…>` | Clone, scan offline, record history, delete the clone. No names = whole corpus. One job per CPU core by default (`BENCH_JOBS` overrides); heaviest repos first. Refuses to run if the CLI is older than its sources. |
| `node benchmark/resume.mjs` | Rescan what changed. Every result records a base fingerprint (CLI + engine + rules + schema) and one per scanner (its module and runtime imports). Base changed → full scan; one scanner changed → only that scanner reruns (`--only`) and its findings are merged with the cached ones, score recomputed; new scanner → only it runs; confidence data → nothing (use `rescore.mjs`). Prints the plan, e.g. `partial: insecure-code ×3000`. `BENCH_FULL=1` forces full scans. |
| `node benchmark/replay.mjs build \| baseline \| check [--only ids]` | Fast regression check (~1–2 min): snapshots of the files behind every label plus the whole source of each deliberately vulnerable app. `baseline` before editing a scanner, `check` after `build:cli`: fails on labelled TP or vulnerable-app high findings lost, reports FP removed. Trusted only for scanners it reproduces ≥ 95% (insecure-code, workflow, IaC, Dockerfile, EOL, deps…); others still need the partial rescan. |
| sparse reruns (automatic) | When every scanner a repo must rerun reads only declared files (`sparseGlobs` in scanner-inputs.mjs), run.mjs fetches a depth-1, blob-less clone with a sparse checkout of just those files instead of the full history; finding ages are carried over from the previous result. Checked equal to full clones on 18 repos for insecure-code, the container/workflow/IaC scanners, dead-code and the npm scanners. `BENCH_SPARSE=0` disables it. |
| `node benchmark/inventory.mjs [--check]` | Per-repo file inventory (extensions, manifests, Dockerfiles, key dirs) from blob-less clones; `run.mjs` refreshes it on every full scan. A stale scanner is skipped for repos with none of the files it reads (`scanner-inputs.mjs`) and no previous finding from it. `--check` verifies the declared inputs against every finding in the corpus — run it after adding or widening a scanner. |
| `pnpm --filter ./packages/core build && node benchmark/rescore.mjs` | After `score.mjs --update`: reapply confidence to stored findings and recompute every score. No scan. |
| `node benchmark/score.mjs` | Precision by scanner, rule and confidence. `--update` rewrites baseline + confidence-data.ts; `--check` fails on regressions. |
| `node benchmark/sample.mjs --spread N <repo…>` | Up to N unlabelled findings per rule from those repos, for labelling. |
| `node benchmark/label.mjs < lines` | Record labels; each line `<repo-name> <tp|fp> <finding-id>`. |
| `node benchmark/stats.mjs` | Corpus statistics → STATS.md + stats.json. |
| `node benchmark/history.mjs [repo…]` | Git-history records and curves, built from `.gitlog/<repo>.json.gz` (raw commits, add/delete log, file list, workflow and Dockerfile texts). `run.mjs` writes that cache from its clone; `node benchmark/gitlog.mjs` builds it for the corpus from blob-less clones (~30 KB per repo). A new practice marker or statistic: add it, bump `SCHEMA` in history.mjs, run `history.mjs` — no clones. It is archived in separate `gitlog-NNN` chunks (`archive.mjs pull` restores it). |
| `node benchmark/archive.mjs pack && node benchmark/archive.mjs push` | Save data to the `bench-data` branch. |
| `pnpm test`, `npx tsc --noEmit -p .`, `npx eslint .`, `pnpm run build:packages` | Full checks before every merge. |

## 4. The loop (one batch)

1. **Pick ~100–200 new repos** of types/languages the corpus lacks (apps,
   infra, mobile, games, other languages, deliberately vulnerable apps). Check
   each exists and get its SHA: `git ls-remote https://github.com/<o>/<r> HEAD`.
   Skip renamed duplicates (same SHA as an existing entry) and giant repos.
   Append to `corpus.json` as `{"name": "<owner>-<repo> lowercased, non-alnum→-", "url", "sha"}`.
2. **Run** them: `BENCH_DROP_CLONES=1 node benchmark/run.mjs <names…>` as a
   tracked background job. A batch of ~180 takes 1–2 h. Background jobs have a
   2 h limit — split large batches in halves.
3. **Sample and label**: `sample.mjs --spread 2 <names…>`, read each finding with
   its source context, label with the criterion below. Label the things a user
   would see by default first (high/medium confidence).
4. **Find patterns** in the false positives (they cluster: a directory kind, a
   file kind, a framework convention) and fix the scanner with the narrowest
   rule that removes the cluster. Add a regression test for each fix.
5. **Verify**: rebuild, rerun ONLY the repos that had those findings plus the
   deliberately vulnerable apps (recall must not drop), check `score.mjs`
   (precision up, "lost TP" not up).
6. **Refresh**: `score.mjs --update`, core build + `rescore.mjs`, `history.mjs`, `stats.mjs`, full checks,
   `archive.mjs pack && push`, commit, merge to main, push.

### Labelling criterion

`tp` = the claim is true **and** a maintainer of that project would act on it.
Otherwise `fp`. Examples of fp: a "debug print" that is the program's output;
`privileged: true` on a GPU/TPU worker or a CNI DaemonSet; an "unused export"
consumed by Storybook; a TODO marking an untranslated string; findings inside
vendored, generated, test-fixture or docs-example code. A deliberately vulnerable
app's real hole is `tp`. If you labelled something wrong, fix the label (it
happened: calico DaemonSets were first labelled tp).

## 5. How confidence works (do not break this)

- `confidence-data.ts` holds labelled tp/fp per rule (generated by `score.mjs --update`).
- `confidence.ts`: smoothed precision (tp+1)/(n+2); n<3 → medium; ≥0.8 with n≥5 → high; <0.5 → low.
- Low-confidence findings go to `report.lowConfidence`: hidden by default, excluded
  from the score, shown on request in the UI (CLI `--all`).
- `insecure-code` stamps its own confidence: an injection is **high** only if a
  taint source is visible (same file within ~25 lines, or a caller in another
  file via cross-file taint), otherwise **low**. CLI args (`process.argv`,
  `sys.argv`) are NOT taint sources.
- Result files store the confidence at scan time; after `--update` the stored
  values are stale until a rescan. To judge precision without rescanning,
  recompute confidence per rule from confidence-data (see section 8).

## 6. Score

`computeScore` in `packages/core/src/engine.ts` and its mirror in `lib/score.ts`
must stay identical. Warning/info counts are multiplied by
`sizeFactor = sqrt(20000 / LOC)` (≤1) for codebases over 20k lines; critical
findings never. The factor travels in `report.config.weights.sizeFactor` so the
dashboard recomputes the same score.

## 7. Environment gotchas (learned the hard way)

- **Session restarts kill background processes**, including `nohup`/`setsid`.
  Use tracked background jobs and schedule a check-in; `resume.mjs` continues.
- **Disk is limited** (~40 GB). Always `BENCH_DROP_CLONES=1`. If space runs out,
  delete `benchmark/.cache/*` (results and history are separate).
- **Network drops** during clones: run.mjs retries 4× with backoff. A repo that
  never clones (e.g. daisyui) — drop it from the corpus. A pinned SHA that no
  longer exists ("reference is not a tree") — update the SHA to current HEAD.
- **`pkill -f <pattern>` kills your own shell** if the pattern is in the command
  line. Use `ps aux | grep "[r]un.mjs"` to find PIDs, then `kill <pid>`.
- **`next dev` creates `AGENTS.md` and `CLAUDE.md`** at the repo root. Delete them;
  do not commit.
- `benchmark/REPORT.md` is rewritten by `score.mjs`; restore it with
  `git checkout benchmark/REPORT.md` unless you mean to commit it.
- Tags cannot be pushed from the cloud session (owner pushes `v1`, `v1.x.y`).
- Shell heredocs with complex quoting can be rejected by a safety check; write
  Python/JS edit scripts to a file in the scratchpad and run them instead.

## 8. Snippets

Precision by the current confidence scale, without rescanning:

```js
// node -e '…'
const fs=require("fs");const P={};
for(const m of fs.readFileSync("packages/core/src/confidence-data.ts","utf8").matchAll(/"([^"]+)": \{ tp: (\d+), fp: (\d+)/g))P[m[1]]={tp:+m[2],fp:+m[3]};
const rc=r=>{const p=P[r];const n=p?p.tp+p.fp:0;if(!p||n<3)return"medium";const x=(p.tp+1)/(n+2);return x>=.8&&n>=5?"high":x<.5?"low":"medium"};
const t={high:[0,0],medium:[0,0],low:[0,0]};
for(const f of fs.readdirSync("benchmark/labels")){const p="benchmark/.results/"+f;if(!fs.existsSync(p))continue;
 const L=JSON.parse(fs.readFileSync("benchmark/labels/"+f));
 for(const i of JSON.parse(fs.readFileSync(p)).findings||[]){const v=L[i.id];if(v!=="tp"&&v!=="fp")continue;
  const c=(i.scanner==="insecure-code"&&i.confidence!=="medium")?i.confidence:rc(i.rule);t[c][v==="tp"?0:1]++}}
console.log(t)
```

Listing findings of one rule with source context: see the `pick.js` idea — pick a
random unlabelled finding per repo, read `benchmark/.cache/<repo>/<file>` around
the line (clone needed; or rerun with `BENCH_KEEP_TREES=1`).

## 9. State at handoff (2026-11-05)

- Corpus: 1,273 repos; ~980 labelled findings used for precision.
- Precision by confidence: high 93%, medium 68%, low (hidden) 12%; default-visible 86%.
- Deliberately vulnerable apps (~37) are the recall check: DVWA, WebGoat,
  WebGoat.NET (cross-file), VAmPI, DVGA, RailsGoat, govwa, pygoat, vulpy,
  terragoat, cfngoat, kubernetes-goat, crAPI, Juice Shop…
- Scanners added in this phase: iac-security (Terraform/CloudFormation/K8s/compose),
  PHP/Java/Ruby/Go/C# injection rules, SSRF, Python SQL, cross-file taint, size-adjusted score.

## 10. Open work, in suggested order

1. **Full rescan** (`pnpm run build:cli && node benchmark/resume.mjs`, ~4–5 h in
   chunks) so every stored confidence matches the current scale; then refresh stats.
2. **Medium-confidence rules** (68%): dead-export, commented-code, doc-link, bloat,
   docker-* — label more of each and fix the clusters.
3. **iac-security**: container rules are low confidence on real infra; cloud rules
   (open-admin-port, public-database) are high. Absence checks (missing
   securityContext, kustomizegoat) are intentionally NOT implemented.
4. **Remaining blind spots**: Swift (iGoat), crypto misuse (DamnVulnerableCryptoApp),
   hidden secrets (wrongsecrets).
5. Product: per-finding fix explanations with before/after snippets; percentile
   "better than X% of repos your size" in reports using stats.json.
