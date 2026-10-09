# Changelog

## 0.3.0 — 2026-10-09

Far fewer false positives. Measured on a 20-repository benchmark
(`benchmark/` in the repo), precision went from 48% to 91% and the number of
findings on the same code fell from 1355 to 486. Scores of healthy projects
go up accordingly.

### Fixed false positives
- **project-hygiene** — no longer reports a missing README when it is a
  symlink, a missing license for `LICENSE-MIT` / `LICENSE-APACHE` / `COPYING`,
  or missing tests for Go (`*_test.go`), Python (`test_*.py`), Ruby, Java and
  root `test.js` suites.
- **ci-health** — follows `make <target>`, `scripts/*` and `package.json`
  scripts (including `${{ matrix.task }}`) before saying tests never run in CI;
  bare `rake` counts.
- **workflow-security** — a workflow whose every job sets `permissions:` is
  no longer reported as unrestricted.
- **leftover-debug** — ignores Python docstrings and `__main__` blocks,
  `console.print` (rich), Cargo `build.rs`, program entry points, benchmarks,
  scripts, fixtures, e2e helpers and nested private workspace packages.
- **dead-code** — resolves `./x.js` imports to `x.ts`; treats `package.json`
  entry points, `export * as ns` targets, TypeScript namespace members and
  MDX usage as used; skips tests, fixtures and examples; in Python packages
  only `_private` names are reported.
- **bus-factor** — skips tests, fixtures, configs, docs and tooling.
- **env-lifecycle** — asks for `.env.example` only in deployable projects.
- **lockfile-drift** — respects `package-lock=false`; library crates, gems and
  Composer libraries are not asked for a lockfile.
- **secrets** — interpolated strings and UUIDs are not secrets.
- **insecure-code** — TLS-off, MD5, pickle and `Math.random` in tests.
- **skipped-tests** — Playwright's conditional `test.skip(condition)`.
- **duplicate-code** — import lists, typed parameter lists, overloads, Python
  docstrings, locales and benchmarks.
- **commented-code** — documentation examples are not commented-out code.
- **broken-doc-links** — MkDocs directory-style relative links.
- **todo-debt** — TODOs copied into snapshot fixtures.

### Added
- Each finding carries a `rule` (the specific check within its scanner).
- The report profile includes a project-essentials `checklist` and, with full
  git history, a 12-month commit `activity` summary (counts only).
- `REPO_ANTI_ROT_OFFLINE=1` skips registry, OSV and link checks for
  reproducible runs.

## 0.2.0 — 2026-08-02

Previous release.
