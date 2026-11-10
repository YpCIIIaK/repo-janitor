# Scanner benchmark

3400/3400 repos scanned offline at pinned commits. Overall precision **58%** (994 TP, 724 FP, 322262 unlabelled, 36 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| secrets | 5% | 2 | 37 | 4143 | 0 |
| dependency-funeral | 8% | 1 | 12 | 704 | 0 |
| insecure-code | 12% | 41 | 304 | 10652 | 0 |
| env-lifecycle | 14% | 4 | 25 | 5091 | 0 |
| license-risk | 15% | 5 | 29 | 15 | 0 |
| leftover-debug | 27% | 4 | 11 | 3551 | 0 |
| iac-security | 42% | 84 | 118 | 137 | 0 |
| dockerfile | 45% | 22 | 27 | 2891 | 0 |
| repo-bloat | 47% | 8 | 9 | 2883 | 0 |
| ci-health | 48% | 22 | 24 | 791 | 0 |
| docs-drift | 63% | 17 | 10 | 183 | 0 |
| broken-doc-links | 66% | 31 | 16 | 6049 | 0 |
| commented-code | 68% | 69 | 32 | 8451 | 0 |
| project-hygiene | 69% | 27 | 12 | 1379 | 0 |
| duplicate-code | 78% | 39 | 11 | 23965 | 0 |
| dead-code | 80% | 20 | 5 | 11262 | 0 |
| skipped-tests | 84% | 21 | 4 | 2630 | 0 |
| bus-factor | 85% | 28 | 5 | 44087 | 0 |
| lockfile-drift | 90% | 19 | 2 | 108 | 0 |
| todo-debt | 91% | 92 | 9 | 92823 | 0 |
| eol-runtime | 94% | 84 | 5 | 2642 | 0 |
| config-conflict | 95% | 19 | 1 | 201 | 0 |
| workflow-security | 95% | 334 | 16 | 33733 | 0 |
| supply-chain | 100% | 1 | 0 | 1 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| vulnerable-deps | — | 0 | 0 | 63890 | 0 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 10 | 403 | 0 |
| insecure-document-write-dynamic | 0% | 0 | 3 | 1 | 0 |
| insecure-dotnet-deserialization | 0% | 0 | 2 | 39 | 0 |
| insecure-go-template-html | 0% | 0 | 10 | 148 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 13 | 315 | 0 |
| insecure-py-eval-exec | 0% | 0 | 19 | 265 | 0 |
| insecure-py-os-system | 0% | 0 | 9 | 173 | 0 |
| insecure-py-yaml-load | 0% | 0 | 2 | 19 | 0 |
| insecure-ruby-dynamic-dispatch | 0% | 0 | 3 | 1 | 0 |
| insecure-ruby-marshal-load | 0% | 0 | 5 | 56 | 0 |
| insecure-tls-verification-off | 0% | 0 | 12 | 47 | 0 |
| license-risk | 0% | 0 | 1 | 0 | 0 |
| license-unrecognised | 0% | 0 | 6 | 12 | 0 |
| license-weak | 0% | 0 | 14 | 2 | 0 |
| secret-provider | 0% | 0 | 14 | 2574 | 0 |
| insecure-ssrf | 1% | 1 | 74 | 4525 | 0 |
| secret-history | 6% | 1 | 15 | 183 | 0 |
| dep-unused | 8% | 1 | 12 | 704 | 0 |
| env-no-example | 8% | 1 | 11 | 132 | 0 |
| iac-run-as-root | 10% | 2 | 19 | 3 | 0 |
| insecure-py-pickle-load | 10% | 2 | 19 | 219 | 0 |
| insecure-sql-interpolated | 10% | 3 | 26 | 2300 | 0 |
| insecure-py-shell-true | 11% | 1 | 8 | 116 | 0 |
| insecure-react-dangerous-html | 11% | 2 | 16 | 436 | 0 |
| secret-generic | 11% | 1 | 8 | 1386 | 0 |
| iac-host-namespace | 11% | 5 | 39 | 23 | 0 |
| insecure-exec-interpolated | 12% | 3 | 23 | 977 | 0 |
| insecure-eval-dynamic | 13% | 1 | 7 | 294 | 0 |
| insecure-php-unserialize | 13% | 1 | 7 | 121 | 0 |
| insecure-random-for-secret | 13% | 1 | 7 | 30 | 0 |
| env-missing | 14% | 1 | 6 | 4673 | 0 |
| docs-manager | 17% | 1 | 5 | 22 | 0 |
| iac-dangerous-capability | 17% | 1 | 5 | 1 | 0 |
| insecure-new-function | 17% | 3 | 15 | 123 | 0 |
| insecure-localstorage-secret | 18% | 2 | 9 | 152 | 0 |
| env-dead | 20% | 2 | 8 | 286 | 0 |
| iac-privilege-escalation | 20% | 1 | 4 | 0 | 0 |
| insecure-weak-hash | 20% | 2 | 8 | 18 | 0 |
| iac-privileged | 21% | 8 | 30 | 10 | 0 |
| workflow-script-injection | 22% | 2 | 7 | 21 | 0 |
| docker-root | 24% | 4 | 13 | 2008 | 0 |
| debug-leftover | 27% | 4 | 11 | 3551 | 0 |
| workflow-pr-target-checkout | 29% | 2 | 5 | 34 | 0 |
| license-network | 33% | 2 | 4 | 0 | 0 |
| license-proprietary | 33% | 1 | 2 | 0 | 0 |
| ci-silenced-failure | 36% | 4 | 7 | 231 | 0 |
| docker-untagged | 36% | 4 | 7 | 591 | 0 |
| insecure-java-deserialization | 40% | 2 | 3 | 152 | 0 |
| bloat | 47% | 8 | 9 | 2883 | 0 |
| iac-public-bucket | 50% | 11 | 11 | 28 | 0 |
| insecure-py-verify-false | 50% | 1 | 1 | 5 | 0 |
| license-strong | 50% | 2 | 2 | 1 | 0 |
| workflow-self-hosted-runner | 50% | 2 | 2 | 58 | 0 |
| hygiene-no-tests | 55% | 6 | 5 | 662 | 0 |
| ci-no-pr-trigger | 56% | 5 | 4 | 97 | 0 |
| ci-swallowed | 60% | 3 | 2 | 10 | 0 |
| dead-uikit | 60% | 3 | 2 | 29 | 0 |
| docker-latest | 60% | 9 | 6 | 207 | 0 |
| insecure-rust-tls-validation-disabled | 60% | 3 | 2 | 16 | 0 |
| docs-script | 63% | 5 | 3 | 29 | 0 |
| doc-link | 66% | 31 | 16 | 6049 | 0 |
| commented-code | 68% | 69 | 32 | 8451 | 0 |
| hygiene-no-ci | 71% | 10 | 4 | 526 | 0 |
| hygiene-no-license | 75% | 9 | 3 | 175 | 0 |
| iac-docker-socket | 75% | 9 | 3 | 17 | 0 |
| iac-unencrypted | 75% | 3 | 1 | 3 | 0 |
| duplicate | 78% | 39 | 11 | 23965 | 0 |
| insecure-php-reflected-xss | 80% | 4 | 1 | 65 | 0 |
| iac-open-admin-port | 83% | 29 | 6 | 27 | 0 |
| docker-add-url | 83% | 5 | 1 | 85 | 0 |
| skipped-test | 84% | 21 | 4 | 2630 | 0 |
| docs-badge | 85% | 11 | 2 | 132 | 0 |
| bus-factor | 85% | 28 | 5 | 44087 | 0 |
| dead-export | 85% | 17 | 3 | 11233 | 0 |
| eol-python | 89% | 31 | 4 | 829 | 0 |
| lockfile-missing | 90% | 18 | 2 | 108 | 0 |
| ci-disabled | 91% | 10 | 1 | 50 | 0 |
| todo | 91% | 92 | 9 | 92823 | 0 |
| config-conflict | 95% | 19 | 1 | 201 | 0 |
| eol-node | 97% | 36 | 1 | 1730 | 0 |
| workflow-action-tag-first-party | 99% | 119 | 1 | 20132 | 0 |
| workflow-action-tag | 99% | 123 | 1 | 9049 | 0 |
| eol-runner | 100% | 17 | 0 | 83 | 0 |
| hygiene-no-readme | 100% | 2 | 0 | 16 | 0 |
| iac-hardcoded-password | 100% | 2 | 0 | 20 | 0 |
| iac-iam-wildcard | 100% | 3 | 0 | 2 | 0 |
| iac-public-database | 100% | 10 | 0 | 3 | 0 |
| insecure-cpp-tls-validation-disabled | 100% | 2 | 0 | 19 | 0 |
| insecure-php-path-traversal | 100% | 4 | 0 | 0 | 0 |
| insecure-php-xxe | 100% | 1 | 0 | 3 | 0 |
| insecure-swift-plaintext-credential-storage | 100% | 1 | 0 | 0 | 0 |
| insecure-swift-webview-html | 100% | 1 | 0 | 0 | 0 |
| lockfile-drift | 100% | 1 | 0 | 0 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 0 | 0 |
| workflow-no-permissions | 100% | 86 | 0 | 4437 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| insecure-php-include-user-input | — | 0 | 0 | 14 | 0 |
| insecure-swift-tls-validation-disabled | — | 0 | 0 | 3 | 0 |
| supply-node-eval | — | 0 | 0 | 1 | 0 |
| vuln | — | 0 | 0 | 63890 | 0 |
| workflow-action-unpinned | — | 0 | 0 | 2 | 0 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 12% | 73 | 549 | 29758 | 0 |
| medium | 68% | 237 | 112 | 104366 | 0 |
| high | 92% | 684 | 63 | 188138 | 0 |
