# What 3400 open-source repos look like

3400 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 852 | 25% |
| B | 803 | 24% |
| C | 1074 | 32% |
| D | 573 | 17% |
| F | 98 | 3% |

Median score **74**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| Python | 409 | 73 | 2.0 |
| TypeScript | 387 | 69 | 1.6 |
| Go | 341 | 71 | 1.6 |
| JavaScript | 339 | 78 | 2.0 |
| Swift | 262 | 83 | 2.2 |
| Kotlin | 240 | 70 | 1.9 |
| Java | 211 | 80 | 2.9 |
| Ruby | 194 | 84 | 2.3 |
| other | 189 | 91 | 0.0 |
| PHP | 173 | 79 | 1.6 |
| Rust | 170 | 62 | 2.0 |
| C++ | 148 | 62 | 3.2 |
| C# | 131 | 73 | 1.3 |
| Scala | 97 | 63 | 2.4 |
| C | 93 | 63 | 1.1 |
| Vue | 13 | 78 | 2.3 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 2555 | 75% |
| duplicate | 2408 | 71% |
| todo | 2022 | 59% |
| workflow-action-tag-first-party | 2007 | 59% |
| workflow-no-permissions | 1779 | 52% |
| workflow-action-tag | 1682 | 49% |
| commented-code | 1074 | 32% |
| doc-link | 707 | 21% |
| hygiene-no-tests | 673 | 20% |
| dead-export | 554 | 16% |
| hygiene-no-ci | 540 | 16% |
| eol-node | 509 | 15% |
| skipped-test | 326 | 10% |
| eol-python | 309 | 9% |
| config-conflict | 195 | 6% |
| hygiene-no-license | 187 | 6% |
| lockfile-missing | 125 | 4% |
| ci-no-pr-trigger | 106 | 3% |
| docker-latest | 94 | 3% |
| docs-badge | 78 | 2% |
| insecure-sql-interpolated | 52 | 2% |
| eol-runner | 45 | 1% |
| dead-uikit | 30 | 1% |
| docker-add-url | 28 | 1% |
| ci-disabled | 26 | 1% |

## CI supply chain

- **80%** of 2669 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **63%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **67%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **10**.

## End-of-life runtimes

- **43%** of 1103 Node.js projects still declare or test on an end-of-life Node version.
- **49%** of 409 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 91% |
| contributing | 48% |
| security | 24% |
| codeOfConduct | 23% |
| changelog | 36% |
| ci | 84% |
| tests | 79% |

## How old the debt is

- Median age of a TODO/FIXME: **3.4 years** (92922 dated).
- 37% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.9 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/reflect/MethodDelegate.java:24`
- 23.4 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/beans/BeanMap.java:282`
- 23.3 y — cjlin1-libsvm `svm.cpp:2183`
- 23.3 y — cjlin1-libsvm `svm.cpp:3120`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 1596): median score **67**.
- Quiet repos (< 10 commits, 1175): median score **83**.
- Mean findings per repo: active 102, quiet 37.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 1168 | 89 |
| 5k–50k | 1317 | 68 |
| 50k–200k | 626 | 63 |
| > 200k | 289 | 61 |

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
| OpenSSF Scorecard | 68 | +7 | +7.1 | -1.00 |
| ESLint flat config | 225 | -6 | +3.0 | -0.65 |
| TypeScript | 357 | -3 | +2.5 | -0.26 |
| SECURITY.md | 768 | -9 | +0.5 | -0.43 |
| .editorconfig | 861 | -8 | +0.3 | -0.58 |
| Prettier | 248 | -5 | +0.1 | -0.04 |
| Renovate | 212 | -6 | -0.4 | +0.06 |
| CodeQL | 315 | -7 | -0.4 | -0.28 |
| Dev container | 218 | -8 | -0.7 | -0.23 |
| Changesets | 58 | -9 | -1.9 | +0.39 |
| CODEOWNERS | 468 | -9 | -2.3 | +0.06 |
| CONTRIBUTING | 1483 | -13 | -2.6 | -0.19 |
| PR template | 950 | -11 | -2.7 | +0.19 |
| Dependabot | 990 | -10 | -3.7 | -0.13 |
| Issue templates | 1489 | -16 | -4.7 | +0.37 |
| pre-commit | 241 | -9 | -6.1 | -0.61 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

30337 low-confidence findings were kept out of these numbers (12% of everything the scanners raised).
