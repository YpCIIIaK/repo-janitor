# Security rule/reference databases for repo-janitor

Checked 2026-11-07 using official project sources. This is a development reference assessment, not a proposal to execute an external scanner in the product.

## Best practical choice

Use **github/codeql's MIT-licensed query taxonomy, model definitions, query help and positive/negative tests** as the primary reference, with independently authored TypeScript detectors and small regression fixtures. The existing offline, lightweight scanner cannot execute QL queries directly; port the security claim, explicit source/sink/sanitizer contract, and safe negative cases rather than treating regex conversion as equivalent analysis. Retain the MIT notice for any actual copied or adapted code/test assets. PHP and Scala do not have native CodeQL language packs; use CWE/framework documentation to implement these languages independently.

Use **OWASP BenchmarkJava** as an external, pinned recall/precision test target with its expectedresults CSV. Keep its GPL source out of the MIT scanner source/test tree. Juliet is a useful future corpus, but its official site was inaccessible here and the exact downloaded distribution's notices must be checked before importing fixtures.

## Evidence and licenses

| Source | Verified official evidence | License / practical disposition |
|---|---|---|
| Semgrep Community rules / Registry | https://github.com/semgrep/semgrep-rules ; https://raw.githubusercontent.com/semgrep/semgrep-rules/develop/LICENSE ; https://semgrep.dev/legal/rules-license | Current LICENSE says **Semgrep Rules License v1.0**, not MIT/LGPL. Legal text: “You may use the rules only for your own internal business purposes”; “does not allow you to distribute the rules, or to make them available to others as a service.” Do not vendor, translate, or redistribute these current packs as repo-janitor rules. Registry also mixes proprietary Pro rules (README distinguishes them). Check any individually licensed independent rule repo separately. |
| CodeQL standard libraries, queries and tests | https://github.com/github/codeql ; https://raw.githubusercontent.com/github/codeql/main/LICENSE ; https://raw.githubusercontent.com/github/codeql/main/README.md | **MIT** for this source repository. README explicitly distinguishes separately licensed **CodeQL CLI/engine**: source reference permission does not grant unrestricted redistribution/use of the engine. No need to add engine dependency. |
| CodeQL query help | https://codeql.github.com/codeql-query-help/ ; https://codeql.github.com/codeql-query-help/swift/ ; https://codeql.github.com/codeql-query-help/python/ ; https://codeql.github.com/codeql-query-help/javascript/ | Good human-readable CWE-indexed claims, explanations, and safe alternatives. Prefer links and independent implementation; upstream code lives in MIT repository. |
| OWASP BenchmarkJava | https://github.com/OWASP-Benchmark/BenchmarkJava ; https://raw.githubusercontent.com/OWASP-Benchmark/BenchmarkJava/master/LICENSE ; https://owasp.org/www-project-benchmark/ | **GNU GPL v2** verified both LICENSE and OWASP project page. Fully runnable intentionally vulnerable app. README points to separate BenchmarkUtils for scorecards. External pinned clone can be scanned without embedding the application's source into product distribution. |
| Benchmark expected truth data | https://github.com/OWASP-Benchmark/BenchmarkJava/blob/master/expectedresults-1.2.csv | Machine-readable case/category/CWE and true/false answers. Honor upstream repository license for redistributed assets. Record version/SHA, derive coverage metrics from an external checkout rather than claim every sink is a true vulnerability. |
| Juliet / NIST SARD | https://samate.nist.gov/SARD/test-suites/112 ; https://www.nist.gov/itl/ssd/software-quality-group/juliet-test-suite ; https://www.nist.gov/itl/ssd/software-quality-group/samate/software-assurance-reference-dataset-sard | All three official endpoints returned **403** in this environment. Cannot verify current distribution/license from fetched authoritative content, so do not automatically vendor or claim license clearance. Intended use: paired good/bad CWE regression cases from exact distribution after checking file headers/notices. C/C++/Java focus; not Swift/PHP/Scala coverage. |

## Portable rule families (priority)

1. **CWE-89 SQL injection**: distinguish raw string interpolation/concatenation into JDBC/SQLite/PDO query text from bound parameters. Real source-to-sink flow required. Safe JDBC prepareStatement with `?` and Slick `sql"...$value"` are negatives; Slick `#$value` raw splices are potential sinks.
2. **CWE-22 path traversal**: HTTP request filename to local file open/write/read/delete, exclude fixed literals and explicit allowlist mapping. `basename`/canonical path containment are operation-specific, not universal sanitizers.
3. **CWE-611 XXE**: user XML plus resolver/external entity expansion enabled. Parser invocation alone is insufficient; modern secure parser defaults are important negatives. Swift reference: https://codeql.github.com/codeql-query-help/swift/swift-xxe/ .
4. **CWE-78 command injection**: shell source constructed from request data. Argument arrays passed without a shell differ from `sh -c`; quoting/escaping semantics depend on platform. Swift reference: https://codeql.github.com/codeql-query-help/swift/swift-command-line-injection/ .
5. **CWE-79 XSS / CWE-94 template injection**: require unescaped request value rendered as HTML, or request-controlled template **source**, not ordinary template context values. Python template reference: https://codeql.github.com/codeql-query-help/python/py-template-injection/ .
6. **CWE-295 TLS bypass / CWE-327 weak crypto**: explicit certificate acceptance/insecure verification flags and security-sensitive crypto use. Do not flag hash checksums or deterministic nonsecurity identifiers merely because MD5/SHA1 appears.
7. **CWE-502 unsafe deserialization / CWE-918 SSRF**: source-sensitive sink models, with serializers' safe options and browser-vs-server distinctions preserved.

