# Scanner benchmark

3000/3000 repos scanned offline at pinned commits. Overall precision **58%** (950 TP, 674 FP, 232158 unlabelled, 36 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| license-risk | 0% | 0 | 1 | 0 | 0 |
| secrets | 6% | 2 | 33 | 3767 | 0 |
| dependency-funeral | 8% | 1 | 12 | 695 | 0 |
| insecure-code | 12% | 40 | 299 | 10391 | 0 |
| env-lifecycle | 14% | 4 | 25 | 5082 | 0 |
| leftover-debug | 25% | 3 | 9 | 3404 | 0 |
| iac-security | 42% | 84 | 116 | 132 | 0 |
| dockerfile | 45% | 22 | 27 | 2807 | 0 |
| repo-bloat | 47% | 8 | 9 | 2417 | 0 |
| ci-health | 49% | 22 | 23 | 656 | 0 |
| broken-doc-links | 62% | 24 | 15 | 5576 | 0 |
| docs-drift | 62% | 16 | 10 | 159 | 0 |
| commented-code | 69% | 58 | 26 | 7796 | 0 |
| project-hygiene | 69% | 27 | 12 | 1179 | 0 |
| duplicate-code | 77% | 37 | 11 | 20280 | 0 |
| dead-code | 80% | 20 | 5 | 11121 | 0 |
| bus-factor | 85% | 28 | 5 | 38570 | 0 |
| skipped-tests | 88% | 21 | 3 | 2549 | 0 |
| todo-debt | 89% | 76 | 9 | 83724 | 0 |
| lockfile-drift | 90% | 19 | 2 | 98 | 0 |
| eol-runtime | 94% | 84 | 5 | 2560 | 0 |
| config-conflict | 95% | 19 | 1 | 193 | 0 |
| workflow-security | 95% | 334 | 16 | 29001 | 0 |
| supply-chain | 100% | 1 | 0 | 1 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 10 | 308 | 0 |
| insecure-document-write-dynamic | 0% | 0 | 3 | 1 | 0 |
| insecure-dotnet-deserialization | 0% | 0 | 2 | 39 | 0 |
| insecure-go-template-html | 0% | 0 | 10 | 146 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 13 | 314 | 0 |
| insecure-py-eval-exec | 0% | 0 | 18 | 226 | 0 |
| insecure-py-os-system | 0% | 0 | 9 | 159 | 0 |
| insecure-py-yaml-load | 0% | 0 | 2 | 19 | 0 |
| insecure-ruby-dynamic-dispatch | 0% | 0 | 3 | 1 | 0 |
| insecure-ruby-marshal-load | 0% | 0 | 5 | 56 | 0 |
| insecure-tls-verification-off | 0% | 0 | 12 | 46 | 0 |
| license-risk | 0% | 0 | 1 | 0 | 0 |
| secret-provider | 0% | 0 | 10 | 2323 | 0 |
| insecure-ssrf | 1% | 1 | 75 | 4489 | 0 |
| secret-history | 6% | 1 | 15 | 162 | 0 |
| dep-unused | 8% | 1 | 12 | 695 | 0 |
| env-no-example | 8% | 1 | 11 | 128 | 0 |
| iac-run-as-root | 10% | 2 | 19 | 3 | 0 |
| insecure-py-pickle-load | 10% | 2 | 19 | 212 | 0 |
| insecure-sql-interpolated | 10% | 3 | 26 | 2229 | 0 |
| insecure-localstorage-secret | 11% | 1 | 8 | 150 | 0 |
| insecure-py-shell-true | 11% | 1 | 8 | 107 | 0 |
| secret-generic | 11% | 1 | 8 | 1282 | 0 |
| iac-host-namespace | 12% | 5 | 38 | 22 | 0 |
| insecure-react-dangerous-html | 12% | 2 | 15 | 434 | 0 |
| insecure-eval-dynamic | 13% | 1 | 7 | 292 | 0 |
| insecure-exec-interpolated | 13% | 3 | 21 | 939 | 0 |
| insecure-php-unserialize | 13% | 1 | 7 | 121 | 0 |
| env-missing | 14% | 1 | 6 | 4673 | 0 |
| insecure-random-for-secret | 14% | 1 | 6 | 29 | 0 |
| docs-manager | 17% | 1 | 5 | 22 | 0 |
| insecure-new-function | 17% | 3 | 15 | 119 | 0 |
| env-dead | 20% | 2 | 8 | 281 | 0 |
| iac-dangerous-capability | 20% | 1 | 4 | 1 | 0 |
| iac-privilege-escalation | 20% | 1 | 4 | 0 | 0 |
| insecure-weak-hash | 20% | 2 | 8 | 17 | 0 |
| iac-privileged | 21% | 8 | 30 | 10 | 0 |
| workflow-script-injection | 22% | 2 | 7 | 16 | 0 |
| docker-root | 24% | 4 | 13 | 1977 | 0 |
| debug-leftover | 25% | 3 | 9 | 3404 | 0 |
| workflow-pr-target-checkout | 29% | 2 | 5 | 32 | 0 |
| docker-untagged | 36% | 4 | 7 | 547 | 0 |
| ci-silenced-failure | 40% | 4 | 6 | 222 | 0 |
| insecure-java-deserialization | 40% | 2 | 3 | 131 | 0 |
| bloat | 47% | 8 | 9 | 2417 | 0 |
| iac-public-bucket | 50% | 11 | 11 | 28 | 0 |
| insecure-py-verify-false | 50% | 1 | 1 | 2 | 0 |
| workflow-self-hosted-runner | 50% | 2 | 2 | 56 | 0 |
| hygiene-no-tests | 55% | 6 | 5 | 568 | 0 |
| ci-no-pr-trigger | 56% | 5 | 4 | 71 | 0 |
| docs-script | 57% | 4 | 3 | 28 | 0 |
| ci-swallowed | 60% | 3 | 2 | 9 | 0 |
| dead-uikit | 60% | 3 | 2 | 28 | 0 |
| docker-latest | 60% | 9 | 6 | 200 | 0 |
| insecure-rust-tls-validation-disabled | 60% | 3 | 2 | 13 | 0 |
| doc-link | 62% | 24 | 15 | 5576 | 0 |
| commented-code | 69% | 58 | 26 | 7796 | 0 |
| hygiene-no-ci | 71% | 10 | 4 | 446 | 0 |
| hygiene-no-license | 75% | 9 | 3 | 154 | 0 |
| iac-docker-socket | 75% | 9 | 3 | 17 | 0 |
| iac-unencrypted | 75% | 3 | 1 | 3 | 0 |
| duplicate | 77% | 37 | 11 | 20280 | 0 |
| insecure-php-reflected-xss | 80% | 4 | 1 | 65 | 0 |
| iac-open-admin-port | 83% | 29 | 6 | 25 | 0 |
| docker-add-url | 83% | 5 | 1 | 83 | 0 |
| docs-badge | 85% | 11 | 2 | 109 | 0 |
| bus-factor | 85% | 28 | 5 | 38570 | 0 |
| dead-export | 85% | 17 | 3 | 11093 | 0 |
| skipped-test | 88% | 21 | 3 | 2549 | 0 |
| eol-python | 89% | 31 | 4 | 818 | 0 |
| todo | 89% | 76 | 9 | 83724 | 0 |
| lockfile-missing | 90% | 18 | 2 | 98 | 0 |
| ci-disabled | 91% | 10 | 1 | 46 | 0 |
| config-conflict | 95% | 19 | 1 | 193 | 0 |
| eol-node | 97% | 36 | 1 | 1671 | 0 |
| workflow-action-tag-first-party | 99% | 119 | 1 | 17330 | 0 |
| workflow-action-tag | 99% | 123 | 1 | 7630 | 0 |
| eol-runner | 100% | 17 | 0 | 71 | 0 |
| hygiene-no-readme | 100% | 2 | 0 | 11 | 0 |
| iac-hardcoded-password | 100% | 2 | 0 | 20 | 0 |
| iac-iam-wildcard | 100% | 3 | 0 | 2 | 0 |
| iac-public-database | 100% | 10 | 0 | 1 | 0 |
| insecure-cpp-tls-validation-disabled | 100% | 2 | 0 | 15 | 0 |
| insecure-php-path-traversal | 100% | 4 | 0 | 0 | 0 |
| insecure-php-xxe | 100% | 1 | 0 | 3 | 0 |
| insecure-swift-plaintext-credential-storage | 100% | 1 | 0 | 0 | 0 |
| insecure-swift-webview-html | 100% | 1 | 0 | 0 | 0 |
| lockfile-drift | 100% | 1 | 0 | 0 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 0 | 0 |
| workflow-no-permissions | 100% | 86 | 0 | 3935 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| insecure-php-include-user-input | — | 0 | 0 | 14 | 0 |
| insecure-swift-tls-validation-disabled | — | 0 | 0 | 3 | 0 |
| supply-node-eval | — | 0 | 0 | 1 | 0 |
| workflow-action-unpinned | — | 0 | 0 | 2 | 0 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 12% | 68 | 507 | 28301 | 0 |
| medium | 68% | 214 | 103 | 35412 | 0 |
| high | 91% | 668 | 64 | 168445 | 0 |
