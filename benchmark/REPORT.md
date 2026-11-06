# Scanner benchmark

1273/1273 repos scanned offline at pinned commits. Overall precision **59%** (566 TP, 401 FP, 80178 unlabelled, 36 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| dependency-funeral | 0% | 0 | 11 | 431 | 0 |
| secrets | 0% | 0 | 12 | 1559 | 0 |
| insecure-code | 7% | 14 | 184 | 4111 | 0 |
| env-lifecycle | 7% | 1 | 13 | 1337 | 0 |
| iac-security | 41% | 73 | 105 | 11 | 0 |
| leftover-debug | 43% | 3 | 4 | 2000 | 0 |
| ci-health | 46% | 12 | 14 | 248 | 0 |
| dockerfile | 46% | 12 | 14 | 1479 | 0 |
| repo-bloat | 47% | 7 | 8 | 1005 | 0 |
| broken-doc-links | 70% | 16 | 7 | 2373 | 0 |
| docs-drift | 75% | 9 | 3 | 64 | 0 |
| commented-code | 76% | 28 | 9 | 2872 | 0 |
| project-hygiene | 85% | 23 | 4 | 334 | 0 |
| dead-code | 90% | 19 | 2 | 4157 | 0 |
| lockfile-drift | 94% | 15 | 1 | 59 | 0 |
| skipped-tests | 94% | 17 | 1 | 1281 | 0 |
| duplicate-code | 95% | 35 | 2 | 7328 | 0 |
| workflow-security | 95% | 132 | 7 | 11865 | 0 |
| bus-factor | 100% | 28 | 0 | 13233 | 0 |
| config-conflict | 100% | 17 | 0 | 80 | 0 |
| eol-runtime | 100% | 53 | 0 | 1488 | 0 |
| supply-chain | 100% | 1 | 0 | 1 | 0 |
| todo-debt | 100% | 51 | 0 | 22862 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 8 | 112 | 0 |
| dep-unused | 0% | 0 | 11 | 431 | 0 |
| docs-manager | 0% | 0 | 2 | 5 | 0 |
| env-dead | 0% | 0 | 5 | 89 | 0 |
| env-missing | 0% | 0 | 2 | 1177 | 0 |
| iac-dangerous-capability | 0% | 0 | 2 | 0 | 0 |
| insecure-go-template-html | 0% | 0 | 5 | 54 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 5 | 119 | 0 |
| insecure-php-reflected-xss | 0% | 0 | 1 | 6 | 0 |
| insecure-php-unserialize | 0% | 0 | 2 | 59 | 0 |
| insecure-py-eval-exec | 0% | 0 | 12 | 82 | 0 |
| insecure-py-os-system | 0% | 0 | 4 | 10 | 0 |
| insecure-py-yaml-load | 0% | 0 | 2 | 2 | 0 |
| insecure-random-for-secret | 0% | 0 | 1 | 20 | 0 |
| insecure-ruby-dynamic-dispatch | 0% | 0 | 1 | 1 | 0 |
| insecure-ruby-marshal-load | 0% | 0 | 1 | 10 | 0 |
| insecure-tls-verification-off | 0% | 0 | 6 | 30 | 0 |
| secret-generic | 0% | 0 | 3 | 463 | 0 |
| secret-history | 0% | 0 | 5 | 74 | 0 |
| secret-provider | 0% | 0 | 4 | 1022 | 0 |
| insecure-ssrf | 2% | 1 | 65 | 2044 | 0 |
| insecure-sql-interpolated | 5% | 1 | 20 | 679 | 0 |
| insecure-react-dangerous-html | 9% | 1 | 10 | 216 | 0 |
| iac-run-as-root | 10% | 2 | 19 | 0 | 0 |
| iac-host-namespace | 13% | 5 | 35 | 0 | 0 |
| env-no-example | 14% | 1 | 6 | 71 | 0 |
| insecure-exec-interpolated | 14% | 2 | 12 | 305 | 0 |
| insecure-py-pickle-load | 14% | 2 | 12 | 72 | 0 |
| insecure-weak-hash | 17% | 1 | 5 | 9 | 0 |
| iac-privileged | 18% | 6 | 27 | 0 | 0 |
| insecure-py-shell-true | 20% | 1 | 4 | 13 | 0 |
| insecure-new-function | 21% | 3 | 11 | 108 | 0 |
| insecure-eval-dynamic | 25% | 1 | 3 | 126 | 0 |
| workflow-script-injection | 25% | 1 | 3 | 8 | 0 |
| docker-root | 33% | 4 | 8 | 1071 | 0 |
| iac-privilege-escalation | 33% | 1 | 2 | 0 | 0 |
| insecure-localstorage-secret | 33% | 1 | 2 | 90 | 0 |
| workflow-self-hosted-runner | 33% | 1 | 2 | 41 | 0 |
| ci-no-pr-trigger | 40% | 2 | 3 | 17 | 0 |
| debug-leftover | 43% | 3 | 4 | 2000 | 0 |
| bloat | 47% | 7 | 8 | 1005 | 0 |
| docker-latest | 50% | 3 | 3 | 128 | 0 |
| docker-untagged | 50% | 3 | 3 | 264 | 0 |
| workflow-pr-target-checkout | 50% | 2 | 2 | 10 | 0 |
| iac-docker-socket | 53% | 9 | 8 | 8 | 0 |
| ci-silenced-failure | 67% | 4 | 2 | 106 | 0 |
| iac-public-bucket | 67% | 10 | 5 | 0 | 0 |
| iac-unencrypted | 67% | 2 | 1 | 1 | 0 |
| doc-link | 70% | 16 | 7 | 2373 | 0 |
| hygiene-no-license | 75% | 6 | 2 | 41 | 0 |
| hygiene-no-tests | 75% | 6 | 2 | 180 | 0 |
| commented-code | 76% | 28 | 9 | 2872 | 0 |
| ci-disabled | 80% | 4 | 1 | 10 | 0 |
| iac-open-admin-port | 82% | 27 | 6 | 2 | 0 |
| docs-badge | 88% | 7 | 1 | 52 | 0 |
| dead-export | 89% | 16 | 2 | 4143 | 0 |
| lockfile-missing | 94% | 15 | 1 | 59 | 0 |
| skipped-test | 94% | 17 | 1 | 1281 | 0 |
| duplicate | 95% | 35 | 2 | 7328 | 0 |
| bus-factor | 100% | 28 | 0 | 13233 | 0 |
| ci-swallowed | 100% | 2 | 0 | 3 | 0 |
| config-conflict | 100% | 17 | 0 | 80 | 0 |
| dead-uikit | 100% | 3 | 0 | 14 | 0 |
| docker-add-url | 100% | 2 | 0 | 16 | 0 |
| docs-script | 100% | 2 | 0 | 7 | 0 |
| eol-node | 100% | 27 | 0 | 1127 | 0 |
| eol-python | 100% | 21 | 0 | 332 | 0 |
| eol-runner | 100% | 5 | 0 | 29 | 0 |
| hygiene-no-ci | 100% | 9 | 0 | 106 | 0 |
| hygiene-no-readme | 100% | 2 | 0 | 7 | 0 |
| iac-iam-wildcard | 100% | 1 | 0 | 0 | 0 |
| iac-public-database | 100% | 10 | 0 | 0 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 0 | 0 |
| todo | 100% | 51 | 0 | 22862 | 0 |
| workflow-action-tag | 100% | 44 | 0 | 3179 | 0 |
| workflow-action-tag-first-party | 100% | 56 | 0 | 7017 | 0 |
| workflow-no-permissions | 100% | 28 | 0 | 1609 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| insecure-dotnet-deserialization | — | 0 | 0 | 18 | 0 |
| insecure-java-deserialization | — | 0 | 0 | 30 | 0 |
| insecure-php-include-user-input | — | 0 | 0 | 8 | 0 |
| supply-node-eval | — | 0 | 0 | 1 | 0 |
| workflow-action-unpinned | — | 0 | 0 | 1 | 0 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 12% | 45 | 319 | 10225 | 0 |
| medium | 67% | 106 | 52 | 7244 | 0 |
| high | 93% | 415 | 30 | 62709 | 0 |
