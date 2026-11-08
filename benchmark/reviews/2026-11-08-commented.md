# 2026-11-08: commented-code documentation notation

Source review found three false positives across three repositories: protocol grammar, embedded-script parameter maps and binary field equations. These comments explain formats consumed by the surrounding implementation; maintainers need them to check parser behavior, script calling conventions and surrogate decoding.

## Pinned source evidence

- `flashmob-go-guerrilla`: [`mail/rfc5321/parse.go:178`](https://github.com/flashmob/go-guerrilla/blob/858ac36f3a048344549643e68c89cc1d6d489e29/mail/rfc5321/parse.go#L178), SHA `858ac36f3a048344549643e68c89cc1d6d489e29`. Finding `commented-mail/rfc5321/parse.go:178`. SMTP ABNF production rules specify accepted keyword/value bytes. Hyphenated rule names plus percent-d numeric terminals distinguish this from Go assignments. Full pinned source reviewed with surrounding implementation; snapshot `work/cycle8/flashmob-go-guerrilla-commented.txt`.
- `projectdiscovery-interactsh`: [`pkg/storage/storage_redis_lua.go:15`](https://github.com/projectdiscovery/interactsh/blob/b9fea16e57ea1c7eba13ca3f345fdfdd7caa156d/pkg/storage/storage_redis_lua.go#L15), SHA `b9fea16e57ea1c7eba13ca3f345fdfdd7caa156d`. Finding `commented-pkg/storage/storage_redis_lua.go:15`. The KEYS/ARGV table documents positional Redis Lua arguments immediately before redis.NewScript. The script below reads those exact arguments. Full pinned source reviewed with surrounding implementation; snapshot `work/cycle8/projectdiscovery-interactsh-commented.txt`.
- `lysine-dev-okio`: [`okio/src/commonMain/kotlin/okio/Utf8.kt:184`](https://github.com/lysine-dev/okio/blob/f0e3f479f83531332de076ed39bc001a5618d538/okio/src/commonMain/kotlin/okio/Utf8.kt#L184), SHA `f0e3f479f83531332de076ed39bc001a5618d538`. Finding `commented-okio/src/commonMain/kotlin/okio/Utf8.kt:184`. Three labelled bit-layout equations explain UTF-16 surrogate decoding. Every row carries a symbolic binary field and explicit bit width. Full pinned source reviewed with surrounding implementation; snapshot `work/cycle8/lysine-dev-okio-commented.txt`.

## Scope

Whole runs must match precise notation syntax. ABNF is restricted to Go, requires hyphenated production names on every row and a numeric ABNF terminal. Redis argument rows are restricted to Go and must immediately precede a Redis NewScript declaration (only blank/comment separators allowed). Bit-layout rows require a label, binary/symbolic fields and an explicit numeric bit width on every row. No broad grammar keyword, test-directory or prose exclusion was added.

The Smartknob C++ field map and EasyWechat magic-call examples remain findings: both contain valid host-language code and lack enough explicit documentation syntax for this narrow change. Their FP labels remain intact.

## Validation

Before the change, all three positive regression fixtures failed. Afterward all 30 focused commented-code tests pass, including negative controls for ordinary array assignments and ordinary code mentioning grammar/bits. Direct scanner replay of all 55 currently active TP labels from 48 pinned source files preserves every finding, including old and new cycle labels. All three reviewed full-source FP IDs disappear. Replay cache and results: `work/cycle8/commented-active-replay{,-result}.json`. No CLI rebuild or benchmark baseline/confidence edits performed.
