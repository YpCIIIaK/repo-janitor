/**
 * Catalogue for the php-taint add-on: where request data comes from, which
 * calls are dangerous with it (and in which argument), and which calls make it
 * safe for which kind of sink. Names are matched lower-case.
 */

/** Kinds of sink. A value can be safe for one kind and dangerous for another. */
export type SinkKind =
  | "sql"
  | "cmd"
  | "code"
  | "include"
  | "file"
  | "ssrf"
  | "xss"
  | "redirect"
  | "deser"
  | "ldap"
  | "upload"
  | "account"
  | "privesc"

/** `sqlq` = escaped for a quoted SQL literal only; unquoted use stays injectable. */
export type SafeKind = SinkKind | "sqlq"

export const ALL_SAFE: readonly SafeKind[] = ["sql", "sqlq", "cmd", "code", "include", "file", "ssrf", "xss", "redirect", "deser", "ldap", "upload", "account", "privesc"]

export interface RuleInfo {
  id: string
  title: string
  detail: string
  severity: "critical" | "warning"
}

export const RULES: Record<SinkKind, RuleInfo> = {
  sql: {
    id: "php-taint-sqli",
    title: "SQL injection: request input reaches a query",
    detail: "Request data is built into an SQL statement. Use a prepared statement with bound parameters (PDO/mysqli prepare + bind, $wpdb->prepare, query-builder bindings) instead of putting the value into the SQL text.",
    severity: "critical",
  },
  cmd: {
    id: "php-taint-cmdi",
    title: "Command injection: request input reaches a shell command",
    detail: "Request data is passed to a shell. Avoid the shell (proc_open with an argument array) or escape every argument with escapeshellarg() and validate it against an allowlist.",
    severity: "critical",
  },
  code: {
    id: "php-taint-code-injection",
    title: "Code injection: request input is executed as PHP",
    detail: "Request data reaches eval/assert/create_function or picks the function that is called. Never evaluate request data; map it to a fixed set of callables.",
    severity: "critical",
  },
  include: {
    id: "php-taint-file-inclusion",
    title: "File inclusion: request input chooses the file that is included",
    detail: "Request data selects the file passed to include/require, which allows local (and with allow_url_include remote) file inclusion. Map the input to an allowlist of files.",
    severity: "critical",
  },
  file: {
    id: "php-taint-path-traversal",
    title: "Path traversal: request input chooses a file that is read or written",
    detail: "Request data selects a filesystem path for a read, write, delete or upload. Use basename() and a fixed directory, or map the input to an allowlist, and verify the resolved path stays inside that directory.",
    severity: "critical",
  },
  ssrf: {
    id: "php-taint-ssrf",
    title: "SSRF: request input chooses the URL the server fetches",
    detail: "Request data controls the URL of a server-side request. Allow only known hosts and schemes and block internal addresses after DNS resolution.",
    severity: "critical",
  },
  xss: {
    id: "php-taint-xss",
    title: "XSS: request input is written to the page unescaped",
    detail: "Request data is echoed into HTML without escaping. Escape on output with htmlspecialchars($v, ENT_QUOTES, 'UTF-8') (or the framework's escaping helper).",
    severity: "critical",
  },
  redirect: {
    id: "php-taint-open-redirect",
    title: "Open redirect: request input chooses the redirect target",
    detail: "Request data becomes a redirect location. Redirect only to relative paths or an allowlist of hosts.",
    severity: "warning",
  },
  deser: {
    id: "php-taint-object-injection",
    title: "Object injection: request input is unserialized",
    detail: "unserialize() on request data can instantiate arbitrary classes (POP chains). Use json_decode, or pass ['allowed_classes' => false].",
    severity: "critical",
  },
  upload: {
    id: "php-taint-unrestricted-upload",
    title: "Unrestricted upload: the client chooses the stored file's name and extension",
    detail: "An uploaded file is stored under a name taken from the request without checking the extension against an allowlist, so a .php file can be uploaded into a web-served directory and executed. Generate the stored name yourself and allow only known extensions (and content types) outside the web root.",
    severity: "critical",
  },
  account: {
    id: "php-taint-account-takeover",
    title: "Account takeover: the request chooses whose password or login is changed",
    detail: "A request value selects the user whose password is reset/set or who is logged in, with no reset-key or capability check on the way. Verify the reset key (check_password_reset_key) or require current_user_can('edit_user', $id) before changing another account.",
    severity: "critical",
  },
  privesc: {
    id: "php-taint-privilege-escalation",
    title: "Privilege escalation: the request chooses which user meta or role is written",
    detail: "A request value picks the user meta key (or role) that is written, so a visitor can set wp_capabilities / user_level and become an administrator. Write only an allowlist of known meta keys.",
    severity: "critical",
  },
  ldap: {
    id: "php-taint-ldapi",
    title: "LDAP injection: request input reaches an LDAP filter",
    detail: "Request data is put into an LDAP search filter. Escape it with ldap_escape($v, '', LDAP_ESCAPE_FILTER).",
    severity: "critical",
  },
}

