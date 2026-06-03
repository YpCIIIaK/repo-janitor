# Repo Anti-Rot — Core Engine Handoff

This is a **starter scaffold** for the scanning engine. Any AI/engineer can continue from here.

## What exists now

```
packages/core/
  package.json                  # @repo-anti-rot/core, deps: zod (tsup/vitest dev)
  src/
    schema.ts                   # zod ScanReport schema (SCHEMA_VERSION=1) — shared source of truth
    scanner.ts                  # Scanner plugin interface + ScanContext (all IO behind it)
    engine.ts                   # runScan(), computeScore(), scoreToGrade(), scanner registry
    scanners/
      env-lifecycle.ts          # first reference scanner (regex stub, works end-to-end)
    example.ts                  # in-memory smoke test (npx tsx packages/core/src/example.ts)
    index.ts                    # barrel exports
```

## Key contracts (do not break lightly)

- **`ScanReport` shape == dashboard `lib/mock-data.ts`.** The UI already renders this shape.
  Changing it requires bumping `SCHEMA_VERSION` and updating the dashboard.
- **All IO lives behind `ScanContext`** (fs/git/network). Scanners stay pure → easy to test and swap libs.
- **Scanners are plugins** implementing `Scanner`. Register in `defaultScanners` (engine.ts). No engine edits needed.
- **Per-scanner isolation:** a thrown scanner error is logged and skipped, never fatal.

## Scoring

Start 100, subtract weighted penalties (critical 10 / warning 3 / info 1), clamp to 0.
Grade: A≥90, B≥75, C≥60, D≥40, else F. Tune weights in `engine.ts`.

## Done (was "next steps")

1. ✅ **Real `ScanContext`** in `packages/cli` (`src/context.ts`, reused by the Action):
   fast-glob files, simple-git `blameAgeDays`/`listBranches`, `fetchJson` for registry,
   commander CLI (`scan` + `batch`, `--format json|terminal|md`).
2. ✅ **AST env scanner** (`@babel/parser`); shared walker extracted to `src/ast.ts`.
3. ✅ **All 6 scanners** in `scanners/`, registered in `defaultScanners`:
   `env-lifecycle`, `stale-branch`, `todo-debt`, `secrets` (working tree), `dependency-funeral`
   (offline + npm registry), `dead-code` (conservative import-graph).
4. ✅ **Reporters** in `src/reporters/`: `json`, `terminal` (ANSI, no dep), `markdown` (PR/issue);
   `renderReport(report, format)` dispatcher.
5. ✅ **GitHub Action** (`packages/action`): scans in CI, writes job summary + outputs,
   POSTs the report to dashboard `/api/ingest`. Bundled to `dist/index.cjs` (self-contained).

### Remaining (intentionally deferred)
- **`/api/ingest` is endpoint-only**: it validates against `scanReportSchema` and acks, but does
  **not** persist. The dashboard still reads its own localStorage. To truly replace the mocks,
  add a server store + a GET read-path (ROADMAP D1/D3) — the report shape already matches the UI.
- **secrets history scan** (`git log -p`) needs a `ScanContext` extension; today it's working-tree only.
- Scanner unit tests / fixture repos (ROADMAP B5).

## Stack flexibility

Primary choices are swappable — see chat for the full flexible-stack table.
Fixed only: **TypeScript, zod report schema, SQL-compatible DB (Neon by default)**.

## Verify the scaffold

```bash
cd packages/core && pnpm install
npx tsx src/example.ts   # prints a scored ScanReport JSON
```
