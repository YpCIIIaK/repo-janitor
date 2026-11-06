# What 1737 open-source repos look like

1737 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 384 | 22% |
| B | 363 | 21% |
| C | 562 | 32% |
| D | 363 | 21% |
| F | 65 | 4% |

Median score **69**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| TypeScript | 368 | 68 | 1.6 |
| JavaScript | 306 | 79 | 2.1 |
| Python | 255 | 66 | 1.5 |
| Go | 184 | 68 | 1.2 |
| other | 153 | 91 | 0.0 |
| PHP | 83 | 66 | 1.9 |
| Rust | 76 | 60 | 2.1 |
| C | 69 | 61 | 1.0 |
| Java | 58 | 67 | 1.4 |
| Ruby | 53 | 75 | 1.4 |
| C# | 42 | 62 | 1.2 |
| C++ | 31 | 64 | 2.1 |
| Kotlin | 20 | 63 | 1.8 |
| Swift | 17 | 76 | 1.2 |
| Vue | 11 | 72 | 2.3 |
| Scala | 8 | 58 | 1.7 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 1265 | 73% |
| duplicate | 1143 | 66% |
| todo | 1101 | 63% |
| workflow-action-tag-first-party | 1035 | 60% |
| workflow-no-permissions | 941 | 54% |
| workflow-action-tag | 876 | 50% |
| commented-code | 608 | 35% |
| doc-link | 413 | 24% |
| eol-node | 408 | 23% |
| dead-export | 402 | 23% |
| skipped-test | 290 | 17% |
| hygiene-no-tests | 265 | 15% |
| eol-python | 195 | 11% |
| hygiene-no-ci | 156 | 9% |
| config-conflict | 127 | 7% |
| docker-untagged | 119 | 7% |
| lockfile-missing | 90 | 5% |
| ci-silenced-failure | 80 | 5% |
| hygiene-no-license | 75 | 4% |
| docker-latest | 60 | 3% |
| env-missing | 57 | 3% |
| docs-badge | 41 | 2% |
| insecure-sql-interpolated | 39 | 2% |
| workflow-pr-target-checkout | 22 | 1% |
| dead-uikit | 22 | 1% |

## CI supply chain

- **74%** of 1523 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **58%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **62%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **10**.

## End-of-life runtimes

- **45%** of 875 Node.js projects still declare or test on an end-of-life Node version.
- **56%** of 255 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 92% |
| contributing | 55% |
| security | 33% |
| codeOfConduct | 28% |
| changelog | 39% |
| ci | 91% |
| tests | 83% |

## How old the debt is

- Median age of a TODO/FIXME: **3.1 years** (63196 dated).
- 33% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.1 y — dateutil-dateutil `src/dateutil/rrule.py:1199`
- 23.1 y — fortra-impacket `impacket/ImpactPacket.py:1774`
- 23.0 y — paramiko-paramiko `paramiko/ber.py:71`
- 22.0 y — openttd-openttd `src/rail_gui.cpp:992`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 965): median score **65**.
- Quiet repos (< 10 commits, 442): median score **81**.
- Mean findings per repo: active 124, quiet 37.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 587 | 88 |
| 5k–50k | 597 | 67 |
| 50k–200k | 350 | 61 |
| > 200k | 203 | 59 |

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
- **0** aws-samples-serverless-patterns (332 findings)
- **0** docker-library-wordpress (32 findings)
- **0** posthog-charts-clickhouse (39 findings)
- **0** expo-expo-cli (268 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 57 | +6 | +8.2 | -1.08 |
| ESLint flat config | 215 | -1 | +4.2 | -0.69 |
| TypeScript | 347 | +2 | +3.5 | -0.19 |
| .editorconfig | 609 | -3 | +1.1 | -0.53 |
| Prettier | 235 | -2 | +0.7 | +0.26 |
| Dev container | 171 | -5 | +0.6 | -0.08 |
| CodeQL | 237 | -6 | +0.3 | -0.29 |
| Renovate | 148 | -2 | +0.0 | -0.01 |
| Changesets | 55 | -5 | -0.0 | +0.43 |
| SECURITY.md | 534 | -9 | -0.5 | -0.38 |
| Dependabot | 626 | -6 | -0.6 | -0.12 |
| CODEOWNERS | 315 | -7 | -1.1 | +0.22 |
| PR template | 620 | -11 | -1.2 | +0.40 |
| CONTRIBUTING | 861 | -13 | -2.8 | -0.13 |
| Issue templates | 869 | -16 | -3.0 | +0.24 |
| pre-commit | 180 | -4 | -5.5 | -0.72 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

18700 low-confidence findings were kept out of these numbers (11% of everything the scanners raised).
