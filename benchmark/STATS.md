# What 515 open-source repos look like

515 public repositories, scanned offline at pinned commits by repo-janitor. Only findings a user sees by default (high + medium confidence) are counted.

## Grades

| grade | repos | share |
|---|---:|---:|
| A | 124 | 24% |
| B | 120 | 23% |
| C | 109 | 21% |
| D | 127 | 25% |
| F | 35 | 7% |

Median score **70**.

## By main language

| language | repos | median score | findings / 1k lines |
|---|---:|---:|---:|
| JavaScript | 160 | 82 | 1.8 |
| TypeScript | 113 | 68 | 1.5 |
| Python | 81 | 65 | 1.4 |
| Go | 44 | 70 | 1.4 |
| Rust | 28 | 58 | 1.5 |
| Ruby | 18 | 74 | 1.1 |
| Java | 16 | 59 | 0.8 |
| PHP | 15 | 76 | 0.5 |
| C# | 12 | 64 | 1.3 |
| Kotlin | 8 | 54 | 1.2 |
| C++ | 6 | 62 | 2.1 |
| Swift | 6 | 66 | 1.5 |

## How common each problem is

Share of repos with at least one finding of the rule.

| rule | repos | share |
|---|---:|---:|
| bus-factor | 379 | 74% |
| todo | 360 | 70% |
| duplicate | 336 | 65% |
| workflow-action-tag-first-party | 312 | 61% |
| workflow-no-permissions | 240 | 47% |
| workflow-action-tag | 224 | 43% |
| eol-node | 166 | 32% |
| commented-code | 163 | 32% |
| skipped-test | 102 | 20% |
| doc-link | 100 | 19% |
| dead-export | 66 | 13% |
| eol-python | 61 | 12% |
| bloat | 55 | 11% |
| lockfile-missing | 46 | 9% |
| config-conflict | 37 | 7% |
| hygiene-no-tests | 27 | 5% |
| hygiene-no-ci | 20 | 4% |
| secret-provider | 15 | 3% |
| ci-silenced-failure | 13 | 3% |
| docs-badge | 9 | 2% |
| hygiene-no-license | 8 | 2% |
| secret-generic | 8 | 2% |
| docker-latest | 5 | 1% |
| eol-runner | 5 | 1% |
| ci-disabled | 5 | 1% |

## CI supply chain

- **69%** of 472 repos with GitHub Actions pin at least one action to a mutable tag instead of a commit SHA.
- **47%** do it for a *third-party* action — the tj-actions/changed-files attack vector.
- **51%** have a workflow that never restricts its token permissions.
- Median unpinned actions per repo: **7**.

## End-of-life runtimes

- **54%** of 298 Node.js projects still declare or test on an end-of-life Node version.
- **69%** of 81 Python projects still support an end-of-life Python.
- **1%** of all repos run CI on a retired runner image.

## Project hygiene

| has | share |
|---|---:|
| readme | 99% |
| license | 93% |
| contributing | 60% |
| security | 42% |
| codeOfConduct | 28% |
| changelog | 51% |
| ci | 96% |
| tests | 92% |

## How old the debt is

- Median age of a TODO/FIXME: **4.0 years** (10868 dated).
- 41% of them are older than five years.

Oldest TODOs in the corpus:

- 23.1 y — dateutil-dateutil `src/dateutil/rrule.py:1199`
- 23.0 y — paramiko-paramiko `paramiko/ber.py:71`
- 21.8 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestCopticChronology.java:405`
- 21.1 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestEthiopicChronology.java:405`
- 20.9 y — jodaorg-joda-time `src/test/java/org/joda/time/chrono/TestIslamicChronology.java:419`

## Does activity mean health?

- Active repos (≥ 50 commits last year, 269): median score **62**.
- Quiet repos (< 10 commits, 124): median score **84**.
- Mean findings per repo: active 73, quiet 30.

## Size vs score

| size | repos | median score |
|---|---:|---:|
| < 5k lines | 127 | 91 |
| 5k–50k | 246 | 74 |
| 50k–200k | 120 | 51 |
| > 200k | 22 | 46 |

## Cleanest repos

- **100** ai-nanoid (0 findings)
- **100** jshttp-cookie (0 findings)
- **100** jonschlinkert-is-number (0 findings)
- **100** fastify-fastify-cors (0 findings)
- **100** fastify-fastify-static (0 findings)
- **100** express (1 findings)
- **100** rust-lang-log (1 findings)
- **100** pyca-bcrypt (1 findings)
- **100** semantic-release-semantic-release (1 findings)
- **100** marcbachmann-node-html-pdf (1 findings)

## Most to clean up

- **0** plotly-dash-sample-apps (153 findings)
- **0** webgoat-webgoat (140 findings)
- **0** digininja-dvwa (105 findings)
- **0** juice-shop-juice-shop (150 findings)
- **0** google-dagger (704 findings)
- **15** sequelize-sequelize (440 findings)
- **15** assertj-assertj (267 findings)
- **16** web2py-web2py (295 findings)
- **20** qwikdev-qwik (363 findings)
- **21** lit-lit (418 findings)

## Noise the confidence scale hides

1719 low-confidence findings were kept out of these numbers (6% of everything the scanners raised).
