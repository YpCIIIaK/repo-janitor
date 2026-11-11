# Scanner benchmark

6007/6007 repos scanned offline at pinned commits. Overall precision **57%** (1052 TP, 793 FP, 511525 unlabelled, 36 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| secrets | 5% | 2 | 37 | 5679 | 0 |
| dependency-funeral | 8% | 1 | 12 | 1475 | 0 |
| env-lifecycle | 14% | 4 | 25 | 10996 | 0 |
| license-risk | 15% | 5 | 28 | 74 | 0 |
| insecure-code | 18% | 74 | 346 | 19121 | 0 |
| leftover-debug | 27% | 4 | 11 | 6801 | 0 |
| iac-security | 42% | 84 | 118 | 263 | 0 |
| dockerfile | 45% | 22 | 27 | 4184 | 0 |
| repo-bloat | 47% | 8 | 9 | 6308 | 0 |
| ci-health | 48% | 22 | 24 | 1332 | 0 |
| commented-code | 61% | 93 | 59 | 15089 | 0 |
| docs-drift | 63% | 17 | 10 | 324 | 0 |
| broken-doc-links | 66% | 31 | 16 | 9807 | 0 |
| project-hygiene | 69% | 27 | 12 | 3723 | 0 |
| duplicate-code | 75% | 39 | 13 | 41175 | 0 |
| dead-code | 80% | 20 | 5 | 17929 | 0 |
| bus-factor | 85% | 28 | 5 | 68859 | 0 |
| skipped-tests | 88% | 22 | 3 | 3248 | 0 |
| lockfile-drift | 90% | 19 | 2 | 234 | 0 |
| todo-debt | 91% | 92 | 9 | 142571 | 0 |
| eol-runtime | 94% | 84 | 5 | 3804 | 0 |
| config-conflict | 95% | 19 | 1 | 365 | 0 |
| workflow-security | 95% | 334 | 16 | 54097 | 0 |
| supply-chain | 100% | 1 | 0 | 8 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| vulnerable-deps | — | 0 | 0 | 94059 | 0 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 10 | 678 | 0 |
| insecure-document-write-dynamic | 0% | 0 | 3 | 5 | 0 |
| insecure-dotnet-deserialization | 0% | 0 | 2 | 68 | 0 |
| insecure-go-template-html | 0% | 0 | 10 | 209 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 13 | 679 | 0 |
| insecure-py-eval-exec | 0% | 0 | 19 | 572 | 0 |
| insecure-py-os-system | 0% | 0 | 9 | 284 | 0 |
| insecure-py-yaml-load | 0% | 0 | 3 | 25 | 0 |
| insecure-ruby-dynamic-dispatch | 0% | 0 | 3 | 3 | 0 |
| insecure-ruby-marshal-load | 0% | 0 | 5 | 75 | 0 |
| insecure-tls-verification-off | 0% | 0 | 12 | 69 | 0 |
| license-unrecognised | 0% | 0 | 6 | 47 | 0 |
| license-weak | 0% | 0 | 14 | 18 | 0 |
| secret-provider | 0% | 0 | 14 | 3295 | 0 |
| insecure-ssrf | 5% | 4 | 76 | 8593 | 0 |
| secret-history | 6% | 1 | 15 | 301 | 0 |
| dep-unused | 8% | 1 | 12 | 1475 | 0 |
| env-no-example | 8% | 1 | 11 | 224 | 0 |
| iac-run-as-root | 10% | 2 | 19 | 23 | 0 |
| insecure-py-pickle-load | 10% | 2 | 19 | 391 | 0 |
| insecure-py-shell-true | 11% | 1 | 8 | 269 | 0 |
| insecure-react-dangerous-html | 11% | 2 | 16 | 753 | 0 |
| secret-generic | 11% | 1 | 8 | 2083 | 0 |
| iac-host-namespace | 11% | 5 | 39 | 63 | 0 |
| insecure-random-for-secret | 13% | 1 | 7 | 44 | 0 |
| env-missing | 14% | 1 | 6 | 10045 | 0 |
| docs-manager | 17% | 1 | 5 | 38 | 0 |
| iac-dangerous-capability | 17% | 1 | 5 | 8 | 0 |
| insecure-new-function | 17% | 3 | 15 | 192 | 0 |
| insecure-exec-interpolated | 18% | 5 | 23 | 1614 | 0 |
| insecure-localstorage-secret | 18% | 2 | 9 | 274 | 0 |
| env-dead | 20% | 2 | 8 | 727 | 0 |
| iac-privilege-escalation | 20% | 1 | 4 | 6 | 0 |
| insecure-php-unserialize | 20% | 2 | 8 | 243 | 0 |
| insecure-weak-hash | 20% | 2 | 8 | 24 | 0 |
| iac-privileged | 21% | 8 | 30 | 30 | 0 |
| insecure-eval-dynamic | 22% | 2 | 7 | 455 | 0 |
| workflow-script-injection | 22% | 2 | 7 | 41 | 0 |
| docker-root | 24% | 4 | 13 | 2960 | 0 |
| debug-leftover | 27% | 4 | 11 | 6801 | 0 |
| workflow-pr-target-checkout | 29% | 2 | 5 | 42 | 0 |
| insecure-sql-interpolated | 31% | 28 | 63 | 3870 | 0 |
| license-network | 33% | 2 | 4 | 3 | 0 |
| license-proprietary | 33% | 1 | 2 | 1 | 0 |
| ci-silenced-failure | 36% | 4 | 7 | 366 | 0 |
| docker-untagged | 36% | 4 | 7 | 762 | 0 |
| insecure-java-deserialization | 40% | 2 | 3 | 245 | 0 |
| bloat | 47% | 8 | 9 | 6308 | 0 |
| iac-public-bucket | 50% | 11 | 11 | 40 | 0 |
| insecure-py-verify-false | 50% | 1 | 1 | 5 | 0 |
| license-strong | 50% | 2 | 2 | 5 | 0 |
| workflow-self-hosted-runner | 50% | 2 | 2 | 120 | 0 |
| hygiene-no-tests | 55% | 6 | 5 | 1606 | 0 |
| ci-no-pr-trigger | 56% | 5 | 4 | 198 | 0 |
| ci-swallowed | 60% | 3 | 2 | 22 | 0 |
| dead-uikit | 60% | 3 | 2 | 95 | 0 |
| docker-latest | 60% | 9 | 6 | 351 | 0 |
| insecure-rust-tls-validation-disabled | 60% | 3 | 2 | 26 | 0 |
| commented-code | 61% | 93 | 59 | 15089 | 0 |
| docs-script | 63% | 5 | 3 | 56 | 0 |
| doc-link | 66% | 31 | 16 | 9807 | 0 |
| insecure-php-reflected-xss | 67% | 4 | 2 | 82 | 0 |
| hygiene-no-ci | 71% | 10 | 4 | 1440 | 0 |
| duplicate | 75% | 39 | 13 | 41175 | 0 |
| hygiene-no-license | 75% | 9 | 3 | 615 | 0 |
| iac-docker-socket | 75% | 9 | 3 | 34 | 0 |
| iac-unencrypted | 75% | 3 | 1 | 3 | 0 |
| iac-open-admin-port | 83% | 29 | 6 | 29 | 0 |
| docker-add-url | 83% | 5 | 1 | 111 | 0 |
| docs-badge | 85% | 11 | 2 | 230 | 0 |
| bus-factor | 85% | 28 | 5 | 68859 | 0 |
| dead-export | 85% | 17 | 3 | 17834 | 0 |
| skipped-test | 88% | 22 | 3 | 3248 | 0 |
| eol-python | 89% | 31 | 4 | 1264 | 0 |
| lockfile-missing | 90% | 18 | 2 | 213 | 0 |
| ci-disabled | 91% | 10 | 1 | 68 | 0 |
| todo | 91% | 92 | 9 | 142571 | 0 |
| config-conflict | 95% | 19 | 1 | 365 | 0 |
| eol-node | 97% | 36 | 1 | 2418 | 0 |
| workflow-action-tag-first-party | 99% | 119 | 1 | 33191 | 0 |
| workflow-action-tag | 99% | 123 | 1 | 13966 | 0 |
| eol-runner | 100% | 17 | 0 | 122 | 0 |
| hygiene-no-readme | 100% | 2 | 0 | 62 | 0 |
| iac-hardcoded-password | 100% | 2 | 0 | 20 | 0 |
| iac-iam-wildcard | 100% | 3 | 0 | 4 | 0 |
| iac-public-database | 100% | 10 | 0 | 3 | 0 |
| insecure-cpp-tls-validation-disabled | 100% | 2 | 0 | 25 | 0 |
| insecure-php-path-traversal | 100% | 4 | 0 | 2 | 0 |
| insecure-php-xxe | 100% | 2 | 0 | 3 | 0 |
| insecure-swift-plaintext-credential-storage | 100% | 1 | 0 | 0 | 0 |
| insecure-swift-webview-html | 100% | 1 | 0 | 0 | 0 |
| lockfile-drift | 100% | 1 | 0 | 21 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 0 | 0 |
| workflow-no-permissions | 100% | 86 | 0 | 6735 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| insecure-php-include-user-input | — | 0 | 0 | 19 | 0 |
| insecure-swift-tls-validation-disabled | — | 0 | 0 | 3 | 0 |
| supply-node-eval | — | 0 | 0 | 8 | 0 |
| vuln | — | 0 | 0 | 94059 | 0 |
| workflow-action-unpinned | — | 0 | 0 | 2 | 0 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 12% | 73 | 549 | 54643 | 0 |
| medium | 65% | 261 | 140 | 165002 | 0 |
| high | 87% | 718 | 104 | 291880 | 0 |
