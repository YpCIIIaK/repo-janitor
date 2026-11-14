# Scanner benchmark

6510/6510 repos scanned offline at pinned commits. Overall precision **57%** (1064 TP, 812 FP, 556444 unlabelled, 36 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| secrets | 5% | 2 | 37 | 6385 | 0 |
| dependency-funeral | 8% | 1 | 12 | 1560 | 0 |
| env-lifecycle | 14% | 4 | 25 | 11556 | 0 |
| license-risk | 15% | 5 | 28 | 107 | 0 |
| insecure-code | 18% | 74 | 346 | 20029 | 0 |
| leftover-debug | 27% | 4 | 11 | 7164 | 0 |
| iac-security | 42% | 84 | 118 | 276 | 0 |
| dockerfile | 45% | 22 | 27 | 4308 | 0 |
| repo-bloat | 47% | 8 | 9 | 6570 | 0 |
| ci-health | 48% | 22 | 24 | 1436 | 0 |
| commented-code | 59% | 105 | 74 | 15745 | 0 |
| docs-drift | 63% | 17 | 10 | 340 | 0 |
| broken-doc-links | 66% | 31 | 16 | 10138 | 0 |
| project-hygiene | 69% | 27 | 12 | 4072 | 0 |
| duplicate-code | 72% | 39 | 15 | 43748 | 0 |
| dead-code | 80% | 20 | 5 | 18494 | 0 |
| skipped-tests | 81% | 22 | 5 | 3355 | 0 |
| bus-factor | 85% | 28 | 5 | 73684 | 0 |
| lockfile-drift | 90% | 19 | 2 | 262 | 0 |
| todo-debt | 91% | 92 | 9 | 146137 | 0 |
| eol-runtime | 94% | 84 | 5 | 3909 | 0 |
| config-conflict | 95% | 19 | 1 | 389 | 0 |
| workflow-security | 95% | 334 | 16 | 57178 | 0 |
| supply-chain | 100% | 1 | 0 | 8 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| vulnerable-deps | — | 0 | 0 | 119594 | 0 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 10 | 750 | 0 |
| insecure-document-write-dynamic | 0% | 0 | 3 | 6 | 0 |
| insecure-dotnet-deserialization | 0% | 0 | 2 | 70 | 0 |
| insecure-go-template-html | 0% | 0 | 10 | 209 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 13 | 728 | 0 |
| insecure-py-eval-exec | 0% | 0 | 19 | 633 | 0 |
| insecure-py-os-system | 0% | 0 | 9 | 294 | 0 |
| insecure-py-yaml-load | 0% | 0 | 3 | 25 | 0 |
| insecure-ruby-dynamic-dispatch | 0% | 0 | 3 | 9 | 0 |
| insecure-ruby-marshal-load | 0% | 0 | 5 | 87 | 0 |
| insecure-tls-verification-off | 0% | 0 | 12 | 73 | 0 |
| license-unrecognised | 0% | 0 | 6 | 57 | 0 |
| license-weak | 0% | 0 | 14 | 33 | 0 |
| secret-provider | 0% | 0 | 14 | 3317 | 0 |
| insecure-ssrf | 5% | 4 | 76 | 8933 | 0 |
| secret-history | 6% | 1 | 15 | 338 | 0 |
| dep-unused | 8% | 1 | 12 | 1560 | 0 |
| env-no-example | 8% | 1 | 11 | 246 | 0 |
| iac-run-as-root | 10% | 2 | 19 | 24 | 0 |
| insecure-py-pickle-load | 10% | 2 | 19 | 406 | 0 |
| insecure-py-shell-true | 11% | 1 | 8 | 274 | 0 |
| insecure-react-dangerous-html | 11% | 2 | 16 | 776 | 0 |
| secret-generic | 11% | 1 | 8 | 2730 | 0 |
| iac-host-namespace | 11% | 5 | 39 | 64 | 0 |
| insecure-random-for-secret | 13% | 1 | 7 | 45 | 0 |
| env-missing | 14% | 1 | 6 | 10515 | 0 |
| docs-manager | 17% | 1 | 5 | 45 | 0 |
| iac-dangerous-capability | 17% | 1 | 5 | 9 | 0 |
| insecure-new-function | 17% | 3 | 15 | 200 | 0 |
| insecure-exec-interpolated | 18% | 5 | 23 | 1735 | 0 |
| insecure-localstorage-secret | 18% | 2 | 9 | 291 | 0 |
| env-dead | 20% | 2 | 8 | 795 | 0 |
| iac-privilege-escalation | 20% | 1 | 4 | 7 | 0 |
| insecure-php-unserialize | 20% | 2 | 8 | 248 | 0 |
| insecure-weak-hash | 20% | 2 | 8 | 26 | 0 |
| iac-privileged | 21% | 8 | 30 | 34 | 0 |
| insecure-eval-dynamic | 22% | 2 | 7 | 509 | 0 |
| workflow-script-injection | 22% | 2 | 7 | 43 | 0 |
| docker-root | 24% | 4 | 13 | 3051 | 0 |
| debug-leftover | 27% | 4 | 11 | 7164 | 0 |
| workflow-pr-target-checkout | 29% | 2 | 5 | 43 | 0 |
| insecure-sql-interpolated | 31% | 28 | 63 | 4027 | 0 |
| license-network | 33% | 2 | 4 | 5 | 0 |
| license-proprietary | 33% | 1 | 2 | 1 | 0 |
| ci-silenced-failure | 36% | 4 | 7 | 373 | 0 |
| docker-untagged | 36% | 4 | 7 | 779 | 0 |
| insecure-java-deserialization | 40% | 2 | 3 | 249 | 0 |
| bloat | 47% | 8 | 9 | 6570 | 0 |
| iac-public-bucket | 50% | 11 | 11 | 40 | 0 |
| insecure-py-verify-false | 50% | 1 | 1 | 7 | 0 |
| license-strong | 50% | 2 | 2 | 11 | 0 |
| workflow-self-hosted-runner | 50% | 2 | 2 | 120 | 0 |
| hygiene-no-tests | 55% | 6 | 5 | 1746 | 0 |
| ci-no-pr-trigger | 56% | 5 | 4 | 216 | 0 |
| commented-code | 59% | 105 | 74 | 15745 | 0 |
| ci-swallowed | 60% | 3 | 2 | 23 | 0 |
| dead-uikit | 60% | 3 | 2 | 100 | 0 |
| docker-latest | 60% | 9 | 6 | 364 | 0 |
| insecure-rust-tls-validation-disabled | 60% | 3 | 2 | 31 | 0 |
| docs-script | 63% | 5 | 3 | 56 | 0 |
| doc-link | 66% | 31 | 16 | 10138 | 0 |
| insecure-php-reflected-xss | 67% | 4 | 2 | 82 | 0 |
| hygiene-no-ci | 71% | 10 | 4 | 1589 | 0 |
| duplicate | 72% | 39 | 15 | 43748 | 0 |
| hygiene-no-license | 75% | 9 | 3 | 674 | 0 |
| iac-docker-socket | 75% | 9 | 3 | 39 | 0 |
| iac-unencrypted | 75% | 3 | 1 | 3 | 0 |
| skipped-test | 81% | 22 | 5 | 3355 | 0 |
| iac-open-admin-port | 83% | 29 | 6 | 29 | 0 |
| docker-add-url | 83% | 5 | 1 | 114 | 0 |
| docs-badge | 85% | 11 | 2 | 239 | 0 |
| bus-factor | 85% | 28 | 5 | 73684 | 0 |
| dead-export | 85% | 17 | 3 | 18394 | 0 |
| eol-python | 89% | 31 | 4 | 1286 | 0 |
| lockfile-missing | 90% | 18 | 2 | 241 | 0 |
| ci-disabled | 91% | 10 | 1 | 74 | 0 |
| todo | 91% | 92 | 9 | 146137 | 0 |
| config-conflict | 95% | 19 | 1 | 389 | 0 |
| eol-node | 97% | 36 | 1 | 2494 | 0 |
| workflow-action-tag-first-party | 99% | 119 | 1 | 35050 | 0 |
| workflow-action-tag | 99% | 123 | 1 | 14803 | 0 |
| eol-runner | 100% | 17 | 0 | 129 | 0 |
| hygiene-no-readme | 100% | 2 | 0 | 63 | 0 |
| iac-hardcoded-password | 100% | 2 | 0 | 20 | 0 |
| iac-iam-wildcard | 100% | 3 | 0 | 4 | 0 |
| iac-public-database | 100% | 10 | 0 | 3 | 0 |
| insecure-cpp-tls-validation-disabled | 100% | 2 | 0 | 29 | 0 |
| insecure-php-path-traversal | 100% | 4 | 0 | 2 | 0 |
| insecure-php-xxe | 100% | 2 | 0 | 3 | 0 |
| insecure-swift-plaintext-credential-storage | 100% | 1 | 0 | 0 | 0 |
| insecure-swift-webview-html | 100% | 1 | 0 | 0 | 0 |
| lockfile-drift | 100% | 1 | 0 | 21 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 0 | 0 |
| workflow-no-permissions | 100% | 86 | 0 | 7117 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| insecure-php-include-user-input | — | 0 | 0 | 19 | 0 |
| insecure-swift-tls-validation-disabled | — | 0 | 0 | 3 | 0 |
| supply-node-eval | — | 0 | 0 | 8 | 0 |
| vuln | — | 0 | 0 | 119594 | 0 |
| workflow-action-unpinned | — | 0 | 0 | 2 | 0 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 12% | 73 | 549 | 57724 | 0 |
| medium | 65% | 295 | 162 | 197863 | 0 |
| high | 87% | 696 | 101 | 300857 | 0 |
