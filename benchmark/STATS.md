# What 4397 open-source repos look like

4397 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 1359 | 31% |
| B | 1025 | 23% |
| C | 1250 | 28% |
| D | 651 | 15% |
| F | 112 | 3% |

Median score **78**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| Python | 670 | 80 | 2.1 |
| TypeScript | 509 | 74 | 1.8 |
| JavaScript | 434 | 82 | 2.1 |
| Go | 394 | 76 | 1.6 |
| other | 376 | 94 | 0.0 |
| Swift | 267 | 83 | 2.3 |
| Kotlin | 253 | 73 | 2.1 |
| Java | 243 | 82 | 2.9 |
| PHP | 211 | 81 | 1.7 |
| Rust | 209 | 63 | 2.1 |
| Ruby | 205 | 84 | 2.3 |
| C++ | 186 | 64 | 2.8 |
| C# | 163 | 76 | 1.3 |
| C | 150 | 69 | 1.3 |
| Scala | 100 | 63 | 2.5 |
| Vue | 23 | 80 | 3.1 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 2999 | 68% |
| duplicate | 2951 | 67% |
| workflow-action-tag-first-party | 2433 | 55% |
| todo | 2322 | 53% |
| workflow-no-permissions | 2113 | 48% |
| workflow-action-tag | 1999 | 45% |
| commented-code | 1237 | 28% |
| hygiene-no-tests | 1137 | 26% |
| hygiene-no-ci | 1003 | 23% |
| doc-link | 850 | 19% |
| dead-export | 769 | 17% |
| eol-node | 597 | 14% |
| hygiene-no-license | 422 | 10% |
| eol-python | 386 | 9% |
| skipped-test | 373 | 8% |
| config-conflict | 225 | 5% |
| lockfile-missing | 167 | 4% |
| ci-no-pr-trigger | 149 | 3% |
| docker-latest | 112 | 3% |
| docs-badge | 94 | 2% |
| insecure-sql-interpolated | 60 | 1% |
| dead-uikit | 56 | 1% |
| eol-runner | 47 | 1% |
| hygiene-no-readme | 45 | 1% |
| docker-add-url | 32 | 1% |

## CI supply chain

- **81%** of 3176 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **63%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **67%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **40%** of 1390 Node.js projects still declare or test on an end-of-life Node version.
- **39%** of 670 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 98% |
| license | 88% |
| contributing | 41% |
| security | 20% |
| codeOfConduct | 19% |
| changelog | 32% |
| ci | 77% |
| tests | 72% |

## How old the debt is

- Median age of a TODO/FIXME: **3.5 years** (107436 dated).
- 38% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.9 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/reflect/MethodDelegate.java:24`
- 23.4 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/beans/BeanMap.java:282`
- 23.3 y — cjlin1-libsvm `svm.cpp:2183`
- 23.3 y — cjlin1-libsvm `svm.cpp:3120`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 1864): median score **68**.
- Quiet repos (< 10 commits, 1633): median score **87**.
- Mean findings per repo: active 95, quiet 37.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 1759 | 91 |
| 5k–50k | 1601 | 70 |
| 50k–200k | 712 | 64 |
| > 200k | 325 | 61 |

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
| OpenSSF Scorecard | 73 | +4 | +6.6 | -1.22 |
| ESLint flat config | 282 | -8 | +2.7 | -0.32 |
| TypeScript | 477 | -2 | +2.0 | -0.23 |
| SECURITY.md | 861 | -12 | -0.7 | -0.48 |
| .editorconfig | 956 | -10 | -0.9 | -0.30 |
| Renovate | 246 | -8 | -1.2 | +0.18 |
| Prettier | 292 | -10 | -1.4 | +0.04 |
| Dev container | 230 | -13 | -1.6 | -0.07 |
| CodeQL | 347 | -12 | -1.9 | -0.05 |
| CODEOWNERS | 528 | -12 | -2.7 | +0.10 |
| Changesets | 64 | -14 | -3.1 | +0.38 |
| CONTRIBUTING | 1670 | -16 | -3.6 | -0.14 |
| PR template | 1046 | -16 | -3.8 | +0.10 |
| Dependabot | 1108 | -14 | -4.7 | -0.01 |
| Issue templates | 1625 | -17 | -6.0 | +0.36 |
| pre-commit | 276 | -12 | -6.3 | -0.50 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

37677 low-confidence findings were kept out of these numbers (12% of everything the scanners raised).
