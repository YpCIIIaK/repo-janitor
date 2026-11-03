# What 1273 open-source repos look like

1273 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 306 | 24% |
| B | 281 | 22% |
| C | 395 | 31% |
| D | 221 | 17% |
| F | 70 | 5% |

Median score **71**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| TypeScript | 277 | 70 | 1.8 |
| JavaScript | 269 | 80 | 2.0 |
| Python | 178 | 68 | 1.7 |
| Go | 134 | 69 | 1.5 |
| other | 122 | 90 | 0.0 |
| PHP | 69 | 68 | 1.9 |
| Rust | 50 | 61 | 2.0 |
| Ruby | 41 | 75 | 2.0 |
| Java | 36 | 65 | 1.7 |
| C# | 25 | 61 | 2.3 |
| C | 24 | 69 | 1.7 |
| C++ | 16 | 64 | 3.7 |
| Kotlin | 12 | 64 | 1.7 |
| Swift | 12 | 72 | 0.9 |
| Scala | 5 | 54 | 5.9 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 868 | 68% |
| duplicate | 770 | 60% |
| todo | 750 | 59% |
| workflow-action-tag-first-party | 746 | 59% |
| workflow-no-permissions | 677 | 53% |
| workflow-action-tag | 615 | 48% |
| commented-code | 371 | 29% |
| eol-node | 305 | 24% |
| doc-link | 266 | 21% |
| dead-export | 226 | 18% |
| bloat | 201 | 16% |
| skipped-test | 189 | 15% |
| hygiene-no-tests | 189 | 15% |
| eol-python | 121 | 10% |
| hygiene-no-ci | 115 | 9% |
| config-conflict | 91 | 7% |
| secret-provider | 87 | 7% |
| lockfile-missing | 73 | 6% |
| secret-generic | 71 | 6% |
| ci-silenced-failure | 49 | 4% |
| hygiene-no-license | 49 | 4% |
| docker-latest | 38 | 3% |
| env-missing | 33 | 3% |
| docs-badge | 31 | 2% |
| ci-no-pr-trigger | 22 | 2% |

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
| readme | 99% |
| license | 93% |
| contributing | 54% |
| security | 32% |
| codeOfConduct | 26% |
| changelog | 41% |
| ci | 91% |
| tests | 84% |

## How old the debt is

- Median age of a TODO/FIXME: **3.6 years** (22840 dated).
- 36% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.1 y — dateutil-dateutil `src/dateutil/rrule.py:1199`
- 23.0 y — paramiko-paramiko `paramiko/ber.py:71`
- 21.8 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestCopticChronology.java:405`
- 21.1 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestEthiopicChronology.java:405`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 667): median score **66**.
- Quiet repos (< 10 commits, 330): median score **82**.
- Mean findings per repo: active 81, quiet 31.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 484 | 88 |
| 5k–50k | 469 | 67 |
| 50k–200k | 234 | 61 |
| > 200k | 86 | 62 |

## Cleanest repos

- **100** ai-nanoid (0 findings)
- **100** jshttp-cookie (0 findings)
- **100** jonschlinkert-is-number (0 findings)
- **100** fastify-fastify-cors (0 findings)
- **100** fastify-fastify-static (0 findings)
- **100** metabase-toucan (0 findings)
- **100** jamesives-github-pages-deploy-action (0 findings)
- **100** aquasecurity-trivy-action (0 findings)
- **100** mfussenegger-nvim-dap (0 findings)
- **100** tmux-plugins-tpm (0 findings)

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
| OpenSSF Scorecard | 43 | +14 | +8.9 | -1.05 |
| ESLint flat config | 157 | -2 | +5.6 | -0.27 |
| TypeScript | 267 | +1 | +3.5 | -0.08 |
| Prettier | 169 | -1 | +2.3 | +0.06 |
| .editorconfig | 434 | -3 | +2.0 | -0.51 |
| CodeQL | 156 | -5 | +0.5 | -0.25 |
| Renovate | 98 | -4 | +0.1 | +0.13 |
| Changesets | 43 | -8 | -0.6 | +0.55 |
| Dependabot | 475 | -8 | -0.9 | -0.14 |
| SECURITY.md | 380 | -9 | -0.9 | -0.28 |
| Dev container | 110 | -7 | -1.6 | +0.08 |
| PR template | 420 | -12 | -3.5 | +0.45 |
| CODEOWNERS | 212 | -8 | -3.8 | +0.94 |
| CONTRIBUTING | 616 | -14 | -5.0 | +0.02 |
| Issue templates | 589 | -16 | -5.2 | +0.28 |
| pre-commit | 123 | -7 | -6.1 | -0.56 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

8114 low-confidence findings were kept out of these numbers (10% of everything the scanners raised).
