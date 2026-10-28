# Scanner benchmark

220/220 repos scanned offline at pinned commits. Overall precision **81%** (354 TP, 83 FP, 12885 unlabelled, 3 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| dependency-funeral | 0% | 0 | 3 | 10 | 0 |
| env-lifecycle | 0% | 0 | 9 | 12 | 0 |
| secrets | 0% | 0 | 2 | 24 | 0 |
| leftover-debug | 27% | 4 | 11 | 215 | 0 |
| insecure-code | 29% | 10 | 24 | 156 | 0 |
| ci-health | 44% | 7 | 9 | 24 | 0 |
| dead-code | 53% | 10 | 9 | 439 | 0 |
| commented-code | 74% | 20 | 7 | 541 | 0 |
| repo-bloat | 75% | 6 | 2 | 88 | 0 |
| dockerfile | 86% | 6 | 1 | 7 | 0 |
| broken-doc-links | 90% | 9 | 1 | 743 | 0 |
| lockfile-drift | 90% | 9 | 1 | 7 | 0 |
| skipped-tests | 92% | 11 | 1 | 391 | 0 |
| duplicate-code | 94% | 29 | 2 | 1234 | 0 |
| workflow-security | 99% | 112 | 1 | 1937 | 0 |
| bus-factor | 100% | 22 | 0 | 1825 | 0 |
| config-conflict | 100% | 10 | 0 | 4 | 0 |
| docs-drift | 100% | 2 | 0 | 6 | 0 |
| eol-runtime | 100% | 38 | 0 | 348 | 0 |
| project-hygiene | 100% | 4 | 0 | 0 | 0 |
| todo-debt | 100% | 45 | 0 | 4874 | 0 |
| (gone) | — | 0 | 0 | 0 | 3 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 1 | 0 | 0 |
| dep-unused | 0% | 0 | 3 | 10 | 0 |
| env-dead | 0% | 0 | 3 | 6 | 0 |
| env-no-example | 0% | 0 | 6 | 6 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 1 | 0 | 0 |
| insecure-py-eval-exec | 0% | 0 | 2 | 24 | 0 |
| insecure-py-os-system | 0% | 0 | 2 | 0 | 0 |
| insecure-py-yaml-load | 0% | 0 | 2 | 1 | 0 |
| insecure-tls-verification-off | 0% | 0 | 1 | 1 | 0 |
| insecure-weak-hash | 0% | 0 | 1 | 0 | 0 |
| secret-generic | 0% | 0 | 1 | 0 | 0 |
| secret-history | 0% | 0 | 1 | 1 | 0 |
| workflow-script-injection | 0% | 0 | 1 | 0 | 0 |
| insecure-py-pickle-load | 17% | 1 | 5 | 13 | 0 |
| insecure-sql-interpolated | 25% | 1 | 3 | 54 | 0 |
| debug-leftover | 27% | 4 | 11 | 215 | 0 |
| ci-silenced-failure | 29% | 2 | 5 | 24 | 0 |
| ci-no-pr-trigger | 33% | 1 | 2 | 0 | 0 |
| insecure-react-dangerous-html | 33% | 1 | 2 | 8 | 0 |
| insecure-eval-dynamic | 50% | 1 | 1 | 32 | 0 |
| insecure-exec-interpolated | 50% | 1 | 1 | 7 | 0 |
| insecure-new-function | 50% | 3 | 3 | 16 | 0 |
| dead-export | 53% | 10 | 9 | 439 | 0 |
| ci-disabled | 67% | 2 | 1 | 0 | 0 |
| commented-code | 74% | 20 | 7 | 541 | 0 |
| bloat | 75% | 6 | 2 | 88 | 0 |
| docker-root | 75% | 3 | 1 | 6 | 0 |
| doc-link | 90% | 9 | 1 | 743 | 0 |
| lockfile-missing | 90% | 9 | 1 | 7 | 0 |
| skipped-test | 92% | 11 | 1 | 391 | 0 |
| duplicate | 94% | 29 | 2 | 1234 | 0 |
| bus-factor | 100% | 22 | 0 | 1825 | 0 |
| ci-swallowed | 100% | 2 | 0 | 0 | 0 |
| config-conflict | 100% | 10 | 0 | 4 | 0 |
| docker-latest | 100% | 2 | 0 | 0 | 0 |
| docker-untagged | 100% | 1 | 0 | 1 | 0 |
| docs-badge | 100% | 2 | 0 | 6 | 0 |
| eol-node | 100% | 21 | 0 | 294 | 0 |
| eol-python | 100% | 15 | 0 | 54 | 0 |
| eol-runner | 100% | 2 | 0 | 0 | 0 |
| hygiene-no-ci | 100% | 1 | 0 | 0 | 0 |
| hygiene-no-license | 100% | 2 | 0 | 0 | 0 |
| hygiene-no-readme | 100% | 1 | 0 | 0 | 0 |
| insecure-py-shell-true | 100% | 1 | 0 | 0 | 0 |
| insecure-py-verify-false | 100% | 1 | 0 | 0 | 0 |
| todo | 100% | 45 | 0 | 4874 | 0 |
| workflow-action-tag | 100% | 38 | 0 | 596 | 0 |
| workflow-action-tag-first-party | 100% | 50 | 0 | 1164 | 0 |
| workflow-no-permissions | 100% | 22 | 0 | 177 | 0 |
| workflow-pr-target-checkout | 100% | 2 | 0 | 0 | 0 |
| (gone) | — | 0 | 0 | 0 | 3 |
| secret-provider | — | 0 | 0 | 23 | 0 |
