/**
 * Logic flaws that taint tracking does not see: checks whose result is thrown
 * away, guards that redirect but do not stop, secrets compared loosely, tokens
 * from predictable randomness, and "magic" request switches that log someone in.
 */
import type { Project } from "./analyze"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any

export type LogicKind = "ignored-check" | "guard-falls-through" | "loose-secret-compare" | "predictable-token" | "magic-switch" | "public-sensitive-file" | "is-admin-as-auth"

export interface LogicFinding {
  kind: LogicKind
  file: string
  line: number
  what: string
  weak: boolean
}

export const LOGIC_RULES: Record<LogicKind, { id: string; title: string; detail: string; severity: "critical" | "warning" }> = {
  "ignored-check": {
    id: "php-taint-ignored-check",
    title: "Security check whose result is ignored",
    detail: "A nonce, capability, password or reset-key check is called as a statement: its true/false result is dropped and execution continues either way. Use it in a condition and stop (wp_die / return) when it fails.",
    severity: "critical",
  },
  "guard-falls-through": {
    id: "php-taint-guard-falls-through",
    title: "Failed check redirects but does not stop",
    detail: "When the check fails the code redirects, but without exit/return the rest of the handler still runs for the unauthorised request (wp_redirect/header only send a header). Add exit; after the redirect.",
    severity: "critical",
  },
  "loose-secret-compare": {
    id: "php-taint-loose-secret-compare",
    title: "Secret compared with == (type juggling)",
    detail: "Request data is compared to a token, key, hash or password with == / != / strcmp. PHP compares numeric-looking strings ('0e123…') as numbers and strcmp(array, …) returns null, so a crafted value can pass. Use hash_equals() with strings.",
    severity: "critical",
  },
  "predictable-token": {
    id: "php-taint-predictable-token",
    title: "Security token from predictable randomness",
    detail: "A token, key, code or password is generated from rand/mt_rand/uniqid/time, which an attacker can predict or brute-force. Use random_bytes(), random_int() or wp_generate_password().",
    severity: "warning",
  },
  "public-sensitive-file": {
    id: "php-taint-public-sensitive-file",
    title: "Log, export or backup written to a web-accessible path",
    detail: "A log, export, backup or dump file is written under the uploads / wp-content / plugin directory with a name that can be guessed, so anyone can download it with a direct URL. Store it outside the web root, or add a long random part to the name and deny access (.htaccess / index.php), and delete it after use.",
    severity: "warning",
  },
  "is-admin-as-auth": {
    id: "php-taint-is-admin-as-auth",
    title: "is_admin() used as a permission check",
    detail: "is_admin() only says the request goes to an admin URL, and admin-ajax.php / admin-post.php count — including for visitors who are not logged in. It is not a capability check. Use current_user_can() with the capability the action needs.",
    severity: "critical",
  },
  "magic-switch": {
    id: "php-taint-magic-switch",
    title: "Request parameter switch logs a user in or grants a role",
    detail: "A request value compared with a fixed string unlocks a login, user creation or role change, with no capability or credential check in between. This is how debug back doors and hidden admin switches look; remove it or require a real authentication step.",
    severity: "critical",
  },
}

