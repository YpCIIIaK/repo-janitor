# What 1273 open-source repos look like

1273 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 384 | 30% |
| B | 348 | 27% |
| C | 369 | 29% |
| D | 147 | 12% |
| F | 25 | 2% |

Median score **79**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| TypeScript | 277 | 73 | 1.7 |
| JavaScript | 269 | 80 | 1.9 |
| Python | 178 | 82 | 1.1 |
| Go | 134 | 85 | 1.2 |
| other | 122 | 90 | 0.0 |
| PHP | 69 | 77 | 1.7 |
| Rust | 50 | 67 | 1.5 |
| Ruby | 41 | 83 | 1.6 |
| Java | 36 | 88 | 1.0 |
| C# | 25 | 68 | 1.8 |
| C | 24 | 77 | 1.6 |
| C++ | 16 | 76 | 2.8 |
| Kotlin | 12 | 71 | 1.2 |
| Swift | 12 | 87 | 0.8 |
| Scala | 5 | 61 | 5.9 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 868 | 68% |
| duplicate | 770 | 60% |
| workflow-action-tag-first-party | 746 | 59% |
| workflow-no-permissions | 678 | 53% |
| workflow-action-tag | 615 | 48% |
| todo | 516 | 41% |
| commented-code | 371 | 29% |
| eol-node | 305 | 24% |
| doc-link | 259 | 20% |
| dead-export | 226 | 18% |
| skipped-test | 189 | 15% |
| hygiene-no-tests | 188 | 15% |
| eol-python | 121 | 10% |
| hygiene-no-ci | 115 | 9% |
| config-conflict | 91 | 7% |
| lockfile-missing | 73 | 6% |
| docker-untagged | 66 | 5% |
| ci-silenced-failure | 49 | 4% |
| hygiene-no-license | 49 | 4% |
| docker-latest | 38 | 3% |
| env-missing | 33 | 3% |
| docs-badge | 31 | 2% |
| insecure-sql-interpolated | 22 | 2% |
| dead-uikit | 15 | 1% |
| workflow-pr-target-checkout | 13 | 1% |

## CI supply chain

- **72%** of 1119 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **55%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **61%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **9**.

## End-of-life runtimes

- **45%** of 650 Node.js projects still declare or test on an end-of-life Node version.
- **53%** of 178 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 100% |
| license | 93% |
| contributing | 54% |
| security | 32% |
| codeOfConduct | 26% |
| changelog | 42% |
| ci | 91% |
| tests | 84% |

## How old the debt is

- Median age of a TODO/FIXME: **3.4 years** (11992 dated).
- 34% of them are older than five years.

Oldest TODOs in the corpus:

- 18.6 y — sphinx-doc-sphinx `sphinx/ext/doctest.py:306`
- 18.4 y — sphinx-doc-sphinx `sphinx/writers/text.py:506`
- 18.4 y — sphinx-doc-sphinx `sphinx/writers/text.py:605`
- 18.0 y — sphinx-doc-sphinx `sphinx/writers/text.py:857`
- 16.9 y — sphinx-doc-sphinx `sphinx/builders/_epub_base.py:198`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 667): median score **75**.
- Quiet repos (< 10 commits, 330): median score **85**.
- Mean findings per repo: active 64, quiet 28.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 484 | 89 |
| 5k–50k | 469 | 76 |
| 50k–200k | 234 | 68 |
| > 200k | 86 | 72 |

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

- **0** webgoat-webgoat (116 findings)
- **0** digininja-dvwa (101 findings)
- **0** sasanlabs-vulnerableapp (98 findings)
- **0** sqlmapproject-testenv (103 findings)
- **0** aws-samples-serverless-patterns (167 findings)
- **0** docker-library-wordpress (32 findings)
- **0** posthog-charts-clickhouse (36 findings)
- **0** returntocorp-semgrep-rules (148 findings)
- **1** hashicorp-vault-guides (77 findings)
- **5** presidentbeef-inject-some-sql (59 findings)

## Do good practices go with healthier code?

Median gap between repos with and without a practice. *Raw* compares everyone; *same size* compares repos of similar size and averages the gaps, which removes the effect of big projects both adopting more and scoring lower. Density is findings per 1k lines — lower is better.

| practice | repos | score gap, raw | score gap, same size | findings/1k gap, same size |
|---|---:|---:|---:|---:|
| OpenSSF Scorecard | 43 | +10 | +10.7 | -1.22 |
| Dependabot | 475 | -3 | +1.1 | -0.30 |
| CodeQL | 156 | -3 | +1.0 | -0.27 |
| SECURITY.md | 380 | -6 | +0.8 | -0.36 |
| pre-commit | 123 | -4 | +0.0 | -1.12 |
| .editorconfig | 434 | -5 | -0.3 | -0.41 |
| ESLint flat config | 157 | -6 | -1.1 | -0.05 |
| Dev container | 110 | -6 | -1.9 | -0.08 |
| Renovate | 98 | -3 | -2.3 | +0.06 |
| Prettier | 169 | -6 | -3.2 | +0.27 |
| TypeScript | 267 | -5 | -3.2 | +0.06 |
| PR template | 420 | -10 | -3.3 | +0.45 |
| CODEOWNERS | 212 | -8 | -4.1 | +0.45 |
| CONTRIBUTING | 616 | -11 | -4.1 | -0.03 |
| Issue templates | 589 | -13 | -6.7 | +0.19 |
| Changesets | 43 | -15 | -9.6 | +0.65 |

Correlation, not causation: projects that add Dependabot are also the ones that care in other ways.

## Noise the confidence scale hides

10594 low-confidence findings were kept out of these numbers (15% of everything the scanners raised).
