# Benchmark routine — runbook for an autonomous agent

You are taking over the recurring benchmark loop of repo-janitor. Read
`benchmark/WORKFLOW.md` once first (commands, confidence model, environment
gotchas). This file says **what to do every cycle, what you must not do, and how
to report**, so a reviewer can check your work quickly.

## 0. Ground rules (non-negotiable)

1. **Work on a branch named `bench/<date>-<n>`**, never directly on `main`.
   Open one pull request per cycle. The owner or a reviewer merges it.
2. **Never force-push, never rewrite history, never delete labels** you did not
   create in this cycle.
3. **Never edit** `packages/core/src/engine.ts` / `lib/score.ts` (the score),
   `packages/core/src/confidence.ts` (the scale), the `action` package, or the
   website, unless the task explicitly says so. Scanner files
   (`packages/core/src/scanners/*.ts`) are in scope.
4. **Never lower a recall check to make it pass.** If a deliberately vulnerable
   app loses a true positive, the fix is wrong — revert it.
5. **No test may be skipped, disabled or loosened** to get green.
6. **One scanner change = one commit = one regression test**, with a message
   that names the false-positive cluster it removes.
7. If you are unsure whether something is a true positive, label nothing and
   list it under "Unsure" in the report.

## 0.5 Tracks — one track per cycle

The corpus is read in tracks (`benchmark/tracks.mjs`): general, random,
security, infra, mobile, webBackends. Each has an explicit population, a
labels-per-rule target and its own precision (`score.mjs --track X`,
shown on /state). Work one track per cycle:

- add repos that fit the track's population (or list `"tracks": [...]` on a
  corpus entry to add it by hand);
- sample with `node benchmark/sample.mjs --spread 4 --track X`, which aims at
  that track's target;
- report the track's precision and rules-at-target before and after.
Do not add repos to the random layer by hand: only `random-layer.mjs` draws it.

## 1. One cycle

### 1.1 Add repos (target 100–200)

- Choose themes the corpus lacks (check `benchmark/STATS.md` "By main
  language" and the corpus itself). Mix applications, infrastructure,
  libraries, and at least 2–3 deliberately vulnerable apps if any new ones exist.
- Resolve each with `GIT_TERMINAL_PROMPT=0 git ls-remote https://github.com/<o>/<r> HEAD`.
- Skip: already present (by GitHub repository ID, url, name, or SHA), archived mirrors, renamed
  duplicates, and repos whose clone would exceed the scan limit (1.2).
- Check the candidate's GitHub repository ID against `benchmark/identities.json` and extend that snapshot for new entries. A rename keeps the same ID even when the URL and pinned SHA differ. Existing alias groups are recorded in the cycle reviews; do not count another alias as a new project.
- Append to `corpus.json` as `{"name": "<owner>-<repo>" lowercased with non-alnum → "-", "url", "sha"}`.
- Commit: `Corpus: add N repos (<themes>)`.

### 1.2 Scan

```
pnpm install && pnpm run build:cli          # once, before scanning; never during
BENCH_DROP_CLONES=1 BENCH_JOBS=4 node benchmark/run.mjs <names…>
```

- Run as a tracked background job; batches over ~120 repos → split.
- If interrupted: `node benchmark/resume.mjs` (only rescans missing/stale).
- A repo that fails to clone 4×: remove it from `corpus.json`, list it in the report.
- **Clone size limit: 2000 MB, the `run.mjs` default (`BENCH_MAX_MB`).** Do not
  set `BENCH_MAX_MB`; every cycle must use the same limit, or repos between two
  limits are silently left on old results. A repo rejected as "too large":
  remove it from `corpus.json` and list it in the report.

### 1.3 Label

```
node benchmark/sample.mjs --spread 2 <names…> > /tmp/sample.txt
```

For each sampled finding open the source (`BENCH_KEEP_TREES=1` rerun, or
clone) and read ±20 lines. Criterion:

- `tp` — the claim is true **and** a maintainer of that project would act on it.
- `fp` — otherwise. Typical fp: output that *is* the program's purpose (CLI
  prints), privileged containers that must be privileged (CNI, GPU, node
  agents), exports consumed by tooling (Storybook, plugins, public API),
  findings in vendored / generated / test-fixture / docs-example code.
- A deliberately vulnerable app's intended hole is `tp`.

Record: `printf '%s\n' "<repo> tp <finding-id>" … | node benchmark/label.mjs`.
Target: **≥ 60 new labels per cycle**, high and medium confidence first.

Spend labels where they teach something. `sample.mjs --spread` already skips
saturated rules (≥ 30 labels at ≥ 95% precision — e.g. action pinning, token
permissions) and gives weak or barely labelled rules (< 80% or < 10 labels)
a double quota. Do not add labels to a skipped rule unless you are checking
a suspected regression. At most **15 labels per cycle** may go to rules that
are already above 90% precision; the rest go to the weak ones.

