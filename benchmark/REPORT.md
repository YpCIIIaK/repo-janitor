# Scanner benchmark

10007/10007 repos scanned offline at pinned commits. Overall precision **55%** (1073 TP, 863 FP, 766391 unlabelled, 36 lost TP).

### By scanner

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| secrets | 5% | 2 | 37 | 7296 | 0 |
| dependency-funeral | 8% | 1 | 12 | 2664 | 0 |
| env-lifecycle | 14% | 4 | 25 | 16322 | 0 |
| license-risk | 15% | 5 | 28 | 189 | 0 |
| insecure-code | 17% | 75 | 372 | 27454 | 0 |
| leftover-debug | 27% | 4 | 11 | 9703 | 0 |
| iac-security | 41% | 84 | 119 | 636 | 0 |
| dockerfile | 45% | 22 | 27 | 5519 | 0 |
| repo-bloat | 47% | 8 | 9 | 8893 | 0 |
| ci-health | 48% | 22 | 24 | 2284 | 0 |
| commented-code | 54% | 113 | 98 | 20907 | 0 |
| docs-drift | 63% | 17 | 10 | 470 | 0 |
| broken-doc-links | 66% | 31 | 16 | 13543 | 0 |
| project-hygiene | 69% | 27 | 12 | 6533 | 0 |
| duplicate-code | 72% | 39 | 15 | 63628 | 0 |
| dead-code | 80% | 20 | 5 | 25907 | 0 |
| skipped-tests | 81% | 22 | 5 | 3980 | 0 |
| bus-factor | 85% | 28 | 5 | 103137 | 0 |
| lockfile-drift | 90% | 19 | 2 | 467 | 0 |
| todo-debt | 91% | 92 | 9 | 179115 | 0 |
| eol-runtime | 94% | 84 | 5 | 5119 | 0 |
| config-conflict | 95% | 19 | 1 | 555 | 0 |
| workflow-security | 95% | 334 | 16 | 81162 | 0 |
| supply-chain | 100% | 1 | 0 | 14 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| vulnerable-deps | — | 0 | 0 | 180894 | 0 |

