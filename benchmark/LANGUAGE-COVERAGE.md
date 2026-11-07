# Coverage audit (2026-11-07)

## Implemented in this cycle

Swift: request/UI-to-SQL and WebView HTML, explicit Alamofire TLS bypass, credential UserDefaults writes, CommonCrypto ECB. PHP: include/XSS aliases, XXE, Twig template-source injection, request-selected file reads. Kotlin: native SQL interpolation and request-controlled process commands, including `.kts`. Scala: Play-to-JDBC SQL and Slick raw splices, preserving bound interpolation. Rust: explicit reqwest/native-tls verification bypasses. C/C++: explicit libcurl peer/host verification bypasses. CommonJS `.cjs` now uses JavaScript rules. These are specific rule families, not full language coverage.

## Initial audit before these changes

Recognition is not security coverage. `profile.ts:14` attributes LOC to JS/TS, Python, Go, Rust, Java, Ruby, PHP, C, C++, C#, Kotlin, Swift, Scala, Vue and Svelte.

`insecure-code.ts:26–32,644` routes JS/TS, Python, PHP, Java/Kotlin, Ruby, Go and C# to language-specific regexes. The in-progress Swift module adds a separate `.swift` path. Rust, C/C++, Scala, Vue and Svelte have no injection-source scan path. `.cjs` also does not match JS_RE despite being common JavaScript. Kotlin `.kts` is excluded. PHP `.phtml`/`.inc`, Ruby `.erb`/`.rake`, and C# `.cshtml` are scanned even though profile LOC language mapping omits them.

Kotlin is a Java alias rather than full Kotlin support: SQL sink requires Java-style string concatenation and misses Kotlin interpolation; Java FN_HEADER misses `fun` declarations, preventing cross-file taint. Ktor call.parameters/receive does appear in TAINT_RE.java, as do Spring parameter annotations. Kotlin-specific sinks and function syntax need dedicated rules.

Other scanner gaps: leftover-debug supports JS/TS plus Python, Go, Rust, Ruby and PHP only (`LANG_DEBUG`, `debugLangOf`). Dead-code analyzes JS/TS exports and Python/Go names. TODO scanner and commented-code include Rust/C/C++/Kotlin/Swift/Scala; Ruby/Python excluded from commented-code's //-based detector by design. These cross-language hygiene checks should not be represented as equivalent injection coverage.

Recommended next implementations:
1. Kotlin interpolation SQL sinks, Ktor/Spring taint and `fun` headers; source-to-sink tests plus real deliberately vulnerable Kotlin recall fixture. This fills existing nominal support with native syntax rather than introducing a new API universe.
2. Scala Play request-to-SQL / scala.sys.process injection, limited to recognizable unsafe string assembly. Build precision and recall corpus before enabling broad rules. Scala already has 8 prior corpus repos plus 28 new candidates.

Rust and C/C++ injection require substantially more API- and FFI-specific treatment; generic formatted strings are not sufficient evidence. Vue/Svelte script extraction would reuse JS rules but must preserve line offsets and distinguish browser-only SSRF false positives.

No scanner edits made for this audit.
