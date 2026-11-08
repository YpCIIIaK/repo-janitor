# Scanner benchmark

2538/2538 repos scanned offline at pinned commits. Overall precision **56%** (855 TP, 659 FP, 210985 unlabelled, 36 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| license-risk | 0% | 0 | 1 | 0 | 0 |
| secrets | 6% | 2 | 33 | 3640 | 0 |
| dependency-funeral | 8% | 1 | 12 | 693 | 0 |
| insecure-code | 12% | 40 | 297 | 9728 | 0 |
| env-lifecycle | 14% | 4 | 25 | 5003 | 0 |
| leftover-debug | 25% | 3 | 9 | 3399 | 0 |
| iac-security | 42% | 84 | 116 | 129 | 0 |
| dockerfile | 44% | 21 | 27 | 2573 | 0 |
| repo-bloat | 47% | 8 | 9 | 2188 | 0 |
| ci-health | 49% | 22 | 23 | 569 | 0 |
| broken-doc-links | 61% | 20 | 13 | 5233 | 0 |
| docs-drift | 62% | 16 | 10 | 155 | 0 |
| project-hygiene | 69% | 27 | 12 | 921 | 0 |
| commented-code | 72% | 55 | 21 | 7284 | 0 |
| dead-code | 80% | 20 | 5 | 10986 | 0 |
| duplicate-code | 80% | 37 | 9 | 17455 | 0 |
| bus-factor | 85% | 28 | 5 | 32728 | 0 |
| skipped-tests | 88% | 21 | 3 | 2532 | 0 |
| lockfile-drift | 90% | 19 | 2 | 90 | 0 |
| todo-debt | 91% | 67 | 7 | 77695 | 0 |
| workflow-security | 95% | 262 | 15 | 25337 | 0 |
| config-conflict | 95% | 19 | 1 | 169 | 0 |
| eol-runtime | 95% | 78 | 4 | 2477 | 0 |
| supply-chain | 100% | 1 | 0 | 1 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 10 | 254 | 0 |
| insecure-document-write-dynamic | 0% | 0 | 3 | 1 | 0 |
| insecure-dotnet-deserialization | 0% | 0 | 2 | 22 | 0 |
| insecure-go-template-html | 0% | 0 | 10 | 146 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 13 | 307 | 0 |
| insecure-py-eval-exec | 0% | 0 | 18 | 201 | 0 |
| insecure-py-os-system | 0% | 0 | 9 | 147 | 0 |
| insecure-py-yaml-load | 0% | 0 | 2 | 14 | 0 |
| insecure-ruby-dynamic-dispatch | 0% | 0 | 3 | 1 | 0 |
| insecure-ruby-marshal-load | 0% | 0 | 5 | 42 | 0 |
| insecure-tls-verification-off | 0% | 0 | 12 | 46 | 0 |
| license-risk | 0% | 0 | 1 | 0 | 0 |
| secret-provider | 0% | 0 | 10 | 2237 | 0 |
| insecure-ssrf | 1% | 1 | 73 | 4277 | 0 |
| secret-history | 6% | 1 | 15 | 142 | 0 |
| dep-unused | 8% | 1 | 12 | 693 | 0 |
| env-no-example | 8% | 1 | 11 | 120 | 0 |
| iac-run-as-root | 10% | 2 | 19 | 0 | 0 |
| insecure-py-pickle-load | 10% | 2 | 19 | 198 | 0 |
| insecure-sql-interpolated | 10% | 3 | 26 | 2145 | 0 |
| insecure-localstorage-secret | 11% | 1 | 8 | 139 | 0 |
| insecure-py-shell-true | 11% | 1 | 8 | 90 | 0 |
| secret-generic | 11% | 1 | 8 | 1261 | 0 |
| iac-host-namespace | 12% | 5 | 38 | 21 | 0 |
| insecure-react-dangerous-html | 12% | 2 | 15 | 430 | 0 |
| insecure-eval-dynamic | 13% | 1 | 7 | 283 | 0 |
| insecure-exec-interpolated | 13% | 3 | 21 | 799 | 0 |
| insecure-php-unserialize | 13% | 1 | 7 | 103 | 0 |
| env-missing | 14% | 1 | 6 | 4619 | 0 |
| insecure-random-for-secret | 14% | 1 | 6 | 28 | 0 |
| docs-manager | 17% | 1 | 5 | 22 | 0 |
| insecure-new-function | 17% | 3 | 15 | 116 | 0 |
| env-dead | 20% | 2 | 8 | 264 | 0 |
| iac-dangerous-capability | 20% | 1 | 4 | 0 | 0 |
| iac-privilege-escalation | 20% | 1 | 4 | 0 | 0 |
| insecure-weak-hash | 20% | 2 | 8 | 17 | 0 |
| iac-privileged | 21% | 8 | 30 | 10 | 0 |
| workflow-script-injection | 22% | 2 | 7 | 11 | 0 |
| docker-root | 24% | 4 | 13 | 1830 | 0 |
| debug-leftover | 25% | 3 | 9 | 3399 | 0 |
| workflow-pr-target-checkout | 29% | 2 | 5 | 30 | 0 |
| docker-untagged | 36% | 4 | 7 | 485 | 0 |
| ci-silenced-failure | 40% | 4 | 6 | 208 | 0 |
| insecure-java-deserialization | 40% | 2 | 3 | 78 | 0 |
| bloat | 47% | 8 | 9 | 2188 | 0 |
| iac-public-bucket | 50% | 11 | 11 | 28 | 0 |
| insecure-py-verify-false | 50% | 1 | 1 | 2 | 0 |
| hygiene-no-tests | 55% | 6 | 5 | 457 | 0 |
| ci-no-pr-trigger | 56% | 5 | 4 | 57 | 0 |
| docker-latest | 57% | 8 | 6 | 182 | 0 |
| docs-script | 57% | 4 | 3 | 28 | 0 |
| ci-swallowed | 60% | 3 | 2 | 9 | 0 |
| dead-uikit | 60% | 3 | 2 | 26 | 0 |
| insecure-rust-tls-validation-disabled | 60% | 3 | 2 | 8 | 0 |
| doc-link | 61% | 20 | 13 | 5233 | 0 |
| workflow-self-hosted-runner | 67% | 2 | 1 | 51 | 0 |
| hygiene-no-ci | 71% | 10 | 4 | 332 | 0 |
| commented-code | 72% | 55 | 21 | 7284 | 0 |
| hygiene-no-license | 75% | 9 | 3 | 123 | 0 |
| iac-docker-socket | 75% | 9 | 3 | 17 | 0 |
| iac-unencrypted | 75% | 3 | 1 | 3 | 0 |
| insecure-php-reflected-xss | 80% | 4 | 1 | 65 | 0 |
| duplicate | 80% | 37 | 9 | 17455 | 0 |
| iac-open-admin-port | 83% | 29 | 6 | 27 | 0 |
| docker-add-url | 83% | 5 | 1 | 76 | 0 |
| docs-badge | 85% | 11 | 2 | 105 | 0 |
| bus-factor | 85% | 28 | 5 | 32728 | 0 |
| dead-export | 85% | 17 | 3 | 10960 | 0 |
| skipped-test | 88% | 21 | 3 | 2532 | 0 |
| lockfile-missing | 90% | 18 | 2 | 90 | 0 |
| todo | 91% | 67 | 7 | 77695 | 0 |
| eol-python | 91% | 29 | 3 | 778 | 0 |
| ci-disabled | 91% | 10 | 1 | 41 | 0 |
| config-conflict | 95% | 19 | 1 | 169 | 0 |
| eol-node | 97% | 36 | 1 | 1638 | 0 |
| workflow-action-tag-first-party | 99% | 90 | 1 | 15167 | 0 |
| workflow-action-tag | 99% | 97 | 1 | 6649 | 0 |
| eol-runner | 100% | 13 | 0 | 61 | 0 |
| hygiene-no-readme | 100% | 2 | 0 | 9 | 0 |
| iac-hardcoded-password | 100% | 2 | 0 | 20 | 0 |
| iac-iam-wildcard | 100% | 3 | 0 | 2 | 0 |
| iac-public-database | 100% | 10 | 0 | 1 | 0 |
| insecure-cpp-tls-validation-disabled | 100% | 2 | 0 | 3 | 0 |
| insecure-php-path-traversal | 100% | 4 | 0 | 0 | 0 |
| insecure-php-xxe | 100% | 1 | 0 | 3 | 0 |
| insecure-swift-plaintext-credential-storage | 100% | 1 | 0 | 0 | 0 |
| insecure-swift-webview-html | 100% | 1 | 0 | 0 | 0 |
| lockfile-drift | 100% | 1 | 0 | 0 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 0 | 0 |
| workflow-no-permissions | 100% | 69 | 0 | 3427 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| insecure-php-include-user-input | — | 0 | 0 | 14 | 0 |
| insecure-swift-tls-validation-disabled | — | 0 | 0 | 3 | 0 |
| supply-node-eval | — | 0 | 0 | 1 | 0 |
| workflow-action-unpinned | — | 0 | 0 | 2 | 0 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 12% | 68 | 507 | 26930 | 0 |
| medium | 67% | 169 | 84 | 13956 | 0 |
| high | 90% | 618 | 68 | 170099 | 0 |
