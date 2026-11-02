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

const JS_RE = /\.(ts|tsx|js|jsx|mjs|mts|cts)$/i
const PY_RE = /\.py$/i
const PHP_RE = /\.(?:php|phtml|inc)$/i
const JAVA_RE = /\.(?:java|kt)$/i
const RB_RE = /\.(?:rb|erb|rake)$/i
const GO_RE = /\.go$/i
const CS_RE = /\.(?:cs|cshtml)$/i
// Vendored/generated code is not ours to fix, and minified bundles produce
// garbage line numbers.
const SKIP_RE = /(^|\/)(?:node_modules|vendor|third_party|dist|build|out|\.next)\/|\.min\.[cm]?js$/i
/**
 * Code that never runs on anyone's input: examples, demos, benchmarks, docs
 * sites and their copies of the library, build and release scripts, and
 * vendored bundles (`jquery-3.7.1.js` under test/data, `*_assets/`). In the
 * 100-repo benchmark every finding under these paths was a false positive.
 */
const NOT_SHIPPED_RE =
  /(^|\/)(?:_?examples?|demos?|benchmarks?|bench|perf(?:-testing)?|performance|docs?|documentation|www|website|site|scripts?|tools?|[\w-]*_assets|static|_?vendor(?:ed)?|third_party|integration-?[tT]ests|test-utils|tooling|_tools|sphinx)\/|(^|\/)jquery[-.\d]*\.js$/i
const TEST_RE =
  /(^|\/)(?:__tests__|tests?|specs?|fixtures?)\/|\.(?:test|spec)\.[cm]?[jt]sx?$|(?:^|\/)test\.[cm]?[jt]s$|(?:^|\/)test_[^/]+\.py$|_test\.py$|(?:^|\/)conftest\.py$/i

const MAX_PER_FILE = 6
const MAX_TOTAL = 60
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
}

