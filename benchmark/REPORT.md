# Scanner benchmark

320/320 repos scanned offline at pinned commits. Overall precision **76%** (408 TP, 127 FP, 16556 unlabelled, 4 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| dependency-funeral | 0% | 0 | 6 | 34 | 0 |
| env-lifecycle | 0% | 0 | 12 | 13 | 0 |
| secrets | 0% | 0 | 3 | 26 | 0 |
| leftover-debug | 22% | 4 | 14 | 403 | 0 |
| insecure-code | 23% | 12 | 40 | 167 | 0 |
| ci-health | 32% | 8 | 17 | 27 | 0 |
| dead-code | 50% | 11 | 11 | 569 | 0 |
| dockerfile | 64% | 7 | 4 | 7 | 0 |
| repo-bloat | 64% | 7 | 4 | 107 | 0 |
| commented-code | 75% | 21 | 7 | 733 | 0 |
| broken-doc-links | 77% | 10 | 3 | 882 | 0 |
| project-hygiene | 91% | 10 | 1 | 2 | 0 |
| lockfile-drift | 92% | 12 | 1 | 13 | 0 |
| skipped-tests | 93% | 14 | 1 | 473 | 0 |
| duplicate-code | 94% | 32 | 2 | 1621 | 0 |
| workflow-security | 99% | 121 | 1 | 2575 | 0 |
| bus-factor | 100% | 25 | 0 | 2390 | 0 |
| config-conflict | 100% | 13 | 0 | 12 | 0 |
| docs-drift | 100% | 6 | 0 | 8 | 0 |
| eol-runtime | 100% | 47 | 0 | 483 | 0 |
| todo-debt | 100% | 48 | 0 | 6011 | 0 |
| (gone) | — | 0 | 0 | 0 | 4 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 4 | 0 | 0 |
| dep-unused | 0% | 0 | 6 | 34 | 0 |
| env-dead | 0% | 0 | 3 | 6 | 0 |
| env-no-example | 0% | 0 | 9 | 7 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 3 | 0 | 0 |
| insecure-py-eval-exec | 0% | 0 | 4 | 22 | 0 |
| insecure-py-os-system | 0% | 0 | 2 | 0 | 0 |
| insecure-py-yaml-load | 0% | 0 | 2 | 1 | 0 |
| insecure-tls-verification-off | 0% | 0 | 1 | 1 | 0 |
| secret-generic | 0% | 0 | 1 | 1 | 0 |
| secret-history | 0% | 0 | 2 | 1 | 0 |
| workflow-script-injection | 0% | 0 | 1 | 0 | 0 |
| insecure-py-pickle-load | 14% | 1 | 6 | 12 | 0 |
| insecure-sql-interpolated | 14% | 1 | 6 | 57 | 0 |
| insecure-react-dangerous-html | 17% | 1 | 5 | 10 | 0 |
| ci-silenced-failure | 20% | 2 | 8 | 26 | 0 |
| debug-leftover | 22% | 4 | 14 | 403 | 0 |
| ci-no-pr-trigger | 33% | 2 | 4 | 1 | 0 |
| insecure-weak-hash | 33% | 1 | 2 | 0 | 0 |
| insecure-new-function | 38% | 3 | 5 | 20 | 0 |
| insecure-exec-interpolated | 40% | 2 | 3 | 12 | 0 |
| docker-root | 43% | 3 | 4 | 6 | 0 |
| dead-export | 50% | 11 | 11 | 569 | 0 |
| insecure-eval-dynamic | 50% | 1 | 1 | 32 | 0 |
| bloat | 64% | 7 | 4 | 107 | 0 |
| ci-disabled | 67% | 2 | 1 | 0 | 0 |
| hygiene-no-tests | 67% | 2 | 1 | 2 | 0 |
| commented-code | 75% | 21 | 7 | 733 | 0 |
| doc-link | 77% | 10 | 3 | 882 | 0 |
| lockfile-missing | 92% | 12 | 1 | 13 | 0 |
| skipped-test | 93% | 14 | 1 | 473 | 0 |
| duplicate | 94% | 32 | 2 | 1621 | 0 |
| bus-factor | 100% | 25 | 0 | 2390 | 0 |
| ci-swallowed | 100% | 2 | 0 | 0 | 0 |
| config-conflict | 100% | 13 | 0 | 12 | 0 |
| docker-add-url | 100% | 1 | 0 | 0 | 0 |
| docker-latest | 100% | 2 | 0 | 0 | 0 |
| docker-untagged | 100% | 1 | 0 | 1 | 0 |
| docs-badge | 100% | 5 | 0 | 8 | 0 |
| docs-script | 100% | 1 | 0 | 0 | 0 |
| eol-node | 100% | 24 | 0 | 402 | 0 |
| eol-python | 100% | 18 | 0 | 81 | 0 |
| eol-runner | 100% | 5 | 0 | 0 | 0 |
| hygiene-no-ci | 100% | 4 | 0 | 0 | 0 |
| hygiene-no-license | 100% | 3 | 0 | 0 | 0 |
| hygiene-no-readme | 100% | 1 | 0 | 0 | 0 |
| insecure-py-shell-true | 100% | 1 | 0 | 0 | 0 |
| insecure-py-verify-false | 100% | 1 | 0 | 0 | 0 |
| todo | 100% | 48 | 0 | 6011 | 0 |
| workflow-action-tag | 100% | 41 | 0 | 742 | 0 |
| workflow-action-tag-first-party | 100% | 53 | 0 | 1585 | 0 |
| workflow-no-permissions | 100% | 25 | 0 | 248 | 0 |
| workflow-pr-target-checkout | 100% | 2 | 0 | 0 | 0 |
| (gone) | — | 0 | 0 | 0 | 4 |
| secret-provider | — | 0 | 0 | 24 | 0 |