/** Superglobals that are request input as a whole. */
export const SUPERGLOBALS = new Set(["_get", "_post", "_request", "_cookie", "_files"])

/** $_SERVER keys a client controls. */
export const TAINTED_SERVER = /^(?:HTTP_\w+|REQUEST_URI|QUERY_STRING|PHP_SELF|PATH_INFO|PATH_TRANSLATED|ORIG_PATH_INFO|REDIRECT_URL|REDIRECT_QUERY_STRING|CONTENT_TYPE)$/i

/** Functions returning request input. */
export const SOURCE_FUNCTIONS = new Set(["getallheaders", "apache_request_headers", "filter_input_array", "get_query_var", "request", "input"])

/** Methods returning request input when called on a request-like receiver. */
export const SOURCE_METHODS = new Set([
  "input", "query", "post", "get", "all", "only", "except", "cookie", "header", "json", "file", "files",
  "getqueryparams", "getparsedbody", "getcontent", "getbody", "param", "params", "getparam", "getparams",
  "getpost", "getquery", "getvar", "getget", "getcookie", "getrawinput", "getjson", "fromquery", "route",
  "getpathinfo", "getrequesturi", "getheader", "getheaderline", "getuploadedfiles", "getclientfilename",
  "get_param", "get_params", "get_json_params", "get_body_params", "get_query_params", "get_file_params", "get_body",
  "get_url_params", "get_header",
  // Joomla-style input (JRequest, JInput, $app->input and ports like VikRequest)
  "getstring", "getvar", "getraw", "getcmd", "getword", "gethtml", "getarray", "getpath", "getusername", "getemail", "getbase64",
])

/** Typed getters of the same request objects: numbers and booleans carry no injection. */
export const CLEAN_REQUEST_METHODS = new Set(["getint", "getuint", "getfloat", "getdouble", "getbool", "getboolean", "absint", "getalnum"])

/** A receiver that is the HTTP request (Laravel, Symfony, PSR-7, CodeIgniter, Yii, Slim, CakePHP). */
export const REQUEST_RECEIVER = /(?:^(?:\\?\w+\\)*\w*(?:Request|Input)$|->input$|^\$input$|^\$(?:request|req|httprequest|serverrequest|wp_rest_request|rest_request)$|^\$this->(?:request|input)$|->(?:request|query|attributes|cookies|headers|files)$|^request\(\)$|^(?:\\?\w+\\)*(?:Input|Request)$|^\$this->(?:request|input)->(?:query|request|attributes|cookies|headers|files)$|getRequest\(\)$|^Yii::\$app->request$)/i

/** Validators that make a value safe for every sink when they hold. */
export const VALIDATORS = new Set([
  "is_numeric", "is_int", "is_integer", "is_float", "is_bool", "ctype_digit", "ctype_alnum", "ctype_alpha",
  "ctype_xdigit", "preg_match", "in_array", "array_key_exists", "filter_var", "is_uuid", "checkdate",
])

