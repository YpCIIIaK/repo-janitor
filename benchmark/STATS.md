# What 5016 open-source repos look like

5016 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 1690 | 34% |
| B | 1170 | 23% |
| C | 1352 | 27% |
| D | 688 | 14% |
| F | 116 | 2% |

Median score **80**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| Python | 821 | 83 | 2.1 |
| TypeScript | 580 | 76 | 1.9 |
| JavaScript | 503 | 83 | 2.1 |
| other | 485 | 96 | 0.0 |
| Go | 425 | 77 | 1.6 |
| Swift | 274 | 84 | 2.2 |
| Java | 273 | 82 | 2.7 |
| Kotlin | 259 | 73 | 2.1 |
| Rust | 233 | 64 | 2.1 |
| PHP | 231 | 82 | 1.8 |
| Ruby | 210 | 84 | 2.3 |
| C++ | 208 | 65 | 2.6 |
| C | 192 | 74 | 1.4 |
| C# | 185 | 76 | 1.5 |
| Scala | 104 | 63 | 2.6 |
| Vue | 26 | 82 | 3.2 |
| Svelte | 7 | 89 | 5.6 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| duplicate | 3281 | 65% |
| bus-factor | 3267 | 65% |
| workflow-action-tag-first-party | 2679 | 53% |
| todo | 2489 | 50% |
| workflow-no-permissions | 2307 | 46% |
| workflow-action-tag | 2172 | 43% |
| hygiene-no-tests | 1433 | 29% |
| commented-code | 1343 | 27% |
| hygiene-no-ci | 1321 | 26% |
| doc-link | 933 | 19% |
| dead-export | 894 | 18% |
| eol-node | 651 | 13% |
| hygiene-no-license | 584 | 12% |
| eol-python | 434 | 9% |
| skipped-test | 390 | 8% |
| config-conflict | 247 | 5% |
| lockfile-missing | 187 | 4% |
| ci-no-pr-trigger | 166 | 3% |
| docker-latest | 118 | 2% |
| docs-badge | 102 | 2% |
| insecure-sql-interpolated | 65 | 1% |
| dead-uikit | 64 | 1% |
| hygiene-no-readme | 58 | 1% |
| eol-runner | 50 | 1% |
| ci-disabled | 33 | 1% |

## CI supply chain

- **82%** of 3464 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **63%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **67%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **39%** of 1568 Node.js projects still declare or test on an end-of-life Node version.
- **36%** of 821 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 98% |
| license | 86% |
| contributing | 38% |
| security | 19% |
| codeOfConduct | 18% |
| changelog | 30% |
| ci | 73% |
| tests | 69% |

## How old the debt is

- Median age of a TODO/FIXME: **3.4 years** (113096 dated).
- 37% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.9 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/reflect/MethodDelegate.java:24`
- 23.4 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/beans/BeanMap.java:282`
- 23.3 y — cjlin1-libsvm `svm.cpp:2183`
- 23.3 y — cjlin1-libsvm `svm.cpp:3120`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 2032): median score **69**.
- Quiet repos (< 10 commits, 1921): median score **88**.
- Mean findings per repo: active 91, quiet 36.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 2122 | 92 |
| 5k–50k | 1787 | 71 |
| 50k–200k | 765 | 64 |
| > 200k | 342 | 62 |

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

- **0** a large JavaScript project (133 findings)
- **0** a mid-size PHP project (110 findings)
- **0** a mid-size C# project (74 findings)
- **0** a mid-size Java project (100 findings)
- **0** a large C project (121 findings)
- **0** a small PHP project (103 findings)
- **0** a very large Python project (322 findings)
- **0** a small PHP project (32 findings)
- **0** a small Python project (39 findings)
- **0** a large TypeScript project (268 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 76 | +2 | +5.6 | -1.23 |
| ESLint flat config | 305 | -7 | +2.4 | -0.20 |
| TypeScript | 545 | -2 | +1.5 | -0.05 |
| .editorconfig | 1002 | -12 | -1.3 | -0.25 |
| SECURITY.md | 914 | -14 | -1.4 | -0.47 |
| Prettier | 316 | -10 | -1.6 | +0.00 |
| Renovate | 261 | -9 | -2.1 | +0.21 |
| CodeQL | 359 | -14 | -2.2 | -0.02 |
| Dev container | 242 | -15 | -2.5 | -0.18 |
| CODEOWNERS | 557 | -14 | -2.9 | +0.18 |
| Changesets | 69 | -16 | -3.7 | +0.43 |
| PR template | 1087 | -17 | -5.2 | +0.13 |
| CONTRIBUTING | 1771 | -16 | -5.2 | -0.08 |
| Dependabot | 1174 | -15 | -5.8 | +0.12 |
| pre-commit | 302 | -13 | -6.4 | -0.48 |
| Issue templates | 1701 | -19 | -6.9 | +0.33 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

42522 low-confidence findings were kept out of these numbers (13% of everything the scanners raised).
