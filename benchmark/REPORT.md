# Scanner benchmark

812/812 repos scanned offline at pinned commits. Overall precision **68%** (477 TP, 228 FP, 52731 unlabelled, 28 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| dependency-funeral | 0% | 0 | 9 | 259 | 0 |
| secrets | 0% | 0 | 6 | 351 | 0 |
| insecure-code | 8% | 14 | 154 | 2498 | 0 |
| env-lifecycle | 13% | 1 | 7 | 1123 | 0 |
| leftover-debug | 43% | 3 | 4 | 1080 | 0 |
| ci-health | 44% | 8 | 10 | 149 | 0 |
| dockerfile | 47% | 9 | 10 | 351 | 0 |
| repo-bloat | 54% | 7 | 6 | 387 | 0 |
| broken-doc-links | 74% | 17 | 6 | 1397 | 0 |
| commented-code | 78% | 28 | 8 | 1592 | 0 |
| dead-code | 89% | 17 | 2 | 2807 | 0 |
| lockfile-drift | 94% | 15 | 1 | 41 | 0 |
| skipped-tests | 94% | 17 | 1 | 811 | 0 |
| duplicate-code | 95% | 35 | 2 | 4729 | 0 |
| project-hygiene | 95% | 19 | 1 | 141 | 0 |
| workflow-security | 99% | 132 | 1 | 7537 | 0 |
| bus-factor | 100% | 28 | 0 | 8221 | 0 |
| config-conflict | 100% | 15 | 0 | 56 | 0 |
| docs-drift | 100% | 7 | 0 | 29 | 0 |
| eol-runtime | 100% | 53 | 0 | 906 | 0 |
| supply-chain | 100% | 1 | 0 | 1 | 0 |
| todo-debt | 100% | 51 | 0 | 18265 | 0 |
| (gone) | — | 0 | 0 | 0 | 28 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 6 | 65 | 0 |
| dep-unused | 0% | 0 | 9 | 259 | 0 |
| env-dead | 0% | 0 | 3 | 74 | 0 |
| insecure-go-template-html | 0% | 0 | 5 | 45 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 3 | 65 | 0 |
| insecure-php-reflected-xss | 0% | 0 | 1 | 0 | 0 |
| insecure-py-eval-exec | 0% | 0 | 7 | 64 | 0 |
| insecure-py-os-system | 0% | 0 | 3 | 2 | 0 |
| insecure-py-yaml-load | 0% | 0 | 2 | 1 | 0 |
| insecure-ruby-marshal-load | 0% | 0 | 1 | 10 | 0 |
| insecure-tls-verification-off | 0% | 0 | 4 | 10 | 0 |
| secret-generic | 0% | 0 | 1 | 113 | 0 |
| secret-history | 0% | 0 | 3 | 10 | 0 |
| secret-provider | 0% | 0 | 2 | 228 | 0 |
| insecure-ssrf | 1% | 1 | 70 | 976 | 0 |
| insecure-sql-interpolated | 7% | 1 | 13 | 463 | 0 |
| insecure-react-dangerous-html | 11% | 1 | 8 | 64 | 0 |
| insecure-exec-interpolated | 17% | 2 | 10 | 205 | 0 |
| env-no-example | 20% | 1 | 4 | 42 | 0 |
| insecure-py-pickle-load | 20% | 2 | 8 | 53 | 0 |
| insecure-py-shell-true | 20% | 1 | 4 | 5 | 0 |
| docker-untagged | 25% | 1 | 3 | 73 | 0 |
| insecure-new-function | 25% | 3 | 9 | 47 | 0 |
| insecure-weak-hash | 25% | 1 | 3 | 4 | 0 |
| insecure-eval-dynamic | 33% | 1 | 2 | 232 | 0 |
| docker-root | 40% | 4 | 6 | 214 | 0 |
| debug-leftover | 43% | 3 | 4 | 1080 | 0 |
| ci-silenced-failure | 50% | 2 | 2 | 69 | 0 |
| insecure-localstorage-secret | 50% | 1 | 1 | 81 | 0 |
| workflow-script-injection | 50% | 1 | 1 | 4 | 0 |
| bloat | 54% | 7 | 6 | 387 | 0 |
| ci-disabled | 67% | 2 | 1 | 2 | 0 |
| ci-no-pr-trigger | 67% | 2 | 1 | 10 | 0 |
| doc-link | 74% | 17 | 6 | 1397 | 0 |
| docker-latest | 75% | 3 | 1 | 57 | 0 |
| commented-code | 78% | 28 | 8 | 1592 | 0 |
| hygiene-no-tests | 83% | 5 | 1 | 80 | 0 |
| dead-export | 89% | 16 | 2 | 2801 | 0 |
| lockfile-missing | 94% | 15 | 1 | 41 | 0 |
| skipped-test | 94% | 17 | 1 | 811 | 0 |
| duplicate | 95% | 35 | 2 | 4729 | 0 |
| bus-factor | 100% | 28 | 0 | 8221 | 0 |
| ci-swallowed | 100% | 2 | 0 | 3 | 0 |
| config-conflict | 100% | 15 | 0 | 56 | 0 |
| dead-uikit | 100% | 1 | 0 | 6 | 0 |
| docker-add-url | 100% | 1 | 0 | 7 | 0 |
| docs-badge | 100% | 6 | 0 | 24 | 0 |
| docs-script | 100% | 1 | 0 | 5 | 0 |
| eol-node | 100% | 27 | 0 | 725 | 0 |
| eol-python | 100% | 21 | 0 | 169 | 0 |
| eol-runner | 100% | 5 | 0 | 12 | 0 |
| hygiene-no-ci | 100% | 7 | 0 | 43 | 0 |
| hygiene-no-license | 100% | 6 | 0 | 13 | 0 |
| hygiene-no-readme | 100% | 1 | 0 | 5 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 0 | 0 |
| todo | 100% | 51 | 0 | 18265 | 0 |
| workflow-action-tag | 100% | 44 | 0 | 2091 | 0 |
| workflow-action-tag-first-party | 100% | 56 | 0 | 4506 | 0 |
| workflow-no-permissions | 100% | 28 | 0 | 919 | 0 |
| workflow-pr-target-checkout | 100% | 2 | 0 | 7 | 0 |
| workflow-self-hosted-runner | 100% | 1 | 0 | 10 | 0 |
| (gone) | — | 0 | 0 | 0 | 28 |
| env-missing | — | 0 | 0 | 1007 | 0 |
| insecure-dotnet-deserialization | — | 0 | 0 | 62 | 0 |
| insecure-java-deserialization | — | 0 | 0 | 30 | 0 |
| insecure-php-include-user-input | — | 0 | 0 | 4 | 0 |
| insecure-php-unserialize | — | 0 | 0 | 64 | 0 |
| insecure-random-for-secret | — | 0 | 0 | 10 | 0 |
| insecure-ruby-dynamic-dispatch | — | 0 | 0 | 1 | 0 |
| supply-node-eval | — | 0 | 0 | 1 | 0 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 10% | 20 | 175 | 4153 | 0 |
| medium | 74% | 94 | 33 | 7882 | 0 |
| high | 95% | 363 | 20 | 40696 | 0 |