const REQUEST = /\$_(?:GET|POST|REQUEST|COOKIE|SERVER)\b|->get_param\s*\(|\$request\s*\[|php:\/\/input/i
const SECRET_NAME = /(?:token|nonce|secret|api_?key|apikey|hash|signature|sig\b|otp|passw|pwd|pass_?code|auth_?code|reset_?key|activation|verify_?code|access_?key|license)/i
const CHECKS = new Set(["wp_verify_nonce", "current_user_can", "user_can", "check_password_reset_key", "wp_check_password", "password_verify", "hash_equals", "is_user_logged_in", "is_super_admin"])
const AUTH_ACTIONS = new Set(["wp_set_auth_cookie", "wp_set_current_user", "wp_create_user", "wp_insert_user", "set_role", "add_role", "add_cap", "grant_super_admin", "wp_set_password"])
const VERIFY_HINT = /verify|valid|check|auth|oauth|token|signature|hash_equals|password|login|nonce|can_|capab/i
const WEAK_RANDOM = /\b(?:rand|mt_rand|uniqid|lcg_value|str_shuffle|array_rand)\s*\(|\b(?:md5|sha1|hash|base64_encode)\s*\([^;]*\b(?:time|microtime)\s*\(/i
const TOKEN_NAME = /(?:token|secret|reset_?key|activation_?key|api_?key|otp|password|passw|nonce|verif\w*_?code|pin_?code|auth_?code|confirm\w*_?(?:key|code)|invite_?code|magic_?link)/i
const STRONG_RANDOM = /\b(?:random_bytes|random_int|wp_generate_password|openssl_random_pseudo_bytes|wp_generate_uuid4|bin2hex\s*\(\s*random_bytes|sodium_|wp_hash_password|wp_rand)\s*\(/i

const lower = (n: Node) => (typeof n === "string" ? n : typeof n?.name === "string" ? n.name : "").toLowerCase().replace(/^\\/, "")

function calleeName(call: Node): string {
  const w = call?.what
  if (w?.kind === "name") return lower(w.name)
  if (w?.kind === "propertylookup" || w?.kind === "staticlookup" || w?.kind === "nullsafepropertylookup") return lower(w.offset?.name ?? "")
  return ""
}

function walk(node: Node, visit: (n: Node) => void) {
  const stack: Node[] = [node]
  while (stack.length) {
    const n = stack.pop()
    if (!n || typeof n !== "object") continue
    if (Array.isArray(n)) {
      for (let i = n.length - 1; i >= 0; i--) stack.push(n[i])
      continue
    }
    if (n.kind) visit(n)
    for (const k of Object.keys(n)) {
      if (k === "loc") continue
      const v = n[k]
      if (v && typeof v === "object") stack.push(v)
    }
  }
}

function text(content: string, n: Node): string {
  return n?.loc ? content.slice(n.loc.start.offset, n.loc.end.offset) : ""
}

function stops(body: Node): boolean {
  let stop = false
  walk(body, (n) => {
    if (n.kind === "exit" || n.kind === "return" || n.kind === "throw") stop = true
    if (n.kind === "call" && /^(?:wp_die|die|exit|wp_send_json(?:_error|_success)?|wp_safe_redirect_exit|abort|status_header_exit)$/.test(calleeName(n))) stop = true
  })
  return stop
}

/** `!check(...)`, `check(...) === false`, `false == check(...)` → the check call. */
function negatedCheck(test: Node): Node | null {
  if (test?.kind === "unary" && test.type === "!" && test.what?.kind === "call" && CHECKS.has(calleeName(test.what))) return test.what
  if (test?.kind === "bin" && ["===", "=="].includes(test.type)) {
    const [c, o] = test.left?.kind === "call" ? [test.left, test.right] : [test.right, test.left]
    if (c?.kind === "call" && CHECKS.has(calleeName(c)) && o?.kind === "boolean" && !o.value) return c
  }
  if (test?.kind === "bin" && (test.type === "||" || test.type === "&&")) return negatedCheck(test.left) ?? negatedCheck(test.right)
  return null
}

export function auditLogic(project: Project): LogicFinding[] {
  const out: LogicFinding[] = []
  const seen = new Set<string>()
  const push = (f: LogicFinding) => {
    const k = `${f.kind}|${f.file}|${f.line}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push(f)
    }
  }
  for (const { file, content, ast } of project.allFiles()) {
    walk(ast, (n) => {
      const line = n.loc?.start?.line ?? 0
      // 1. A check called for nothing.
      if (n.kind === "expressionstatement" && n.expression?.kind === "call") {
        const name = calleeName(n.expression)
        const args = n.expression.arguments ?? []
        const softAjax = (name === "check_ajax_referer" || name === "check_admin_referer") && args[2]?.kind === "boolean" && !args[2].value
        if (CHECKS.has(name) && name !== "is_user_logged_in" || softAjax) push({ kind: "ignored-check", file, line, what: `${name}()`, weak: name === "hash_equals" })
      }
      // 2. Failed check that only redirects.
      if (n.kind === "if") {
        const check = negatedCheck(n.test)
        if (check && n.body && !stops(n.body)) {
          let redirects = false
          walk(n.body, (b) => {
            if (b.kind === "call" && /^(?:wp_redirect|wp_safe_redirect|header|auth_redirect)$/.test(calleeName(b))) redirects = true
          })
          if (redirects) push({ kind: "guard-falls-through", file, line, what: `${calleeName(check)}()`, weak: false })
        }
        // 5. Magic switch: request == 'literal' unlocks an auth action.
        const t = text(content, n.test)
        const literalCompare = /(?:==|===|!=|!==)\s*['"][^'"]{3,}['"]|['"][^'"]{3,}['"]\s*(?:==|===)/.test(t) || /\b(?:isset|array_key_exists)\s*\(/.test(t)
        if (REQUEST.test(t) && literalCompare && !VERIFY_HINT.test(t)) {
          let action = ""
          let verified = false
          walk(n.body, (b) => {
            if (b.kind !== "call") return
            const c = calleeName(b)
            if (AUTH_ACTIONS.has(c) && !action && !verified) {
              // A fixed user id / role from code, not chosen by a verified credential.
              action = c
            }
            if (VERIFY_HINT.test(c) && !action) verified = true
          })
          // A stored value compared inside (activation hash, one-time key) is a real check.
          if (/hash_equals|===|!==|get_(?:user_)?meta|get_option|get_transient|wp_check_password|password_verify/.test(text(content, n.body).split(action)[0] ?? "")) verified = true
          if (action && !verified) push({ kind: "magic-switch", file, line, what: `${action}()`, weak: !/['"](?:administrator|admin)['"]|\b1\s*\)/.test(text(content, n.body)) })
        }
      }
      // 7. is_admin() as the only gate in front of a privileged action.
      if (n.kind === "if" && n.test) {
        const t = text(content, n.test)
        if (/\bis_admin\s*\(\s*\)/.test(t) && !/current_user_can|user_can|is_super_admin|check_admin_referer|check_ajax_referer|wp_verify_nonce|is_user_logged_in|wp_doing_ajax|DOING_AJAX|is_network_admin/.test(t)) {
          const negated = /!\s*is_admin\s*\(\s*\)/.test(t)
          // The branch that runs for "admin" requests: the body for is_admin(), what follows / else for !is_admin() + exit.
          const guarded = negated ? (stops(n.body) ? null : n.alternate) : n.body
          let action = ""
          if (guarded) walk(guarded, (b) => {
            if (b.kind === "call" && !action && /^(?:update_option|delete_option|add_option|update_site_option|unlink|rmdir|file_put_contents|rename|copy|wp_delete_post|wp_insert_post|wp_update_post|wp_delete_user|wp_insert_user|wp_update_user|wp_set_password|update_user_meta|set_role|add_cap|activate_plugin|deactivate_plugins|move_uploaded_file|wp_handle_upload|query|delete|put_contents)$/.test(calleeName(b))) {
              const args = text(content, b)
              if (REQUEST.test(args) || /\$_(?:GET|POST|REQUEST)/.test(text(content, guarded))) action = calleeName(b)
            }
          })
          if (negated && stops(n.body)) {
            // `if (!is_admin()) return;` then the rest of the function: look at the following statements of the same block.
            // (Handled conservatively: report only when the same block also reads request data and acts.)
            const parentText = content.slice(n.loc.end.offset, Math.min(content.length, n.loc.end.offset + 3000))
            const m = /\b(update_option|delete_option|unlink|file_put_contents|wp_delete_post|wp_update_user|wp_insert_user|update_user_meta|set_role|move_uploaded_file|wp_handle_upload)\s*\(/.exec(parentText)
            if (m && /\$_(?:GET|POST|REQUEST)/.test(parentText.slice(0, m.index + 400)) && !/current_user_can|check_ajax_referer|check_admin_referer|wp_verify_nonce/.test(parentText.slice(0, m.index))) action = m[1]
          }
          if (action) push({ kind: "is-admin-as-auth", file, line, what: `is_admin() → ${action}()`, weak: false })
        }
      }
      // 3. Loose comparison of a secret with request data.
      if (n.kind === "bin" && ["==", "!="].includes(n.type)) {
        const l = text(content, n.left), r = text(content, n.right)
        const req = REQUEST.test(l) && !REQUEST.test(r) ? r : REQUEST.test(r) && !REQUEST.test(l) ? l : null
        if (req !== null && SECRET_NAME.test(req) && !/^['"]|^\d|^(?:null|true|false)$/i.test(req.trim())) push({ kind: "loose-secret-compare", file, line, what: `${l.slice(0, 40)} ${n.type} ${r.slice(0, 40)}`, weak: false })
      }
      if (n.kind === "call" && calleeName(n) === "strcmp") {
        const args = (n.arguments ?? []).map((a: Node) => text(content, a))
        if (args.some((a: string) => REQUEST.test(a)) && args.some((a: string) => SECRET_NAME.test(a))) push({ kind: "loose-secret-compare", file, line, what: "strcmp()", weak: true })
      }
      // 6. Sensitive files in web-served places under guessable names.
      if (n.kind === "call" || n.kind === "new") {
        const c = calleeName(n)
        const args: Node[] = n.arguments ?? []
        const writes = /^(?:file_put_contents|fopen|error_log|put_contents|open|save|move_uploaded_file|copy|rename|fputcsv)$/.test(c)
        const target = c === "error_log" ? (args[1] && text(content, args[1]) === "3" ? args[2] : null) : c === "copy" || c === "rename" || c === "move_uploaded_file" ? args[1] : args[0]
        if (writes && target) {
          const t = text(content, target)
          const publicDir = /wp_upload_dir|WP_CONTENT_DIR|wp-content|uploads|plugin_dir_path|__DIR__|dirname\s*\(\s*__FILE__|ABSPATH|_PLUGIN_DIR|_PATH\b/i.test(t)
          const sensitive = /\.(?:log|sql|csv|bak|dump|txt|zip|tar|gz|json|xml)\b|(?:log|debug|export|backup|dump|invoice|order|report|archive)/i.test(t)
          const random = /wp_generate_password|random_bytes|wp_rand|random_int|bin2hex|wp_hash|hash_hmac|AUTH_KEY|NONCE_KEY|SECURE_AUTH|wp_salt|md5\s*\(\s*(?:wp_salt|AUTH|SECURE)|sha1\s*\(\s*(?:wp_salt|AUTH)/i
          // Resolve one level of variable: $file = $dir . 'debug.log'; file_put_contents($file, ...).
          let resolved = t
          const v = /^\$(\w+)$/.exec(t.trim())
          if (v) {
            const m = new RegExp(`\\$${v[1]}\\s*\\.?=\\s*([^;]+);`, "g")
            resolved = [...content.matchAll(m)].map((x) => x[1]).join(" ") || t
          }
          const pub = publicDir || /wp_upload_dir|WP_CONTENT_DIR|wp-content|uploads|plugin_dir_path|__DIR__|dirname\s*\(\s*__FILE__|ABSPATH|_PLUGIN_DIR/i.test(resolved)
          const sens = sensitive || /\.(?:log|sql|csv|bak|dump|zip|tar|gz)\b|(?:debug|export|backup|dump|invoice|archive)/i.test(resolved)
          if (pub && sens && !random.test(resolved) && !/tmp|temp|get_temp_dir|sys_get_temp_dir|\.htaccess|index\.php|\.css|\.js\b|cache/i.test(resolved)) {
            push({ kind: "public-sensitive-file", file, line, what: `${c}(${t.slice(0, 60)})`, weak: !/\.(?:log|sql|bak|dump)\b|debug|backup|dump/i.test(resolved) })
          }
        }
      }
      // 4. Token from weak randomness.
      if (n.kind === "assign" && n.operator === "=") {
        const target = text(content, n.left)
        const value = text(content, n.right)
        if (TOKEN_NAME.test(target) && WEAK_RANDOM.test(value) && !STRONG_RANDOM.test(value) && !/nonce_?life|time_?out|expir|timestamp|created|_at\b|date/i.test(target)) {
          push({ kind: "predictable-token", file, line, what: target.slice(0, 60), weak: !/reset|activation|otp|password|passw|api_?key|secret/i.test(target) })
        }
      }
    })
  }
  return out
}
