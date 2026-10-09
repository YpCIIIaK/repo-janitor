# Scanner benchmark

20/20 repos scanned offline at pinned commits. Overall precision **91%** (165 TP, 16 FP, 305 unlabelled, 0 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| env-lifecycle | 0% | 0 | 3 | 0 | 0 |
| secrets | 0% | 0 | 6 | 1 | 0 |
| leftover-debug | 25% | 1 | 3 | 0 | 0 |
| docs-drift | 50% | 1 | 1 | 0 | 0 |
| dead-code | 75% | 3 | 1 | 0 | 0 |
| commented-code | 90% | 9 | 1 | 44 | 0 |
| bus-factor | 91% | 10 | 1 | 58 | 0 |
| broken-doc-links | 100% | 5 | 0 | 1 | 0 |
| dockerfile | 100% | 2 | 0 | 0 | 0 |
| duplicate-code | 100% | 16 | 0 | 43 | 0 |
| eol-runtime | 100% | 14 | 0 | 8 | 0 |
| insecure-code | 100% | 2 | 0 | 0 | 0 |
| lockfile-drift | 100% | 2 | 0 | 0 | 0 |
| repo-bloat | 100% | 1 | 0 | 0 | 0 |
| skipped-tests | 100% | 2 | 0 | 0 | 0 |
| todo-debt | 100% | 30 | 0 | 77 | 0 |
| workflow-security | 100% | 67 | 0 | 73 | 0 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| docs-script | 0% | 0 | 1 | 0 | 0 |
| env-no-example | 0% | 0 | 3 | 0 | 0 |
| secret-history | 0% | 0 | 1 | 0 | 0 |
| secret-provider | 0% | 0 | 5 | 1 | 0 |
| debug-leftover | 25% | 1 | 3 | 0 | 0 |
| dead-export | 75% | 3 | 1 | 0 | 0 |
| commented-code | 90% | 9 | 1 | 44 | 0 |
| bus-factor | 91% | 10 | 1 | 58 | 0 |
| bloat | 100% | 1 | 0 | 0 | 0 |
| doc-link | 100% | 5 | 0 | 1 | 0 |
| docker-latest | 100% | 1 | 0 | 0 | 0 |
| docker-root | 100% | 1 | 0 | 0 | 0 |
| docs-badge | 100% | 1 | 0 | 0 | 0 |
| duplicate | 100% | 16 | 0 | 43 | 0 |
| eol-node | 100% | 6 | 0 | 0 | 0 |
| eol-python | 100% | 8 | 0 | 8 | 0 |
| insecure-new-function | 100% | 1 | 0 | 0 | 0 |
| insecure-react-dangerous-html | 100% | 1 | 0 | 0 | 0 |
| lockfile-missing | 100% | 2 | 0 | 0 | 0 |
| skipped-test | 100% | 2 | 0 | 0 | 0 |
| todo | 100% | 30 | 0 | 77 | 0 |
| workflow-action-tag | 100% | 23 | 0 | 25 | 0 |
| workflow-action-tag-first-party | 100% | 35 | 0 | 48 | 0 |
| workflow-no-permissions | 100% | 9 | 0 | 0 | 0 |
