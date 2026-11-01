# Scanner benchmark

420/420 repos scanned offline at pinned commits. Overall precision **76%** (481 TP, 148 FP, 19824 unlabelled, 26 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| dependency-funeral | 0% | 0 | 9 | 52 | 0 |
| secrets | 0% | 0 | 7 | 38 | 0 |
| env-lifecycle | 13% | 1 | 7 | 14 | 0 |
| insecure-code | 18% | 14 | 64 | 237 | 0 |
| leftover-debug | 43% | 3 | 4 | 444 | 0 |
| ci-health | 44% | 8 | 10 | 20 | 0 |
| dockerfile | 47% | 9 | 10 | 90 | 0 |
| repo-bloat | 54% | 7 | 6 | 97 | 0 |
| dead-code | 65% | 20 | 11 | 464 | 0 |
| broken-doc-links | 74% | 17 | 6 | 622 | 0 |
| commented-code | 78% | 28 | 8 | 688 | 0 |
| lockfile-drift | 94% | 15 | 1 | 26 | 0 |
| skipped-tests | 94% | 17 | 1 | 589 | 0 |
| duplicate-code | 95% | 35 | 2 | 2051 | 0 |
| project-hygiene | 95% | 19 | 1 | 10 | 0 |
| workflow-security | 99% | 132 | 1 | 3286 | 0 |
| bus-factor | 100% | 28 | 0 | 3146 | 0 |
| config-conflict | 100% | 16 | 0 | 14 | 0 |
| docs-drift | 100% | 7 | 0 | 8 | 0 |
| eol-runtime | 100% | 53 | 0 | 663 | 0 |
| supply-chain | 100% | 1 | 0 | 0 | 0 |
| todo-debt | 100% | 51 | 0 | 7265 | 0 |
| (gone) | — | 0 | 0 | 0 | 26 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 6 | 0 | 0 |
| dep-unused | 0% | 0 | 9 | 52 | 0 |
| env-dead | 0% | 0 | 3 | 6 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 3 | 0 | 0 |
| insecure-py-eval-exec | 0% | 0 | 7 | 51 | 0 |
| insecure-py-os-system | 0% | 0 | 3 | 0 | 0 |
| insecure-py-yaml-load | 0% | 0 | 2 | 1 | 0 |
| insecure-tls-verification-off | 0% | 0 | 4 | 1 | 0 |
| secret-generic | 0% | 0 | 2 | 10 | 0 |
| secret-history | 0% | 0 | 3 | 1 | 0 |
| secret-provider | 0% | 0 | 2 | 27 | 0 |
| insecure-sql-interpolated | 10% | 1 | 9 | 61 | 0 |
| insecure-react-dangerous-html | 17% | 1 | 5 | 10 | 0 |
| env-no-example | 20% | 1 | 4 | 8 | 0 |
| insecure-py-pickle-load | 20% | 2 | 8 | 42 | 0 |
| docker-untagged | 25% | 1 | 3 | 1 | 0 |
| insecure-exec-interpolated | 25% | 2 | 6 | 13 | 0 |
| insecure-py-shell-true | 25% | 1 | 3 | 0 | 0 |
| insecure-weak-hash | 25% | 1 | 3 | 0 | 0 |
| insecure-new-function | 27% | 3 | 8 | 26 | 0 |
| insecure-eval-dynamic | 33% | 1 | 2 | 32 | 0 |
| docker-root | 40% | 4 | 6 | 40 | 0 |
| debug-leftover | 43% | 3 | 4 | 444 | 0 |
| ci-silenced-failure | 50% | 2 | 2 | 20 | 0 |
| insecure-localstorage-secret | 50% | 1 | 1 | 0 | 0 |
| workflow-script-injection | 50% | 1 | 1 | 0 | 0 |
| bloat | 54% | 7 | 6 | 97 | 0 |
| dead-export | 63% | 19 | 11 | 464 | 0 |
| ci-disabled | 67% | 2 | 1 | 0 | 0 |
| ci-no-pr-trigger | 67% | 2 | 1 | 0 | 0 |
| doc-link | 74% | 17 | 6 | 622 | 0 |
| docker-latest | 75% | 3 | 1 | 49 | 0 |
| commented-code | 78% | 28 | 8 | 688 | 0 |
| hygiene-no-tests | 83% | 5 | 1 | 7 | 0 |
| lockfile-missing | 94% | 15 | 1 | 26 | 0 |
| skipped-test | 94% | 17 | 1 | 589 | 0 |
| duplicate | 95% | 35 | 2 | 2051 | 0 |
| bus-factor | 100% | 28 | 0 | 3146 | 0 |
| ci-swallowed | 100% | 2 | 0 | 0 | 0 |
| config-conflict | 100% | 16 | 0 | 14 | 0 |
| dead-uikit | 100% | 1 | 0 | 0 | 0 |
| docker-add-url | 100% | 1 | 0 | 0 | 0 |
| docs-badge | 100% | 6 | 0 | 8 | 0 |
| docs-script | 100% | 1 | 0 | 0 | 0 |
| eol-node | 100% | 27 | 0 | 540 | 0 |
| eol-python | 100% | 21 | 0 | 123 | 0 |
| eol-runner | 100% | 5 | 0 | 0 | 0 |
| hygiene-no-ci | 100% | 7 | 0 | 3 | 0 |
| hygiene-no-license | 100% | 6 | 0 | 0 | 0 |
| hygiene-no-readme | 100% | 1 | 0 | 0 | 0 |
| insecure-py-verify-false | 100% | 1 | 0 | 0 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 0 | 0 |
| todo | 100% | 51 | 0 | 7265 | 0 |
| workflow-action-tag | 100% | 44 | 0 | 920 | 0 |
| workflow-action-tag-first-party | 100% | 56 | 0 | 2018 | 0 |
| workflow-no-permissions | 100% | 28 | 0 | 348 | 0 |
| workflow-pr-target-checkout | 100% | 2 | 0 | 0 | 0 |
| workflow-self-hosted-runner | 100% | 1 | 0 | 0 | 0 |
| (gone) | — | 0 | 0 | 0 | 26 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 16% | 19 | 99 | 793 | 0 |
| medium | 71% | 98 | 41 | 1980 | 0 |
| high | 98% | 364 | 8 | 17051 | 0 |
