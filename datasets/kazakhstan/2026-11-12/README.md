# Kazakhstan cluster — 12 November 2026

## Snapshot

| Item | Count |
|---|---:|
| Unique repositories processed | 635 |
| Repositories still pending | 0 |
| Empty repositories without Git refs | 4 |
| GitHub forks | 63 |
| GitHub archived repositories | 5 |
| Automatic signals | 13,867 |
| Normal-visibility signals | 11,663 |
| Low-confidence signals | 2,204 |

Fork and archive categories can overlap. The count is repositories, not independent products or deployed services. An empty repository was checked for refs and scanned as an empty local Git repository; it has no source SHA.

## Files

- [repositories.csv](repositories.csv) / [JSON](repositories.json): all 635 repositories, fixed source revisions where available, primary GitHub language, scan status, and affiliation qualifications.
- [findings.csv](findings.csv) / [JSON](findings.json): all automatic signals, with source links and batch identifiers. Secret values and evidence snippets are omitted.
- [technologies.csv](technologies.csv) / [JSON](technologies.json): one primary GitHub language per repository, so the counts sum to 635. This is not the complete framework or dependency stack. GitHub supplied no primary language for 67 repositories.
- [summary.json](summary.json): machine-readable totals.
- [companies/](companies/): 169 companies from a preliminary selection of 100 plus all previous 80, with 11 normalized-name overlaps. The 100 are a research shortlist, **not a verified ranking of the largest companies**. Size evidence distinguishes international groups from local entities.
- [batches/](batches/): scan provenance and selected manual reviews. Not every scanner version or method was identical across historical batches; retain the batch and source revision when interpreting a finding.

## Latest batches

The final queue contained 343 repositories because six of the previously pending 349 had already been scanned separately. Of the 343, 339 had source revisions and four were empty. This batch produced 6,168 normal signals and 1,065 low-confidence signals, including 784 matches from security and supply-chain scanners. These are not confirmed vulnerabilities.

The separate six-repository batch produced 63 normal signals and 20 low-confidence signals. Notebook code extraction for two repositories is documented in its provenance file.

## Interpretation and scope

Scans ran locally in offline mode. Target dependencies, code, tests, and CI scripts were not executed. No production endpoints were probed and no credential values were validated. Online vulnerability databases, current dependency versions, and external-link availability were not refreshed. File, size, language, history, and per-rule limits apply; absence of a signal is not proof of safety. Archive contents, databases, and datasets were not separately inspected.

Most findings are maintenance signals. Scanner severity and a repository's health score do not establish exploitability. Review [the selected manual checks for the 343 batch](batches/remaining-343/manual-review.md) and [the six-repository batch](batches/telecom-atomic-six/manual-review.json) for examples where context changes the interpretation. Source-code facts, conditional risks, false positives, and deployed vulnerabilities must remain distinct.

GitHub account affiliation is qualified in the inventory. Some records are international group accounts, personal projects, unconfirmed company-name matches, research, training, or documentation. No assertion is made that all 635 belong to Kazakhstan companies or are in production.

Raw scan reports, target clones, target source snapshots, raw uploads, credential-like values, and unrelated workspace data are not included. Local paths to unpublished raw reports have been removed from published batch manifests.

## Validate or continue

Run `python3 validate.py` from this directory. It checks totals, uniqueness, source-pin consistency, membership, and secret-field omission without network access or target execution.

Use `repositories.json` as the canonical inventory for future discovery, deduplicate by GitHub ID and normalized full name, and preserve affiliation qualifications. This queue is complete: begin a new batch for newly discovered repositories. Record scanner revision, source SHA, coverage limitations, and manual review status separately. Do not overwrite this dated snapshot with newer results.
