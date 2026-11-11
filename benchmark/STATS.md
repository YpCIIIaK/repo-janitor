# What 6007 open-source repos look like

6007 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

Identity audit: **6000 distinct GitHub repositories** in 6007 pinned records; 7 legacy alias records are retained.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 1885 | 31% |
| B | 1436 | 24% |
| C | 1689 | 28% |
| D | 865 | 14% |
| F | 132 | 2% |

Median score **79**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| Python | 924 | 83 | 2.0 |
| TypeScript | 692 | 76 | 1.8 |
| JavaScript | 601 | 82 | 2.0 |
| Go | 526 | 75 | 1.5 |
| other | 470 | 97 | 0.0 |
| Java | 356 | 78 | 2.2 |
| Rust | 334 | 64 | 1.8 |
| PHP | 315 | 80 | 1.8 |
| Swift | 314 | 84 | 2.2 |
| Kotlin | 299 | 73 | 2.1 |
| C++ | 291 | 64 | 2.1 |
| C# | 270 | 74 | 1.6 |
| Ruby | 259 | 82 | 2.1 |
| C | 216 | 71 | 1.3 |
| Scala | 104 | 63 | 2.6 |
| Vue | 29 | 80 | 3.2 |
| Svelte | 7 | 89 | 5.6 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| duplicate | 4099 | 68% |
| bus-factor | 4000 | 67% |
| workflow-action-tag-first-party | 3353 | 56% |
| todo | 3111 | 52% |
| workflow-no-permissions | 2851 | 47% |
| workflow-action-tag | 2720 | 45% |
| commented-code | 1782 | 30% |
| hygiene-no-tests | 1617 | 27% |
| hygiene-no-ci | 1454 | 24% |
| dead-export | 1149 | 19% |
| doc-link | 1148 | 19% |
| eol-node | 818 | 14% |
| hygiene-no-license | 627 | 10% |
| eol-python | 519 | 9% |
| skipped-test | 450 | 7% |
| config-conflict | 334 | 6% |
| lockfile-missing | 229 | 4% |
| ci-no-pr-trigger | 207 | 3% |
| docker-latest | 153 | 3% |
| docs-badge | 132 | 2% |
| dead-uikit | 92 | 2% |
| insecure-sql-interpolated | 72 | 1% |
| hygiene-no-readme | 64 | 1% |
| eol-runner | 61 | 1% |
| docker-add-url | 42 | 1% |

## CI supply chain

- **82%** of 4295 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **63%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **66%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **39%** of 1950 Node.js projects still declare or test on an end-of-life Node version.
- **36%** of 924 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 87% |
| contributing | 41% |
| security | 20% |
| codeOfConduct | 19% |
| changelog | 31% |
| ci | 76% |
| tests | 72% |

## How old the debt is

- Median age of a TODO/FIXME: **3.5 years** (142639 dated).
- 38% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.9 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/reflect/MethodDelegate.java:24`
- 23.4 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/beans/BeanMap.java:282`
- 23.3 y — cjlin1-libsvm `svm.cpp:2183`
- 23.3 y — cjlin1-libsvm `svm.cpp:3120`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 2628): median score **69**.
- Quiet repos (< 10 commits, 2137): median score **87**.
- Mean findings per repo: active 92, quiet 37.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 2276 | 91 |
| 5k–50k | 2199 | 70 |
| 50k–200k | 1039 | 64 |
| > 200k | 493 | 64 |

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
| OpenSSF Scorecard | 92 | +1 | +5.7 | -1.00 |
| ESLint flat config | 366 | -5 | +2.2 | -0.22 |
| TypeScript | 646 | -2 | +1.3 | -0.06 |
| SECURITY.md | 1168 | -11 | +0.0 | -0.39 |
| Prettier | 377 | -8 | -0.6 | +0.04 |
| Renovate | 292 | -8 | -1.7 | +0.21 |
| CodeQL | 447 | -13 | -2.5 | +0.05 |
| .editorconfig | 1234 | -12 | -2.6 | -0.17 |
| CODEOWNERS | 666 | -12 | -2.6 | +0.12 |
| Changesets | 83 | -14 | -3.6 | +0.08 |
| PR template | 1375 | -15 | -3.7 | +0.04 |
| Dev container | 303 | -14 | -3.7 | -0.18 |
| Dependabot | 1487 | -13 | -4.5 | +0.05 |
| CONTRIBUTING | 2252 | -15 | -4.5 | -0.13 |
| Issue templates | 2206 | -18 | -5.9 | +0.30 |
| pre-commit | 358 | -12 | -6.2 | -0.44 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

55167 low-confidence findings were kept out of these numbers (13% of everything the scanners raised).
