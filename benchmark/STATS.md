# What 6507 open-source repos look like

6507 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

Identity audit: **6500 distinct GitHub repositories** in 6507 pinned records; 7 legacy alias records are retained.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 2104 | 32% |
| B | 1558 | 24% |
| C | 1801 | 28% |
| D | 907 | 14% |
| F | 137 | 2% |

Median score **80**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| Python | 982 | 83 | 2.1 |
| TypeScript | 741 | 76 | 1.8 |
| JavaScript | 657 | 83 | 2.0 |
| Go | 564 | 76 | 1.5 |
| other | 544 | 96 | 0.0 |
| Java | 388 | 78 | 2.3 |
| Rust | 362 | 66 | 1.8 |
| PHP | 333 | 82 | 1.9 |
| Swift | 329 | 85 | 2.2 |
| Kotlin | 313 | 74 | 2.1 |
| C++ | 311 | 64 | 2.1 |
| C# | 291 | 75 | 1.6 |
| Ruby | 277 | 82 | 2.2 |
| C | 256 | 72 | 1.3 |
| Scala | 112 | 64 | 2.6 |
| Vue | 40 | 81 | 3.4 |
| Svelte | 7 | 89 | 5.6 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| duplicate | 4341 | 67% |
| bus-factor | 4275 | 66% |
| workflow-action-tag-first-party | 3600 | 55% |
| todo | 3297 | 51% |
| workflow-no-permissions | 3076 | 47% |
| workflow-action-tag | 2915 | 45% |
| commented-code | 1883 | 29% |
| hygiene-no-tests | 1781 | 27% |
| hygiene-no-ci | 1623 | 25% |
| dead-export | 1215 | 19% |
| doc-link | 1206 | 19% |
| eol-node | 858 | 13% |
| hygiene-no-license | 711 | 11% |
| eol-python | 542 | 8% |
| skipped-test | 469 | 7% |
| config-conflict | 359 | 6% |
| lockfile-missing | 251 | 4% |
| ci-no-pr-trigger | 223 | 3% |
| docker-latest | 160 | 2% |
| docs-badge | 134 | 2% |
| dead-uikit | 95 | 1% |
| insecure-sql-interpolated | 75 | 1% |
| hygiene-no-readme | 71 | 1% |
| eol-runner | 65 | 1% |
| docker-add-url | 44 | 1% |

## CI supply chain

- **83%** of 4599 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **63%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **67%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **39%** of 2087 Node.js projects still declare or test on an end-of-life Node version.
- **36%** of 982 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 87% |
| contributing | 39% |
| security | 19% |
| codeOfConduct | 18% |
| changelog | 31% |
| ci | 75% |
| tests | 71% |

## How old the debt is

- Median age of a TODO/FIXME: **3.6 years** (148015 dated).
- 39% of them are older than five years.

Oldest TODOs in the corpus:

- 26.7 y — apache-xerces2-j `src/org/apache/xml/serialize/HTMLSerializer.java:865`
- 26.7 y — apache-xerces2-j `src/org/apache/xml/serialize/OutputFormat.java:868`
- 25.8 y — apache-xerces2-j `src/org/apache/xerces/jaxp/DefaultValidationErrorHandler.java:32`
- 25.8 y — apache-xerces2-j `src/org/apache/xerces/jaxp/SAXParserFactoryImpl.java:134`
- 25.8 y — apache-xerces2-j `src/org/apache/xerces/jaxp/SAXParserImpl.java:207`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 2750): median score **70**.
- Quiet repos (< 10 commits, 2382): median score **87**.
- Mean findings per repo: active 90, quiet 36.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 2573 | 92 |
| 5k–50k | 2349 | 71 |
| 50k–200k | 1081 | 64 |
| > 200k | 504 | 64 |

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
| OpenSSF Scorecard | 96 | 0 | +5.4 | -1.15 |
| ESLint flat config | 387 | -6 | +2.8 | -0.40 |
| TypeScript | 695 | -1 | +1.2 | -0.05 |
| SECURITY.md | 1203 | -12 | +0.2 | -0.38 |
| Prettier | 410 | -7 | -0.4 | +0.12 |
| Renovate | 311 | -9 | -2.1 | +0.30 |
| CodeQL | 462 | -14 | -2.4 | +0.02 |
| .editorconfig | 1295 | -12 | -2.4 | -0.14 |
| CODEOWNERS | 704 | -12 | -3.0 | +0.22 |
| Changesets | 85 | -14 | -3.6 | +0.08 |
| PR template | 1416 | -16 | -3.7 | +0.05 |
| Dev container | 311 | -14 | -3.7 | -0.10 |
| CONTRIBUTING | 2332 | -16 | -4.4 | -0.14 |
| Dependabot | 1559 | -14 | -4.6 | +0.06 |
| pre-commit | 375 | -12 | -5.8 | -0.43 |
| Issue templates | 2259 | -18 | -6.3 | +0.35 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

57095 low-confidence findings were kept out of these numbers (13% of everything the scanners raised).
