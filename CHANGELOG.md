# Changelog

Notable changes. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `/state`: vulnerable dependencies broken down by ecosystem.
- Benchmark: `BENCH_SHARD=k/n` to split rescans and OSV checks across parallel jobs; `BENCH_DATA_BRANCH` for staging archives.
- Local rescan dashboard (`pnpm local:rescan`).
- CONTRIBUTING, SECURITY, CODE_OF_CONDUCT and this changelog.

### Changed
- Benchmark corpus: 10,000 distinct projects (10,007 pinned records), fully rescanned on the current scanners.
- Calibration: fewer false positives in `commented-code` and `insecure-sql-interpolated`.

### Fixed
- Java diagnostic-string SQL, prose/maths comment, read-only Docker socket and PHP provenance false positives/negatives.

### Security
- Upgraded next (16.4.6), zod (4.6), sharp, vite (7.3.8) and vitest to versions without known advisories.

## [1.0.0]

First tagged release: scanner core, CLI, GitHub Action and dashboard.
