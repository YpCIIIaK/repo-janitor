# What 10007 open-source repos look like

10007 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

Identity audit: **10000 distinct GitHub repositories** in 10007 pinned records; 7 legacy alias records are retained.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 3432 | 34% |
| B | 2594 | 26% |
| C | 2628 | 26% |
| D | 1175 | 12% |
| F | 178 | 2% |

Median score **82**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| Python | 1417 | 84 | 2.3 |
| TypeScript | 1176 | 81 | 2.1 |
| JavaScript | 1028 | 85 | 2.3 |
| Go | 941 | 82 | 1.6 |
| other | 696 | 94 | 0.0 |
| Java | 647 | 79 | 2.4 |
| Rust | 631 | 68 | 2.0 |
| PHP | 608 | 83 | 2.2 |
| C++ | 503 | 67 | 2.1 |
| C# | 497 | 79 | 2.1 |
| Swift | 474 | 88 | 2.2 |
| Kotlin | 454 | 80 | 2.3 |
| Ruby | 422 | 84 | 2.6 |
| C | 317 | 73 | 1.3 |
| Scala | 196 | 66 | 3.8 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| duplicate | 6616 | 66% |
| bus-factor | 6300 | 63% |
| workflow-action-tag-first-party | 5551 | 55% |
| workflow-no-permissions | 4681 | 47% |
| todo | 4640 | 46% |
| workflow-action-tag | 4496 | 45% |
| hygiene-no-tests | 2751 | 27% |
| commented-code | 2671 | 27% |
| hygiene-no-ci | 2608 | 26% |
| dead-export | 1800 | 18% |
| doc-link | 1712 | 17% |
| eol-node | 1214 | 12% |
| hygiene-no-license | 1119 | 11% |
| eol-python | 743 | 7% |
| skipped-test | 562 | 6% |
| config-conflict | 516 | 5% |
| lockfile-missing | 433 | 4% |
| ci-no-pr-trigger | 378 | 4% |
| docker-latest | 214 | 2% |
| docs-badge | 175 | 2% |
| dead-uikit | 149 | 1% |
| insecure-sql-interpolated | 102 | 1% |
| hygiene-no-readme | 94 | 1% |
| eol-runner | 87 | 1% |
| docs-script | 58 | 1% |

## CI supply chain

- **84%** of 6987 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **64%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **67%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **8**.

## End-of-life runtimes

- **36%** of 3147 Node.js projects still declare or test on an end-of-life Node version.
- **34%** of 1417 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 2% |
| license | 1% |
| contributing | 4% |
| security | 2% |
| codeOfConduct | 2% |
| changelog | 0% |
| ci | 74% |
| tests | 66% |

## How old the debt is

- Median age of a TODO/FIXME: **3.4 years** (179175 dated).
- 37% of them are older than five years.

Oldest TODOs in the corpus:

- 26.7 y — apache-xerces2-j `src/org/apache/xml/serialize/HTMLSerializer.java:865`
- 26.7 y — apache-xerces2-j `src/org/apache/xml/serialize/OutputFormat.java:868`
- 26.0 y — orocos-toolchain-log4cpp `src/NDC.cpp:125`
- 25.8 y — apache-xerces2-j `src/org/apache/xerces/jaxp/DefaultValidationErrorHandler.java:32`
- 25.8 y — apache-xerces2-j `src/org/apache/xerces/jaxp/SAXParserFactoryImpl.java:134`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 17): median score **94**.
- Quiet repos (< 10 commits, 9952): median score **82**.
- Mean findings per repo: active 29, quiet 51.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 4175 | 91 |
| 5k–50k | 3730 | 73 |
| 50k–200k | 1472 | 66 |
| > 200k | 630 | 66 |

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
| OpenSSF Scorecard | 123 | +1 | +6.4 | -1.11 |
| TypeScript | 1077 | 0 | +1.7 | +0.06 |
| SECURITY.md | 1567 | -9 | +1.0 | -0.47 |
| ESLint flat config | 524 | -4 | +0.7 | -0.47 |
| Prettier | 584 | -7 | -2.9 | +0.49 |
| CodeQL | 585 | -13 | -3.3 | -0.02 |
| Renovate | 468 | -4 | -3.4 | +0.41 |
| .editorconfig | 1760 | -9 | -3.5 | +0.09 |
| CODEOWNERS | 967 | -12 | -4.1 | +0.14 |
| CONTRIBUTING | 3151 | -13 | -4.3 | -0.12 |
| PR template | 1791 | -15 | -4.8 | +0.04 |
| Dependabot | 2174 | -12 | -4.9 | +0.10 |
| Dev container | 383 | -15 | -5.1 | -0.04 |
| Issue templates | 2892 | -17 | -6.0 | +0.30 |
| Changesets | 107 | -16 | -6.2 | +0.18 |
| pre-commit | 492 | -14 | -7.4 | -0.09 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

78862 low-confidence findings were kept out of these numbers (13% of everything the scanners raised).