/** Results that carry no request data whatever the input. */
export const CLEAN_FUNCTIONS = new Set([
  "intval", "floatval", "doubleval", "boolval", "count", "sizeof", "strlen", "mb_strlen", "md5", "sha1", "hash",
  "hash_hmac", "crc32", "password_hash", "password_verify", "abs", "round", "ceil", "floor", "number_format",
  "bin2hex", "base64_encode", "uniqid", "time", "microtime", "rand", "mt_rand", "random_int", "is_numeric",
  "is_int", "is_string", "is_array", "isset", "empty", "ctype_digit", "ctype_alnum", "preg_match", "in_array",
  "array_key_exists", "strcmp", "strcasecmp", "strpos", "stripos", "strrpos", "str_contains", "str_starts_with",
  "str_ends_with", "file_exists", "is_file", "is_dir", "gettype", "get_class", "spl_object_hash", "date",
  "strtotime", "mktime", "checkdate", "array_sum", "max", "min", "ord", "dechex", "hexdec", "octdec", "bindec",
  "levenshtein", "similar_text", "soundex", "metaphone", "filesize", "filemtime", "ip2long", "inet_pton",
  "mysqli_num_rows", "mysql_num_rows", "mysqli_insert_id", "mysql_insert_id", "mysqli_affected_rows",
  "array_search", "array_count_values", "version_compare", "is_uploaded_file", "getimagesize", "exif_imagetype",
  "mime_content_type", "finfo_file", "uuid_create", "crypt", "sodium_crypto_secretbox",
])

/** Calls that only make the value safe for some sinks. */
export const SANITIZERS: Record<string, readonly SafeKind[]> = {
  htmlspecialchars: ["xss", "redirect"],
  htmlentities: ["xss", "redirect"],
  strip_tags: ["xss"],
  esc_html: ["xss"],
  esc_attr: ["xss"],
  esc_textarea: ["xss"],
  esc_js: ["xss"],
  esc_url: ["xss", "redirect"],
  esc_url_raw: ["redirect"],
  wp_kses: ["xss"],
  wp_kses_post: ["xss"],
  wp_kses_data: ["xss"],
  sanitize_text_field: ["xss"],
  sanitize_key: ["xss", "sql", "cmd", "file", "include", "ldap"],
  sanitize_file_name: ["file", "include", "xss"],
  sanitize_email: ["xss", "cmd"],
  absint: [...ALL_SAFE],
  e: ["xss"],
  h: ["xss"],
  urlencode: ["xss", "cmd", "ldap"],
  rawurlencode: ["xss", "cmd", "ldap"],
  json_encode: ["xss"],
  wp_json_encode: ["xss"],
  mysqli_real_escape_string: ["sqlq"],
  mysql_real_escape_string: ["sqlq"],
  mysql_escape_string: ["sqlq"],
  real_escape_string: ["sqlq"],
  escape_string: ["sqlq"],
  escape_str: ["sqlq"],
  addslashes: ["sqlq"],
  pg_escape_string: ["sqlq"],
  sqlite_escape_string: ["sqlq"],
  esc_sql: ["sqlq"],
  pg_escape_literal: ["sql"],
  pg_escape_identifier: ["sql"],
  quote: ["sql"],
  escape: ["sql"],
  prepare: ["sql"],
  escapeshellarg: ["cmd"],
  escapeshellcmd: ["cmd"],
  basename: ["file", "include"],
  ldap_escape: ["ldap"],
  preg_quote: [],
}

/** Calls whose result carries their first argument's data unchanged in kind. */
export const PASSTHROUGH = new Set([
  "trim", "ltrim", "rtrim", "chop", "strtolower", "strtoupper", "mb_strtolower", "mb_strtoupper", "ucfirst",
  "lcfirst", "ucwords", "substr", "mb_substr", "str_replace", "str_ireplace", "preg_replace", "sprintf",
  "vsprintf", "implode", "join", "explode", "str_split", "array_values", "array_keys", "array_merge",
  "array_map", "array_filter", "array_slice", "array_reverse", "array_unique", "array_pop", "array_shift",
  "end", "reset", "current", "next", "urldecode", "rawurldecode", "base64_decode", "stripslashes",
  "stripcslashes", "json_decode", "html_entity_decode", "htmlspecialchars_decode", "nl2br", "str_pad",
  "str_repeat", "strrev", "wordwrap", "strstr", "stristr", "strrchr", "substr_replace", "iconv",
  "mb_convert_encoding", "utf8_decode", "utf8_encode", "strval", "print_r", "var_export", "serialize",
  "unserialize", "http_build_query", "parse_url", "pathinfo", "dirname", "realpath", "compact", "array_combine",
  "array_fill_keys", "array_pad", "array_column", "filter_var", "stream_get_contents", "file_get_contents",
  "fread", "fgets", "gzuncompress", "gzinflate", "hex2bin", "str_word_count", "nl2br", "addcslashes",
  "quotemeta", "trim", "mb_strimwidth", "number_format", "wp_unslash", "stripslashes_deep", "urlencode_deep",
  "get_user_by", "get_userdata", "get_user_by_email", "get_user", "wp_get_current_user_by",
])

