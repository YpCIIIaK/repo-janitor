import { scanScalaSource } from "./insecure-scala"
import { scanCppTlsSource } from "./insecure-cpp"
import { scanRustTlsSource } from "./insecure-rust"
import { scanKotlinSource } from "./insecure-kotlin"
import { scanPhpSecurity } from "./php-security"
import { scanSwiftSource } from "./insecure-swift"
import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"
import { parseFile, walk, type Node } from "../ast"

/**
 * Insecure Code scanner ⭐.
 *
 * Finds dangerous constructs in the repository's own source — the class of
 * problem you fix by editing a line, as opposed to {@link vulnerableDepsScanner}
 * (someone else's CVE) or {@link secretsScanner} (a leaked value).
 *
 * Deliberately high-precision rather than exhaustive. This is pattern matching,
 * not dataflow analysis: it cannot prove a value is attacker-controlled. So every
 * rule that could fire on safe code requires evidence of *dynamic* input —
 * interpolation, concatenation, an f-string — and rules that would need real
 * taint tracking to be trustworthy are simply absent. A scanner that cries wolf
 * gets its whole category ignored, which costs more than the findings it misses.
 *
 * Matches inside line comments are skipped, and findings in test files are
 * lowered one step: `rejectUnauthorized: false` against a local fixture server is
 * normal, the same line in `src/` is not.
 */

const JS_RE = /\.(ts|tsx|js|jsx|mjs|cjs|mts|cts)$/i
const PY_RE = /\.py$/i
const PHP_RE = /\.(?:php|phtml|inc)$/i
const JAVA_RE = /\.(?:java|kts?)$/i
const RB_RE = /\.(?:rb|erb|rake)$/i
const GO_RE = /\.go$/i
const CS_RE = /\.(?:cs|cshtml)$/i
// Vendored/generated code is not ours to fix, and minified bundles produce
// garbage line numbers.
// Copies of other people's libraries inside the tree are not the project's code:
// a bundled Python stdlib/site-packages, pip's _vendor, CocoaPods, PEAR, phpseclib.
const SKIP_RE = /(^|\/)(?:node_modules|vendor|third_?party|thirdparty|dist|build|out|\.next|site-packages|dist-packages|_vendor|lib\/python\d(?:\.\d+)?|Pods|bower_components|pear|phpseclib)\/|\.min\.[cm]?js$/i
/**
 * Code that never runs on anyone's input: examples, demos, benchmarks, docs
 * sites and their copies of the library, build and release scripts, and
 * vendored bundles (`jquery-3.7.1.js` under test/data, `*_assets/`). In the
 * 100-repo benchmark every finding under these paths was a false positive.
 */
// `tools/` at the top is build tooling; under internal/, pkg/, src/ or lib/ it is the
// application's own helper package (Go's internal/tool: gogs' signed links, GHSA study).
const NOT_SHIPPED_RE =
  /(^|\/)(?:_?examples?|demos?|benchmarks?|bench|perf(?:-testing)?|performance|docs?|documentation|www|website|site|scripts?|(?<!(?:internal|pkg|src|lib)\/)tools?|[\w-]*_assets|static|_?vendor(?:ed)?|third_party|integration-?[tT]ests|test-utils|tooling|_tools|sphinx)\/|(^|\/)jquery[-.\d]*\.js$/i
