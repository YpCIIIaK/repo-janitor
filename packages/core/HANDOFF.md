# Repo Anti-Rot — Core Engine

Architecture notes for `@repo-anti-rot/core`: the contracts to respect when adding
scanners or changing the report shape. Product direction lives in the repo-root
[ROADMAP.md](../../ROADMAP.md) and [PLAN.md](../../PLAN.md).

## Layout

```
packages/core/
  package.json
  src/
    schema.ts       # zod ScanReport schema (SCHEMA_VERSION) — shared source of truth
    scanner.ts      # Scanner plugin interface + ScanContext (all IO behind it)
    engine.ts       # runScan(), computeScore(), scoreToGrade(), scanner registry
    config.ts       # .repo-anti-rot.json: ignores, thresholds, mute rules, inline ignores
    ast.ts          # shared @babel/parser walker
    lockgraph.ts    # lockfile dependency graph → "does a prod install reach this?"
    scanners/       # 17 scanners, each registered in defaultScanners
    reporters/      # json | terminal | markdown | sarif, behind renderReport()
    index.ts        # barrel exports
```

## Key contracts (do not break lightly)

- **`ScanReport` shape == dashboard `lib/mock-data.ts`.** The UI renders this shape
  directly. Changing it requires bumping `SCHEMA_VERSION` and updating the dashboard,
  the CLI, the Action and `/api/ingest` (which validates against `scanReportSchema`).
- **All IO lives behind `ScanContext`** (fs / git / network). Scanners stay pure → easy
  to test and to swap implementations. The real context is `packages/cli/src/context.ts`,
  re-exported as `repo-anti-rot/context` and reused by the Action.
- **Scanners are plugins** implementing `Scanner`. Register in `defaultScanners`
  (`engine.ts`). No engine edits needed.
- **Per-scanner isolation:** a thrown scanner error is logged and skipped, never fatal.
- **Secrets never leave the process unredacted** — evidence is redacted before any AI call.

## Scoring

Start 100, subtract weighted penalties (critical 10 / warning 3 / info 1), clamp to 0.
Grade: A≥90, B≥75, C≥60, D≥40, else F. Weights live in `engine.ts`; per-rule severity
and thresholds are overridable via `.repo-anti-rot.json`.

**Severity must stay calibrated.** A tool that grades a repo F over a DoS in a package
reachable only through eslint is not believed a second time. Two rules, both enforced in
`scanners/vulnerable-deps.ts`:

- `HIGH` is not `CRITICAL`. It reaches `critical` only with a demonstrated runtime path —
  a direct production dependency.
- Findings on build/test-only paths drop one step. Reachability comes from
  `lockgraph.ts`, which walks the lockfile itself. Do **not** reintroduce a dependency on
  an audit tool's `dev` flag: `pnpm audit` in a workspace reports `dev: false` for
  everything, eslint and vitest included. `null` from the graph means *unknown* — leave
  the severity as published rather than guessing.

## Consumers

| Consumer | Entry point |
| --- | --- |
| CLI (`repo-anti-rot`) | `packages/cli` — `scan`, `batch` |
| GitHub Action | `packages/action` — SARIF + PR comment delta + POST to `/api/ingest` |
| Dashboard | `app/api/scan` (live clone+scan), `app/api/ingest` (write), `app/api/reports` (read) |

Reports POSTed to `/api/ingest` are persisted server-side (`lib/server-store.ts`, JSON
file under `.repo-anti-rot/`) and read back by the dashboard through `/api/reports`.

## Verify

```bash
pnpm --filter @repo-anti-rot/core test
npx tsx packages/core/src/example.ts   # prints a scored ScanReport JSON
```
