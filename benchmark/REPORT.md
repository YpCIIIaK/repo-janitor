# Scanner benchmark

120/120 repos scanned offline at pinned commits. Overall precision **88%** (303 TP, 42 FP, 4189 unlabelled, 3 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| env-lifecycle | 0% | 0 | 3 | 4 | 0 |
| leftover-debug | 10% | 1 | 9 | 300 | 0 |
| ci-health | 43% | 3 | 4 | 3 | 0 |
| insecure-code | 47% | 7 | 8 | 6 | 0 |
| dead-code | 56% | 9 | 7 | 30 | 0 |
| commented-code | 79% | 19 | 5 | 181 | 0 |
| repo-bloat | 80% | 4 | 1 | 15 | 0 |
| lockfile-drift | 86% | 6 | 1 | 0 | 0 |
| skipped-tests | 89% | 8 | 1 | 100 | 0 |
| broken-doc-links | 90% | 9 | 1 | 285 | 0 |
| duplicate-code | 93% | 26 | 2 | 485 | 0 |
| bus-factor | 100% | 19 | 0 | 691 | 0 |
| config-conflict | 100% | 7 | 0 | 0 | 0 |
| dockerfile | 100% | 6 | 0 | 3 | 0 |
| docs-drift | 100% | 2 | 0 | 11 | 0 |
| eol-runtime | 100% | 31 | 0 | 96 | 0 |
| project-hygiene | 100% | 1 | 0 | 0 | 0 |
| todo-debt | 100% | 42 | 0 | 993 | 0 |
| workflow-security | 100% | 103 | 0 | 962 | 0 |
| (gone) | — | 0 | 0 | 0 | 3 |
| secrets | — | 0 | 0 | 24 | 0 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-disabled | 0% | 0 | 1 | 0 | 0 |
| env-no-example | 0% | 0 | 3 | 4 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 1 | 0 | 0 |
| insecure-py-eval-exec | 0% | 0 | 1 | 6 | 0 |
| insecure-py-os-system | 0% | 0 | 2 | 0 | 0 |
| debug-leftover | 10% | 1 | 9 | 300 | 0 |
| insecure-py-pickle-load | 20% | 1 | 4 | 0 | 0 |
| ci-silenced-failure | 25% | 1 | 3 | 3 | 0 |
| dead-export | 56% | 9 | 7 | 30 | 0 |
| commented-code | 79% | 19 | 5 | 181 | 0 |
| bloat | 80% | 4 | 1 | 15 | 0 |
| lockfile-missing | 86% | 6 | 1 | 0 | 0 |
| skipped-test | 89% | 8 | 1 | 100 | 0 |
| doc-link | 90% | 9 | 1 | 285 | 0 |
| duplicate | 93% | 26 | 2 | 485 | 0 |
| bus-factor | 100% | 19 | 0 | 691 | 0 |
| ci-swallowed | 100% | 2 | 0 | 0 | 0 |
| config-conflict | 100% | 7 | 0 | 0 | 0 |
| docker-latest | 100% | 2 | 0 | 0 | 0 |
| docker-root | 100% | 3 | 0 | 3 | 0 |
| docker-untagged | 100% | 1 | 0 | 0 | 0 |
| docs-badge | 100% | 2 | 0 | 5 | 0 |
| eol-node | 100% | 18 | 0 | 60 | 0 |
| eol-python | 100% | 12 | 0 | 36 | 0 |
| eol-runner | 100% | 1 | 0 | 0 | 0 |
| hygiene-no-ci | 100% | 1 | 0 | 0 | 0 |
| insecure-eval-dynamic | 100% | 1 | 0 | 0 | 0 |
| insecure-new-function | 100% | 3 | 0 | 0 | 0 |
| insecure-py-verify-false | 100% | 1 | 0 | 0 | 0 |
| insecure-sql-interpolated | 100% | 1 | 0 | 0 | 0 |
| todo | 100% | 42 | 0 | 993 | 0 |
| workflow-action-tag | 100% | 35 | 0 | 294 | 0 |
| workflow-action-tag-first-party | 100% | 47 | 0 | 590 | 0 |
| workflow-no-permissions | 100% | 19 | 0 | 78 | 0 |
| workflow-pr-target-checkout | 100% | 2 | 0 | 0 | 0 |
| (gone) | — | 0 | 0 | 0 | 3 |
| docs-manager | — | 0 | 0 | 6 | 0 |
| secret-history | — | 0 | 0 | 1 | 0 |
| secret-provider | — | 0 | 0 | 23 | 0 |