const TEST_RE =
  /(^|\/)(?:__tests__|tests?|specs?|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test\.[cm]?[jt]s$|(?:^|\/)test_[^/]+\.py$|_test\.py$|(?:^|\/)conftest\.py$|_test\.go$|(?:Test|Tests|IT)\.(?:java|kt|cs|php)$|_spec\.rb$/i

const MAX_PER_FILE = 6
const MAX_TOTAL = 60
/**
 * Collect well past MAX_TOTAL, then keep the most severe. A plain first-60 cut
 * follows file order, so in a large repository low-confidence noise early in the
 * tree crowded out a critical finding further down (CoreNLP's XXE, GHSA-8gf7).
 */
const MAX_COLLECT = 2000
const CONFIDENCE_RANK: Record<string, number> = { high: 2, medium: 1, low: 0 }
/** Skip enormous files: generated payloads dominate the report and cost time. */
const MAX_BYTES = 400_000

type Lang = "js" | "py" | "php" | "java" | "rb" | "go" | "cs"

interface VulnRule {
  /** Stable slug — part of the issue id, so renaming one resets its snooze. */
  id: string
  lang: Lang
  re: RegExp
  severity: Severity
  title: string
  /** What is wrong and what to do instead. Findings without a fix are noise. */
  detail: string
  /** Extra per-match judgement when a regex alone cannot see enough (imports, call arguments). */
  check?: (m: RegExpMatchArray, content: string) => boolean
}

/** PHP, Java/Kotlin, Ruby, Go and C#: the injection classes DVWA, WebGoat, RailsGoat, govwa and WebGoat.NET teach. */
const PHP_JAVA_RULES: VulnRule[] = [
  // --- Python SQL (VAmPI: f"SELECT … '{username}'") ---------------------------
  {
    id: "sql-interpolated",
    lang: "py",
    // Any formatted string handed straight to a DB-API execute, whatever the
    // statement (SHOW, SET, CREATE… are injectable too): `cur.execute(f"SHOW {t}")`.
    re: /\.(?:execute|executemany|executescript|exec_driver_sql)\s*\(\s*(?:f(["'])[^"'\n]*\{[^"'\n]*\1|(["'])[^"'\n]*\2\s*(?:%\s*[(\w]|\.format\s*\())/g,
    severity: "critical",
    title: "SQL query assembled by string formatting",
    detail:
      "A formatted string goes straight to execute(): any value in it becomes SQL. Pass values as " +
      "parameters (`cur.execute(\"… WHERE id = %s\", (id,))`); identifiers need an allow-list.",
  },
  {
    id: "sql-interpolated",
    lang: "py",
    re: /\bf(?:"\s*(?:SELECT\b[^"'\n]*\bFROM|INSERT\s+INTO|UPDATE\b[^"'\n]*\bSET|DELETE\s+FROM)\b[^"\n]*\{|'\s*(?:SELECT\b[^"'\n]*\bFROM|INSERT\s+INTO|UPDATE\b[^"'\n]*\bSET|DELETE\s+FROM)\b[^'\n]*\{)|(?:"\s*(?:SELECT\b[^"'\n]*\bFROM|INSERT\s+INTO|UPDATE\b[^"'\n]*\bSET|DELETE\s+FROM)\b[^"\n]*"|'\s*(?:SELECT\b[^"'\n]*\bFROM|INSERT\s+INTO|UPDATE\b[^"'\n]*\bSET|DELETE\s+FROM)\b[^'\n]*')\s*(?:%\s*[(\w]|\.format\s*\(|\+\s*[A-Za-z_])/gi,
    severity: "critical",
    title: "SQL query assembled by string formatting",
    detail:
      "A value is formatted into the SQL text, which is what SQL injection is. Pass it as a bound " +
      "parameter (`cursor.execute(\"… WHERE name = %s\", (name,))`, or `text(\"… :name\")` with params).",
  },
  // --- Server-side request forgery ------------------------------------------
  {
    id: "ssrf",
    lang: "php",
    re: /\b(?:file_get_contents|fopen|readfile|get_headers|curl_init|simplexml_load_file)\s*\(\s*\$|\bcurl_setopt\s*\([^,]+,\s*CURLOPT_URL\s*,\s*\$/g,
    severity: "critical",
    title: "Server fetches a URL from a variable",
    detail:
      "The server requests whatever URL the variable holds. If a request supplies it, a caller can " +
      "reach internal services and cloud metadata (SSRF). Allow-list hosts and schemes.",
  },
  {
    id: "ssrf",
    lang: "py",
    re: /\b(?:requests|httpx|session|client)\.(?:get|post|put|head|request)\s*\(\s*(?!["'])[A-Za-z_f]|\burllib\.request\.urlopen\s*\(\s*(?!["'])/g,
    severity: "critical",
    title: "Server fetches a URL from a variable",
    detail:
      "The server requests whatever URL the variable holds. If a request supplies it, a caller can " +
      "reach internal services and cloud metadata (SSRF). Allow-list hosts and schemes.",
  },
  {
    id: "ssrf",
    lang: "js",
    re: /\b(?:fetch|axios(?:\.(?:get|post|request))?|got|needle|superagent\.get|https?\.get)\s*\(\s*(?!['"`])[A-Za-z_$]/g,
    severity: "critical",
    title: "Server fetches a URL from a variable",
    detail:
      "The server requests whatever URL the variable holds. If a request supplies it, a caller can " +
      "reach internal services and cloud metadata (SSRF). Allow-list hosts and schemes.",
  },
  // --- Ruby / Rails ---------------------------------------------------------
  {
    id: "sql-interpolated",
    lang: "rb",
    re: /\.(?:where|find_by_sql|order|group|having|select|joins|pluck|from|execute|exec_query|select_all|select_value|count_by_sql)\s*\(?\s*(?:"[^"\n]*#\{|'[^'\n]*'\s*\+|"[^"\n]*"\s*\+)/g,
    severity: "critical",
    title: "SQL fragment built by string interpolation",
    detail:
      "A value is interpolated into SQL that ActiveRecord passes through as-is, which is SQL " +
      "injection. Use placeholders (`where(\"name = ?\", name)`) or a hash condition.",
  },
  {
    id: "exec-interpolated",
    lang: "rb",
    re: /`[^`\n]*#\{|%x[({[][^\n]*#\{|\b(?:system|exec|spawn|IO\.popen|Open3\.\w+)\s*\(?\s*"[^"\n]*#\{/g,
    severity: "critical",
    title: "Shell command built by string interpolation",
    detail:
      "An interpolated value reaches a shell, so `;` or `$(…)` in it runs a command of its own. " +
      "Pass the arguments separately (`system(\"ls\", dir)`), which skips the shell.",
  },
  {
    id: "eval-dynamic",
    lang: "rb",
    re: /\b(?:eval|instance_eval|class_eval|module_eval)\b(?!\s*(?:do\b|\{|\(\s*&|&|<<|\(\s*<<))\s*\(?\s*[^\s"'(&:{|)<]/g,
    severity: "critical",
    title: "eval() on a non-literal value",
    detail: "`eval` runs whatever Ruby it is given. If any part of it comes from a request, this is remote code execution.",
  },
  {
    id: "ruby-dynamic-dispatch",
    lang: "rb",
    re: /\.(?:send|public_send|constantize|safe_constantize)\b\s*\(?\s*params\b|\bparams\s*\[[^\]]+\]\s*\.\s*(?:constantize|safe_constantize)\b/g,
    severity: "critical",
    title: "Method or class chosen by request input",
    detail:
      "The request names the method to call or the class to load, so a caller can reach any of " +
      "them. Map the input to an allow-list.",
  },
  {
    id: "ruby-marshal-load",
    lang: "rb",
    re: /\bMarshal\.load\s*\(|\bYAML\.(?:load|unsafe_load)\s*\((?![^)]*permitted_classes)/g,
    severity: "warning",
    title: "Marshal/YAML load of a value",
    detail:
      "`Marshal.load` and unsafe `YAML.load` build arbitrary objects. Use JSON, or `YAML.safe_load` " +
      "with a list of permitted classes.",
  },
  {
    id: "ruby-html-safe",
    lang: "rb",
    re: /\bparams\b[^\n]*\.html_safe\b|\braw\s*\(?\s*params\b|<%==\s*params\b/g,
    severity: "warning",
    title: "Request input marked as safe HTML",
    detail: "`html_safe`/`raw` turns off Rails escaping for a request value: reflected XSS.",
  },
  // --- Go -------------------------------------------------------------------
  {
    id: "sql-interpolated",
    lang: "go",
    re: /\.(?:Query|QueryRow|Exec|QueryContext|QueryRowContext|ExecContext|Raw|Select|Get)\s*\(\s*(?:ctx\s*,\s*)?(?:fmt\.Sprintf\s*\(\s*"[^"\n]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b|"[^"\n]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"\n]*"\s*\+)/gi,
    severity: "critical",
    title: "SQL query assembled with Sprintf or +",
    detail:
      "The SQL text is formatted with a value, which is what SQL injection is. Pass the value as " +
      "an argument (`db.Query(\"… WHERE id = $1\", id)`).",
  },
  {
    id: "sql-interpolated",
    lang: "go",
    re: /:?=\s*fmt\.Sprintf\s*\(\s*(?:"\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^"\n]*%[sv]|`\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^`]*%[sv])/gi,
    severity: "critical",
    title: "SQL query assembled with Sprintf",
    detail:
      "The SQL text is formatted with a value, which is what SQL injection is. Pass the value as " +
      "an argument (`db.Query(\"… WHERE id = $1\", id)`).",
  },
  {
    id: "exec-interpolated",
    lang: "go",
    re: /\bexec\.Command(?:Context)?\s*\(\s*(?:ctx\s*,\s*)?(?:"(?:sh|bash|cmd|cmd\.exe|powershell)"\s*,\s*"(?:-c|\/c|\/C|-Command)"\s*,\s*(?!")|fmt\.Sprintf)/g,
    severity: "critical",
    title: "Shell command built from a value",
    detail:
      "A computed string is handed to a shell. Call the program directly with separate " +
      "arguments (`exec.Command(\"ping\", \"-c\", \"1\", host)`).",
  },
  {
    id: "go-template-html",
    lang: "go",
    re: /\btemplate\.(?:HTML|JS|URL|HTMLAttr)\s*\(\s*(?!")[^)]/g,
    severity: "warning",
    title: "Value marked as trusted template content",
    detail: "`template.HTML(x)` switches off html/template escaping for `x`. If it came from a request, this is XSS.",
  },
  // --- C# -------------------------------------------------------------------
  {
    id: "sql-interpolated",
    lang: "cs",
    re: /\b(?:new\s+(?:Sql|Npgsql|MySql|Sqlite|OleDb|Odbc)Command|\.(?:FromSqlRaw|ExecuteSqlRaw|ExecuteSqlRawAsync|Query|Execute|QueryFirst\w*|QuerySingle\w*))\s*(?:<[^>]*>)?\s*\(\s*(?:\$"[^"\n]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"\n]*\{|"[^"\n]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"\n]*"\s*\+)/gi,
    severity: "critical",
    title: "SQL command assembled from variables",
    detail:
      "A value is pasted into the SQL text, which is what SQL injection is. Use parameters " +
      "(`cmd.Parameters.AddWithValue`) or `FromSqlInterpolated`.",
  },
  {
    id: "sql-interpolated",
    lang: "cs",
    re: /=\s*(?:\$"\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^"\n]*\{|"\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^"\n]*"\s*\+\s*[A-Za-z_])/gi,
    severity: "critical",
    title: "SQL command assembled from variables",
    detail:
      "A value is pasted into the SQL text, which is what SQL injection is. Use parameters " +
      "(`cmd.Parameters.AddWithValue`) or `FromSqlInterpolated`.",
  },
  {
    id: "exec-interpolated",
    lang: "cs",
    re: /\bProcess\.Start\s*\(\s*(?:"(?:cmd(?:\.exe)?|powershell|bash|sh)"\s*,\s*(?!")|\$")/g,
    severity: "critical",
    title: "Process started with a computed command line",
    detail:
      "A computed string reaches a shell. Start the program directly and pass validated " +
      "arguments through `ProcessStartInfo.ArgumentList`.",
  },
  {
    id: "dotnet-deserialization",
    lang: "cs",
    re: /\bnew\s+(?:BinaryFormatter|LosFormatter|NetDataContractSerializer|SoapFormatter|ObjectStateFormatter)\b|TypeNameHandling\s*=\s*TypeNameHandling\.(?:All|Auto|Objects|Arrays)/g,
    severity: "warning",
    title: "Unsafe .NET deserialiser",
    detail:
      "BinaryFormatter-style serialisers and Json.NET `TypeNameHandling` other than None can " +
      "instantiate attacker-chosen types. Use System.Text.Json or `TypeNameHandling.None`.",
  },
  {
    id: "sql-interpolated",
    lang: "php",
    re: /\b(?:mysqli?_query|pg_query|sqlite_query|->query|->exec|->prepare)\s*\([^;]*?(?:\$_(?:GET|POST|REQUEST|COOKIE)|["'][^"';]*\b(?:SELECT|INSERT|UPDATE|DELETE)\b[^"';]*(?:\$\w|["']\s*\.))/gi,
    severity: "critical",
    title: "SQL query assembled from variables",
    detail:
      "A variable is pasted into the SQL text, which is what SQL injection is. Use a prepared " +
      "statement with bound parameters (PDO or mysqli `bind_param`).",
  },
  {
    id: "sql-interpolated",
    lang: "php",
    re: /=\s*(?:"\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^"\n]*(?:\$\w|"\s*\.\s*\$)|'\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^'\n]*'\s*\.\s*\$)/gi,
    severity: "critical",
    title: "SQL query assembled from variables",
    detail:
      "A variable is pasted into the SQL text, which is what SQL injection is. Use a prepared " +
      "statement with bound parameters (PDO or mysqli `bind_param`).",
  },
  {
    id: "exec-interpolated",
    lang: "php",
    re: /\b(?:shell_exec|exec|system|passthru|popen|proc_open)\s*\(\s*(?:[^)'"]*\$|["'][^"']*["']\s*\.\s*\$|"[^"]*\$)/g,
    severity: "critical",
    title: "Shell command built from variables",
    detail:
      "A variable reaches a shell command, so a value containing `;` or `&&` runs its own command. " +
      "Pass arguments through `escapeshellarg`, or avoid the shell.",
  },
  {
    id: "eval-dynamic",
    lang: "php",
    re: /\b(?:eval|create_function)\s*\(\s*[^)'"\s]/g,
    severity: "critical",
    title: "eval() on a non-literal value",
    detail: "`eval` runs whatever PHP it is given. If any part of it comes from a request, this is remote code execution.",
  },
  {
    id: "php-include-user-input",
    lang: "php",
    re: /\b(?:include|require)(?:_once)?\s*\(?\s*(?:[^;]*\$_(?:GET|POST|REQUEST|COOKIE)|\$[A-Za-z_]\w*)/g,
    severity: "critical",
    title: "File included from request input",
    detail:
      "The path to include comes from the request: a local or remote file inclusion. Map the input " +
      "to a fixed allow-list of files instead.",
  },
  {
    id: "php-unserialize",
    lang: "php",
    re: /(?<!function\s{1,4})\bunserialize\s*\(\s*[^)'"\s](?![^;\n]*allowed_classes)/g,
    severity: "warning",
    title: "unserialize() on a non-literal value",
    detail:
      "`unserialize` can instantiate arbitrary classes and trigger their magic methods. Use " +
      "`json_decode` for data that crosses a trust boundary.",
  },
  {
    id: "php-reflected-xss",
    lang: "php",
    re: /\b(?:echo|print)\b(?:[^;]*\$_(?:GET|POST|REQUEST|COOKIE)\b(?![^;]*htmlspecialchars)|\s+(?:['"][^'"\n]*['"]\s*\.\s*)?\$[A-Za-z_]\w*\b)/g,
    severity: "warning",
    title: "Request input echoed into the page",
    detail: "A request value is written to the HTML unescaped: reflected XSS. Wrap it in `htmlspecialchars`.",
  },
  {
    id: "sql-interpolated",
    lang: "java",
    re: /"[^"\n]*\b(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^"\n]*"\s*\+\s*[A-Za-z_]/gi,
    severity: "critical",
    title: "SQL query assembled by string concatenation",
    detail:
      "The SQL text is built by concatenating a value, which is what SQL injection is. Use a " +
      "`PreparedStatement` with `?` placeholders, or named parameters in JPA.",
  },
  {
    id: "exec-interpolated",
    lang: "java",
    re: /\b(?:Runtime\.getRuntime\(\)\.exec|new\s+ProcessBuilder)\s*\(\s*(?!")[^)]/g,
    severity: "critical",
    title: "Process started with a computed command",
    detail:
      "The command line is built at run time. If a request value reaches it, the caller chooses " +
      "what runs. Pass a fixed executable and validated arguments as a list.",
  },
  {
    id: "java-deserialization",
    lang: "java",
    re: /\bnew\s+ObjectInputStream\s*\(|\bXMLDecoder\s*\(|\.readObject\s*\(\s*\)/g,
    severity: "warning",
    title: "Java deserialisation of a stream",
    detail:
      "Native Java deserialisation of untrusted bytes is a classic remote-code-execution path " +
      "(gadget chains). Use a data format such as JSON, or an allow-list `ObjectInputFilter`.",
  },
]

const RULES: VulnRule[] = [
  // ---- JavaScript / TypeScript -------------------------------------------
  {
    id: "eval-dynamic",
    lang: "js",
    // Only when the argument is not a plain string literal: `eval("1+1")` is
    // pointless but harmless, `eval(userInput)` is remote code execution.
    re: /(?<![.$\w])eval\s*\(\s*[^)'"`\s]/g,
    severity: "critical",
    title: "eval() on a non-literal value",
    detail:
      "`eval` executes whatever string it is given. If any part of that string can come from a " +
      "request, a file or a URL, this is remote code execution. Replace it with an explicit " +
      "lookup — `JSON.parse` for data, a map of allowed operations for behaviour.",
  },
  {
    id: "new-function",
    lang: "js",
    re: /\bnew\s+Function\s*\(/g,
    severity: "critical",
    title: "Code built at runtime with new Function()",
    detail:
      "`new Function(...)` compiles a string into code, with the same consequences as `eval` and " +
      "the same fix: express the behaviour directly instead of assembling it from text.",
  },
  {
    id: "exec-interpolated",
    lang: "js",
    // A shell command assembled from a template literal or string concatenation.
    // A bare `exec(` / `execSync(` (child_process import) or `cp.exec(`; not
    // `/re/.exec(…)`, `db.exec(sql)` or `jake.exec`, which run no shell.
    re: /(?:(?<![.\w$])|\b(?:child_process|childProcess|cp)\.)exec(?:Sync)?\s*\(\s*(?:`[^`]*\$\{|['"][^'"]*['"]\s*\+)/g,
    severity: "critical",
    title: "Shell command built by string interpolation",
    detail:
      "`exec` runs its argument through a shell, so an interpolated value containing `;` or `$(...)` " +
      "runs as a separate command. Use `execFile`/`spawn` with an argument array, which never " +
      "involves a shell, instead of building one string.",
  },
  {
    id: "sql-interpolated",
    lang: "js",
    re: /\b(?:query|execute|raw)\s*\(\s*(?:`[^`]*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^`]*\$\{|['"][^'"]*\b(?:SELECT|INSERT|UPDATE|DELETE|DROP)\b[^'"]*['"]\s*\+)/gi,
    severity: "critical",
    title: "SQL query assembled by string interpolation",
    detail:
      "The query text is built by pasting a value into SQL, which is what SQL injection is. Use a " +
      "parameterised query — placeholders plus a values array — so the driver sends the value " +
      "separately from the statement.",
  },
  {
    // dvna: `var query = "SELECT … WHERE login='" + req.body.login + "'"`, run later.
    id: "sql-interpolated",
    lang: "js",
    re: /['"]\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^'"\n]*['"]\s*\+\s*[A-Za-z_$]/g,
    severity: "critical",
    title: "SQL query assembled by string concatenation",
    detail:
      "The query text is built by gluing a value into SQL, which is what SQL injection is. Use a " +
      "parameterised query — placeholders plus a values array — so the driver sends the value " +
      "separately from the statement.",
  },
  ...PHP_JAVA_RULES,
  {
    id: "innerhtml-dynamic",
    lang: "js",
    re: /\.innerHTML\s*=\s*[^;\n]*(?:\$\{|\+\s*[A-Za-z_$])/g,
    severity: "warning",
    title: "innerHTML assigned a value built at runtime",
    detail:
      "Assigning built-up HTML runs any `<script>` or event handler inside it. If the value can " +
      "carry user input this is cross-site scripting. Use `textContent` for text, or sanitise " +
      "before assigning if markup really is required.",
  },
  {
    id: "react-dangerous-html",
    lang: "js",
    // The JSX attribute, not a type declaration (`dangerouslySetInnerHTML?:`)
    // or a renderer reading the prop.
    re: /dangerouslySetInnerHTML\s*=\s*\{/g,
    severity: "warning",
    title: "dangerouslySetInnerHTML bypasses React's escaping",
    detail:
      "React escapes output by default; this prop turns that off for the subtree. Confirm the HTML " +
      "is either a literal you wrote or has been through a sanitiser such as DOMPurify.",
  },
  {
    id: "tls-verification-off",
    lang: "js",
    re: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*[=:]\s*['"]?0/g,
    severity: "critical",
    title: "TLS certificate verification disabled",
    detail:
      "This accepts any certificate, including one an attacker on the network presents — the " +
      "connection is encrypted but not authenticated, which defeats the point. If it was to work " +
      "around a self-signed certificate, add that certificate as a trusted CA instead.",
  },
  {
    id: "weak-hash",
    lang: "js",
    re: /createHash\s*\(\s*['"](?:md5|sha1)['"]/gi,
    severity: "warning",
    title: "Weak hash algorithm (MD5/SHA-1)",
    detail:
      "MD5 and SHA-1 have practical collision attacks and must not be used for signatures, " +
      "integrity checks or password storage. Use SHA-256 for integrity, and a purpose-built " +
      "password hash (argon2, bcrypt, scrypt) for passwords. Harmless for cache keys.",
  },
  {
    id: "random-for-secret",
    lang: "js",
    // A leading `\w*` so camelCase names match too: `sessionToken` has no word
    // boundary before "Token", and that is the spelling people actually use.
    re: /\b\w*(?:token|secret|password|passwd|salt|nonce|api_?key|session_?id)\w*\s*[=:]\s*[^;\n]*Math\.random\s*\(/gi,
    severity: "warning",
    title: "Security value generated with Math.random()",
    detail:
      "`Math.random` is a predictable pseudo-random generator, not a cryptographic one — its output " +
      "can be reconstructed from earlier values. Use `crypto.randomBytes` / `crypto.getRandomValues` " +
      "for anything anyone is not supposed to guess.",
  },
  // `verify: false` is not a jsonwebtoken signature-bypass option. Decoding a
  // token can also be legitimate; detecting authentication based on decoded
  // claims requires data-flow context, not a generic object-property match.
  {
    id: "localstorage-secret",
    lang: "js",
    // setItem key (first arg) or value expression mentions a credential-ish name.
    re: /localStorage\.setItem\s*\(\s*(?:['"`][^'"`]*(?:token|password|passwd|secret|api[_-]?key)[^'"`]*['"`]|[^)]*(?:token|password|passwd|secret|apiKey|api_key))/gi,
    severity: "warning",
    title: "Credential stored in localStorage",
    detail:
      "`localStorage` is readable by any script on the origin, so XSS becomes credential theft. " +
      "Prefer an httpOnly cookie set by the server, or keep short-lived tokens in memory only.",
  },
  {
    id: "document-write-dynamic",
    lang: "js",
    re: /document\.write\s*\(\s*(?:`[^`]*\$\{|[^)'"`\n]*\+)/g,
    severity: "warning",
    title: "document.write() with a value built at runtime",
    detail:
      "`document.write` injects markup into the page. If any part of the argument can carry user " +
      "input this is cross-site scripting. Prefer DOM APIs (`textContent`, `createElement`) or a " +
      "sanitiser when HTML is required.",
  },

  // ---- Java / Go: XML, TLS, weak crypto -----------------------------------
  {
    id: "java-xxe",
    lang: "java",
    // Judged per file in contextAllows: the factory is only a hole when nothing
    // in the file turns off DTDs or external entities. TransformerFactory is left
    // out: in the corpus it serialised in-memory DOM, which reads no input (5 of 20 sampled).
    re: /\b(?:DocumentBuilderFactory|SAXParserFactory|XMLInputFactory|SchemaFactory)\s*\.\s*new(?:Default)?(?:Instance|Factory)\s*\(|\bnew\s+SAXReader\s*\(|\bnew\s+SAXBuilder\s*\(/g,
    severity: "warning",
    title: "XML parser with external entities left on",
    detail:
      "Java XML parsers resolve DTDs and external entities by default, so a crafted document can read " +
      "local files or reach internal hosts (XXE). Disable DOCTYPE declarations on the factory: " +
      "`setFeature(\"http://apache.org/xml/features/disallow-doctype-decl\", true)`, or set " +
      "`XMLConstants.ACCESS_EXTERNAL_DTD` and `ACCESS_EXTERNAL_SCHEMA` to \"\".",
  },
  {
    id: "tls-verification-off",
    lang: "java",
    // An X509TrustManager whose checkServerTrusted does nothing, or a hostname
    // verifier that accepts every name.
    re: /\bcheckServerTrusted\s*\([^)]*\)\s*(?:throws\s+[\w.,\s]+)?\{\s*(?:\/\/[^\n]*\s*)*\}|\bNoopHostnameVerifier\b|\bALLOW_ALL_HOSTNAME_VERIFIER\b|\bsetHostnameVerifier\s*\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*->\s*true\b|\bverify\s*\(\s*String\s+\w+\s*,\s*SSLSession\s+\w+\s*\)\s*\{\s*return\s+true\s*;/g,
    severity: "critical",
    title: "TLS certificate or hostname checks disabled",
    detail:
      "This trusts any certificate (or any host name), so anyone on the network path can impersonate " +
      "the server. Use the default trust manager; to trust a private CA, add it to a KeyStore instead.",
  },
  {
    id: "tls-verification-off",
    lang: "go",
    re: /\bInsecureSkipVerify\s*:\s*true\b/g,
    severity: "critical",
    title: "TLS certificate checks disabled",
    detail:
      "`InsecureSkipVerify: true` accepts any certificate, so the connection is encrypted but not " +
      "authenticated. Add the server's CA to `RootCAs` instead.",
  },
  {
    id: "weak-hash",
    lang: "go",
    re: /\b(?:md5|sha1)\.(?:New|Sum)\s*\(/g,
    severity: "warning",
    title: "Weak hash algorithm (MD5/SHA-1)",
    detail:
      "MD5 and SHA-1 have practical collision attacks. Use SHA-256 for integrity and a password hash " +
      "(argon2, bcrypt, scrypt) for passwords. Harmless for cache keys.",
  },
  {
    id: "weak-hash",
    lang: "java",
    re: /\bMessageDigest\s*\.\s*getInstance\s*\(\s*"(?:MD5|MD2|SHA-?1)"|\bDigestUtils\s*\.\s*(?:md5|sha1|sha)(?:Hex)?\s*\(/gi,
    severity: "warning",
    title: "Weak hash algorithm (MD5/SHA-1)",
    detail:
      "MD5 and SHA-1 have practical collision attacks. Use SHA-256 for integrity and a password hash " +
      "(argon2, bcrypt, scrypt) for passwords. Harmless for cache keys.",
  },
  {
    id: "random-for-secret",
    lang: "go",
    // math/rand only: crypto/rand exposes rand.Read and rand.Int too, so the file's import decides (contextAllows).
    re: /\b\w*(?:token|secret|password|passwd|salt|nonce|api_?key|session_?id)\w*\s*:?=\s*[^\n]*\brand\.(?:Intn|Int63n?|Int31n?|Int|Uint32|Uint64|Float64|Perm|Read)\s*\(/gi,
    severity: "warning",
    title: "Security value generated with math/rand",
    detail:
      "`math/rand` is predictable; its sequence can be reconstructed. Use `crypto/rand` for anything " +
      "anyone is not supposed to guess.",
  },
  {
    id: "random-for-secret",
    lang: "java",
    re: /\b\w*(?:token|secret|password|passwd|salt|nonce|apiKey|sessionId)\w*\s*=\s*[^;\n]*\bnew\s+Random\s*\(|\b\w*(?:token|secret|password|salt|nonce)\w*\s*=\s*[^;\n]*\bMath\.random\s*\(/gi,
    severity: "warning",
    title: "Security value generated with java.util.Random",
    detail:
      "`java.util.Random` and `Math.random` are predictable. Use `SecureRandom` for tokens, salts and keys.",
  },

  // ---- Sink rules from the harvested sink DB (Nov 2026) ----------------------
  // Shapes taken from the vulnerable lines of GitHub-advisory fixes the fast engine
  // missed (benchmark/sinks-gap.mjs). Provisional: confidence stays low until labelled.
  {
    id: "py-xxe",
    lang: "py",
    // lxml's XMLParser resolves entities unless told not to.
    re: /(?<![\w.])(?:(?:lxml\.)?etree\.|ET\.)?XMLParser\s*\((?![^)]*resolve_entities\s*=\s*False)/g,
    severity: "warning",
    title: "lxml parser resolves XML entities",
    detail:
      "An lxml `XMLParser` built without `resolve_entities=False` expands entities in the document, so " +
      "a crafted file can read local files or reach internal hosts (XXE). Pass " +
      "`resolve_entities=False, no_network=True`, or parse untrusted XML with `defusedxml`.",
    check: (_m, content) => /\blxml\b/.test(content),
  },
  {
    id: "py-xxe",
    lang: "py",
    // ElementTree / minidom / sax / lxml parse calls, by module alias or by an imported bare name.
    re: /(?<![\w.])(?:(\w+)\.)?(parse|fromstring|parseString|iterparse|XML)\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g,
    severity: "warning",
    title: "XML parsed without entity protection",
    detail:
      "Python's XML parsers (lxml, ElementTree, minidom, sax) expand entities and, depending on the " +
      "version, resolve external ones, so an untrusted document can exhaust memory or read files. " +
      "Parse it with `defusedxml` (`defusedxml.ElementTree.fromstring`), or give lxml a parser with " +
      "`resolve_entities=False`.",
    check: (m, content) => pyXmlCallUnsafe(m[1], m[2], m[3], content),
  },
  {
    id: "py-unsafe-deserialization",
    lang: "py",
    re: /\btorch\.load\s*\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)|\b(?:shelve\.open|dill\.loads?|jsonpickle\.decode|marshal\.loads?|cloudpickle\.loads?|pickle\.Unpickler|pd\.read_pickle|pandas\.read_pickle)\s*\(/g,
    severity: "warning",
    title: "Deserialiser that runs code from the data",
    detail:
      "`torch.load` without `weights_only=True`, `shelve`, `dill`, `jsonpickle`, `marshal` and " +
      "`read_pickle` all unpickle, which executes whatever the file says. Load only files you wrote; " +
      "for models use `torch.load(…, weights_only=True)` or safetensors, for data use JSON.",
    // A training or eval script loading the checkpoint its own operator passes on the
    // command line is not a trust boundary (18 of 18 corpus hits after thirdparty/).
    check: (m, content) =>
      (m[1] === undefined || !/\bweights_only\s*=\s*True\b/.test(m[1])) &&
      !(m[1] !== undefined && (/^\s*(?:self\.)?args\.|\bopt\.|\bcfg\.|\bconfig\./.test(m[1]) || /^[ \t]*import[ \t]+argparse\b|ArgumentParser\s*\(/m.test(content))),
  },
  {
    id: "py-random-for-secret",
    lang: "py",
    re: /(?<![\w.])random\.(?:randint|randrange|choice|choices|sample|random|getrandbits|shuffle)\s*\(/g,
    severity: "warning",
    title: "Security value generated with the random module",
    detail:
      "`random` is a Mersenne Twister: its output can be predicted from earlier values. Tokens, " +
      "passwords, OTPs and nonces need `secrets` (`secrets.token_urlsafe`, `secrets.choice`).",
    check: (m, content) => pyRandomForSecret(content, m.index ?? 0),
  },
  {
    id: "sql-builder-interpolated",
    lang: "go",
    // gorm / xorm / sqlbuilder / database/sql methods handed a formatted or concatenated string.
    re: /\.(?:Where|Or|Not|Having|Order|Group|Joins|Select|Raw|Exec|Query|QueryRow|QueryContext|ExecContext|Table|Distinct)\s*\(\s*(?:ctx\s*,\s*)?(?:fmt\.Sprintf\s*\(|"[^"\n]*"\s*\+\s*[A-Za-z_]|[A-Za-z_][\w.]*\s*\+\s*")/g,
    severity: "warning",
    title: "Query builder handed a formatted string",
    detail:
      "The SQL fragment passed to the query builder is built with Sprintf or `+`, so a value in it is " +
      "parsed as SQL. Use placeholders (`Where(\"name = ?\", name)`) and map sort columns through an allowlist.",
    check: (m, content) => goSqlBuilderAllows(m, content),
  },
  {
    id: "sql-builder-interpolated",
    lang: "go",
    // A string quoted into SQL by hand: `fmt.Sprintf("… = '%s'", v)` in a file that talks to a database.
    re: /\bfmt\.Sprintf\s*\(\s*["`][^"`\n]*(?:'%[sv]'|\b(?:WHERE|SET|VALUES|LIKE|IN)\b[^"`\n]*%[sv])/gi,
    severity: "warning",
    title: "SQL text built with Sprintf",
    detail:
      "A value is formatted into SQL text, which is what SQL injection is. Pass it as a query " +
      "argument (`db.Query(\"… WHERE id = $1\", id)`).",
    check: (m, content) => goSqlBuilderAllows(m, content),
  },
  {
    id: "go-archive-path-traversal",
    lang: "go",
    // Zip slip: an archive entry's own name joined onto the extraction directory.
    re: /\b(?:filepath|path)\.Join\s*\([^()\n]*\b\w+\.(?:Name|FileHeader\.Name)\b(?!\s*\()/g,
    severity: "warning",
    title: "Archive entry name used as a path",
    detail:
      "Entry names in zip and tar archives are chosen by whoever made the archive; `../../etc/x` " +
      "escapes the target directory (zip slip). Reject names that are not `filepath.IsLocal`, or " +
      "check the joined path still has the directory plus a separator as its prefix.",
    check: (_m, content) =>
      /"archive\/(?:zip|tar)"/.test(content) &&
      !/\bHasPrefix\s*\(|\bIsLocal\s*\(|\bfilepath\.Rel\s*\(|\bsecurejoin\b|\bOpenRoot\s*\(|\bSecureJoin\s*\(/.test(content),
  },
  {
    id: "java-code-injection",
    lang: "java",
    // Expression and script engines handed a non-literal string.
    re: /\.parseExpression\s*\(\s*(?!")[\w.]|\bOgnl\.(?:getValue|setValue|parseExpression)\s*\(\s*(?!")[\w.]|\bMVEL\.(?:eval|compileExpression|executeExpression)\s*\(\s*(?!")[\w.]|\bnew\s+GroovyShell\s*\([^)]*\)\s*\.\s*(?:evaluate|parse)\s*\(\s*(?!")|\bVelocity\.evaluate\s*\(|\.createExpression\s*\(\s*(?!")[\w.]|\bnew\s+Template\s*\([^;\n]*\bnew\s+StringReader\s*\(/g,
    severity: "warning",
    title: "Expression or template engine evaluates a computed string",
    detail:
      "SpEL, OGNL, MVEL, JEXL, Groovy, Velocity and FreeMarker can call arbitrary Java methods. " +
      "Evaluating a string that carries user input is remote code execution. Evaluate fixed " +
      "expressions only, or use a restricted context (`SimpleEvaluationContext`, a sandboxed resolver).",
    check: (_m, content) =>
      !JAVA_SCRIPTING_TOOL.test(content) &&
      /\bimport\s+(?:org\.springframework\.expression|ognl|org\.mvel2|org\.apache\.commons\.jexl\d?|groovy\.lang|org\.apache\.velocity|freemarker\.template)\b/.test(content) &&
      !/\bSimpleEvaluationContext\b|\bSAFER_RESOLVER\b/.test(content),
  },
  {
    id: "java-code-injection",
    lang: "java",
    re: /\b\w*[eE]ngine\s*\.\s*eval\s*\(\s*(?!")[\w.]/g,
    severity: "warning",
    title: "Script engine evaluates a computed string",
    detail:
      "`ScriptEngine.eval` runs the string as a program with full access to the JVM. Evaluating " +
      "anything derived from input is remote code execution.",
    check: (_m, content) => /\bimport\s+javax\.script\b/.test(content) && !JAVA_SCRIPTING_TOOL.test(content),
  },

  // ---- Weak hashes where they matter: password storage and home-made MACs ----
  // Measured on 350 corpus repos (Nov 2026): the generic weak-hash rule was right
  // 1 time in 21; these two, judged on what is hashed, 36 of 60.
  {
    id: "weak-password-hash",
    lang: "php",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /(?<![\w$>:\\])(?:md5|sha1)\s*\(|\bhash\s*\(\s*['"](?:md5|sha1)['"]\s*,|\bMD5\s*\(\s*'/g,
    severity: "critical",
    title: "Password hashed with MD5/SHA-1",
    detail:
      "MD5 and SHA-1 are fast hashes: a leaked table of them is cracked at billions of guesses a second, and unsalted ones fall to lookup tables. Store passwords with a password hash (bcrypt, scrypt, argon2; `password_hash()` in PHP) and rehash old entries at the next login.",
  },
  {
    id: "weak-secret-mac",
    lang: "php",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /(?<![\w$>:\\])(?:md5|sha1)\s*\(|\bhash\s*\(\s*['"](?:md5|sha1)['"]\s*,|\bMD5\s*\(\s*'/g,
    severity: "warning",
    title: "Secret signed with a plain MD5/SHA-1 hash",
    detail:
      "Gluing a secret to the data and hashing it is not a signature: MD5 and SHA-1 allow length-extension and collision tricks. Use HMAC-SHA256 (`hash_hmac`, `hmac.new`, `crypto.createHmac`) and compare in constant time.",
  },
  {
    id: "weak-password-hash",
    lang: "py",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\bhashlib\.(?:md5|sha1)\s*\(|\b(?:MD5|SHA1|SHA)\.new\s*\(/g,
    severity: "critical",
    title: "Password hashed with MD5/SHA-1",
    detail:
      "MD5 and SHA-1 are fast hashes: a leaked table of them is cracked at billions of guesses a second, and unsalted ones fall to lookup tables. Store passwords with a password hash (bcrypt, scrypt, argon2; `password_hash()` in PHP) and rehash old entries at the next login.",
  },
  {
    id: "weak-secret-mac",
    lang: "py",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\bhashlib\.(?:md5|sha1)\s*\(|\b(?:MD5|SHA1|SHA)\.new\s*\(/g,
    severity: "warning",
    title: "Secret signed with a plain MD5/SHA-1 hash",
    detail:
      "Gluing a secret to the data and hashing it is not a signature: MD5 and SHA-1 allow length-extension and collision tricks. Use HMAC-SHA256 (`hash_hmac`, `hmac.new`, `crypto.createHmac`) and compare in constant time.",
  },
  {
    id: "weak-password-hash",
    lang: "js",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\bcreateHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/g,
    severity: "critical",
    title: "Password hashed with MD5/SHA-1",
    detail:
      "MD5 and SHA-1 are fast hashes: a leaked table of them is cracked at billions of guesses a second, and unsalted ones fall to lookup tables. Store passwords with a password hash (bcrypt, scrypt, argon2; `password_hash()` in PHP) and rehash old entries at the next login.",
  },
  {
    id: "weak-secret-mac",
    lang: "js",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\bcreateHash\s*\(\s*['"](?:md5|sha1)['"]\s*\)/g,
    severity: "warning",
    title: "Secret signed with a plain MD5/SHA-1 hash",
    detail:
      "Gluing a secret to the data and hashing it is not a signature: MD5 and SHA-1 allow length-extension and collision tricks. Use HMAC-SHA256 (`hash_hmac`, `hmac.new`, `crypto.createHmac`) and compare in constant time.",
  },
  {
    id: "weak-password-hash",
    lang: "go",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\b(?:md5|sha1)\.(?:New|Sum)\s*\(/g,
    severity: "critical",
    title: "Password hashed with MD5/SHA-1",
    detail:
      "MD5 and SHA-1 are fast hashes: a leaked table of them is cracked at billions of guesses a second, and unsalted ones fall to lookup tables. Store passwords with a password hash (bcrypt, scrypt, argon2; `password_hash()` in PHP) and rehash old entries at the next login.",
  },
  {
    id: "weak-secret-mac",
    lang: "go",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\b(?:md5|sha1)\.(?:New|Sum)\s*\(/g,
    severity: "warning",
    title: "Secret signed with a plain MD5/SHA-1 hash",
    detail:
      "Gluing a secret to the data and hashing it is not a signature: MD5 and SHA-1 allow length-extension and collision tricks. Use HMAC-SHA256 (`hash_hmac`, `hmac.new`, `crypto.createHmac`) and compare in constant time.",
  },
  {
    id: "weak-password-hash",
    lang: "java",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\bMessageDigest\s*\.\s*getInstance\s*\(\s*"(?:MD5|SHA-?1)"\s*\)|\bDigestUtils\s*\.\s*(?:md5|sha1)\w*\s*\(/g,
    severity: "critical",
    title: "Password hashed with MD5/SHA-1",
    detail:
      "MD5 and SHA-1 are fast hashes: a leaked table of them is cracked at billions of guesses a second, and unsalted ones fall to lookup tables. Store passwords with a password hash (bcrypt, scrypt, argon2; `password_hash()` in PHP) and rehash old entries at the next login.",
  },
  {
    id: "weak-secret-mac",
    lang: "java",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\bMessageDigest\s*\.\s*getInstance\s*\(\s*"(?:MD5|SHA-?1)"\s*\)|\bDigestUtils\s*\.\s*(?:md5|sha1)\w*\s*\(/g,
    severity: "warning",
    title: "Secret signed with a plain MD5/SHA-1 hash",
    detail:
      "Gluing a secret to the data and hashing it is not a signature: MD5 and SHA-1 allow length-extension and collision tricks. Use HMAC-SHA256 (`hash_hmac`, `hmac.new`, `crypto.createHmac`) and compare in constant time.",
  },
  {
    id: "weak-password-hash",
    lang: "rb",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\bDigest::(?:MD5|SHA1)\.\w*digest\s*\(/g,
    severity: "critical",
    title: "Password hashed with MD5/SHA-1",
    detail:
      "MD5 and SHA-1 are fast hashes: a leaked table of them is cracked at billions of guesses a second, and unsalted ones fall to lookup tables. Store passwords with a password hash (bcrypt, scrypt, argon2; `password_hash()` in PHP) and rehash old entries at the next login.",
  },
  {
    id: "weak-secret-mac",
    lang: "rb",
    // Judged by weakHashKindAllows(): the hashed value has to be a password
    // (or a secret concatenated with data), not just sit near one.
    re: /\bDigest::(?:MD5|SHA1)\.\w*digest\s*\(/g,
    severity: "warning",
    title: "Secret signed with a plain MD5/SHA-1 hash",
    detail:
      "Gluing a secret to the data and hashing it is not a signature: MD5 and SHA-1 allow length-extension and collision tricks. Use HMAC-SHA256 (`hash_hmac`, `hmac.new`, `crypto.createHmac`) and compare in constant time.",
  },

  // ---- Python -------------------------------------------------------------
  {
    id: "py-shell-true",
    lang: "py",
    // No dotAll flag needed: `[^)]` already spans newlines, and `s` requires an
    // ES2018 target the dashboard's tsconfig does not use.
    // Bare names cover `from subprocess import Popen`; bare run/call are too generic to claim.
    re: /(?:\bsubprocess\.(?:run|call|check_output|check_call|Popen)|(?<![\w.])(?:Popen|check_output|check_call))\s*\((?:[^()]|\([^()]*\))*shell\s*=\s*True/g,
    severity: "critical",
    title: "subprocess called with shell=True",
    detail:
      "`shell=True` sends the command through a shell, so any interpolated value containing `;` or " +
      "backticks runs as its own command. Drop it and pass the command as a list of arguments.",
  },
  {
    id: "py-os-system",
    lang: "py",
    re: /\bos\.(?:system|popen)\s*\(\s*(?:f['"]|['"][^'"]*['"]\s*[+%]|[A-Za-z_])/g,
    severity: "critical",
    title: "os.system() with a constructed command",
    detail:
      "`os.system` always runs a shell, and the command here is built rather than fixed. Use " +
      "`subprocess.run([...])` with an argument list, which does not involve a shell at all.",
  },
  {
    id: "py-yaml-load",
    lang: "py",
    // yaml.load without a Loader= argument constructs arbitrary Python objects.
    re: /\byaml\.load\s*\((?![^)]*(?:Loader\s*=|Safe\w*Loader|BaseLoader|CSafeLoader))/g,
    severity: "critical",
    title: "yaml.load() without a safe loader",
    detail:
      "Plain `yaml.load` can instantiate arbitrary Python objects from the document, which makes " +
      "parsing an untrusted file equivalent to running it. Use `yaml.safe_load`.",
  },
  {
    id: "py-pickle-load",
    lang: "py",
    re: /\bpickle\.loads?\s*\(/g,
    severity: "warning",
    title: "pickle deserialises arbitrary objects",
    detail:
      "Unpickling executes constructors chosen by the data, so a crafted payload runs code. It is " +
      "safe only for data you produced yourself and stored somewhere nobody else can write. For " +
      "anything crossing a trust boundary use JSON.",
  },
  {
    id: "py-eval-exec",
    lang: "py",
    // Not `def eval(self, …)`, not `obj.eval(…)`.
    re: /(?<![.\w])(?<!def\s+)(?:eval|exec)\s*\(\s*[^)'"\s]/g,
    severity: "critical",
    title: "eval()/exec() on a non-literal value",
    detail:
      "Both execute the string they are handed. If any part of it can come from outside the " +
      "program this is remote code execution. Use `ast.literal_eval` for data, or an explicit " +
      "mapping of permitted operations.",
  },
  {
    id: "py-verify-false",
    lang: "py",
    re: /\brequests\.(?:get|post|put|patch|delete|head|request)\s*\([^)]*verify\s*=\s*False/g,
    severity: "critical",
    title: "TLS certificate verification disabled",
    detail:
      "`verify=False` accepts any certificate, so the connection is encrypted but not authenticated " +
      "and can be intercepted. Point `verify=` at the CA bundle that should be trusted instead.",
  },
]

/**
 * Ranges on a line that are inside a string or regex literal — text, not code.
 *
 * From a dogfood run: this scanner flagged its OWN rule table. `rejectUnauthorized:
 * false` really does appear there, inside `/…/g`, and the words "new Function()"
 * appear in the prose explaining the rule. Neither executes.
 *
 * That is not a quirk of scanning ourselves. Linters, security tooling, WAF
 * configs, documentation and test matchers all hold dangerous-looking text in
 * patterns and strings. A description of code is not code, and a scanner that
 * cannot tell the difference reports every security tool as insecure.
 *
 * The trade is deliberate and small: code assembled inside a string is missed.
 * That is the eval-family case, which the eval rules already catch at the call.
 *
 * Exported for tests — the distinction is load-bearing.
 */
export function literalRanges(line: string): [number, number][] {
  const ranges: [number, number][] = []
  let i = 0

  while (i < line.length) {
    const c = line[i]

    // A line comment ends the line for our purposes.
    if (c === "/" && (line[i + 1] === "/" || line[i + 1] === "*")) break

    if (c === '"' || c === "'" || c === "`") {
      const start = i
      i++
      while (i < line.length) {
        if (line[i] === "\\") i += 2
        else if (line[i] === c) break
        else i++
      }
      // Unterminated (a multi-line template): treat the rest of the line as text.
      ranges.push([start, i >= line.length ? line.length : i])
      i++
      continue
    }

    if (c === "/") {
      // `/` opens a regex only where a value may begin; after an identifier,
      // number or closing bracket it is division.
      const before = line.slice(0, i).trimEnd()
      const prev = before[before.length - 1] ?? ""
      if (prev === "" || /[(,=:[!&|?{};+*%<>~^-]/.test(prev)) {
        const start = i
        let j = i + 1
        let inClass = false
        for (; j < line.length; j++) {
          const ch = line[j]
          if (ch === "\\") j++
          else if (ch === "[") inClass = true
          else if (ch === "]") inClass = false
          else if (ch === "/" && !inClass) break
        }
        if (j < line.length) {
          ranges.push([start, j])
          i = j + 1
          continue
        }
      }
    }

    i++
  }

  return ranges
}

/** Line-comment markers, used to skip commented-out code. */
const COMMENT_MARKERS: Record<Lang, string[]> = {
  js: ["//"],
  py: ["#"],
  php: ["//", "#"],
  java: ["//"],
  rb: ["#"],
  go: ["//"],
  cs: ["//"],
}

function langOf(path: string): Lang | null {
  if (JS_RE.test(path)) return "js"
  if (PY_RE.test(path)) return "py"
  if (PHP_RE.test(path)) return "php"
  if (JAVA_RE.test(path)) return "java"
  if (RB_RE.test(path)) return "rb"
  if (GO_RE.test(path)) return "go"
  if (CS_RE.test(path)) return "cs"
  return null
}

/** 1-based line number of a string index. */
function lineAt(content: string, index: number): number {
  return content.slice(0, index).split("\n").length
}

const LOWER: Record<Severity, Severity> = {
  critical: "warning",
  warning: "info",
  info: "info",
}

/**
 * Rules that almost always fire on purpose in tests (fixtures that exercise
 * eval / Function / the scanner itself). Reporting them even at lowered severity
 * is noise — the finding is the test, not a vulnerability.
 */
const SKIP_IN_TEST = new Set([
  "exec-interpolated",
  "sql-interpolated",
  "innerhtml-dynamic",
  "react-dangerous-html",
  "document-write-dynamic",
  "py-eval-exec",
  "py-os-system",
  "py-shell-true",
  "py-yaml-load",
  "new-function",
  "eval-dynamic",
  // A test talking to its own self-signed fixture server, computing Content-MD5,
  // round-tripping an object through pickle, or making a throwaway token.
  // Every one of these in the benchmark was the test working as intended.
  "tls-verification-off",
  "py-verify-false",
  "weak-hash",
  "py-pickle-load",
  "random-for-secret",
  "java-xxe",
  "weak-password-hash",
  "weak-secret-mac",
  "php-include-user-input",
  "php-unserialize",
  "php-reflected-xss",
  "java-deserialization",
  "ruby-dynamic-dispatch",
  "ruby-marshal-load",
  "ruby-html-safe",
  "go-template-html",
  "dotnet-deserialization",
  "ssrf",
  "py-xxe",
  "py-unsafe-deserialization",
  "py-random-for-secret",
  "sql-builder-interpolated",
  "go-archive-path-traversal",
  "java-code-injection",
])

/** Sink rules from the harvested DB, still unlabelled (see PROVISIONAL_RULES in confidence.ts). */
const PROVISIONAL_SINK_RULES = new Set([
  "py-xxe",
  "py-unsafe-deserialization",
  "py-random-for-secret",
  "sql-builder-interpolated",
  "go-archive-path-traversal",
  "java-code-injection",
])

export interface CodeHit {
  rule: VulnRule
  line: number
  evidence: string
  /** Injection rules only: untrusted input appears near the match. */
  tainted?: boolean
}

/**
 * Collect rule hits for one file's contents.
 *
 * Exported for tests: the rule set is the interesting part of this scanner and
 * deserves to be exercised without a ScanContext around it.
 */

const PASSWORD_VALUE = /\b(?:password|passwd|passphrase|pwd|user_?pass)\w*\b|\$pass\b/i
const SECRET_VALUE = /\b\w*(?:secret|private_?key|api_?key|signing_?key|hmac_?key|encryption_?key)\w*\b/i
// Protocols that mandate MD5/SHA-1 over a password or secret: not the project's choice.
const MANDATED_HASH = /\bAPOP\b|\brealm\b|\bcnonce\b|WWW-Authenticate|258EAFA5-E914-47DA-95CA-C5AB0DC85B11/i

/** What a hash call hashes: its own arguments, plus `.update()`/`.Write()` calls on the next two lines. */
export function hashInput(content: string, idx: number): string {
  const open = content.indexOf("(", idx)
  if (open < 0) return ""
  let depth = 0
  let end = open
  for (; end < content.length && end < open + 400; end++) {
    const ch = content[end]
    if (ch === "(") depth++
    else if (ch === ")" && --depth === 0) break
  }
  const own = content.slice(open + 1, end)
  // The rest of this line and the next two: `h := sha1.New()` then `h.Write([]byte(data + secret))`.
  let stop = end
  for (let n = 0; n < 3 && stop >= 0; n++) stop = content.indexOf("\n", stop + 1)
  const next = content.slice(end, stop < 0 ? undefined : stop)
  const fed = [...next.matchAll(/\.(?:update|Write|digest)\s*\(([^\n]*)/g)].map((m) => m[1]).join(" ")
  return `${own} ${fed}`
}

/** weak-password-hash / weak-secret-mac: decided by the hashed value, not the neighbourhood. */
function weakHashKindAllows(ruleId: string, content: string, idx: number, line: string): boolean {
  const input = hashInput(content, idx)
  if (MANDATED_HASH.test(line) || MANDATED_HASH.test(input)) return false
  if (ruleId === "weak-password-hash") return PASSWORD_VALUE.test(input)
  // A secret on its own is a key derivation or a fingerprint; a MAC glues it to data.
  return !PASSWORD_VALUE.test(input) && SECRET_VALUE.test(input) && /\+|\s\.\s|\.\s*\$|\$\w+(?:\[[^\]]*\])?\s*\.|,/.test(input)
}

export function scanSource(content: string, lang: Lang): CodeHit[] {
  const markers = COMMENT_MARKERS[lang]
  // Parse whole-file text boundaries: line-local quoting cannot distinguish a
  // multiline documentation string or block comment from executable code.
  const textRanges: [number, number][] = []
  const staticFunctionCalls = new Set<number>()
  if (lang === "js") {
    const tree = parseFile(content, "source.tsx", { comments: true })
    const record = (node: Node) => {
      if (typeof node.start === "number" && typeof node.end === "number") {
        textRanges.push([node.start, node.end])
      }
    }
    if (tree) {
      walk(tree, (node) => {
        if (["StringLiteral", "RegExpLiteral", "TemplateElement"].includes(node.type ?? "")) record(node)
        // Feature probes and literal functions do not execute external input.
        // Keep dynamic code generation visible; this is not taint analysis.
        const callee = node.callee as Node | undefined
        if (node.type === "NewExpression" && callee?.type === "Identifier" && callee.name === "Function" &&
          typeof node.start === "number" && Array.isArray(node.arguments) && node.arguments.every((arg: Node) =>
            arg.type === "StringLiteral" || arg.type === "TemplateLiteral" && Array.isArray(arg.expressions) && arg.expressions.length === 0)) {
          staticFunctionCalls.add(node.start)
        }
      })
      if (Array.isArray(tree.comments)) for (const comment of tree.comments) record(comment as Node)
    }
  }
  // One finding per line: overlapping rules on the same line describe one defect.
  const byLine = new Map<number, CodeHit>()

  for (const rule of RULES) {
    if (rule.lang !== lang) continue
    rule.re.lastIndex = 0
    for (const m of content.matchAll(rule.re)) {
      const idx = m.index ?? 0
      if (textRanges.some(([start, end]) => idx >= start && idx < end)) continue
      if (rule.id === "new-function" && staticFunctionCalls.has(idx)) continue
      const lineStart = content.lastIndexOf("\n", idx - 1) + 1
      const prefix = content.slice(lineStart, idx)
      if (markers.some((mk) => prefix.includes(mk))) continue

      const line = lineAt(content, idx)
      const lineEnd = content.indexOf("\n", idx)
      const rawLine = content.slice(lineStart, lineEnd === -1 ? undefined : lineEnd)
      const text = rawLine.trim()

      if (lang === "js") {
        const col = idx - lineStart
        if (literalRanges(rawLine).some(([a, b]) => col > a && col < b)) continue
      }

      if (lang === "py") {
        const col = idx - lineStart
        if (literalRanges(rawLine).some(([a, b]) => col > a && col < b)) continue
      }
      if (rawLine.length > 1000) continue // minified bundle
      // The maintainers already reviewed this line for a security linter.
      // …on the line itself, or as a standalone directive on the line above (`//nolint:gosec` before the call).
      const prevStart = content.lastIndexOf("\n", lineStart - 2) + 1
      const prevLine = lineStart > 0 ? content.slice(prevStart, lineStart - 1) : ""
      const REVIEWED = /#\s*(?:noqa|nosec)\b|\/\/\s*(?:nosemgrep|eslint-disable|phpcs:ignore|nolint:[\w,\s]*gosec)|\bNOSONAR\b/
      if (REVIEWED.test(rawLine) || (/^\s*(?:#|\/\/)/.test(prevLine) && REVIEWED.test(prevLine))) continue
      // Docblock lines: ` * const v = await page.$eval(`, ``pickle.loads()``.
      if (/^\s*\*/.test(rawLine) || /``/.test(rawLine)) continue
      // Doctest continuation lines are documentation: `...     pickle.loads(x)`.
      if (/^\s*(?:>>>|\.\.\.)\s/.test(rawLine)) continue
      if (!contextAllows(rule.id, content, lineStart)) continue
      if (rule.check && !rule.check(m, content)) continue
      if ((rule.id === "weak-password-hash" || rule.id === "weak-secret-mac") && !weakHashKindAllows(rule.id, content, idx, rawLine)) continue

      const existing = byLine.get(line)
      // Keep the most severe rule when several match the same line; a specific
      // weak-hash finding (password, MAC) always replaces the generic one.
      const specific = (rule.id === "weak-password-hash" || rule.id === "weak-secret-mac") && existing?.rule.id === "weak-hash"
      if (existing && !specific && rank(existing.rule.severity) >= rank(rule.severity)) continue
      if (!sinkAllows(rule.id, rawLine, idx - lineStart, lang)) continue
      if (lang === "php" && rule.id === "exec-interpolated" &&
        /\bproc_open\s*\(\s*\[/.test(rawLine)) continue
      // Variable-only PHP includes and HTML output need a local request-to-sink flow.
      if ((rule.id === "php-include-user-input" || rule.id === "php-reflected-xss") && !/\$_(?:GET|POST|REQUEST|COOKIE)\b/.test(m[0]) &&
        !phpLocalRequestValue(content, idx, m[0])) continue
      const tainted = !INJECTION_RULES.has(rule.id)
        ? undefined
        : rule.id === "ssrf"
          // SSRF needs the request value in the call itself (or just above it): a
          // fetch of some URL in a function that also reads `req` elsewhere is
          // the common case in every server, and almost never SSRF.
          ? SSRF_TAINT.test(around(content, lineStart, 2, 0))
          : TAINT_RE[lang].test(around(content, lineStart, TAINT_WINDOW, 2))
      byLine.set(line, { rule, line, evidence: text.slice(0, 160), tainted })
    }
  }

  if (lang === "php") for (const hit of scanPhpSecurity(content)) {
    if (!byLine.has(hit.line)) byLine.set(hit.line, hit)
  }
  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

// --- helpers for the harvested-sink rules ------------------------------------

/** Go files that talk to a database: the SQL-builder rules only judge these. */
const GO_SQL_IMPORT =
  /"(?:database\/sql|gorm\.io\/gorm|github\.com\/jinzhu\/gorm|xorm\.io\/xorm|github\.com\/go-xorm\/xorm|github\.com\/huandu\/go-sqlbuilder|github\.com\/jmoiron\/sqlx|github\.com\/jackc\/pgx[^"]*|github\.com\/gocql\/gocql|github\.com\/uptrace\/bun|github\.com\/Masterminds\/squirrel|github\.com\/doug-martin\/goqu[^"]*|github\.com\/go-pg\/pg[^"]*)"|\bsqldb\b/

/**
 * Code whose job is evaluating scripts or expressions (a scripting console, an OGNL
 * wrapper, a rule engine): the evaluation is the feature, not an injection (6/6 corpus).
 */
const JAVA_SCRIPTING_TOOL = /\bclass\s+\w*(?:Script|Ognl|Expression|Interpreter|Evaluator|Console|Repl|Shell)\w*/

/** Go SQL builders: not the ORM's own SQL generator, not a placeholder list, not quoted identifiers. */
function goSqlBuilderAllows(m: RegExpMatchArray, content: string): boolean {
  if (!GO_SQL_IMPORT.test(content)) return false
  // The ORM/driver itself building DDL or clauses from schema metadata (gorm migrator, 3/5 corpus).
  if (/^package\s+(?:migrator|clause|schema|gorm|dialect\w*|callbacks)\b/m.test(content)) return false
  const idx = m.index ?? 0
  const end = content.indexOf("\n", content.indexOf(")", idx) + 1)
  const call = content.slice(Math.max(0, content.lastIndexOf("\n", idx - 1) - 400), end < 0 ? undefined : end)
  // `NOT IN (%s)` filled with "?,?,?" or table names run through a quoting helper.
  if (/strings\.Repeat\s*\(\s*"\?|Placeholders?\b|quote\w*Ident|QuoteIdentifier|pq\.Quote/i.test(call)) return false
  return true
}

const PY_XML_MODULE = /^(?:xml\.etree\.c?ElementTree|xml\.etree|lxml\.etree|lxml|xml\.dom\.minidom|xml\.dom\.pulldom|xml\.dom|xml\.sax|xml\.dom\.expatbuilder)$/

/** Names a Python file binds to XML parsing modules and functions, minus defusedxml's. */
function pyXmlNames(content: string): { modules: Set<string>; functions: Set<string>; defused: Set<string>; lxml: Set<string> } {
  const modules = new Set<string>()
  const lxml = new Set<string>()
  const functions = new Set<string>()
  const defused = new Set<string>()
  const names = (list: string) =>
    list.replace(/[()\\]/g, " ").split(",").map((n) => n.trim()).filter(Boolean).map((n) => {
      const [orig, alias] = n.split(/\s+as\s+/)
      return { orig: orig.trim(), bound: (alias ?? orig).trim() }
    })
  for (const m of content.matchAll(/^[ \t]*import[ \t]+([\w.]+)(?:[ \t]+as[ \t]+(\w+))?/gm)) {
    if (/^defusedxml\b/.test(m[1])) { defused.add(m[2] ?? m[1].split(".").pop()!); continue }
    if (PY_XML_MODULE.test(m[1])) {
      const bound = m[2] ?? m[1].split(".").pop()!
      modules.add(bound)
      if (/^lxml\b/.test(m[1])) lxml.add(bound)
    }
  }
  for (const m of content.matchAll(/^[ \t]*from[ \t]+([\w.]+)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm)) {
    const from = m[1]
    for (const { orig, bound } of names(m[2])) {
      if (/^defusedxml\b/.test(from)) { defused.add(bound); continue }
      if (PY_XML_MODULE.test(`${from}.${orig}`)) modules.add(bound)
      else if (PY_XML_MODULE.test(from)) functions.add(bound)
      else continue
      if (/^lxml\b/.test(from)) lxml.add(bound)
    }
  }
  for (const d of defused) { modules.delete(d); functions.delete(d) }
  return { modules, functions, defused, lxml }
}

/** py-xxe: a parse call on an XML module (or a function imported from one) with no parser handed in. */
function pyXmlCallUnsafe(alias: string | undefined, fn: string, args: string, content: string): boolean {
  if (/parser/i.test(args) || /^\s*[rbuf]*["']/i.test(args) || !args.trim()) return false
  const { modules, functions, lxml } = pyXmlNames(content)
  const name = alias ?? fn
  if (!(alias ? modules.has(alias) : functions.has(fn))) return false
  // Since Python 3.7.1 the standard library parsers resolve no external entities; what is
  // left (entity expansion) matters only for documents from outside. In the corpus all
  // stdlib hits on local files and tool replies were noise (3/3), so require such input.
  return lxml.has(name) || PY_XML_EXTERNAL.test(args)
}

/** Argument text that reads like a document from outside: an HTTP response or request, an upload, a payload. */
const PY_XML_EXTERNAL = /\b(?:resp|response|request|req|res|r)\b|\.(?:content|text|body|data|read)\b|\b(?:get_data|payload|upload\w*|xml_?string|xml_?str|xml_?data|raw_?xml|body|envelope|soap\w*|message|stream|data)\b/i

const PY_SECRET_NAME = /token|secret|passw|pwd|nonce|salt|otp|verifier|verification|reset_?code|api_?key|session_?(?:id|key)|csrf|one_?time|captcha|authenticator|activation/i
const PY_NOT_SECRET = /tokeni[sz]|tokens\b|token_ids|_tokens|num_token|max_token|token_count/i

/** py-random-for-secret: the value lands in a secret-named variable, or is returned by a secret-named function. */
function pyRandomForSecret(content: string, idx: number): boolean {
  if (!/^[ \t]*(?:import[ \t]+(?:[\w.]+[ \t]*,[ \t]*)*random\b|from[ \t]+random[ \t]+import)/m.test(content)) return false
  const lineStart = content.lastIndexOf("\n", idx - 1) + 1
  const line = content.slice(lineStart, idx)
  const secret = (s: string) => PY_SECRET_NAME.test(s) && !PY_NOT_SECRET.test(s)
  const lhs = line.match(/^\s*([\w.[\]'"]+)\s*\+?=(?!=)/)
  if (lhs) return secret(lhs[1])
  if (!/^\s*(?:return\b|yield\b|[\w'"]*\.join\s*\(|str\s*\(|\w+\s*\()/.test(line) && line.trim()) return false
  const before = content.slice(Math.max(0, lineStart - 3000), lineStart).split("\n").reverse()
  for (const l of before.slice(0, 40)) {
    const def = l.match(/^\s*(?:async\s+)?def\s+(\w+)/)
    if (def) return secret(def[1])
    const assign = l.match(/^\s*([\w.[\]'"]+)\s*\+?=(?!=)/)
    if (assign && /\(\s*$|\[\s*$/.test(l)) return secret(assign[1])
  }
  return false
}

/** Request input as a URL source, for SSRF (any language). */
const SSRF_TAINT =
  /\b(?:req|request)\.(?:query|body|params|args|form|values|GET|POST)\b|\$_(?:GET|POST|REQUEST|COOKIE)\b|\bparams\s*\[|\brequest\.get_json\b|\bc\.(?:Query|Param|PostForm)\s*\(|\br\.(?:FormValue|URL\.Query)\b/

/** Conservative PHP assignment flow: plain request values and aliases only.
 * Reassignments kill taint; function boundaries prevent borrowing another scope.
 * Calls, array lookups on locals, and multi-line expressions are left unclassified.
 */
function phpLocalRequestValue(content: string, sinkOffset: number, sink: string): boolean {
  const tainted = new Set<string>()
  const prefix = content.slice(0, sinkOffset).split(/\r?\n/).slice(-TAINT_WINDOW).join("\n")
  for (const statement of prefix.split(/[;\n]/)) {
    if (/\b(?:function|fn)\b|^\s*}/.test(statement)) tainted.clear()
    const assignment = statement.match(/^\s*(?:<\?php\s*)?(\$[A-Za-z_]\w*)\s*=\s*([\s\S]*)$/)
    if (!assignment) continue
    const [, target, value] = assignment
    const direct = /^\$_(?:GET|POST|REQUEST|COOKIE)\s*\[\s*(['"])[^'"]+\1\s*\]\s*$/.test(value)
    const alias = value.trim()
    if (direct || tainted.has(alias)) tainted.add(target)
    else tainted.delete(target)
  }
  return [...sink.matchAll(/\$[A-Za-z_]\w*/g)].some(([name]) => tainted.has(name))
}

/** Escaping and sanitising calls that make an echoed request value safe. */
const PHP_ESCAPED =
  /\b(?:htmlspecialchars|htmlentities|esc_(?:attr|html|url|js|textarea)|sanitize_\w+|wp_kses\w*|strip_tags|intval|floatval|urlencode|rawurlencode|json_encode|scrub_out|e)\s*\(|\(int\)|\(float\)/

/**
 * Per-match vetoes that need the line itself:
 *  - ssrf: browser code (service workers, components, extensions) fetches on
 *    the user's behalf: a browser is not a server, so there is no SSRF.
 *  - php-reflected-xss: the request value passes through an escaping call.
 *  - Ruby backticks inside a double-quoted string are text, not a command.
 *  - SQL handed to a prepare() call is parameterised by that call.
 */
function sinkAllows(ruleId: string, line: string, col: number, lang: Lang): boolean {
  // A string passed directly to a diagnostic API is not a query. Anchor at
  // this literal's argument position: a nested database call, or another call
  // later on the same line, must remain visible.
  if (ruleId === "sql-interpolated" && lang === "java") {
    const prefix = line.slice(0, col)
    if (/\b(?:log|logger)\s*\.\s*(?:trace|debug|info|warn|error|fatal)\s*\(\s*$/i.test(prefix) ||
      /\bthrow\s+new\s+(?:[\w$]+\.)*[\w$]*(?:Exception|Error)\s*\(\s*$/.test(prefix)) return false
  }
  // A request value passed into a function call is that function's output, not the raw input.
  if (ruleId === "php-reflected-xss") return !PHP_ESCAPED.test(line) && !/\b(?:echo|print)\b[^;$]*\w\s*\([^;]*\$_(?:GET|POST|REQUEST|COOKIE)/.test(line)
  if (ruleId === "exec-interpolated" && line[col] === "`") {
    return (line.slice(0, col).match(/"/g)?.length ?? 0) % 2 === 0
  }
  if (ruleId === "sql-interpolated") return !/\bprepare\s*\(/.test(line)
  // The host is fixed and only the path or query varies: `f"{API_URL}/{op}"`,
  // `f"https://api.x.com/{id}"`, `BASE_URI + "/token"`. A caller can choose
  // which endpoint of that server, not which server — not SSRF.
  if (ruleId === "ssrf" && /^[^(]*\(\s*(?:f["'](?:\{\s*(?:self\.|this\.)?[A-Z][A-Z0-9_]*\s*\}|https?:\/\/[\w.-]+)|(?:self\.|this\.)?[A-Z][A-Z0-9_]*\s*\+)/.test(line.slice(col))) return false
  // `redis_script.eval(...)`, `expr.eval()` — a method on an object, not Kernel#eval.
  if (ruleId === "eval-dynamic" && line.slice(0, col).trimEnd().endsWith(".")) return false
  // An import names a class; it disables nothing (`import …NoopHostnameVerifier;`).
  if (ruleId === "tls-verification-off" && /^\s*import\s/.test(line)) return false
  // A shell=True call whose command is a plain string literal runs fixed text.
  if (ruleId === "py-shell-true" && /(?:subprocess\.\w+|(?<![\w.])(?:Popen|check_output|check_call))\s*\(\s*(?:r|b)?(["'])[^"'{}%]*\1\s*,/.test(line)) return false
  // `eval(time, snapshot) {` declares a method called eval (PlayCanvas animation tracks).
  if (ruleId === "eval-dynamic" && /^\s*(?:async\s+|static\s+|public\s+|private\s+)*eval\s*\([^)]*\)\s*(?::\s*[\w<>[\]| ]+)?\s*\{/.test(line)) return false
  return true
}
const BROWSER_CODE_RE =
  /(^|\/)(?:public|static|assets|frontend|client|ui|web|www|browser|extension|src\/components|components|pages|app\/javascript)\/|(?:^|\/)(?:sw|service-worker)\.[cm]?[jt]s$|\.(?:tsx|jsx|vue|svelte)$/i

/** Rules whose risk depends on where the value comes from. */
export const INJECTION_RULES = new Set([
  "eval-dynamic",
  "new-function",
  "exec-interpolated",
  "sql-interpolated",
  "innerhtml-dynamic",
  "react-dangerous-html",
  "document-write-dynamic",
  "py-eval-exec",
  "py-os-system",
  "py-shell-true",
  "py-pickle-load",
  "py-yaml-load",
  "php-include-user-input",
  "php-unserialize",
  "php-reflected-xss",
  "java-deserialization",
  "ruby-dynamic-dispatch",
  "ruby-marshal-load",
  "ruby-html-safe",
  "go-template-html",
  "dotnet-deserialization",
  "ssrf",
])
/** Lines above the match searched for untrusted input — roughly one function. */
const TAINT_WINDOW = 25
/**
 * Untrusted sources a reviewer would trace: HTTP request fields, CLI args,
 * the URL, cross-window messages, uploaded files, interactive input.
 */
const TAINT_RE: Record<Lang, RegExp> = {
  rb: /\bparams\s*\[|\bparams\.(?:require|permit|fetch)\b|\brequest\.(?:params|body|query_string|headers|env)\b|\bcookies\s*\[/,
  go: /\br\.(?:URL\.Query|FormValue|PostFormValue|Form|PostForm|Body|Header|URL\.Path)\b|\bc\.(?:Query|Param|PostForm|FormValue|DefaultQuery|Bind\w*|ShouldBind\w*)\s*\(|\bmux\.Vars\b|\bchi\.URLParam\b/,
  cs: /\bRequest\.(?:Query|Form|QueryString|Params|Cookies|Headers|Body)\b|\bRequest\s*\[|\b(?:txt|tb|text)\w*\.Text\b(?!\s*=[^=])|\[From(?:Query|Body|Form|Route|Header)\]|\bHttpContext\.Request\b/,
  php: /\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER)\b|\$request->(?:input|get|query|post)\b|\bfile_get_contents\s*\(\s*['"]php:\/\/input/,
  java: /\brequest\.get(?:Parameter|Header|QueryString|InputStream|Reader|Cookies)\b|@(?:RequestParam|PathVariable|RequestBody|RequestHeader|CookieValue)\b|\bcall\.(?:parameters|receive)\b/,
  js: /\b(?:req|request|ctx\.request|ctx)\.(?:body|query|params|headers|cookies|url|originalUrl|path)\b|\blocation\.(?:search|hash|href|pathname)\b|\bsearchParams\b|\bdocument\.(?:cookie|referrer|URL)\b|\b(?:event|e|evt|msg)\.data\b|\bwindow\.name\b|\bformData\b|\.files\b|\buserInput\b/,
  py: /\bparams\s*\[\s*["']|\bparse_qsl?\s*\(|\bQUERY_STRING\b|\bquery_string\b|\brequest\.(?:args|form|json|data|values|files|GET|POST|body|query_params|path_params|cookies|headers|get_json)\b|\bself\.request\b|\bflask\.request\b/,
}

/** Up to `n` lines either side of the match, for rules that need context. */
function around(content: string, lineStart: number, before: number, after: number): string {
  let a = lineStart
  for (let k = 0; k < before && a > 0; k++) a = content.lastIndexOf("\n", a - 2) + 1
  let b = lineStart
  for (let k = 0; k <= after && b !== -1; k++) b = content.indexOf("\n", b + 1)
  return content.slice(a, b === -1 ? undefined : b)
}

/**
 * Context vetoes, each from a benchmark false positive:
 *  - weak-hash: SHA-1/MD5 are mandated by the WebSocket handshake, UUID v3/v5
 *    and many checksums; only a security-sounding neighbourhood makes it a finding.
 *  - py-eval-exec: `exec(compile(src, …))` is code generation (attrs, jinja,
 *    flask config), not evaluation of input.
 *  - react-dangerous-html: `__html` set to a literal is markup the author wrote.
 */
function contextAllows(ruleId: string, content: string, lineStart: number): boolean {
  // A factory is safe once the file disables DTDs or external entities anywhere.
  // Skipping verification behind an option the user sets (`if cfg.Insecure {`,
  // `else if spec.TLSSkipVerify {`) is a feature, not a default: 12 of 15 sampled Go hits.
  if (ruleId === "tls-verification-off" && /\bif\b[^\n{]*(?:insecure|skip_?tls|tls_?skip|skip_?verify|no_?verify|allow_?insecure|trust_?all|ignore_?(?:ssl|tls|cert))/i.test(around(content, lineStart, 4, 0))) return false
  if (ruleId === "java-xxe") {
    return !/disallow-doctype-decl|external-general-entities|external-parameter-entities|ACCESS_EXTERNAL_(?:DTD|SCHEMA|STYLESHEET)|FEATURE_SECURE_PROCESSING|SUPPORT_DTD|IS_SUPPORTING_EXTERNAL_ENTITIES|load-external-dtd/.test(content)
  }
  // Go's rand.Read/rand.Int are also crypto/rand; only math/rand is predictable.
  if (ruleId === "random-for-secret" && /^import\s*(?:\(|")/m.test(content)) {
    if (!/"math\/rand(?:\/v2)?"/.test(content)) return false
  }
  if (ruleId === "weak-hash") {
    return /password|passwd|secret|token|signature|\bsign|hmac|credential|\bauth/i.test(around(content, lineStart, 3, 3))
  }
  if (ruleId === "py-eval-exec") {
    return !/\bcompile\s*\(/.test(around(content, lineStart, 3, 0))
  }
  // `.readObject()` is also JsonReader/ObjectMapper; only Java serialisation
  // streams count, and not when a deserialisation filter guards them.
  if (ruleId === "java-deserialization") {
    return /\b(?:ObjectInputStream|XMLDecoder)\b/.test(content) && !/\b(?:ObjectInputFilter|SerialFilterChecker|setObjectInputFilter)\b/.test(content)
  }
  // Constructing a BinaryFormatter to Serialize is harmless; the hole is Deserialize.
  if (ruleId === "dotnet-deserialization" && /new\s+\w*Formatter\b/.test(around(content, lineStart, 0, 0))) {
    return /\.Deserialize\s*\(/.test(content)
  }
  // `new Function(...)` where Function is an imported or local class (Pulumi's
  // cloudfront.Function, a framework's Function resource) is a constructor call.
  if (ruleId === "new-function") {
    return !/\bimport\s*(?:type\s*)?\{[^}]*\bFunction\b[^}]*\}\s*from|\b(?:class|const|let|var)\s+Function\b|\bFunction\s*=\s*require\(/.test(content)
  }
  // ruamel.yaml's YAML().load is safe by default.
  if (ruleId === "py-yaml-load") return !/\bruamel\b/.test(content)
  if (ruleId === "react-dangerous-html") {
    const near = around(content, lineStart, 0, 3)
    const html = near.match(/__html\s*:\s*([`'"])/)
    if (html && !/\$\{/.test(near)) return false
  }
  return true
}

function rank(s: Severity): number {
  return s === "critical" ? 3 : s === "warning" ? 2 : 1
}

// --- cross-file taint -------------------------------------------------------
// A controller reads the request and calls a model function in another file;
// the model builds the SQL. Local taint sees neither half as dangerous. Here a
// low-confidence sink inside a function whose PARAMETER reaches the sink is
// upgraded when some caller of that function has request input in sight.

/** Function headers per language: group 1 is the name, group 2 the parameter list. */
const FN_HEADER: Record<Lang, RegExp> = {
  py: /^\s*(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/,
  js: /(?:function\s+(\w+)\s*\(([^)]*)\)|^\s*(?:export\s+)?(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?(?:function\s*)?\(([^)]*)\)\s*(?:=>|\{)|^\s*(?:async\s+|static\s+|public\s+|private\s+)*(\w+)\s*\(([^)]*)\)\s*\{)/,
  php: /function\s+(\w+)\s*\(([^)]*)\)/,
  rb: /^\s*def\s+(?:self\.)?(\w+[?!]?)\s*(?:\(([^)]*)\)|([^\n#]*))/,
  go: /^func\s+(?:\([^)]*\)\s*)?(\w+)\s*\(([^)]*)\)/,
  java: /(?:public|private|protected|static|final|synchronized)[\w<>[\],.?\s]*\s(\w+)\s*\(([^)]*)\)\s*(?:throws[^{]*)?\{?\s*$/,
  cs: /(?:public|private|protected|internal|static|async|virtual|override)[\w<>[\],.?\s]*\s(\w+)\s*\(([^)]*)\)\s*\{?\s*$/,
}

/** Sinks a caller's input can make dangerous through a parameter, by kind. */
const CROSS_FILE_KIND: [RegExp, "sql" | "exec"][] = [
  [/^insecure-sql-interpolated-/, "sql"],
  [/^insecure-(?:exec-interpolated|py-os-system|py-shell-true|eval-dynamic|py-eval-exec|new-function)-/, "exec"],
]

/** Third-party code copied into a repo (Tautulli ships mako and cherrypy under lib/). */
const VENDORED_SINK_RE = /(^|\/)(?:vendor|third_party|node_modules|lib\/(?:mako|cherrypy|jinja2|six|requests|urllib3))\//

/** Does parameter `n` reach the sink text? For SQL it has to be pasted into the string. */
function paramReaches(kind: "sql" | "exec", n: string, text: string): boolean {
  if (kind === "exec") return new RegExp(`\\b${n}\\b`).test(text)
  return new RegExp(
    [
      `\\{\\s*${n}\\b`, // f"…{n}" or $"…{n}"
      `\\$\\{\\s*${n}\\b`, // `…${n}`
      `#\\{\\s*${n}\\b`, // "…#{n}"
      `\\$${n}\\b`, // "…$n" in PHP
      `[+.]\\s*${n}\\b`, // "…" + n, "…" . $n
      `\\b${n}\\s*[+.]`,
      `%\\s*\\(?\\s*${n}\\b`, // "…%s" % n
      `\\.format\\([^)]*\\b${n}\\b`,
      `%[sv][^\\n]*,\\s*${n}\\b`, // Sprintf("…%s", n)
    ].join("|"),
  ).test(text)
}

/** Names too generic to link a call to one definition. */
const GENERIC_FN = new Set([
  "get", "set", "run", "main", "init", "call", "send", "load", "save", "read", "write", "open", "close",
  "query", "execute", "exec", "find", "handle", "handler", "render", "request", "process", "update",
  "create", "delete", "remove", "start", "stop", "test", "setup", "index", "show", "new", "edit",
  "constructor", "if", "for", "while", "switch", "catch", "function", "return",
])

function paramNames(raw: string, lang: Lang): string[] {
  return raw
    .split(",")
    .map((p) => p.replace(/=[\s\S]*$/, "").replace(/:[\s\S]*$/, "").trim())
    .map((p) => {
      if (lang === "php") return p.match(/\$(\w+)/)?.[1] ?? ""
      if (lang === "go") return p.split(/\s+/)[0] ?? ""
      if (lang === "java" || lang === "cs") return p.split(/\s+/).pop() ?? ""
      return p.replace(/^[*&.\s]+/, "").split(/\s+/)[0] ?? ""
    })
    .filter((n) => /^[A-Za-z_]\w*$/.test(n) && !["self", "cls", "this", "ctx", "context"].includes(n))
}

/** The function enclosing a 1-based line, if its header is within 80 lines above. */
function enclosingFunction(lines: string[], lineNo: number, lang: Lang): { name: string; params: string[] } | null {
  for (let i = lineNo - 1; i >= Math.max(0, lineNo - 80); i--) {
    const m = lines[i].match(FN_HEADER[lang])
    if (!m) continue
    const groups = m.slice(1)
    const name = groups.find((g, k) => k % 2 === 0 && g) ?? ""
    const params = groups.find((g, k) => k % 2 === 1 && g !== undefined) ?? ""
    if (!name || GENERIC_FN.has(name.toLowerCase()) || name.length < 4) return null
    return { name, params: paramNames(params, lang) }
  }
  return null
}

interface Source {
  norm: string
  lang: Lang
  lines: string[]
}

/** First call of `name(` in another place with request input around it, as "file:line". */
function taintedCaller(sources: Source[], name: string, defFile: string, defLine: number): string | null {
  const call = new RegExp(`(?<![\\w.$]def\\s|function\\s)\\b${name.replace(/[?!]/g, "\\$&")}\\s*\\(`)
  for (const src of sources) {
    for (let i = 0; i < src.lines.length; i++) {
      if (src.norm === defFile && Math.abs(i + 1 - defLine) < 80) continue
      if (!call.test(src.lines[i])) continue
      if (TEST_RE.test(src.norm)) continue
      if (FN_HEADER[src.lang].test(src.lines[i])) continue
      const near = src.lines.slice(Math.max(0, i - TAINT_WINDOW), i + 3).join("\n")
      if (TAINT_RE[src.lang].test(near)) return `${src.norm}:${i + 1}`
    }
  }
  return null
}

/**
 * Keep `max` findings out of many. Most severe first, but taken in turns across
 * rules, so one noisy rule cannot fill every slot: in mage-ai 25 SSRF and 11
 * eval criticals (both hidden as low confidence) pushed out a confirmed XSS.
 * Within a rule, order is severity, then confidence, then file order.
 */
export function capFindings(issues: Issue[], max: number): Issue[] {
  const ordered = issues
    .map((issue, i) => ({ issue, i }))
    .sort((a, b) =>
      rank(b.issue.severity) - rank(a.issue.severity) ||
      (CONFIDENCE_RANK[b.issue.confidence ?? "medium"] ?? 1) - (CONFIDENCE_RANK[a.issue.confidence ?? "medium"] ?? 1) ||
      a.i - b.i)
  const byRule = new Map<string, Issue[]>()
  for (const { issue } of ordered) {
    const rule = issue.id.slice(0, issue.id.length - issue.location.length - 1)
    if (!byRule.has(rule)) byRule.set(rule, [])
    byRule.get(rule)!.push(issue)
  }
  const out: Issue[] = []
  // Calibrated rules share the slots first; provisional ones only fill what is left,
  // so an unlabelled rule cannot push a known finding past the cap (commix testbed).
  const provisional = (rule: string) => PROVISIONAL_SINK_RULES.has(rule.replace(/^insecure-/, ""))
  for (const pass of [false, true]) {
    const lists = [...byRule].filter(([rule]) => provisional(rule) === pass).map(([, list]) => list)
    for (let round = 0; out.length < max; round++) {
      let took = false
      for (const list of lists) {
        if (round < list.length && out.length < max) { out.push(list[round]); took = true }
      }
      if (!took) break
    }
  }
  return out
}

export const insecureCodeScanner: Scanner = {
  id: "insecure-code",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []
    // Files with request input somewhere: the only places a tainted caller can be.
    const sources: Source[] = []
    // Low-confidence injection findings that may be reached from another file.
    const pending: { issue: Issue; lang: Lang; lines: string[]; line: number; norm: string }[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_COLLECT) break
      const norm = file.replace(/\\/g, "/")
      // Declaration signatures are erased by TypeScript; they cannot execute sinks.
      if (/\.d\.(?:ts|mts|cts)$/i.test(norm)) continue
      // In PHP apps `www/` (or `public/`) is the web root itself, not a docs site.
      const webRoot = /\.php$/i.test(norm) && /(^|\/)(?:www|public|htdocs)\//.test(norm)
      // Java/Kotlin package names are namespaces, not directory purposes:
      // com/example and org/owasp/benchmark below Maven/Gradle production
      // source roots must be scanned. Outer examples/docs trees still skip.
      const productionRoot = (JAVA_RE.test(norm) || /\.scala$/i.test(norm)) ? /(?:^|\/)src\/main\/(?:java|kotlin|scala)\//.exec(norm) : null
      const purposePath = productionRoot ? norm.slice(0, productionRoot.index + productionRoot[0].length) : norm
      if (SKIP_RE.test(norm) || (NOT_SHIPPED_RE.test(purposePath) && !webRoot)) continue

      if (/\.(?:rs|c|cc|cpp|cxx|h|hpp|hxx)$/i.test(norm)) {
        // Reviewed native TLS fixtures intentionally bypass verification.
        if (TEST_RE.test(norm) || /(?:^|\/)(?:test|tests)\.(?:rs|c|cc|cpp|cxx)$|_test\.(?:rs|c|cc|cpp|cxx)$/i.test(norm)) continue
        const size = await ctx.fileSize?.(file)
        if (size !== null && size !== undefined && size > MAX_BYTES) continue
        const content = await ctx.readFile(file)
        if (!content) continue
        const nativeHits = /\.rs$/i.test(norm) ? scanRustTlsSource(content) : scanCppTlsSource(content)
        for (const hit of nativeHits.slice(0, MAX_PER_FILE)) {
          if (issues.length >= MAX_COLLECT) break
          let ageDays = 0
          try { ageDays = await ctx.git.blameAgeDays(file, hit.line) } catch { /* blame unavailable */ }
          issues.push({ id: `insecure-${hit.rule.id}-${norm}:${hit.line}`, category: "security",
            severity: TEST_RE.test(norm) ? LOWER[hit.rule.severity] : hit.rule.severity,
            title: hit.rule.title, location: `${norm}:${hit.line}`, ageDays,
            detail: hit.rule.detail, evidence: hit.evidence })
        }
        continue
      }

      const lang = langOf(norm)
      if (!lang && !/\.(?:swift|scala)$/i.test(norm)) continue

      const size = await ctx.fileSize?.(file)
      if (size !== null && size !== undefined && size > MAX_BYTES) continue

      const content = await ctx.readFile(file)
      if (!content) continue

      if (!lang) {
        const isLanguageTest = TEST_RE.test(norm) || /Tests?\.(?:swift|scala)$/i.test(norm)
        for (const hit of (/\.scala$/i.test(norm) ? scanScalaSource(content) : scanSwiftSource(content)).slice(0, MAX_PER_FILE)) {
          if (issues.length >= MAX_COLLECT) break
          let ageDays = 0
          try { ageDays = await ctx.git.blameAgeDays(file, hit.line) } catch { /* blame unavailable */ }
          issues.push({
            id: `insecure-${hit.rule.id}-${norm}:${hit.line}`,
            category: "security", severity: isLanguageTest ? LOWER[hit.rule.severity] : hit.rule.severity,
            title: hit.rule.title, location: `${norm}:${hit.line}`, ageDays,
            detail: hit.rule.detail, evidence: hit.evidence,
            ...(hit.tainted === undefined ? {} : { confidence: hit.tainted ? "high" : "low" }),
          })
        }
        continue
      }

      const isTest = TEST_RE.test(norm)
      const lines = content.split(/\r?\n/)
      if (!isTest && TAINT_RE[lang].test(content)) sources.push({ norm, lang, lines })

      let perFile = 0
      const hits = scanSource(content, lang).filter(hit => !(
        /\.kts?$/i.test(norm) && hit.rule.id === "exec-interpolated" &&
        /\bRuntime\s*\.\s*getRuntime\s*\(\s*\)\s*\.\s*exec\s*\(/.test(lines[hit.line - 1] ?? "")
      ))
      if (/\.kts?$/i.test(norm)) for (const hit of scanKotlinSource(content)) {
        const existing = hits.findIndex(h => h.line === hit.line && h.rule.id === hit.rule.id)
        if (existing >= 0) hits[existing] = hit
        else hits.push(hit)
      }
      // Provisional (unlabelled) rules queue behind calibrated ones for the per-file slots:
      // a noisy new rule must not push a known finding out of a busy file (dsvw, nua-bench).
      hits.sort((a, b) => Number(PROVISIONAL_SINK_RULES.has(a.rule.id)) - Number(PROVISIONAL_SINK_RULES.has(b.rule.id)) || a.line - b.line)
      for (const hit of hits) {
        if (issues.length >= MAX_COLLECT || perFile >= MAX_PER_FILE) break
        if (isTest && SKIP_IN_TEST.has(hit.rule.id)) continue
        if (hit.rule.id === "ssrf" && lang === "js" && BROWSER_CODE_RE.test(norm)) continue
        perFile++

        // Blame gives the finding an age, so a fresh regression is visible next
        // to code that has been wrong for two years. Failure is not fatal.
        let ageDays = 0
        try {
          ageDays = await ctx.git.blameAgeDays(file, hit.line)
        } catch {
          /* blame unavailable — age stays 0 */
        }

        const issue: Issue = {
          id: `insecure-${hit.rule.id}-${norm}:${hit.line}`,
          category: "security",
          severity: isTest ? LOWER[hit.rule.severity] : hit.rule.severity,
          title: hit.rule.title,
          location: `${norm}:${hit.line}`,
          ageDays,
          detail: isTest
            ? `${hit.rule.detail} Lowered one severity step because this is a test file, where the ` +
              "pattern is often deliberate."
            : hit.rule.detail,
          evidence: hit.evidence,
          // Injection rules vouch for a finding only when untrusted input is in
          // sight: a request field, argv, user input. Without it the benchmark
          // showed these are mostly code generation and fixed commands.
          ...(hit.tainted === undefined ? {} : { confidence: hit.tainted ? "high" : "low" }),
        }
        issues.push(issue)
        if (hit.tainted === false && !isTest && hit.rule.id !== "ssrf") pending.push({ issue, lang, lines, line: hit.line, norm })
      }
    }

    for (const p of pending) {
      const kind = CROSS_FILE_KIND.find(([re]) => re.test(p.issue.id))?.[1]
      if (!kind) continue
      // Generated and vendored code is not the project's to fix.
      if (VENDORED_SINK_RE.test(p.norm)) continue
      if (/Code generated|DO NOT EDIT|@generated/.test(p.lines.slice(0, 8).join("\n"))) continue
      const fn = enclosingFunction(p.lines, p.line, p.lang)
      if (!fn || !fn.params.length) continue
      // The parameter has to reach the sink: on its line, or on the line that
      // builds the value the sink uses (`q = f"… {username}"` then `execute(q)`).
      // For SQL it must be pasted into the text, not bound through a placeholder.
      const sinkText = p.lines.slice(Math.max(0, p.line - 3), p.line).join("\n")
      if (!fn.params.some((n) => paramReaches(kind, n, sinkText))) continue
      const caller = taintedCaller(sources, fn.name, p.norm, p.line)
      if (!caller) continue
      p.issue.confidence = "high"
      p.issue.detail += ` Request input reaches \`${fn.name}()\` from ${caller}.`
    }

    if (issues.length <= MAX_TOTAL) return issues
    return capFindings(issues, MAX_TOTAL)
  },
}
