# New security helpers: pinned real-source review

Executed direct imports with `pnpm dlx tsx work/security-real-run.ts`; no CLI rebuild, no full test suite, no benchmark labels added for new helper output. B2 benchmark result SHA verification passed 100/100 against corpus. B2 labels were already committed by parent.

## Source corpus

| Repository | Pinned SHA |
|---|---|
| jmoiron-sqlx | `41dac167fdad5e3fd81d66cafba0951dc6823a30` |
| seanmonstar-reqwest | `8e1c8061e5dd936762dcef08a64ef2cff584b295` |
| launchbadge-sqlx | `e5cbd61a2fd8b100698bc5ad626a04ef8d1fa724` |
| curl-trurl | `d8edc4f5bd442e1c18fba4ebf067ce21b1bc75a9` |
| playframework-play-samples | `510fc1319b8bea39db80798479ba22ceb3080c3e` |
| owasp-igoat-swift | `8c8a8ed6051279f06098f72d6d5aeeb65f8905f2` |
| playframework-playframework | `c7741739585dddbeeb8bad867aeaf95f6561746e` |
| antoniomika-sish | `d41c1fa59efaf586b378e87d69902e58b0095cd2` |
| scalatra-scalatra | `3285c2923e7ba7c630c19bbc42f63433e077270f` |
| rustdesk-rustdesk | `3513c9751db598567b2d1ac7e0637f8ecc5a5fc0` |
| aria2-aria2 | `9e7273583f83e881e3ec067b523ba88724088d2f` |

Scanned source files: {'.cc': 616, '.c': 27, '.h': 716, '.rs': 871, '.swift': 70, '.scala': 1231, '.cpp': 13}. Sources fetched from codeload at exact corpus commits; only source extensions extracted. Harness `work/security-real-run.ts`, raw results `work/security-real-hits.json`.

## Confirmed actionable findings

- iGoat Swift `Source/Exercises/Injection Flaws/XSS/CrossSiteScriptingExerciseVC.swift:9`: user text reaches WebView HTML (intentional vulnerable app TP).
- iGoat Swift `Source/Exercises/InsecureLocalDataStorage/NSUserDefaults/NSUserDefaultsStorageExerciseVC.swift:13`: literal secret PIN stored in preferences (intentional vulnerable app TP).
- RustDesk `src/hbbs_http/http_client.rs:26,43`: real reqwest builders explicitly accept invalid certificates when the corresponding user setting is enabled. These are conditional production bypasses, not unconditional defaults; title accurately describes the call, no unrelated receiver found.

## Precision defect requiring narrow suppression

Reqwest produces 14 helper hits, all intentional TLS validation tests:

- `tests/badssl.rs:26,61,77`: explicit `#[tokio::test]` tests for self-signed and wrong-host certificates, assertions verify behavior.
- `tests/client.rs:426`: ignored HTTP2 upgrade test against local test server, with comment that test server needs TLS.
- `tests/http3.rs:26,55,121,206,299,394,458,534,569`: local HTTP3 test-server clients.
- `tests/redirect.rs:367`: redirect test infrastructure.

Current integration downgrades critical to warning for TEST_RE but retains high confidence, leaving these visible. Suppress unequivocal native test/fixture contexts; retain production RustDesk bypasses. Sent exact evidence to corpus_a. No inline `#[cfg(test)]` bypass false positives appeared in this sample; numerous inline test modules exist in SQLx/RustDesk, so any inline-module suppression should be lexical and must not hide earlier production code.

## Real recall gap requiring Swift fix

Pinned iGoat `Source/Exercises/Injection Flaws/SQL Injection/SQLInjectionExerciseVC.swift` returns no helper finding:

```swift
@IBOutlet weak var searchField: UITextField! // line 5
// ...
if !(searchField.text?.isEmpty ?? true) {
    searchStr = "%" + "\(searchField.text!)" + "%" // line 17
}
let query = "SELECT title FROM article WHERE title LIKE '\(searchStr)' AND premium=0" // line 20
sqlite3_prepare_v2(db, query, -1, &stmt, nil) // line 22
```

The INPUT name heuristic misses a typed UITextField named searchField. Independently, closing the if block clears all taint before query construction. This is an actual deliberately vulnerable SQL exercise, not a synthetic counterexample. Sent to parent for Swift owner. Fix should infer declared UIKit input properties and handle safe local branch joins conservatively, preserving unknown-transform exclusions.

## Other observations and limits

- Scala: 1,231 real files across Play samples/framework and Scalatra yielded zero hits. No false positives in normal route/query parsing. This is negative precision evidence only: no known unsafe JDBC request flow found in these particular repos, so it does not establish recall.
- C/C++: aria2, trurl and native files within downloaded repos yielded zero hits. aria2 uses GnuTLS (`src/LibgnutlsTLSSession.cc:263`) rather than libcurl; unsupported GnuTLS behavior is outside current rule. No claim of C++ TLS recall beyond explicit libcurl setter syntax.
- Swift multiline/raw-string whole-file bailout skips files containing such strings (e.g. iGoat model Exercise.swift). This is a documented coverage limit, not an observed lost TP in those files.
- Rust production bypasses with nonliteral flags are intentionally out of scope; reqwest's own builder implementation forwards bool arguments, and correctly yields no literal-true finding.


## Follow-up fixes

The observations above describe the initial implementation. Commit f1b3732 excludes intentional native TLS test/fixture files and Rust cfg(test) modules, and uses learned confidence for static native configuration checks. Commit aeac048 recognizes typed UIKit text controls and preserves outer-variable taint across conditional scopes; the pinned iGoat SQL sink at line 22 is now detected.
