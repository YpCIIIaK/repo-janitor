# What 2538 open-source repos look like

2538 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 614 | 24% |
| B | 584 | 23% |
| C | 788 | 31% |
| D | 464 | 18% |
| F | 88 | 3% |

Median score **72**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| TypeScript | 374 | 69 | 1.6 |
| Python | 354 | 71 | 1.9 |
| JavaScript | 319 | 79 | 2.0 |
| Go | 276 | 70 | 1.5 |
| other | 177 | 91 | 0.0 |
| Java | 146 | 78 | 2.7 |
| PHP | 140 | 77 | 1.5 |
| Ruby | 139 | 80 | 2.0 |
| Rust | 130 | 62 | 1.8 |
| C# | 98 | 67 | 1.3 |
| C | 82 | 64 | 1.1 |
| C++ | 77 | 62 | 1.6 |
| Kotlin | 73 | 68 | 2.4 |
| Swift | 73 | 80 | 1.8 |
| Scala | 64 | 63 | 2.4 |
| Vue | 13 | 78 | 2.3 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 1898 | 75% |
| duplicate | 1731 | 68% |
| todo | 1562 | 62% |
| workflow-action-tag-first-party | 1495 | 59% |
| workflow-no-permissions | 1332 | 52% |
| workflow-action-tag | 1256 | 49% |
| commented-code | 860 | 34% |
| doc-link | 559 | 22% |
| dead-export | 492 | 19% |
| hygiene-no-tests | 468 | 18% |
| eol-node | 458 | 18% |
| hygiene-no-ci | 346 | 14% |
| skipped-test | 311 | 12% |
| eol-python | 268 | 11% |
| config-conflict | 165 | 7% |
| hygiene-no-license | 135 | 5% |
| lockfile-missing | 107 | 4% |
| docker-latest | 78 | 3% |
| ci-no-pr-trigger | 66 | 3% |
| docs-badge | 61 | 2% |
| insecure-sql-interpolated | 51 | 2% |
| eol-runner | 30 | 1% |
| dead-uikit | 27 | 1% |
| docker-add-url | 23 | 1% |
| ci-disabled | 21 | 1% |

## CI supply chain

- **78%** of 2068 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **61%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **64%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **44%** of 988 Node.js projects still declare or test on an end-of-life Node version.
- **51%** of 354 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 91% |
| contributing | 51% |
| security | 28% |
| codeOfConduct | 25% |
| changelog | 36% |
| ci | 86% |
| tests | 80% |

## How old the debt is

- Median age of a TODO/FIXME: **3.3 years** (77767 dated).
- 36% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.9 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/reflect/MethodDelegate.java:24`
- 23.4 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/beans/BeanMap.java:282`
- 23.3 y — cjlin1-libsvm `svm.cpp:2183`
- 23.3 y — cjlin1-libsvm `svm.cpp:3120`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 1246): median score **66**.
- Quiet repos (< 10 commits, 816): median score **83**.
- Mean findings per repo: active 110, quiet 38.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 846 | 89 |
| 5k–50k | 964 | 68 |
| 50k–200k | 476 | 62 |
| > 200k | 252 | 60 |

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
- **0** digininja-dvwa (110 findings)
- **0** jerryhoff-webgoat-net (74 findings)
- **0** sasanlabs-vulnerableapp (100 findings)
- **0** hashicorp-vault-guides (121 findings)
- **0** sqlmapproject-testenv (103 findings)
- **0** aws-samples-serverless-patterns (322 findings)
- **0** docker-library-wordpress (32 findings)
- **0** posthog-charts-clickhouse (39 findings)
- **0** expo-expo-cli (268 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 63 | +3 | +7.2 | -0.89 |
| ESLint flat config | 223 | -5 | +4.0 | -0.58 |
| TypeScript | 355 | -1 | +3.5 | -0.15 |
| .editorconfig | 721 | -6 | +1.2 | -0.53 |
| SECURITY.md | 665 | -9 | +0.5 | -0.36 |
| Prettier | 241 | -5 | -0.1 | +0.09 |
| Renovate | 170 | -4 | -0.2 | +0.02 |
| CodeQL | 277 | -7 | -0.2 | -0.25 |
| Dev container | 196 | -7 | -0.7 | -0.12 |
| Changesets | 58 | -8 | -1.3 | +0.46 |
| Dependabot | 802 | -9 | -1.6 | -0.13 |
| CODEOWNERS | 390 | -8 | -1.7 | +0.13 |
| CONTRIBUTING | 1175 | -14 | -1.8 | -0.17 |
| PR template | 777 | -12 | -2.0 | +0.20 |
| Issue templates | 1147 | -15 | -3.4 | +0.27 |
| pre-commit | 216 | -8 | -6.1 | -0.48 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

27505 low-confidence findings were kept out of these numbers (13% of everything the scanners raised).
