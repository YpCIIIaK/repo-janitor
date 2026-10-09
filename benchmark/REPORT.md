# Scanner benchmark

20/20 repos scanned offline at pinned commits. Overall precision **48%** (161 TP, 174 FP, 1020 unlabelled, 0 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-health | 0% | 0 | 4 | 0 | 0 |
| dead-code | 0% | 0 | 15 | 466 | 0 |
| env-lifecycle | 0% | 0 | 12 | 0 | 0 |
| leftover-debug | 0% | 0 | 28 | 116 | 0 |
| project-hygiene | 0% | 0 | 6 | 0 | 0 |
| secrets | 0% | 0 | 9 | 1 | 0 |
| insecure-code | 10% | 2 | 18 | 26 | 0 |
| bus-factor | 21% | 10 | 38 | 137 | 0 |
| lockfile-drift | 22% | 2 | 7 | 0 | 0 |
| skipped-tests | 40% | 2 | 3 | 17 | 0 |
| commented-code | 43% | 9 | 12 | 47 | 0 |
| docs-drift | 50% | 1 | 1 | 0 | 0 |
| duplicate-code | 59% | 16 | 11 | 41 | 0 |
| broken-doc-links | 83% | 5 | 1 | 1 | 0 |
| workflow-security | 89% | 67 | 8 | 75 | 0 |
| todo-debt | 97% | 30 | 1 | 85 | 0 |
| dockerfile | 100% | 2 | 0 | 0 | 0 |
| eol-runtime | 100% | 14 | 0 | 8 | 0 |
| repo-bloat | 100% | 1 | 0 | 0 | 0 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 4 | 0 | 0 |
| dead-export | 0% | 0 | 15 | 466 | 0 |
| debug-leftover | 0% | 0 | 28 | 116 | 0 |
| docs-script | 0% | 0 | 1 | 0 | 0 |
| env-no-example | 0% | 0 | 12 | 0 | 0 |
| hygiene-no-license | 0% | 0 | 2 | 0 | 0 |
| hygiene-no-readme | 0% | 0 | 1 | 0 | 0 |
| hygiene-no-tests | 0% | 0 | 3 | 0 | 0 |
| insecure-py-pickle-load | 0% | 0 | 8 | 8 | 0 |
| insecure-random-for-secret | 0% | 0 | 1 | 0 | 0 |
| insecure-tls-verification-off | 0% | 0 | 6 | 16 | 0 |
| insecure-weak-hash | 0% | 0 | 3 | 2 | 0 |
| secret-generic | 0% | 0 | 2 | 0 | 0 |
| secret-history | 0% | 0 | 2 | 0 | 0 |
| secret-provider | 0% | 0 | 5 | 1 | 0 |
| bus-factor | 21% | 10 | 38 | 137 | 0 |
| lockfile-missing | 22% | 2 | 7 | 0 | 0 |
| skipped-test | 40% | 2 | 3 | 17 | 0 |
| commented-code | 43% | 9 | 12 | 47 | 0 |
| workflow-no-permissions | 53% | 9 | 8 | 2 | 0 |
| duplicate | 59% | 16 | 11 | 41 | 0 |
| doc-link | 83% | 5 | 1 | 1 | 0 |
| todo | 97% | 30 | 1 | 85 | 0 |
| bloat | 100% | 1 | 0 | 0 | 0 |
| docker-latest | 100% | 1 | 0 | 0 | 0 |
| docker-root | 100% | 1 | 0 | 0 | 0 |
| docs-badge | 100% | 1 | 0 | 0 | 0 |
| eol-node | 100% | 6 | 0 | 0 | 0 |
| eol-python | 100% | 8 | 0 | 8 | 0 |
| insecure-new-function | 100% | 1 | 0 | 0 | 0 |
| insecure-react-dangerous-html | 100% | 1 | 0 | 0 | 0 |
| workflow-action-tag | 100% | 23 | 0 | 25 | 0 |
| workflow-action-tag-first-party | 100% | 35 | 0 | 48 | 0 |
