# What 2138 open-source repos look like

2138 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 496 | 23% |
| B | 479 | 22% |
| C | 682 | 32% |
| D | 404 | 19% |
| F | 77 | 4% |

Median score **70**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| TypeScript | 370 | 69 | 1.6 |
| JavaScript | 313 | 79 | 2.0 |
| Python | 306 | 69 | 1.7 |
| Go | 232 | 71 | 1.3 |
| other | 154 | 91 | 0.0 |
| PHP | 112 | 76 | 1.5 |
| Java | 107 | 73 | 1.7 |
| Rust | 102 | 60 | 1.7 |
| Ruby | 102 | 78 | 1.7 |
| C | 72 | 63 | 1.0 |
| C# | 70 | 65 | 1.3 |
| C++ | 56 | 62 | 1.5 |
| Kotlin | 48 | 67 | 1.5 |
| Swift | 44 | 76 | 1.6 |
| Scala | 34 | 61 | 2.3 |
| Vue | 13 | 78 | 2.3 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 1590 | 74% |
| duplicate | 1456 | 68% |
| todo | 1339 | 63% |
| workflow-action-tag-first-party | 1276 | 60% |
| workflow-no-permissions | 1136 | 53% |
| workflow-action-tag | 1067 | 50% |
| commented-code | 738 | 35% |
| doc-link | 500 | 23% |
| dead-export | 462 | 22% |
| eol-node | 439 | 21% |
| hygiene-no-tests | 360 | 17% |
| skipped-test | 304 | 14% |
| hygiene-no-ci | 242 | 11% |
| eol-python | 232 | 11% |
| config-conflict | 153 | 7% |
| hygiene-no-license | 105 | 5% |
| lockfile-missing | 98 | 5% |
| docker-latest | 69 | 3% |
| docs-badge | 53 | 2% |
| ci-no-pr-trigger | 50 | 2% |
| insecure-sql-interpolated | 47 | 2% |
| dead-uikit | 27 | 1% |
| eol-runner | 24 | 1% |
| ci-disabled | 19 | 1% |
| docker-add-url | 19 | 1% |

## CI supply chain

- **76%** of 1810 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **59%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **63%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **10**.

## End-of-life runtimes

- **44%** of 941 Node.js projects still declare or test on an end-of-life Node version.
- **53%** of 306 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 92% |
| contributing | 53% |
| security | 30% |
| codeOfConduct | 26% |
| changelog | 37% |
| ci | 88% |
| tests | 82% |

## How old the debt is

- Median age of a TODO/FIXME: **3.3 years** (73040 dated).
- 34% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.9 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/reflect/MethodDelegate.java:24`
- 23.4 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/beans/BeanMap.java:282`
- 23.3 y — cjlin1-libsvm `svm.cpp:2183`
- 23.3 y — cjlin1-libsvm `svm.cpp:3120`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 1129): median score **66**.
- Quiet repos (< 10 commits, 611): median score **80**.
- Mean findings per repo: active 115, quiet 40.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 691 | 89 |
| 5k–50k | 773 | 68 |
| 50k–200k | 427 | 62 |
| > 200k | 247 | 60 |

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
| OpenSSF Scorecard | 61 | +5 | +7.9 | -0.83 |
| ESLint flat config | 221 | -3 | +3.9 | -0.56 |
| TypeScript | 353 | +1 | +3.2 | -0.10 |
| .editorconfig | 669 | -4 | +0.6 | -0.50 |
| CodeQL | 257 | -6 | +0.5 | -0.22 |
| SECURITY.md | 613 | -8 | +0.2 | -0.41 |
| Prettier | 238 | -2 | +0.2 | +0.32 |
| Dev container | 182 | -6 | +0.1 | -0.07 |
| Renovate | 151 | -5 | -0.5 | +0.10 |
| Changesets | 56 | -6 | -0.8 | +0.48 |
| Dependabot | 723 | -7 | -1.5 | -0.14 |
| CODEOWNERS | 349 | -8 | -1.7 | +0.25 |
| PR template | 710 | -11 | -2.0 | +0.30 |
| CONTRIBUTING | 1033 | -13 | -2.8 | -0.08 |
| Issue templates | 1026 | -15 | -2.8 | +0.24 |
| pre-commit | 194 | -6 | -5.6 | -0.57 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

26160 low-confidence findings were kept out of these numbers (13% of everything the scanners raised).