Swift path traversal reference: https://codeql.github.com/codeql-query-help/swift/swift-path-injection/ . Query help Swift index explicitly lists SQL, XML external entities, command injection, path injection, TLS and weak hashing families.

## Minimal integration shape

Maintain a small provenance manifest (rule ID, CWE, authoritative reference URL, source/sink/safe cases and test IDs). Keep each language helper independent; return normal findings with existing confidence behavior. Add paired positive/negative regression cases, then run against intentionally vulnerable corpus AND real-world repos. A database of sink names cannot replace scope-aware taint/sanitizer analysis, and generic exclusions must be verified against recall gates.

Research fetched only licenses, READMEs, query documentation, and project metadata; no Semgrep rule implementations were copied into scanner code.

## Scala SQL implementation references

- CWE-89: https://cwe.mitre.org/data/definitions/89.html (retrieved).
- JDBC prepared statements: https://docs.oracle.com/javase/tutorial/jdbc/basics/prepared.html (retrieved).
- Slick Plain SQL: https://scala-slick.org/doc/stable/sql.html (retrieved). Ordinary `$value` interpolation creates bind variables, whereas `#$value` splices literal SQL text. The Scala scanner follows this documented distinction.
- Play request docs: https://www.playframework.com/documentation/3.0.x/ScalaRequests returned HTTP 403 in this environment; request accessor support is explicitly bounded to `request/req.queryString`, `getQueryString`, and `body.asText`.

Scala checks are independently authored, use local straight-line request/alias tracking, and require tainted SQL at a JDBC sink or an explicit Slick raw splice. Bound parameters, constant raw splices, numeric/boolean conversions, comments, ordinary string examples, reassignment, and function boundaries have negative regression cases. Unknown transformations stop taint; whole-program propagation is outside this check.

## External OWASP ground-truth evaluation

`benchmark/owasp-score.mjs` reads truth data **from an external pinned BenchmarkJava checkout** and compares case-level findings from either a CLI `.report.json` or benchmark `.results/*.json`. It does not import application source, copy GPL fixtures into this project, run the application, or write hand labels.

```sh
node benchmark/owasp-score.mjs --checkout /path/to/BenchmarkJava --results benchmark/.results/owasp-benchmark-benchmarkjava.json > work/owasp-score.json
node benchmark/owasp-score.mjs --checkout /path/to/BenchmarkJava --results /path/to/scan.report.json --confidence visible
node --test benchmark/owasp-score.test.mjs
```

The checkout must be at the result's pinned SHA. The adapter records both SHAs and marks mismatches. It auto-selects `expectedresults-*.csv` only when exactly one exists; otherwise pass `--expected /path/to/expectedresults-1.2.csv`. Default `--confidence all` includes low-confidence findings to measure detector recall; `visible` measures the user-facing output.

Currently supported Java mappings are SQL injection → CWE-89, command execution → CWE-78, and unsafe Java deserialization → CWE-502 (only CWEs present in the selected truth CSV contribute counts). Other categories such as path traversal, LDAP/XPath injection, weak crypto, and trust boundaries are listed as unsupported, rather than counted as false negatives for an unimplemented Java detector. Cases match by `BenchmarkTestNNNNN.java` filename and CWE; repeated findings count once per case. Truth cases missing from the checkout are reported separately and excluded from TP/FP/FN/TN.

**A full BenchmarkJava scan can hit the insecure-code scanner's 60-finding total cap or six findings per file.** The adapter flags suspected truncation using all emitted security findings, even for visible-only evaluation. Its FN/TN counts then remain censored observations, unsuitable for claiming full-suite recall or true-negative performance. A scan without a cap warning still does not prove every file was analyzed: filters, diagnostics and unsupported flows matter. Use smaller, explicitly selected case batches to obtain uncapped evidence, preserve each batch's truth set and scan provenance, and inspect `limitations` rather than publishing the confusion table alone. Synthetic adapter tests include duplicate findings, unsupported CWEs, wrong-CWE matches, missing files, hidden findings, caps and CLI provenance.
