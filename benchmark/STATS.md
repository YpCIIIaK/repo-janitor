# What 1093 open-source repos look like

1093 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 266 | 24% |
| B | 246 | 23% |
| C | 332 | 30% |
| D | 186 | 17% |
| F | 63 | 6% |

Median score **72**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| JavaScript | 239 | 80 | 2.0 |
| TypeScript | 219 | 73 | 2.0 |
| Python | 165 | 66 | 1.6 |
| Go | 118 | 71 | 1.5 |
| other | 105 | 89 | 0.0 |
| PHP | 53 | 65 | 1.4 |
| Ruby | 36 | 70 | 1.4 |
| Rust | 35 | 61 | 1.7 |
| Java | 35 | 65 | 1.7 |
| C | 23 | 69 | 1.4 |
| C# | 22 | 62 | 2.3 |
| C++ | 13 | 63 | 3.7 |
| Kotlin | 12 | 64 | 1.7 |
| Swift | 11 | 69 | 1.2 |
| Scala | 5 | 54 | 5.9 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 733 | 67% |
| duplicate | 645 | 59% |
| todo | 639 | 58% |
| workflow-action-tag-first-party | 633 | 58% |
| workflow-no-permissions | 574 | 53% |
| workflow-action-tag | 522 | 48% |
| commented-code | 306 | 28% |
| eol-node | 258 | 24% |
| doc-link | 223 | 20% |
| dead-export | 178 | 16% |
| bloat | 167 | 15% |
| hygiene-no-tests | 167 | 15% |
| skipped-test | 151 | 14% |
| eol-python | 112 | 10% |
| hygiene-no-ci | 94 | 9% |
| config-conflict | 78 | 7% |
| secret-provider | 78 | 7% |
| lockfile-missing | 64 | 6% |
| secret-generic | 63 | 6% |
| ci-silenced-failure | 42 | 4% |
| hygiene-no-license | 38 | 3% |
| docker-latest | 32 | 3% |
| env-missing | 32 | 3% |
| docs-badge | 27 | 2% |
| insecure-sql-interpolated | 22 | 2% |

## CI supply chain

- **72%** of 964 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **54%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **60%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **8**.

## End-of-life runtimes

- **45%** of 548 Node.js projects still declare or test on an end-of-life Node version.
- **54%** of 165 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 93% |
| contributing | 54% |
| security | 35% |
| codeOfConduct | 27% |
| changelog | 41% |
| ci | 91% |
| tests | 83% |

## How old the debt is

- Median age of a TODO/FIXME: **3.7 years** (18530 dated).
- 36% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.1 y — dateutil-dateutil `src/dateutil/rrule.py:1199`
- 23.0 y — paramiko-paramiko `paramiko/ber.py:71`
- 21.8 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestCopticChronology.java:405`
- 21.1 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestEthiopicChronology.java:405`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 568): median score **66**.
- Quiet repos (< 10 commits, 287): median score **81**.
- Mean findings per repo: active 77, quiet 32.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 424 | 87 |
| 5k–50k | 407 | 68 |
| 50k–200k | 198 | 61 |
| > 200k | 64 | 60 |

## Cleanest repos

- **100** ai-nanoid (0 findings)
- **100** jshttp-cookie (0 findings)
- **100** jonschlinkert-is-number (0 findings)
- **100** fastify-fastify-cors (0 findings)
- **100** fastify-fastify-static (0 findings)
- **100** metabase-toucan (0 findings)
- **100** jamesives-github-pages-deploy-action (0 findings)
- **100** aquasecurity-trivy-action (0 findings)
- **100** express (1 findings)
- **100** rust-lang-log (1 findings)

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
| OpenSSF Scorecard | 40 | +14 | +9.1 | -1.33 |
| ESLint flat config | 131 | -2 | +5.6 | -0.22 |
| TypeScript | 212 | +4 | +4.7 | -0.12 |
| Prettier | 136 | +3 | +3.3 | +0.06 |
| .editorconfig | 367 | -3 | +2.1 | -0.54 |
| CodeQL | 144 | -6 | +1.6 | -0.38 |
| Renovate | 85 | -4 | -0.0 | +0.29 |
| SECURITY.md | 352 | -10 | -0.7 | -0.33 |
| Dependabot | 413 | -9 | -1.2 | -0.26 |
| Dev container | 89 | -8 | -2.1 | +0.71 |
| CODEOWNERS | 181 | -8 | -2.6 | +0.93 |
| Changesets | 27 | -8 | -2.9 | +1.11 |
| PR template | 362 | -12 | -3.9 | +0.53 |
| CONTRIBUTING | 520 | -15 | -4.8 | +0.16 |
| Issue templates | 493 | -17 | -6.2 | +0.29 |
| pre-commit | 118 | -7 | -6.3 | -0.57 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

6884 low-confidence findings were kept out of these numbers (10% of everything the scanners raised).
