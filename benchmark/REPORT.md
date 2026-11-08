# Scanner benchmark

2140/2140 repos scanned offline at pinned commits. Overall precision **55%** (765 TP, 634 FP, 193772 unlabelled, 36 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| license-risk | 0% | 0 | 1 | 0 | 0 |
| secrets | 6% | 2 | 33 | 3615 | 0 |
| dependency-funeral | 8% | 1 | 12 | 689 | 0 |
| insecure-code | 9% | 28 | 285 | 9088 | 0 |
| env-lifecycle | 14% | 4 | 25 | 4958 | 0 |
| leftover-debug | 25% | 3 | 9 | 3304 | 0 |
| iac-security | 40% | 80 | 118 | 74 | 0 |
| dockerfile | 43% | 20 | 27 | 2415 | 0 |
| repo-bloat | 47% | 8 | 9 | 2043 | 0 |
| ci-health | 49% | 22 | 23 | 468 | 0 |
| docs-drift | 62% | 16 | 10 | 142 | 0 |
| broken-doc-links | 62% | 18 | 11 | 4875 | 0 |
| project-hygiene | 69% | 27 | 12 | 679 | 0 |
| commented-code | 73% | 47 | 17 | 6950 | 0 |
| dead-code | 80% | 20 | 5 | 11013 | 0 |
| bus-factor | 85% | 28 | 5 | 27697 | 0 |
| duplicate-code | 86% | 36 | 6 | 15073 | 0 |
| skipped-tests | 88% | 21 | 3 | 2522 | 0 |
| lockfile-drift | 90% | 19 | 2 | 81 | 0 |
| workflow-security | 94% | 219 | 15 | 22247 | 0 |
| config-conflict | 95% | 19 | 1 | 157 | 0 |
| eol-runtime | 96% | 69 | 3 | 2287 | 0 |
| todo-debt | 97% | 57 | 2 | 73394 | 0 |
| supply-chain | 100% | 1 | 0 | 1 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 10 | 201 | 0 |
| iac-dangerous-capability | 0% | 0 | 4 | 0 | 0 |
| insecure-document-write-dynamic | 0% | 0 | 3 | 1 | 0 |
| insecure-dotnet-deserialization | 0% | 0 | 2 | 22 | 0 |
| insecure-go-template-html | 0% | 0 | 10 | 146 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 13 | 303 | 0 |
| insecure-java-deserialization | 0% | 0 | 3 | 62 | 0 |
| insecure-py-eval-exec | 0% | 0 | 18 | 192 | 0 |
| insecure-py-os-system | 0% | 0 | 9 | 133 | 0 |
| insecure-py-yaml-load | 0% | 0 | 2 | 14 | 0 |
| insecure-ruby-dynamic-dispatch | 0% | 0 | 3 | 1 | 0 |
| insecure-ruby-marshal-load | 0% | 0 | 5 | 31 | 0 |
| insecure-tls-verification-off | 0% | 0 | 12 | 46 | 0 |
| license-risk | 0% | 0 | 1 | 0 | 0 |
| secret-provider | 0% | 0 | 10 | 2244 | 0 |
| insecure-ssrf | 1% | 1 | 71 | 4085 | 0 |
| secret-history | 6% | 1 | 15 | 129 | 0 |
| dep-unused | 8% | 1 | 12 | 689 | 0 |
| env-no-example | 8% | 1 | 11 | 113 | 0 |
| iac-run-as-root | 10% | 2 | 19 | 0 | 0 |
| insecure-py-pickle-load | 10% | 2 | 18 | 181 | 0 |
| insecure-sql-interpolated | 11% | 3 | 25 | 2049 | 0 |
| insecure-localstorage-secret | 11% | 1 | 8 | 138 | 0 |
| secret-generic | 11% | 1 | 8 | 1242 | 0 |
| iac-host-namespace | 12% | 5 | 38 | 12 | 0 |
| insecure-react-dangerous-html | 12% | 2 | 15 | 430 | 0 |
| insecure-php-unserialize | 13% | 1 | 7 | 98 | 0 |
| insecure-py-shell-true | 13% | 1 | 7 | 73 | 0 |
| env-missing | 14% | 1 | 6 | 4587 | 0 |
| insecure-eval-dynamic | 14% | 1 | 6 | 199 | 0 |
| insecure-random-for-secret | 14% | 1 | 6 | 24 | 0 |
| insecure-exec-interpolated | 15% | 3 | 17 | 676 | 0 |
| docs-manager | 17% | 1 | 5 | 21 | 0 |
| insecure-new-function | 17% | 3 | 15 | 105 | 0 |
| iac-privileged | 19% | 7 | 30 | 7 | 0 |
| env-dead | 20% | 2 | 8 | 258 | 0 |
| iac-privilege-escalation | 20% | 1 | 4 | 0 | 0 |
| insecure-weak-hash | 20% | 2 | 8 | 17 | 0 |
| workflow-script-injection | 22% | 2 | 7 | 9 | 0 |
| docker-root | 24% | 4 | 13 | 1722 | 0 |
| debug-leftover | 25% | 3 | 9 | 3304 | 0 |
| workflow-pr-target-checkout | 29% | 2 | 5 | 27 | 0 |
| docker-untagged | 36% | 4 | 7 | 452 | 0 |
| ci-silenced-failure | 40% | 4 | 6 | 198 | 0 |
| bloat | 47% | 8 | 9 | 2043 | 0 |
| insecure-py-verify-false | 50% | 1 | 1 | 2 | 0 |
| iac-public-bucket | 52% | 11 | 10 | 26 | 0 |
| docker-latest | 54% | 7 | 6 | 170 | 0 |
| hygiene-no-tests | 55% | 6 | 5 | 349 | 0 |
| ci-no-pr-trigger | 56% | 5 | 4 | 41 | 0 |
| docs-script | 57% | 4 | 3 | 25 | 0 |
| ci-swallowed | 60% | 3 | 2 | 9 | 0 |
| dead-uikit | 60% | 3 | 2 | 26 | 0 |
| iac-docker-socket | 60% | 9 | 6 | 15 | 0 |
| doc-link | 62% | 18 | 11 | 4875 | 0 |
| workflow-self-hosted-runner | 67% | 2 | 1 | 40 | 0 |
| hygiene-no-ci | 71% | 10 | 4 | 228 | 0 |
| commented-code | 73% | 47 | 17 | 6950 | 0 |
| hygiene-no-license | 75% | 9 | 3 | 93 | 0 |
| iac-unencrypted | 75% | 3 | 1 | 1 | 0 |
| insecure-php-reflected-xss | 80% | 4 | 1 | 32 | 0 |
| iac-open-admin-port | 82% | 27 | 6 | 11 | 0 |
| docker-add-url | 83% | 5 | 1 | 71 | 0 |
| docs-badge | 85% | 11 | 2 | 96 | 0 |
| bus-factor | 85% | 28 | 5 | 27697 | 0 |
| dead-export | 85% | 17 | 3 | 10987 | 0 |
| duplicate | 86% | 36 | 6 | 15073 | 0 |
| skipped-test | 88% | 21 | 3 | 2522 | 0 |
| lockfile-missing | 90% | 18 | 2 | 81 | 0 |
| ci-disabled | 91% | 10 | 1 | 19 | 0 |
| eol-python | 93% | 26 | 2 | 657 | 0 |
| config-conflict | 95% | 19 | 1 | 157 | 0 |
| todo | 97% | 57 | 2 | 73394 | 0 |
| eol-node | 97% | 32 | 1 | 1578 | 0 |
| workflow-action-tag-first-party | 99% | 68 | 1 | 13362 | 0 |
| workflow-action-tag | 99% | 81 | 1 | 5740 | 0 |
| eol-runner | 100% | 11 | 0 | 52 | 0 |
| hygiene-no-readme | 100% | 2 | 0 | 9 | 0 |
| iac-hardcoded-password | 100% | 2 | 0 | 2 | 0 |
| iac-iam-wildcard | 100% | 3 | 0 | 0 | 0 |
| iac-public-database | 100% | 10 | 0 | 0 | 0 |
| insecure-swift-plaintext-credential-storage | 100% | 1 | 0 | 0 | 0 |
| insecure-swift-webview-html | 100% | 1 | 0 | 0 | 0 |
| lockfile-drift | 100% | 1 | 0 | 0 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 0 | 0 |
| workflow-no-permissions | 100% | 64 | 0 | 3067 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| insecure-cpp-tls-validation-disabled | — | 0 | 0 | 2 | 0 |
| insecure-php-include-user-input | — | 0 | 0 | 10 | 0 |
| insecure-php-path-traversal | — | 0 | 0 | 4 | 0 |
| insecure-php-xxe | — | 0 | 0 | 1 | 0 |
| insecure-rust-tls-validation-disabled | — | 0 | 0 | 11 | 0 |
| supply-node-eval | — | 0 | 0 | 1 | 0 |
| workflow-action-unpinned | — | 0 | 0 | 2 | 0 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 11% | 60 | 464 | 20914 | 0 |
| medium | 60% | 159 | 108 | 17726 | 0 |
| high | 90% | 546 | 62 | 155132 | 0 |
