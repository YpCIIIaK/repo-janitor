# What 3000 open-source repos look like

3000 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 746 | 25% |
| B | 661 | 22% |
| C | 859 | 29% |
| D | 559 | 19% |
| F | 175 | 6% |

Median score **71**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| Python | 400 | 73 | 2.4 |
| other | 380 | 65 | 0.0 |
| JavaScript | 360 | 75 | 2.5 |
| Go | 301 | 74 | 1.9 |
| TypeScript | 280 | 74 | 2.9 |
| Java | 194 | 82 | 3.1 |
| Ruby | 188 | 84 | 2.5 |
| PHP | 161 | 79 | 2.1 |
| Rust | 140 | 62 | 2.2 |
| C# | 114 | 76 | 1.8 |
| Swift | 105 | 83 | 1.9 |
| Kotlin | 99 | 72 | 2.7 |
| Scala | 93 | 63 | 2.6 |
| C++ | 90 | 62 | 1.9 |
| C | 82 | 64 | 1.1 |
| Vue | 11 | 82 | 2.5 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 2263 | 75% |
| duplicate | 2059 | 69% |
| todo | 1823 | 61% |
| workflow-action-tag-first-party | 1750 | 58% |
| workflow-no-permissions | 1568 | 52% |
| workflow-action-tag | 1464 | 49% |
| commented-code | 973 | 32% |
| doc-link | 628 | 21% |
| hygiene-no-tests | 579 | 19% |
| dead-export | 524 | 17% |
| eol-node | 475 | 16% |
| hygiene-no-ci | 460 | 15% |
| skipped-test | 317 | 11% |
| eol-python | 301 | 10% |
| config-conflict | 187 | 6% |
| hygiene-no-license | 166 | 6% |
| lockfile-missing | 115 | 4% |
| docker-latest | 88 | 3% |
| ci-no-pr-trigger | 80 | 3% |
| docs-badge | 65 | 2% |
| insecure-sql-interpolated | 51 | 2% |
| eol-runner | 37 | 1% |
| dead-uikit | 29 | 1% |
| docker-add-url | 27 | 1% |
| ci-disabled | 24 | 1% |

## CI supply chain

- **79%** of 2372 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **62%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **66%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **43%** of 1039 Node.js projects still declare or test on an end-of-life Node version.
- **49%** of 400 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 89% |
| license | 91% |
| contributing | 41% |
| security | 20% |
| codeOfConduct | 19% |
| changelog | 31% |
| ci | 84% |
| tests | 72% |

## How old the debt is

- Median age of a TODO/FIXME: **3.3 years** (83807 dated).
- 36% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.9 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/reflect/MethodDelegate.java:24`
- 23.4 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/beans/BeanMap.java:282`
- 23.3 y — cjlin1-libsvm `svm.cpp:2183`
- 23.3 y — cjlin1-libsvm `svm.cpp:3120`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 1098): median score **68**.
- Quiet repos (< 10 commits, 1356): median score **72**.
- Mean findings per repo: active 71, quiet 80.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 1325 | 84 |
| 5k–50k | 1189 | 68 |
| 50k–200k | 376 | 64 |
| > 200k | 110 | 62 |

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
- **0** a small other project (121 findings)
- **0** a small PHP project (103 findings)
- **0** a small JavaScript project (322 findings)
- **0** a small PHP project (32 findings)
- **0** a small Python project (39 findings)
- **0** a large TypeScript project (268 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 65 | -2 | +6.2 | -1.07 |
| Renovate | 188 | -6 | -7.6 | +0.18 |
| Dependabot | 907 | -10 | -7.9 | -0.06 |
| .editorconfig | 782 | -8 | -8.3 | -0.55 |
| pre-commit | 238 | -7 | -9.4 | -0.62 |
| TypeScript | 356 | -6 | -10.2 | +0.17 |
| ESLint flat config | 224 | -6 | -10.9 | -0.53 |
| SECURITY.md | 719 | -11 | -11.2 | -0.26 |
| CONTRIBUTING | 1321 | -15 | -11.6 | -0.07 |
| CodeQL | 298 | -9 | -11.7 | +0.20 |
| CODEOWNERS | 425 | -9 | -11.8 | +0.98 |
| Prettier | 244 | -7 | -12.0 | +0.48 |
| PR template | 855 | -13 | -12.6 | +0.47 |
| Dev container | 212 | -9 | -12.8 | -0.19 |
| Issue templates | 1281 | -17 | -13.4 | +0.45 |
| Changesets | 58 | -12 | -18.3 | +0.83 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

28824 low-confidence findings were kept out of these numbers (12% of everything the scanners raised).
