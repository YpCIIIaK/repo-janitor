# What 3997 open-source repos look like

3997 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 1247 | 31% |
| B | 876 | 22% |
| C | 1025 | 26% |
| D | 656 | 16% |
| F | 193 | 5% |

Median score **77**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| other | 1127 | 79 | 0.0 |
| Python | 630 | 81 | 2.3 |
| Go | 332 | 79 | 1.8 |
| JavaScript | 296 | 68 | 3.1 |
| Java | 210 | 83 | 3.1 |
| Ruby | 181 | 84 | 2.5 |
| PHP | 180 | 82 | 2.0 |
| TypeScript | 166 | 82 | 2.6 |
| Rust | 159 | 64 | 2.6 |
| C | 134 | 71 | 1.4 |
| C# | 128 | 80 | 1.6 |
| C++ | 127 | 65 | 1.8 |
| Kotlin | 114 | 79 | 2.6 |
| Swift | 114 | 84 | 2.0 |
| Scala | 88 | 64 | 2.6 |
| Vue | 10 | 85 | 6.6 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 2707 | 68% |
| duplicate | 2602 | 65% |
| workflow-action-tag-first-party | 2176 | 54% |
| todo | 2123 | 53% |
| workflow-no-permissions | 1902 | 48% |
| workflow-action-tag | 1781 | 45% |
| commented-code | 1136 | 28% |
| hygiene-no-tests | 1043 | 26% |
| hygiene-no-ci | 923 | 23% |
| doc-link | 771 | 19% |
| dead-export | 739 | 18% |
| eol-node | 563 | 14% |
| hygiene-no-license | 401 | 10% |
| eol-python | 378 | 9% |
| skipped-test | 364 | 9% |
| config-conflict | 217 | 5% |
| lockfile-missing | 157 | 4% |
| ci-no-pr-trigger | 123 | 3% |
| docker-latest | 106 | 3% |
| docs-badge | 81 | 2% |
| insecure-sql-interpolated | 59 | 1% |
| dead-uikit | 55 | 1% |
| hygiene-no-readme | 40 | 1% |
| eol-runner | 39 | 1% |
| docker-add-url | 31 | 1% |

## CI supply chain

- **81%** of 2878 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **62%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **66%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **40%** of 1326 Node.js projects still declare or test on an end-of-life Node version.
- **39%** of 630 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 73% |
| license | 87% |
| contributing | 28% |
| security | 13% |
| codeOfConduct | 12% |
| changelog | 21% |
| ci | 77% |
| tests | 54% |

## How old the debt is

- Median age of a TODO/FIXME: **3.4 years** (98321 dated).
- 37% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.9 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/reflect/MethodDelegate.java:24`
- 23.4 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/beans/BeanMap.java:282`
- 23.3 y — cjlin1-libsvm `svm.cpp:2183`
- 23.3 y — cjlin1-libsvm `svm.cpp:3120`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 1059): median score **71**.
- Quiet repos (< 10 commits, 2284): median score **79**.
- Mean findings per repo: active 77, quiet 62.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 2353 | 85 |
| 5k–50k | 1100 | 69 |
| 50k–200k | 391 | 64 |
| > 200k | 153 | 62 |

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
- **0** a small other project (144 findings)
- **0** a small PHP project (32 findings)
- **0** a small other project (39 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 70 | +1 | +2.6 | -1.35 |
| Renovate | 222 | -10 | -11.3 | +1.16 |
| pre-commit | 273 | -13 | -11.3 | -0.34 |
| Dependabot | 1025 | -16 | -12.1 | +0.27 |
| TypeScript | 476 | -6 | -12.4 | +1.06 |
| .editorconfig | 877 | -13 | -13.0 | +0.24 |
| CODEOWNERS | 485 | -15 | -14.0 | +0.90 |
| CodeQL | 330 | -15 | -14.2 | +1.57 |
| SECURITY.md | 812 | -17 | -14.5 | -0.09 |
| CONTRIBUTING | 1508 | -18 | -14.9 | -0.00 |
| PR template | 951 | -18 | -15.2 | +0.23 |
| Dev container | 224 | -16 | -15.8 | -0.08 |
| ESLint flat config | 281 | -11 | -16.7 | +1.41 |
| Issue templates | 1417 | -20 | -16.9 | +0.51 |
| Prettier | 288 | -13 | -19.2 | +2.53 |
| Changesets | 64 | -18 | -25.2 | +0.73 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

36164 low-confidence findings were kept out of these numbers (13% of everything the scanners raised).
