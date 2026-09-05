# Product review · 5 September 2026

## Positioning

Repo Anti-Rot should compete as a low-friction repository maintenance monitor:
paste a public repository URL, get an explainable health report, prioritize work,
and detect regression. Its distinctive combination is aging TODOs, stale branches,
environment drift, abandoned dependencies, ownership concentration and security
signals in one lightweight workflow, with a CLI and shareable cards.

It should not claim to replace deep SAST or prove that an A-grade repository is
secure. A grade summarizes findings from the selected checks and available data.

## Reference products and implications

| Product | Relevant capability | Implication for Repo Anti-Rot |
| --- | --- | --- |
| [SonarQube](https://docs.sonarsource.com/sonarqube/latest/analysis/pull-request) | Pull-request analysis focuses on introduced issues | Gate new debt separately from the old backlog; make incomplete analysis visible |
| [Qodana](https://www.jetbrains.com/help/qodana/about-qodana.html) | Baselines, quality gates and quick fixes | Reports need an actionable remediation path, not just a score |
| [Renovate](https://docs.renovatebot.com/) | Updates dependencies and lockfiles through pull requests | Integrate with an updater rather than inventing an unsafe generic version bump |
| [GitHub Autofix](https://docs.github.com/en/code-security/concepts/code-scanning/autofix-for-code-scanning) | Generates candidate fixes; agentic mode can validate and open a PR | AI advice must be distinguished from verified fixes; evidence and validation matter |

Sources describe capabilities, not a claim of price or edition parity. Product
editions change; consult their current documentation before publishing comparisons.

## Implemented in this change

- Removed Audit Market from the dashboard and API; kept the separate auditscout project.
- Added a deterministic, bilingual action plan with verification steps and individual
  projected score gains. No runtime estimate is presented as measured work.
- Added CLI `--baseline`, `--fail-on-new` and `--min-score`, with exit 2 for a failed gate.
- Kept JSON stdout machine-readable; operational messages go to stderr.
- Added completed/failed scanner metadata and shallow-history disclosure.
- Added optional hosted AI recommendations: visitor opt-in, fixed model, bounded
  output, no tools, no source/evidence fields, persistent daily request allowance,
  duplicate-request coalescing and cache. User-supplied OpenRouter keys still work.
- Removed instructions that forced the AI to invent certainty with insufficient context.
- Restricted email watches to a verified GitHub address; protected management tokens,
  preserved notification retries after delivery failures and prevented overlapping cron batches.
- Prepared a single-instance Docker deployment, persistent data, serialized atomic
  writes, authenticated backups, a maintenance loop, domain/HTTPS proxy and key setup.
- Hardened public API auth, mutation origins, selected request-body limits, clone
  host policy, child-process environment, output capture, cancellation, filesystem
  boundaries and scanner network requests including redirects/DNS rebinding.

## Next priorities, with acceptance criteria

1. **Detection precision benchmark.** Maintain positive and negative fixtures from
   real false-positive reports per scanner. Publish methodology and regression rates,
   rather than treating the count of scanners as a quality metric.
2. **GitHub App installation.** Repository-scoped installation permissions, verified
   webhook signatures, deduplication and per-repository ownership. Do not reuse a
   broad operator PAT to scan private repositories for anonymous visitors.
3. **Durable scan jobs and isolated workers.** Persist job states, retry only
   idempotent work, recover after restart and place workers on a restricted network.
   The current single-process queue is bounded but is not a durable job queue.
4. **Verified remediation PRs.** Begin with narrow transformations and Renovate
   integration. Generate a diff, rerun the affected checks in an isolated worker,
   and require repository authorization before opening or merging a PR.
5. **Team workflows.** Authenticated repository ownership, roles, shared baselines,
   accepted-risk reasons and expiry, audit history. Current browser reports are local
   to the browser; OAuth sign-in does not imply a team workspace.
6. **Operational metrics.** Queue latency, failures by scanner, provider errors,
   scan duration and storage growth, with retention limits. Avoid logging code,
   credentials, complete request bodies or share/manage tokens.

## Launch boundaries

This is a public-beta foundation, not an independent penetration-test certificate.
The implemented unit/integration checks cannot prove absence of vulnerabilities.
Before moving the domain, validate the Docker image on the actual host, restore a
backup into a separate volume, configure verified mail/OAuth if enabled, and perform
a load test using the server's actual memory and CPU allocation. Do not scale the
filesystem backend to multiple app replicas: its transaction lock is process-local.