### By rule

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| ci-tests-not-run | 0% | 0 | 10 | 1275 | 0 |
| insecure-document-write-dynamic | 0% | 0 | 3 | 7 | 0 |
| insecure-dotnet-deserialization | 0% | 0 | 2 | 99 | 0 |
| insecure-go-template-html | 0% | 0 | 10 | 249 | 0 |
| insecure-innerhtml-dynamic | 0% | 0 | 16 | 1074 | 0 |
| insecure-py-eval-exec | 0% | 0 | 20 | 775 | 0 |
| insecure-py-os-system | 0% | 0 | 10 | 419 | 0 |
| insecure-py-yaml-load | 0% | 0 | 4 | 52 | 0 |
| insecure-ruby-dynamic-dispatch | 0% | 0 | 3 | 9 | 0 |
| insecure-ruby-marshal-load | 0% | 0 | 5 | 103 | 0 |
| insecure-tls-verification-off | 0% | 0 | 12 | 101 | 0 |
| license-unrecognised | 0% | 0 | 6 | 94 | 0 |
| license-weak | 0% | 0 | 14 | 52 | 0 |
| secret-provider | 0% | 0 | 14 | 3822 | 0 |
| insecure-ssrf | 6% | 5 | 78 | 12497 | 0 |
| secret-history | 6% | 1 | 15 | 498 | 0 |
| dep-unused | 8% | 1 | 12 | 2664 | 0 |
| env-no-example | 8% | 1 | 11 | 363 | 0 |
| iac-run-as-root | 10% | 2 | 19 | 47 | 0 |
| insecure-py-pickle-load | 10% | 2 | 19 | 577 | 0 |
| insecure-react-dangerous-html | 11% | 2 | 17 | 1006 | 0 |
| insecure-py-shell-true | 11% | 1 | 8 | 468 | 0 |
| insecure-random-for-secret | 11% | 1 | 8 | 59 | 0 |
| secret-generic | 11% | 1 | 8 | 2976 | 0 |
| iac-host-namespace | 11% | 5 | 39 | 112 | 0 |
| env-missing | 14% | 1 | 6 | 14318 | 0 |
| insecure-exec-interpolated | 16% | 5 | 26 | 2458 | 0 |
| docs-manager | 17% | 1 | 5 | 60 | 0 |
| iac-dangerous-capability | 17% | 1 | 5 | 14 | 0 |
| insecure-eval-dynamic | 17% | 2 | 10 | 641 | 0 |
| insecure-localstorage-secret | 17% | 2 | 10 | 422 | 0 |
| insecure-new-function | 17% | 3 | 15 | 252 | 0 |
| env-dead | 20% | 2 | 8 | 1641 | 0 |
| iac-privilege-escalation | 20% | 1 | 4 | 10 | 0 |
| insecure-php-unserialize | 20% | 2 | 8 | 361 | 0 |
| insecure-weak-hash | 20% | 2 | 8 | 46 | 0 |
| iac-privileged | 21% | 8 | 30 | 71 | 0 |
| workflow-script-injection | 22% | 2 | 7 | 52 | 0 |
| docker-root | 24% | 4 | 13 | 3967 | 0 |
| debug-leftover | 27% | 4 | 11 | 9703 | 0 |
| insecure-sql-interpolated | 28% | 28 | 71 | 5218 | 0 |
| workflow-pr-target-checkout | 29% | 2 | 5 | 55 | 0 |
| insecure-java-deserialization | 33% | 2 | 4 | 345 | 0 |
| license-network | 33% | 2 | 4 | 9 | 0 |
| license-proprietary | 33% | 1 | 2 | 7 | 0 |
| ci-silenced-failure | 36% | 4 | 7 | 521 | 0 |
| docker-untagged | 36% | 4 | 7 | 949 | 0 |
| bloat | 47% | 8 | 9 | 8893 | 0 |
| iac-public-bucket | 50% | 11 | 11 | 67 | 0 |
| insecure-py-verify-false | 50% | 1 | 1 | 8 | 0 |
| license-strong | 50% | 2 | 2 | 27 | 0 |
| workflow-self-hosted-runner | 50% | 2 | 2 | 134 | 0 |
| commented-code | 54% | 113 | 98 | 20907 | 0 |
| hygiene-no-tests | 55% | 6 | 5 | 2740 | 0 |
| ci-no-pr-trigger | 56% | 5 | 4 | 369 | 0 |
| ci-swallowed | 60% | 3 | 2 | 32 | 0 |
| dead-uikit | 60% | 3 | 2 | 153 | 0 |
| docker-latest | 60% | 9 | 6 | 461 | 0 |
| insecure-rust-tls-validation-disabled | 60% | 3 | 2 | 44 | 0 |
| docs-script | 63% | 5 | 3 | 113 | 0 |
| doc-link | 66% | 31 | 16 | 13543 | 0 |
| insecure-php-reflected-xss | 67% | 4 | 2 | 103 | 0 |
| iac-docker-socket | 69% | 9 | 4 | 55 | 0 |
| hygiene-no-ci | 71% | 10 | 4 | 2594 | 0 |
| duplicate | 72% | 39 | 15 | 63628 | 0 |
| hygiene-no-license | 75% | 9 | 3 | 1107 | 0 |
| iac-unencrypted | 75% | 3 | 1 | 4 | 0 |
| skipped-test | 81% | 22 | 5 | 3980 | 0 |
| iac-open-admin-port | 83% | 29 | 6 | 179 | 0 |
| docker-add-url | 83% | 5 | 1 | 142 | 0 |
| docs-badge | 85% | 11 | 2 | 297 | 0 |
| bus-factor | 85% | 28 | 5 | 103137 | 0 |
| dead-export | 85% | 17 | 3 | 25754 | 0 |
| eol-python | 89% | 31 | 4 | 1642 | 0 |
| lockfile-missing | 90% | 18 | 2 | 421 | 0 |
| ci-disabled | 91% | 10 | 1 | 87 | 0 |
| todo | 91% | 92 | 9 | 179115 | 0 |
| config-conflict | 95% | 19 | 1 | 555 | 0 |
| eol-node | 97% | 36 | 1 | 3320 | 0 |
| workflow-action-tag-first-party | 99% | 119 | 1 | 49501 | 0 |
| workflow-action-tag | 99% | 123 | 1 | 21268 | 0 |
| eol-runner | 100% | 17 | 0 | 157 | 0 |
| hygiene-no-readme | 100% | 2 | 0 | 92 | 0 |
| iac-hardcoded-password | 100% | 2 | 0 | 67 | 0 |
| iac-iam-wildcard | 100% | 3 | 0 | 4 | 0 |
| iac-public-database | 100% | 10 | 0 | 6 | 0 |
| insecure-cpp-tls-validation-disabled | 100% | 2 | 0 | 31 | 0 |
| insecure-php-path-traversal | 100% | 4 | 0 | 2 | 0 |
| insecure-php-xxe | 100% | 2 | 0 | 3 | 0 |
| insecure-swift-plaintext-credential-storage | 100% | 1 | 0 | 0 | 0 |
| insecure-swift-webview-html | 100% | 1 | 0 | 0 | 0 |
| lockfile-drift | 100% | 1 | 0 | 46 | 0 |
| supply-remote-shell | 100% | 1 | 0 | 2 | 0 |
| workflow-no-permissions | 100% | 86 | 0 | 10149 | 0 |
| (gone) | — | 0 | 0 | 0 | 36 |
| insecure-php-include-user-input | — | 0 | 0 | 22 | 0 |
| insecure-swift-tls-validation-disabled | — | 0 | 0 | 3 | 0 |
| supply-node-eval | — | 0 | 0 | 12 | 0 |
| vuln | — | 0 | 0 | 180894 | 0 |
| workflow-action-unpinned | — | 0 | 0 | 3 | 0 |

### By scanner-stamped confidence

| | precision | TP | FP | unlabelled | lost TP |
|---|---:|---:|---:|---:|---:|
| low | 11% | 73 | 573 | 78511 | 0 |
| medium | 62% | 303 | 187 | 291262 | 0 |
| high | 87% | 697 | 103 | 396618 | 0 |
