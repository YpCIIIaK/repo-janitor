# What 6510 open-source repos look like

6510 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

Identity audit: **6503 distinct GitHub repositories** in 6510 pinned records; 7 legacy alias records are retained.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 2093 | 32% |
| B | 1574 | 24% |
| C | 1800 | 28% |
| D | 907 | 14% |
| F | 136 | 2% |

Median score **80**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| Python | 979 | 83 | 2.0 |
| TypeScript | 759 | 76 | 1.9 |
| JavaScript | 657 | 82 | 2.0 |
| Go | 574 | 77 | 1.6 |
| other | 494 | 97 | 0.0 |
| Java | 394 | 78 | 2.4 |
| Rust | 376 | 66 | 1.9 |
| Swift | 349 | 85 | 2.5 |
| PHP | 348 | 83 | 1.8 |
| Kotlin | 328 | 74 | 2.2 |
| C++ | 326 | 65 | 2.0 |
| C# | 299 | 75 | 1.7 |
| Ruby | 285 | 82 | 2.2 |
| C | 224 | 71 | 1.3 |
| Scala | 118 | 64 | 2.7 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| duplicate | 4419 | 68% |
| bus-factor | 4314 | 66% |
| workflow-action-tag-first-party | 3625 | 56% |
| todo | 3311 | 51% |
| workflow-no-permissions | 3085 | 47% |
| workflow-action-tag | 2946 | 45% |
| commented-code | 1885 | 29% |
| hygiene-no-tests | 1757 | 27% |
| hygiene-no-ci | 1603 | 25% |
| dead-export | 1222 | 19% |
| doc-link | 1199 | 18% |
| eol-node | 854 | 13% |
| hygiene-no-license | 686 | 11% |
| eol-python | 538 | 8% |
| skipped-test | 460 | 7% |
| config-conflict | 358 | 5% |
| lockfile-missing | 257 | 4% |
| ci-no-pr-trigger | 225 | 3% |
| docker-latest | 162 | 2% |
| docs-badge | 136 | 2% |
| dead-uikit | 97 | 1% |
| insecure-sql-interpolated | 77 | 1% |
| eol-runner | 65 | 1% |
| hygiene-no-readme | 65 | 1% |
| ci-disabled | 44 | 1% |

## CI supply chain

- **83%** of 4602 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **64%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **67%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **41%** of 1445 Node.js projects still declare or test on an end-of-life Node version.
- **35%** of 979 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 7% |
| license | 5% |
| contributing | 6% |
| security | 3% |
| codeOfConduct | 3% |
| changelog | 2% |
| ci | 75% |
| tests | 68% |

## How old the debt is

- Median age of a TODO/FIXME: **3.5 years** (146204 dated).
- 38% of them are older than five years.

Oldest TODOs in the corpus:

- 25.4 y — libsdl-org-sdl-ttf `src/SDL_ttf.c:166`
- 23.9 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/reflect/MethodDelegate.java:24`
- 23.4 y — cglib-cglib `cglib/src/main/java/net/sf/cglib/beans/BeanMap.java:282`
- 23.3 y — cjlin1-libsvm `svm.cpp:2183`
- 23.3 y — cjlin1-libsvm `svm.cpp:3120`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 79): median score **93**.
- Quiet repos (< 10 commits, 6302): median score **79**.
- Mean findings per repo: active 9, quiet 60.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 2530 | 92 |
| 5k–50k | 2401 | 71 |
| 50k–200k | 1073 | 64 |
| > 200k | 506 | 64 |

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
| OpenSSF Scorecard | 96 | +2 | +4.3 | -1.00 |
| ESLint flat config | 382 | -6 | +2.1 | -0.34 |
| TypeScript | 693 | -1 | +1.2 | -0.01 |
| SECURITY.md | 1208 | -12 | +0.3 | -0.41 |
| Prettier | 403 | -8 | -0.8 | +0.23 |
| Renovate | 306 | -9 | -2.1 | +0.22 |
| .editorconfig | 1297 | -12 | -2.6 | -0.17 |
| CodeQL | 463 | -14 | -2.8 | +0.08 |
| CODEOWNERS | 690 | -13 | -3.2 | +0.14 |
| CONTRIBUTING | 2351 | -15 | -3.8 | -0.14 |
| Dev container | 307 | -14 | -3.9 | -0.08 |
| PR template | 1411 | -16 | -4.2 | -0.00 |
| Dependabot | 1566 | -14 | -4.3 | -0.01 |
| Changesets | 86 | -14 | -4.5 | +0.14 |
| Issue templates | 2286 | -17 | -6.3 | +0.31 |
| pre-commit | 369 | -13 | -6.5 | -0.44 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

58221 low-confidence findings were kept out of these numbers (13% of everything the scanners raised).