/** Sinks called as plain functions: argument index → kind. */
export const FUNCTION_SINKS: Record<string, { arg: number | "last"; kind: SinkKind }[]> = {
  mysql_query: [{ arg: 0, kind: "sql" }],
  mysql_unbuffered_query: [{ arg: 0, kind: "sql" }],
  mysql_db_query: [{ arg: 1, kind: "sql" }],
  mysqli_query: [{ arg: 1, kind: "sql" }],
  mysqli_real_query: [{ arg: 1, kind: "sql" }],
  mysqli_multi_query: [{ arg: 1, kind: "sql" }],
  mysqli_prepare: [{ arg: 1, kind: "sql" }],
  pg_query: [{ arg: "last", kind: "sql" }],
  pg_send_query: [{ arg: 1, kind: "sql" }],
  pg_prepare: [{ arg: 2, kind: "sql" }],
  sqlite_query: [{ arg: 0, kind: "sql" }, { arg: 1, kind: "sql" }],
  sqlsrv_query: [{ arg: 1, kind: "sql" }],
  oci_parse: [{ arg: 1, kind: "sql" }],
  odbc_exec: [{ arg: 1, kind: "sql" }],
  db2_exec: [{ arg: 1, kind: "sql" }],
  system: [{ arg: 0, kind: "cmd" }],
  exec: [{ arg: 0, kind: "cmd" }],
  passthru: [{ arg: 0, kind: "cmd" }],
  shell_exec: [{ arg: 0, kind: "cmd" }],
  popen: [{ arg: 0, kind: "cmd" }],
  proc_open: [{ arg: 0, kind: "cmd" }],
  pcntl_exec: [{ arg: 0, kind: "cmd" }],
  expect_popen: [{ arg: 0, kind: "cmd" }],
  mail: [{ arg: 4, kind: "cmd" }],
  assert: [{ arg: 0, kind: "code" }],
  create_function: [{ arg: 1, kind: "code" }],
  call_user_func: [{ arg: 0, kind: "code" }],
  call_user_method: [{ arg: 0, kind: "code" }],
  call_user_func_array: [{ arg: 0, kind: "code" }],
  forward_static_call: [{ arg: 0, kind: "code" }],
  array_map: [{ arg: 0, kind: "code" }],
  usort: [{ arg: 1, kind: "code" }],
  register_shutdown_function: [{ arg: 0, kind: "code" }],
  fopen: [{ arg: 0, kind: "file" }],
  file_get_contents: [{ arg: 0, kind: "file" }],
  file_put_contents: [{ arg: 0, kind: "file" }],
  readfile: [{ arg: 0, kind: "file" }],
  file: [{ arg: 0, kind: "file" }],
  unlink: [{ arg: 0, kind: "file" }],
  copy: [{ arg: 0, kind: "file" }, { arg: 1, kind: "file" }],
  rename: [{ arg: 0, kind: "file" }, { arg: 1, kind: "file" }],
  rmdir: [{ arg: 0, kind: "file" }],
  mkdir: [{ arg: 0, kind: "file" }],
  touch: [{ arg: 0, kind: "file" }],
  move_uploaded_file: [{ arg: 1, kind: "upload" }],
  highlight_file: [{ arg: 0, kind: "file" }],
  show_source: [{ arg: 0, kind: "file" }],
  parse_ini_file: [{ arg: 0, kind: "file" }],
  simplexml_load_file: [{ arg: 0, kind: "file" }],
  fpassthru: [],
  curl_init: [{ arg: 0, kind: "ssrf" }],
  fsockopen: [{ arg: 0, kind: "ssrf" }],
  pfsockopen: [{ arg: 0, kind: "ssrf" }],
  get_headers: [{ arg: 0, kind: "ssrf" }],
  wp_remote_get: [{ arg: 0, kind: "ssrf" }],
  wp_remote_post: [{ arg: 0, kind: "ssrf" }],
  wp_remote_request: [{ arg: 0, kind: "ssrf" }],
  wp_safe_remote_get: [],
  unserialize: [{ arg: 0, kind: "deser" }],
  maybe_unserialize: [{ arg: 0, kind: "deser" }],
  ldap_search: [{ arg: 2, kind: "ldap" }],
  ldap_list: [{ arg: 2, kind: "ldap" }],
  ldap_read: [{ arg: 2, kind: "ldap" }],
  printf: [{ arg: 0, kind: "xss" }, { arg: 1, kind: "xss" }, { arg: 2, kind: "xss" }],
  vprintf: [{ arg: 0, kind: "xss" }, { arg: 1, kind: "xss" }],
  wp_redirect: [{ arg: 0, kind: "redirect" }],
  reset_password: [{ arg: 0, kind: "account" }],
  wp_set_password: [{ arg: 1, kind: "account" }],
  wp_set_auth_cookie: [{ arg: 0, kind: "account" }],
  wp_set_current_user: [{ arg: 0, kind: "account" }],
  wp_update_user: [{ arg: 0, kind: "account" }],
  update_user_meta: [{ arg: 1, kind: "privesc" }],
  add_user_meta: [{ arg: 1, kind: "privesc" }],
  update_user_option: [{ arg: 1, kind: "privesc" }],
  redirect: [{ arg: 0, kind: "redirect" }],
}

