# What 812 open-source repos look like

812 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 182 | 22% |
| B | 169 | 21% |
| C | 189 | 23% |
| D | 209 | 26% |
| F | 63 | 8% |

Median score **68**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| JavaScript | 198 | 82 | 1.8 |
| TypeScript | 164 | 67 | 2.0 |
| Python | 118 | 64 | 1.5 |
| Go | 67 | 64 | 1.4 |
| other | 55 | 89 | 0.0 |
| PHP | 44 | 65 | 1.2 |
| Rust | 35 | 57 | 1.7 |
| Ruby | 29 | 69 | 1.2 |
| Java | 23 | 59 | 0.8 |
| C# | 20 | 61 | 1.8 |
| C | 18 | 66 | 1.4 |
| C++ | 13 | 58 | 3.7 |
| Kotlin | 12 | 61 | 1.7 |
| Swift | 10 | 65 | 1.2 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 564 | 69% |
| todo | 523 | 64% |
| duplicate | 517 | 64% |
| workflow-action-tag-first-party | 512 | 63% |
| workflow-no-permissions | 432 | 53% |
| workflow-action-tag | 401 | 49% |
| commented-code | 243 | 30% |
| eol-node | 210 | 26% |
| doc-link | 154 | 19% |
| dead-export | 128 | 16% |
| skipped-test | 127 | 16% |
| bloat | 106 | 13% |
| hygiene-no-tests | 86 | 11% |
| eol-python | 79 | 10% |
| config-conflict | 65 | 8% |
| lockfile-missing | 56 | 7% |
| hygiene-no-ci | 50 | 6% |
| secret-provider | 39 | 5% |
| secret-generic | 35 | 4% |
| ci-silenced-failure | 29 | 4% |
| hygiene-no-license | 19 | 2% |
| env-missing | 19 | 2% |
| docs-badge | 18 | 2% |
| insecure-localstorage-secret | 15 | 2% |
| ci-no-pr-trigger | 13 | 2% |

## CI supply chain

- **73%** of 735 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **55%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **59%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **8**.

## End-of-life runtimes

- **48%** of 422 Node.js projects still declare or test on an end-of-life Node version.
- **58%** of 118 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 93% |
| contributing | 58% |
| security | 38% |
| codeOfConduct | 28% |
| changelog | 46% |
| ci | 94% |
| tests | 88% |

## How old the debt is

- Median age of a TODO/FIXME: **3.7 years** (18316 dated).
- 36% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.1 y — dateutil-dateutil `src/dateutil/rrule.py:1199`
- 23.0 y — paramiko-paramiko `paramiko/ber.py:71`
- 21.8 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestCopticChronology.java:405`
- 21.1 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestEthiopicChronology.java:405`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 438): median score **61**.
- Quiet repos (< 10 commits, 186): median score **85**.
- Mean findings per repo: active 84, quiet 31.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 255 | 89 |
| 5k–50k | 345 | 67 |
| 50k–200k | 171 | 52 |
| > 200k | 41 | 41 |

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
- **0** google-dagger (704 findings)
- **0** owasp-crapi (182 findings)
- **0** tautulli-tautulli (585 findings)
- **0** alist-org-alist (296 findings)
- **0** atuinsh-atuin (172 findings)
- **0** freshrss-freshrss (2481 findings)
- **0** louislam-uptime-kuma (92 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 28 | +2 | +7.0 | -0.80 |
| ESLint flat config | 105 | -1 | +5.8 | -0.38 |
| TypeScript | 167 | +1 | +4.5 | +0.30 |
| Prettier | 109 | -1 | +3.1 | +0.49 |
| .editorconfig | 307 | -1 | +2.4 | -0.36 |
| pre-commit | 82 | -3 | +0.5 | -0.46 |
| CodeQL | 106 | -7 | -0.3 | -0.09 |
| Renovate | 56 | -7 | -1.7 | +0.24 |
| Dependabot | 306 | -13 | -2.3 | +0.05 |
| CODEOWNERS | 99 | -10 | -2.5 | +0.22 |
| SECURITY.md | 284 | -15 | -2.9 | -0.26 |
| PR template | 268 | -15 | -3.0 | +0.30 |
| Changesets | 22 | -6 | -3.5 | +1.88 |
| Dev container | 64 | -8 | -3.9 | +0.21 |
| CONTRIBUTING | 406 | -18 | -6.1 | +0.27 |
| Issue templates | 384 | -22 | -7.5 | +0.45 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

4348 low-confidence findings were kept out of these numbers (8% of everything the scanners raised).
