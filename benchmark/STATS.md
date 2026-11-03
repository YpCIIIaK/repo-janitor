# What 896 open-source repos look like

896 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 211 | 24% |
| B | 204 | 23% |
| C | 269 | 30% |
| D | 170 | 19% |
| F | 42 | 5% |

Median score **71**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| JavaScript | 216 | 82 | 1.8 |
| TypeScript | 181 | 71 | 1.9 |
| Python | 131 | 67 | 1.6 |
| Go | 73 | 71 | 1.4 |
| other | 61 | 89 | 0.0 |
| PHP | 50 | 66 | 1.4 |
| Rust | 35 | 61 | 1.7 |
| Ruby | 34 | 69 | 1.4 |
| Java | 31 | 64 | 1.5 |
| C | 21 | 67 | 1.4 |
| C# | 21 | 61 | 2.3 |
| C++ | 13 | 63 | 3.7 |
| Kotlin | 12 | 64 | 1.7 |
| Swift | 10 | 72 | 1.2 |
| Scala | 5 | 54 | 5.9 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 632 | 71% |
| todo | 565 | 63% |
| duplicate | 564 | 63% |
| workflow-action-tag-first-party | 546 | 61% |
| workflow-no-permissions | 468 | 52% |
| workflow-action-tag | 432 | 48% |
| commented-code | 267 | 30% |
| eol-node | 227 | 25% |
| doc-link | 174 | 19% |
| dead-export | 144 | 16% |
| skipped-test | 137 | 15% |
| bloat | 132 | 15% |
| hygiene-no-tests | 113 | 13% |
| eol-python | 85 | 9% |
| hygiene-no-ci | 79 | 9% |
| config-conflict | 74 | 8% |
| lockfile-missing | 61 | 7% |
| secret-provider | 50 | 6% |
| secret-generic | 47 | 5% |
| ci-silenced-failure | 34 | 4% |
| hygiene-no-license | 33 | 4% |
| env-missing | 27 | 3% |
| insecure-sql-interpolated | 22 | 2% |
| docs-badge | 20 | 2% |
| docker-latest | 20 | 2% |

## CI supply chain

- **74%** of 787 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **55%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **59%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **8**.

## End-of-life runtimes

- **47%** of 468 Node.js projects still declare or test on an end-of-life Node version.
- **54%** of 131 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 92% |
| contributing | 55% |
| security | 36% |
| codeOfConduct | 27% |
| changelog | 43% |
| ci | 91% |
| tests | 86% |

## How old the debt is

- Median age of a TODO/FIXME: **3.7 years** (19377 dated).
- 36% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.1 y — dateutil-dateutil `src/dateutil/rrule.py:1199`
- 23.0 y — paramiko-paramiko `paramiko/ber.py:71`
- 21.8 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestCopticChronology.java:405`
- 21.1 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestEthiopicChronology.java:405`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 467): median score **65**.
- Quiet repos (< 10 commits, 230): median score **83**.
- Mean findings per repo: active 86, quiet 34.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 301 | 88 |
| 5k–50k | 367 | 68 |
| 50k–200k | 179 | 61 |
| > 200k | 49 | 58 |

## Cleanest repos

- **100** ai-nanoid (0 findings)
- **100** jshttp-cookie (0 findings)
- **100** jonschlinkert-is-number (0 findings)
- **100** fastify-fastify-cors (0 findings)
- **100** fastify-fastify-static (0 findings)
- **100** metabase-toucan (0 findings)
- **100** express (1 findings)
- **100** rust-lang-log (1 findings)
- **100** pyca-bcrypt (1 findings)
- **100** semantic-release-semantic-release (1 findings)

## Most to clean up

- **0** webgoat-webgoat (140 findings)
- **0** digininja-dvwa (105 findings)
- **0** juice-shop-juice-shop (150 findings)
- **0** owasp-crapi (182 findings)
- **0** alist-org-alist (296 findings)
- **0** atuinsh-atuin (172 findings)
- **0** freshrss-freshrss (2481 findings)
- **0** jerryhoff-webgoat-net (83 findings)
- **0** matomo-org-matomo-for-wordpress (226 findings)
- **0** owasp-wrongsecrets (138 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 30 | +9 | +7.3 | -1.34 |
| ESLint flat config | 111 | -1 | +5.8 | -0.47 |
| TypeScript | 178 | +3 | +4.1 | +0.09 |
| Prettier | 117 | -1 | +3.1 | +0.22 |
| .editorconfig | 321 | -1 | +2.8 | -0.54 |
| CodeQL | 116 | -5 | +1.6 | -0.12 |
| Renovate | 62 | -6 | +0.4 | -0.03 |
| SECURITY.md | 300 | -11 | -0.7 | -0.33 |
| pre-commit | 90 | -6 | -1.4 | -0.63 |
| Dependabot | 326 | -10 | -1.7 | +0.02 |
| PR template | 289 | -13 | -2.4 | +0.36 |
| Changesets | 23 | -7 | -3.2 | +1.79 |
| Dev container | 68 | -7 | -3.8 | +0.25 |
| CONTRIBUTING | 425 | -15 | -5.0 | +0.13 |
| CODEOWNERS | 120 | -9 | -6.5 | +1.13 |
| Issue templates | 410 | -18 | -7.1 | +0.32 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

5096 low-confidence findings were kept out of these numbers (9% of everything the scanners raised).
