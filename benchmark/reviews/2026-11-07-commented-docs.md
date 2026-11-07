# Commented-code false-positive cluster: source documentation

The scanner treated embedded input schemas and fragmented documentation examples as disabled implementation code. Three source-reviewed schema FPs across two repositories justify the narrow classification change:

- `tuguangquan-mybatis` XMLConfigBuilder.java:448: XML dataSource input configuration; https://raw.githubusercontent.com/tuguangquan/mybatis/0483a1dcbe92e2d226ab045420f41a85e01d6c04/src/main/java/org/apache/ibatis/builder/xml/XMLConfigBuilder.java
- `tuguangquan-mybatis` XMLMapperBuilder.java:310: XML resultMap input configuration; https://raw.githubusercontent.com/tuguangquan/mybatis/0483a1dcbe92e2d226ab045420f41a85e01d6c04/src/main/java/org/apache/ibatis/builder/xml/XMLMapperBuilder.java
- `go-mysql-org-go-mysql` replication/row_event_test.go:499: SQL CREATE TABLE definition explaining a binary fixture; pinned source URL recorded in [batch B source review](2026-11-07-b1.md).

The change recognizes SQL CREATE TABLE input schemas and XML tag sequences only in languages where those tags cannot be executable source. It also reads complete contiguous comment paragraphs for explicit example markers and ignores apparent line comments inside block comments or multiline strings. It preserves JavaScript/JSX/TSX, PHP templates and Scala XML literals for normal analysis.

Additional existing labelled FPs removed: Vite React runtime documentation, Chart.js usage examples, p-queue documentation output inside a block comment, and Roncoo parseURL SAMPLE documentation. Source at pinned commits was reviewed directly.

Validation: four added negative cases fail before the change and pass after; tests preserve actual disabled implementations, JSX, comment delimiters inside strings/line comments, and variables called samples. An additional temporary source replay fetched all 65 files containing currently active commented-code labels: 47 TP and 29 FP labels; all 47 TP remain, and 7 labelled FP disappear. Source replay is a supplemental check; the full benchmark regression gate still must pass. No labels or baseline values were changed.
