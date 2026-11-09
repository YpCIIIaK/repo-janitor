# What 3000 open-source repos look like

3000 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 758 | 25% |
| B | 707 | 24% |
| C | 927 | 31% |
| D | 513 | 17% |
| F | 95 | 3% |

Median score **74**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| Python | 404 | 73 | 2.0 |
| TypeScript | 375 | 69 | 1.6 |
| Go | 338 | 71 | 1.6 |
| JavaScript | 323 | 79 | 2.0 |
| Java | 204 | 80 | 2.9 |
| Ruby | 194 | 84 | 2.3 |
| other | 180 | 91 | 0.0 |
| PHP | 173 | 79 | 1.6 |
| Rust | 162 | 62 | 2.0 |
| C# | 131 | 73 | 1.3 |
| Swift | 107 | 83 | 1.8 |
| Kotlin | 104 | 72 | 2.5 |
| C++ | 102 | 62 | 1.8 |
| Scala | 97 | 63 | 2.4 |
| C | 90 | 64 | 1.1 |
| Vue | 13 | 78 | 2.3 |

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

- **79%** of 2373 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **62%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **66%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **43%** of 1039 Node.js projects still declare or test on an end-of-life Node version.
- **50%** of 404 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 91% |
| contributing | 48% |
| security | 25% |
| codeOfConduct | 23% |
| changelog | 36% |
| ci | 84% |
| tests | 79% |

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

- Active repos (≥ 50 commits last year, 1395): median score **67**.
- Quiet repos (< 10 commits, 1047): median score **84**.
- Mean findings per repo: active 105, quiet 37.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 1013 | 90 |
| 5k–50k | 1176 | 68 |
| 50k–200k | 549 | 63 |
| > 200k | 262 | 60 |

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
| OpenSSF Scorecard | 65 | +4 | +6.4 | -0.90 |
| ESLint flat config | 224 | -6 | +3.4 | -0.57 |
| TypeScript | 356 | -3 | +2.4 | -0.15 |
| .editorconfig | 782 | -6 | +0.3 | -0.57 |
| Renovate | 188 | -5 | +0.0 | +0.13 |
| Prettier | 244 | -6 | -0.1 | +0.03 |
| SECURITY.md | 719 | -9 | -0.6 | -0.42 |
| Dev container | 212 | -8 | -0.6 | -0.18 |
| CodeQL | 298 | -9 | -0.7 | -0.23 |
| Changesets | 58 | -9 | -1.4 | +0.46 |
| CODEOWNERS | 425 | -9 | -1.6 | +0.02 |
| PR template | 855 | -12 | -2.2 | -0.01 |
| Dependabot | 907 | -10 | -2.4 | -0.16 |
| CONTRIBUTING | 1321 | -13 | -2.6 | -0.23 |
| Issue templates | 1281 | -16 | -3.6 | +0.18 |
| pre-commit | 238 | -9 | -5.4 | -0.51 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

28824 low-confidence findings were kept out of these numbers (12% of everything the scanners raised).