/** PHP, Java/Kotlin, Ruby, Go and C#: the injection classes DVWA, WebGoat, RailsGoat, govwa and WebGoat.NET teach. */
const PHP_JAVA_RULES: VulnRule[] = [
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
    re: /`[^`\n]*#\{|%x[({\[][^\n]*#\{|\b(?:system|exec|spawn|IO\.popen|Open3\.\w+)\s*\(?\s*"[^"\n]*#\{/g,
    severity: "critical",
    title: "Shell command built by string interpolation",
    detail:
      "An interpolated value reaches a shell, so `;` or `$(…)` in it runs a command of its own. " +
      "Pass the arguments separately (`system(\"ls\", dir)`), which skips the shell.",
  },
  {
    id: "eval-dynamic",
    lang: "rb",
    re: /\b(?:eval|instance_eval|class_eval|module_eval)\b(?!\s*(?:do\b|\{|\(\s*&|&))\s*\(?\s*[^\s"'(&:{|)]/g,
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
    re: /:?=\s*fmt\.Sprintf\s*\(\s*"\s*(?:SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\b[^"\n]*%[sv]/gi,
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
    re: /\b(?:eval|assert|create_function)\s*\(\s*[^)'"\s]/g,
    severity: "critical",
    title: "eval() on a non-literal value",
    detail: "`eval` runs whatever PHP it is given. If any part of it comes from a request, this is remote code execution.",
  },
  {
    id: "php-include-user-input",
    lang: "php",
    re: /\b(?:include|require)(?:_once)?\s*\(?\s*[^;]*\$_(?:GET|POST|REQUEST|COOKIE)/g,
    severity: "critical",
    title: "File included from request input",
    detail:
      "The path to include comes from the request: a local or remote file inclusion. Map the input " +
      "to a fixed allow-list of files instead.",
  },
  {
    id: "php-unserialize",
    lang: "php",
    re: /\bunserialize\s*\(\s*[^)'"\s]/g,
    severity: "warning",
    title: "unserialize() on a non-literal value",
    detail:
      "`unserialize` can instantiate arbitrary classes and trigger their magic methods. Use " +
      "`json_decode` for data that crosses a trust boundary.",
  },
  {
    id: "php-reflected-xss",
    lang: "php",
    re: /\b(?:echo|print)\b[^;]*\$_(?:GET|POST|REQUEST|COOKIE)\b(?![^;]*htmlspecialchars)/g,
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

  // ---- Python -------------------------------------------------------------
  {
    id: "py-shell-true",
    lang: "py",
    // No dotAll flag needed: `[^)]` already spans newlines, and `s` requires an
    // ES2018 target the dashboard's tsconfig does not use.
    re: /\bsubprocess\.(?:run|call|check_output|check_call|Popen)\s*\([^)]*shell\s*=\s*True/g,
    severity: "critical",
    title: "subprocess called with shell=True",
    detail:
      "`shell=True` sends the command through a shell, so any interpolated value containing `;` or " +
      "backticks runs as its own command. Drop it and pass the command as a list of arguments.",
  },
  {
    id: "py-os-system",
    lang: "py",
    re: /\bos\.system\s*\(\s*(?:f['"]|['"][^'"]*['"]\s*[+%]|[A-Za-z_])/g,
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
    re: /\byaml\.load\s*\((?![^)]*(?:Loader\s*=|Safe\w*Loader|BaseLoader))/g,
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
  "php-include-user-input",
  "php-unserialize",
  "php-reflected-xss",
  "java-deserialization",
  "ruby-dynamic-dispatch",
  "ruby-marshal-load",
  "ruby-html-safe",
  "go-template-html",
  "dotnet-deserialization",
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
      if (/#\s*(?:noqa|nosec)\b|\/\/\s*(?:nosemgrep|eslint-disable)|\bNOSONAR\b/.test(rawLine)) continue
      // Docblock lines: ` * const v = await page.$eval(`, ``pickle.loads()``.
      if (/^\s*\*/.test(rawLine) || /``/.test(rawLine)) continue
      // Doctest continuation lines are documentation: `...     pickle.loads(x)`.
      if (/^\s*(?:>>>|\.\.\.)\s/.test(rawLine)) continue
      if (!contextAllows(rule.id, content, lineStart)) continue

      const existing = byLine.get(line)
      // Keep the most severe rule when several match the same line.
      if (existing && rank(existing.rule.severity) >= rank(rule.severity)) continue
      const tainted = INJECTION_RULES.has(rule.id) ? TAINT_RE[lang].test(around(content, lineStart, TAINT_WINDOW, 2)) : undefined
      byLine.set(line, { rule, line, evidence: text.slice(0, 160), tainted })
    }
  }

  return [...byLine.values()].sort((a, b) => a.line - b.line)
}

/** Rules whose risk depends on where the value comes from. */
const INJECTION_RULES = new Set([
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
])
/** Lines above the match searched for untrusted input — roughly one function. */
const TAINT_WINDOW = 25
/**
 * Untrusted sources a reviewer would trace: HTTP request fields, CLI args,
 * the URL, cross-window messages, uploaded files, interactive input.
 */
const TAINT_RE: Record<Lang, RegExp> = {
  rb: /\bparams\s*\[|\bparams\.(?:require|permit|fetch)\b|\brequest\.(?:params|body|query_string|headers|env)\b|\bcookies\s*\[/,
  go: /\br\.(?:URL\.Query|FormValue|PostFormValue|Form|PostForm|Body|Header|URL\.Path)\b|\bc\.(?:Query|Param|PostForm|FormValue|DefaultQuery|Bind\w*|ShouldBind\w*)\s*\(|\bmux\.Vars\b|\bchi\.URLParam\b|\bos\.Args\b/,
  cs: /\bRequest\.(?:Query|Form|QueryString|Params|Cookies|Headers|Body)\b|\[From(?:Query|Body|Form|Route|Header)\]|\bHttpContext\.Request\b/,
  php: /\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER)\b|\$request->(?:input|get|query|post)\b|\bfile_get_contents\s*\(\s*['"]php:\/\/input/,
  java: /\brequest\.get(?:Parameter|Header|QueryString|InputStream|Reader|Cookies)\b|@(?:RequestParam|PathVariable|RequestBody|RequestHeader|CookieValue)\b|\bcall\.(?:parameters|receive)\b/,
  js: /\b(?:req|request|ctx\.request|ctx)\.(?:body|query|params|headers|cookies|url|originalUrl|path)\b|\bprocess\.argv\b|\blocation\.(?:search|hash|href|pathname)\b|\bsearchParams\b|\bdocument\.(?:cookie|referrer|URL)\b|\b(?:event|e|evt|msg)\.data\b|\bwindow\.name\b|\bformData\b|\.files\b|\buserInput\b/,
  py: /\brequest\.(?:args|form|json|data|values|files|GET|POST|body|query_params|path_params|cookies|headers|get_json)\b|\bsys\.argv\b|(?<![.\w])input\s*\(|\bself\.request\b|\bflask\.request\b|\bupload|\brecv\s*\(/,
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
  if (ruleId === "weak-hash") {
    return /password|passwd|secret|token|signature|\bsign|hmac|credential|\bauth/i.test(around(content, lineStart, 3, 3))
  }
  if (ruleId === "py-eval-exec") {
    return !/\bcompile\s*\(/.test(around(content, lineStart, 3, 0))
  }
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

export const insecureCodeScanner: Scanner = {
  id: "insecure-code",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (SKIP_RE.test(norm) || NOT_SHIPPED_RE.test(norm)) continue

      const lang = langOf(norm)
      if (!lang) continue

      const size = await ctx.fileSize?.(file)
      if (size !== null && size !== undefined && size > MAX_BYTES) continue

      const content = await ctx.readFile(file)
      if (!content) continue

      const isTest = TEST_RE.test(norm)

      let perFile = 0
      for (const hit of scanSource(content, lang)) {
        if (issues.length >= MAX_TOTAL || perFile >= MAX_PER_FILE) break
        if (isTest && SKIP_IN_TEST.has(hit.rule.id)) continue
        perFile++

        // Blame gives the finding an age, so a fresh regression is visible next
        // to code that has been wrong for two years. Failure is not fatal.
        let ageDays = 0
        try {
          ageDays = await ctx.git.blameAgeDays(file, hit.line)
        } catch {
          /* blame unavailable — age stays 0 */
        }

        issues.push({
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
        })
      }
    }

    return issues
  },
}
