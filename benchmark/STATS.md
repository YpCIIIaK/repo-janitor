# What 909 open-source repos look like

909 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 213 | 23% |
| B | 209 | 23% |
| C | 276 | 30% |
| D | 164 | 18% |
| F | 47 | 5% |

Median score **71**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| JavaScript | 218 | 82 | 1.8 |
| TypeScript | 183 | 71 | 1.9 |
| Python | 135 | 66 | 1.6 |
| Go | 76 | 72 | 1.4 |
| other | 62 | 89 | 0.0 |
| PHP | 51 | 65 | 1.3 |
| Rust | 35 | 61 | 1.7 |
| Ruby | 34 | 75 | 1.4 |
| Java | 31 | 64 | 1.5 |
| C | 21 | 69 | 1.4 |
| C# | 21 | 61 | 2.3 |
| C++ | 13 | 63 | 3.7 |
| Kotlin | 12 | 64 | 1.7 |
| Swift | 10 | 72 | 1.2 |
| Scala | 5 | 54 | 5.9 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 642 | 71% |
| duplicate | 569 | 63% |
| todo | 567 | 62% |
| workflow-action-tag-first-party | 551 | 61% |
| workflow-no-permissions | 478 | 53% |
| workflow-action-tag | 438 | 48% |
| commented-code | 270 | 30% |
| eol-node | 227 | 25% |
| doc-link | 175 | 19% |
| dead-export | 149 | 16% |
| skipped-test | 138 | 15% |
| bloat | 136 | 15% |
| hygiene-no-tests | 114 | 13% |
| eol-python | 87 | 10% |
| hygiene-no-ci | 79 | 9% |
| config-conflict | 74 | 8% |
| lockfile-missing | 61 | 7% |
| secret-provider | 53 | 6% |
| secret-generic | 48 | 5% |
| ci-silenced-failure | 35 | 4% |
| hygiene-no-license | 34 | 4% |
| env-missing | 27 | 3% |
| insecure-sql-interpolated | 22 | 2% |
| docs-badge | 20 | 2% |
| docker-latest | 20 | 2% |

## CI supply chain

- **74%** of 800 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **55%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **60%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **8**.

## End-of-life runtimes

- **47%** of 473 Node.js projects still declare or test on an end-of-life Node version.
- **54%** of 135 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 92% |
| contributing | 55% |
| security | 37% |
| codeOfConduct | 27% |
| changelog | 43% |
| ci | 91% |
| tests | 86% |

## How old the debt is

- Median age of a TODO/FIXME: **3.8 years** (16737 dated).
- 38% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.1 y — dateutil-dateutil `src/dateutil/rrule.py:1199`
- 23.0 y — paramiko-paramiko `paramiko/ber.py:71`
- 21.8 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestCopticChronology.java:405`
- 21.1 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestEthiopicChronology.java:405`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 473): median score **65**.
- Quiet repos (< 10 commits, 233): median score **82**.
- Mean findings per repo: active 80, quiet 33.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 307 | 88 |
| 5k–50k | 371 | 68 |
| 50k–200k | 181 | 61 |
| > 200k | 50 | 60 |

## Cleanest repos

- **100** ai-nanoid (0 findings)
- **100** jshttp-cookie (0 findings)
- **100** jonschlinkert-is-number (0 findings)
- **100** fastify-fastify-cors (0 findings)
- **100** fastify-fastify-static (0 findings)
- **100** metabase-toucan (0 findings)
- **100** jamesives-github-pages-deploy-action (0 findings)
- **100** express (1 findings)
- **100** rust-lang-log (1 findings)
- **100** pyca-bcrypt (1 findings)

## Most to clean up

- **0** webgoat-webgoat (140 findings)
- **0** digininja-dvwa (105 findings)
- **0** juice-shop-juice-shop (150 findings)
- **0** alist-org-alist (264 findings)
- **0** atuinsh-atuin (170 findings)
- **0** jerryhoff-webgoat-net (83 findings)
- **0** matomo-org-matomo-for-wordpress (193 findings)
- **0** owasp-wrongsecrets (138 findings)
- **0** sasanlabs-vulnerableapp (105 findings)
- **0** dagster-io-dagster (876 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 30 | +14 | +9.0 | -1.40 |
| ESLint flat config | 113 | 0 | +5.9 | -0.50 |
| TypeScript | 180 | +4 | +4.5 | +0.11 |
| Prettier | 119 | 0 | +2.5 | +0.18 |
| CodeQL | 117 | -5 | +2.5 | -0.18 |
| .editorconfig | 321 | +2 | +2.4 | -0.51 |
| Renovate | 62 | -5 | +0.3 | -0.02 |
| SECURITY.md | 306 | -10 | -0.3 | -0.38 |
| Dependabot | 333 | -10 | -2.0 | +0.06 |
| pre-commit | 92 | -7 | -2.0 | -0.46 |
| Changesets | 23 | -8 | -3.2 | +1.81 |
| PR template | 294 | -13 | -4.3 | +0.41 |
| Dev container | 72 | -7 | -4.6 | +0.10 |
| CONTRIBUTING | 432 | -15 | -5.3 | +0.03 |
| CODEOWNERS | 124 | -9 | -5.8 | +1.16 |
| Issue templates | 417 | -18 | -6.9 | +0.32 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

5141 low-confidence findings were kept out of these numbers (9% of everything the scanners raised).