/** Methods that run SQL when the receiver or the statement looks like a database call. */
export const SQL_METHODS = new Set([
  "query", "exec", "execute_query", "prepare", "multi_query", "real_query", "rawquery", "unprepared", "statement",
  "select", "insert", "update", "delete", "get_results", "get_var", "get_row", "get_col", "raw", "whereraw",
  "orwhereraw", "havingraw", "orhavingraw", "orderbyraw", "selectraw", "groupbyraw", "fromraw", "executequery",
  "executestatement", "executeupdate", "fetchall", "fetchassociative", "fetchallassociative", "fetchone",
  "fetchcolumn", "createquery", "createnativequery", "sql", "setquery", "loadresult", "loadassoclist", "loadobjectlist",
])

/** Methods that need a DB-looking receiver (they are common words elsewhere). */
export const SQL_METHOD_NEEDS_DB = new Set(["query", "exec", "prepare", "select", "insert", "update", "delete", "raw", "statement", "sql", "fetchall", "fetchone", "fetchcolumn"])

const DB_WORDS = new Set(["db", "dbo", "pdo", "conn", "connection", "mysql", "mysqli", "link", "wpdb", "database", "sql", "dbh", "dbc", "sth", "stmt", "adapter", "entitymanager", "em", "doctrine", "capsule"])
/**
 * A receiver that is a database handle, judged by its last name's words: `$this->db`,
 * `$pdo`, `$entityManager`. Substrings used to match: "em" in measurementFamilyRepository
 * and emailRepository made ORM repositories SQL sinks (deep-PHP review 2026-11-17, 7 fp).
 */
export const DB_RECEIVER = {
  test(recv: string): boolean {
    if (/^(?:DB|\\?Illuminate\\Support\\Facades\\DB)$/.test(recv)) return true
    const last = recv.split(/->|::|\\/).pop() ?? recv
    const words = last.replace(/[$()]/g, " ").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    return words.some((w) => DB_WORDS.has(w) || /^(?:db|mysqli?|sql)\w*$/.test(w)) || words.join("") === "entitymanager"
  },
}

export const SQL_TEXT = /\b(?:select\s[\s\S]*\bfrom|insert\s+into|update\s+\S+\s+set|delete\s+from|replace\s+into|drop\s+table|create\s+table|alter\s+table|where\s|order\s+by|union\s+select)\b/i

/** Paths that are not the project's own shipped code. */
export const SKIP_PATH = /(?:^|\/)(?:vendor|vendor[-_]prefixed|node_modules|third[-_]?party|thirdparty|bower_components|freemius|tests?|specs?|fixtures?|__tests__|docs?|examples?|demos?|payloads?|static|resources\/static)\//i
