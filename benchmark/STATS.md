# What 1273 open-source repos look like

1273 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 321 | 25% |
| B | 296 | 23% |
| C | 418 | 33% |
| D | 207 | 16% |
| F | 31 | 2% |

Median score **73**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| TypeScript | 277 | 72 | 1.7 |
| JavaScript | 269 | 79 | 2.0 |
| Python | 178 | 69 | 1.6 |
| Go | 134 | 72 | 1.4 |
| other | 122 | 90 | 0.0 |
| PHP | 69 | 71 | 1.9 |
| Rust | 50 | 63 | 2.1 |
| Ruby | 41 | 75 | 2.0 |
| Java | 36 | 68 | 1.5 |
| C# | 25 | 62 | 2.3 |
| C | 24 | 76 | 1.7 |
| C++ | 16 | 64 | 3.7 |
| Kotlin | 12 | 64 | 1.4 |
| Swift | 12 | 74 | 0.9 |
| Scala | 5 | 56 | 5.9 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 868 | 68% |
| duplicate | 770 | 60% |
| todo | 751 | 59% |
| workflow-action-tag-first-party | 746 | 59% |
| workflow-no-permissions | 677 | 53% |
| workflow-action-tag | 615 | 48% |
| commented-code | 371 | 29% |
| eol-node | 304 | 24% |
| doc-link | 254 | 20% |
| dead-export | 226 | 18% |
| skipped-test | 189 | 15% |
| hygiene-no-tests | 188 | 15% |
| eol-python | 121 | 10% |
| hygiene-no-ci | 115 | 9% |
| config-conflict | 91 | 7% |
| lockfile-missing | 73 | 6% |
| docker-untagged | 67 | 5% |
| ci-silenced-failure | 49 | 4% |
| hygiene-no-license | 49 | 4% |
| docker-latest | 38 | 3% |
| env-missing | 33 | 3% |
| docs-badge | 31 | 2% |
| insecure-sql-interpolated | 24 | 2% |
| dead-uikit | 15 | 1% |
| workflow-pr-target-checkout | 13 | 1% |

## CI supply chain

- **72%** of 1119 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **55%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **61%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **45%** of 650 Node.js projects still declare or test on an end-of-life Node version.
- **53%** of 178 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 100% |
| license | 93% |
| contributing | 54% |
| security | 32% |
| codeOfConduct | 26% |
| changelog | 42% |
| ci | 91% |
| tests | 84% |

## How old the debt is

- Median age of a TODO/FIXME: **3.6 years** (22913 dated).
- 36% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.1 y — dateutil-dateutil `src/dateutil/rrule.py:1199`
- 23.0 y — paramiko-paramiko `paramiko/ber.py:71`
- 21.8 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestCopticChronology.java:405`
- 21.1 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestEthiopicChronology.java:405`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 667): median score **67**.
- Quiet repos (< 10 commits, 330): median score **83**.
- Mean findings per repo: active 77, quiet 30.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 484 | 88 |
| 5k–50k | 469 | 68 |
| 50k–200k | 234 | 63 |
| > 200k | 86 | 64 |

## Cleanest repos

- **100** ai-nanoid (0 findings)
- **100** jshttp-cookie (0 findings)
- **100** jonschlinkert-is-number (0 findings)
- **100** fastify-fastify-cors (0 findings)
- **100** fastify-fastify-static (0 findings)
- **100** electron-fiddle (0 findings)
- **100** metabase-toucan (0 findings)
- **100** jamesives-github-pages-deploy-action (0 findings)
- **100** aquasecurity-trivy-action (0 findings)
- **100** traefik-traefik-helm-chart (0 findings)

## Most to clean up

- **0** webgoat-webgoat (133 findings)
- **0** digininja-dvwa (106 findings)
- **0** jerryhoff-webgoat-net (74 findings)
- **0** sasanlabs-vulnerableapp (101 findings)
- **0** hashicorp-vault-guides (121 findings)
- **0** sqlmapproject-testenv (103 findings)
- **0** aws-samples-serverless-patterns (330 findings)
- **0** docker-library-wordpress (32 findings)
- **0** posthog-charts-clickhouse (39 findings)
- **1** returntocorp-semgrep-rules (150 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 43 | +12 | +8.9 | -1.04 |
| ESLint flat config | 157 | -3 | +4.7 | -0.27 |
| TypeScript | 267 | +1 | +3.9 | -0.16 |
| Prettier | 169 | -3 | +2.4 | +0.07 |
| .editorconfig | 434 | -5 | +1.5 | -0.48 |
| CodeQL | 156 | -6 | +0.3 | -0.26 |
| SECURITY.md | 380 | -9 | +0.1 | -0.28 |
| Dev container | 110 | -7 | -0.5 | +0.04 |
| Renovate | 98 | -3 | -0.6 | +0.07 |
| Dependabot | 475 | -7 | -0.8 | -0.16 |
| PR template | 420 | -12 | -2.3 | +0.45 |
| CODEOWNERS | 212 | -9 | -2.5 | +0.91 |
| Changesets | 43 | -10 | -2.6 | +0.55 |
| CONTRIBUTING | 616 | -15 | -5.0 | -0.05 |
| Issue templates | 589 | -16 | -5.5 | +0.24 |
| pre-commit | 123 | -9 | -6.0 | -0.63 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

10589 low-confidence findings were kept out of these numbers (13% of everything the scanners raised).