### 1.4 Fix false-positive clusters

- Group the fp by *why* (directory kind, file kind, framework convention).
- A cluster is worth fixing if it has **≥ 3 fp across ≥ 2 repos**.
- Fix with the **narrowest** rule (a path pattern or a precise syntactic
  check), add a test in `packages/core/test/scanners/<scanner>.test.ts` that
  fails before and passes after.
- Do not touch rules whose precision is already ≥ 90% unless a cluster is clear.

### 1.5 Verify (regression gate)

```
pnpm run build:cli
BENCH_DROP_CLONES=1 node benchmark/run.mjs <repos with affected findings> <all vulnerable apps>
node benchmark/score.mjs --check
```

Pass criteria — **all** must hold, else revert the last fix:

- `score.mjs --check` exits 0. It compares precision on the labels the baseline
  was measured on, so new honest labels never fail it; it prints how much they
  moved the measured precision. Report that shift, do not "fix" it by
  relabelling or by narrowing rules without a real false-positive cluster.
- "lost TP" did not increase.
- Precision of each changed rule did not drop.
- Every deliberately vulnerable app keeps its high-confidence true positives
  (list in `stats.json` → `vulnerableApps`; compare before/after).

### 1.6 Refresh and ship

```
node benchmark/score.mjs --update
pnpm --filter ./packages/core build && node benchmark/rescore.mjs   # confidence → scores, no rescan
node benchmark/history.mjs
node benchmark/stats.mjs
node benchmark/archive.mjs pack && node benchmark/archive.mjs push
pnpm test && npx tsc --noEmit -p . && npx eslint . && pnpm run build:packages
git checkout benchmark/REPORT.md   # unless you mean to commit it
```

### 1.7 Bring every result up to date (before opening the PR)

Rerunning only "repos with affected findings" is not enough: a scanner change
makes that scanner's result stale in **every** repo that has its input files,
and the next cycle would start from mixed versions. The scan system knows
exactly what is stale, so let it decide:

```
pnpm run build:cli && pnpm --filter ./packages/core build
BENCH_DROP_CLONES=1 node benchmark/resume.mjs   # per-scanner fingerprints; reruns only stale scanners
node benchmark/osv.mjs                          # online pass (vulnerable-deps, license-risk) for new repos
```

- Both are resumable: if a run stops (time limit, network), start it again.
- `resume.mjs` prints its plan first (`partial: <scanner> ×N`); report it.
- Then redo 1.5 (gate) and 1.6 (refresh, archive) on the complete data.
- The PR is finished only when `resume.mjs` reports nothing left to scan and
  `osv.mjs` reports "all repos checked". Say so in the report; do not leave
  "unaffected results were reused" as an open item.
- Publish the archive to `bench-data` (fast-forward only) after the source PR
  merges; a separate `bench-data-<date>` staging branch is fine before that,
  and is deleted once promoted.

### Random layer draws

`random-layer.mjs draw` uses GitHub search. With `GITHUB_TOKEN` (or
`GITHUB_SEARCH_TOKEN`, no scopes needed) it runs 3x faster, but Node must go
through the environment's proxy or the token is rejected (HTTP 401):

```
NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
  node benchmark/random-layer.mjs draw --n <total>
node benchmark/random-layer.mjs apply
```

Delete `AGENTS.md` / `CLAUDE.md` at the repo root if `next dev` created them.
Push the branch, open the PR with the report below as its body.

## 2. Report (PR body) — fill every section

```
## Cycle <date>-<n>

Corpus: <before> → <after> repos. Failed to clone: <list or none>.
Themes added: <one line>.

### Labels
New: <n> (tp <a>, fp <b>). Unsure: <list of finding ids with one-line reason>.

### Fixes
| rule | cluster (why fp) | fp removed | test | commit |
|---|---|---|---|---|

### Regression gate
- score --check: pass/fail
- lost TP: <before> → <after>
- precision by confidence: high <x>% → <y>%, medium …, low …
- vulnerable apps: <n> checked, high TP before/after <a>/<b> (list any change)
- up to date: resume plan <partial: …>, now nothing stale; osv: all repos checked

### Not done / open questions
<anything skipped and why>
```

## 3. How a reviewer checks a cycle (for us)

1. Report sections all filled; numbers match `REPORT.md` / `baseline.json` diff.
2. Each scanner diff is narrow and has a test that would fail without it.
3. Spot-check 10 random new labels (`git diff benchmark/labels`) against source.
4. `lost TP` and vulnerable-app TPs unchanged or up.
5. No edits outside the allowed files (`git diff --stat main`).
