/**
 * Broken access control in WordPress plugins: entry points a visitor (or any
 * logged-in subscriber) can call, which reach a privileged action without a
 * capability check on the way.
 *
 * Entry points: wp_ajax_nopriv_* / admin_post_nopriv_* and hooks that run on
 * every request (init, wp_loaded, admin_init — which also fires for anonymous
 * admin-ajax.php requests — template_redirect, parse_request, ...) are public;
 * wp_ajax_* / admin_post_* are open to any logged-in user; REST routes are
 * public when permission_callback is missing, '__return_true' or returns true.
 *
 * The callback and the project functions it calls (three levels) are walked in
 * source order. A capability check (current_user_can, user_can,
 * is_super_admin, ...) seen before an action covers it. Account, role, plugin
 * and upload actions count always; option and file writes only when their name
 * or content comes from the request (fixed-name counters are everywhere).
 */
import type { Project } from "./analyze"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Node = any

export type Exposure = "public" | "user"

export interface AuthzFinding {
  kind: "missing-authz" | "csrf" | "data-exposure"
  /** the action changes settings with a request value under a fixed name */
  settings?: boolean
  file: string
  line: number
  action: string
  hook: string
  handler: string
  exposure: Exposure
  nonce: boolean
  chain: string[]
}

const PUBLIC_HOOKS = /^(?:wp_ajax_nopriv_.+|admin_post_nopriv_.+|init|wp_loaded|admin_init|template_redirect|parse_request|wp|send_headers|plugins_loaded|setup_theme|after_setup_theme|wp_head|wp_footer|login_init|login_form_.+|woocommerce_api_.+|rest_api_init_?.*|user_register|wp_login|authenticate|determine_current_user)$/
const USER_HOOKS = /^(?:wp_ajax_(?!nopriv_).+|admin_post_(?!nopriv_).+)$/

const CAP_CHECKS = new Set([
  "current_user_can", "user_can", "is_super_admin", "current_user_can_for_blog", "author_can", "map_meta_cap",
  "check_password_reset_key", "wp_check_password", "wp_authenticate", "wp_authenticate_username_password",
])
const NONCE_CHECKS = new Set(["check_ajax_referer", "wp_verify_nonce", "check_admin_referer", "verify_nonce"])

/**
 * Privileged actions and the arguments that must come from the request for the
 * call to be dangerous: the request picks WHICH option, meta key, file, post,
 * user, role or plugin. `[]` = dangerous whatever the arguments (file uploads).
 * Login, 2FA and social sign-up legitimately set auth cookies and create users;
 * those are judged by the account-takeover taint rule instead.
 */
const ACTIONS: Record<string, number[]> = {
  update_option: [0], add_option: [0], delete_option: [0], update_site_option: [0], delete_site_option: [0],
  update_user_meta: [1], add_user_meta: [1], delete_user_meta: [1], update_user_option: [1],
  update_post_meta: [1], delete_post_meta: [1],
  file_put_contents: [0], unlink: [0], rename: [0, 1], copy: [1], rmdir: [0], put_contents: [0],
  set_role: [0], add_role: [0], add_cap: [0], remove_cap: [0], grant_super_admin: [0],
  wp_delete_user: [0], wp_delete_post: [0], wp_trash_post: [0], wp_delete_attachment: [0], wp_delete_comment: [0],
  wp_update_post: [0], wp_insert_post: [0],
  activate_plugin: [0], activate_plugins: [0], deactivate_plugins: [0], delete_plugins: [0], switch_theme: [0], install: [0],
  move_uploaded_file: [], wp_handle_upload: [], wp_handle_sideload: [], media_handle_upload: [], media_handle_sideload: [], unzip_file: [],
}
/**
 * Settings changed with a request value under a fixed name: "unauthenticated
 * settings update", the most common missing-authorization report. Names that
 * are counters or UI state are left out ("likes", "dismissed_notice", ...).
 */
const VALUE_ACTIONS: Record<string, { value: number; target?: number }> = {
  update_option: { value: 1 }, update_site_option: { value: 1 }, add_option: { value: 1 },
  update_post_meta: { value: 2, target: 0 }, update_term_meta: { value: 2, target: 0 }, update_comment_meta: { value: 2, target: 0 },
  delete_option: { value: -1 }, delete_site_option: { value: -1 },
}
const UI_STATE = /count|like|view|visit|click|vote|rating|stat|cache|transient|dismiss|notice|seen|review|feedback|popup_shown|last_|_time|timestamp|nonce|session|cart|wishlist|compare|recent|track|impression/i
const UPLOADS = new Set(["move_uploaded_file", "wp_handle_upload", "wp_handle_sideload", "media_handle_upload", "media_handle_sideload", "unzip_file"])
/** Calls that print or return data to the client. */
const OUTPUT = /^(?:wp_send_json|wp_send_json_success|wp_send_json_error|print_r|var_dump|var_export|wp_die)$/
const SENSITIVE = /->get_results\s*\(\s*["'][^"']*\bFROM\b[^"']*(?:lead|entr|submission|subscriber|order|customer|contact|message|member|applicant|registration|booking|payment|invoice|user)|get_users\s*\(|get_userdata\s*\(|get_user_by\s*\(|user_email|user_pass|user_activation_key|->users\b|get_option\s*\(\s*['"][^'"]*(?:key|secret|token|pass|licen|credential|smtp|api)[^'"]*['"]/i
const REQUEST = /\$_(?:GET|POST|REQUEST|COOKIE|FILES|SERVER)\b|php:\/\/input|->get_(?:param|params|json_params|body_params|query_params|file_params|body)\s*\(|\$request\s*\[/i

const lower = (n: Node) => (typeof n === "string" ? n : typeof n?.name === "string" ? n.name : "").toLowerCase().replace(/^\\/, "")

function walk(node: Node, visit: (n: Node, parents: Node[]) => void) {
  const stack: [Node, Node[]][] = [[node, []]]
  while (stack.length) {
    const [n, parents] = stack.pop()!
    if (!n || typeof n !== "object") continue
    if (Array.isArray(n)) {
      for (let i = n.length - 1; i >= 0; i--) stack.push([n[i], parents])
      continue
    }
    if (n.kind) visit(n, parents)
    const next = n.kind ? [...parents.slice(-6), n] : parents
    for (const k of Object.keys(n)) {
      if (k === "loc" || k === "leadingComments" || k === "trailingComments") continue
      const v = n[k]
      if (v && typeof v === "object") stack.push([v, next])
    }
  }
}

/** All calls in a function body, in source order (nested closures excluded). */
function callsInOrder(body: Node): Node[] {
  const out: Node[] = []
  walk(body, (n, parents) => {
    if (parents.some((p) => p.kind === "closure" || p.kind === "arrowfunc" || p.kind === "function" || p.kind === "class")) return
    if (n.kind === "call" || n.kind === "new") out.push(n)
  })
  return out.sort((a, b) => (a.loc?.start?.offset ?? 0) - (b.loc?.start?.offset ?? 0))
}

function calleeName(call: Node): { name: string; method: boolean } {
  const w = call.what
  if (call.kind === "new") return { name: lower(w?.name ?? ""), method: false }
  if (w?.kind === "propertylookup" || w?.kind === "nullsafepropertylookup" || w?.kind === "staticlookup") return { name: lower(w.offset?.name ?? ""), method: true }
  if (w?.kind === "name") return { name: lower(w.name), method: false }
  return { name: "", method: false }
}

/** Variables assigned (directly or via other such variables) from request data in this function. */
function requestVars(src: string): Set<string> {
  const vars = new Set<string>()
  const assigns = [...src.matchAll(/\$(\w+)\s*(?:\[[^\]]*\])?\s*\.?=\s*([^;]+);/g)]
  for (let pass = 0; pass < 3; pass++) {
    for (const [, name, rhs] of assigns) {
      if (REQUEST.test(rhs) || [...rhs.matchAll(/\$(\w+)/g)].some((m) => vars.has(m[1]))) vars.add(name)
    }
  }
  return vars
}

export function auditAccessControl(project: Project): AuthzFinding[] {
  const findings: AuthzFinding[] = []
  const seen = new Set<string>()
  for (const { file, content, ast } of project.allFiles()) {
    if (!/add_action|add_filter|register_rest_route/.test(content)) continue
    walk(ast, (n) => {
      if (n.kind !== "call" || n.what?.kind !== "name") return
      const fn = lower(n.what.name)
      const args: Node[] = n.arguments ?? []
      if ((fn === "add_action" || fn === "add_filter") && args[0]?.kind === "string") {
        const hook = String(args[0].value)
        const exposure: Exposure | null = PUBLIC_HOOKS.test(hook) ? "public" : USER_HOOKS.test(hook) ? "user" : null
        if (!exposure) return
        for (const h of project.resolveCallback(args[1], file)) audit(h, hook, exposure)
      }
      if (fn === "register_rest_route") {
        const opts = args[2]
        const routes: Node[] = opts?.kind === "array" && opts.items?.[0]?.kind === "entry" && opts.items[0].key == null ? opts.items.map((i: Node) => i.value) : [opts]
        for (const r of routes) {
          if (r?.kind !== "array") continue
          const entry = (k: string) => r.items?.find((i: Node) => i?.kind === "entry" && i.key?.kind === "string" && i.key.value === k)?.value
          const pc = entry("permission_callback")
          const cb = entry("callback")
          if (!cb || !isOpenPermission(pc, project, file)) continue
          const route = `${args[0]?.kind === "string" ? args[0].value : "…"}${args[1]?.kind === "string" ? args[1].value : ""}`
          for (const h of project.resolveCallback(cb, file)) audit(h, `REST ${route}`, "public")
        }
      }
    })
  }
  return findings

  function audit(h: { node: Node; file: string; content: string; label: string }, hook: string, exposure: Exposure) {
    const state = { guarded: false, nonce: false }
    visitFn(h.node, h.file, h.content, [h.label], 0, state, new Set())

    function visitFn(fnNode: Node, fFile: string, fContent: string, chain: string[], depth: number, st: { guarded: boolean; nonce: boolean }, stack: Set<Node>) {
      if (stack.has(fnNode) || depth > 3) return
      stack.add(fnNode)
      const body = fnNode.body ?? fnNode
      const src = fContent.slice(body.loc?.start?.offset ?? 0, body.loc?.end?.offset ?? fContent.length)
      const params = (fnNode.arguments ?? []).map((p: Node) => lower(p.name))
      const tainted = requestVars(src)
      const sensitiveVars = new Set([...src.matchAll(/\$(\w+)\s*=\s*([^;]+);/g)].filter((m) => SENSITIVE.test(m[2])).map((m) => m[1]))
      // A REST/AJAX callback's parameter is the request.
      if (depth === 0 && hook.startsWith("REST")) for (const p of params) tainted.add(p)
      const fromRequest = (a: Node) => {
        const text = fContent.slice(a?.loc?.start?.offset ?? 0, a?.loc?.end?.offset ?? 0)
        return REQUEST.test(text) || [...text.matchAll(/\$(\w+)/g)].some((m) => tainted.has(m[1]) || (depth > 0 && params.includes(m[1].toLowerCase())))
      }
      for (const call of callsInOrder(body)) {
        const { name, method } = calleeName(call)
        if (!name) continue
        if (CAP_CHECKS.has(name)) st.guarded = true
        if (NONCE_CHECKS.has(name)) st.nonce = true
        const args: Node[] = call.arguments ?? []
        const line = call.loc?.start?.line ?? 0
        const need = ACTIONS[name]
        // Option / meta names built from a fixed prefix ('plugin_' . $id) cannot reach other settings.
        const keyed = /option|meta/.test(name)
        const whole = (a: Node) => !(keyed && (a?.kind === "bin" || a?.kind === "encapsed" || a?.kind === "string"))
        const hit = need !== undefined && !(name === "install" && !method) && (need.length === 0 || need.some((i) => args[i] && whole(args[i]) && fromRequest(args[i])))
        // Rows changed or deleted by a request-chosen id (IDOR): $wpdb->update/delete/replace, UPDATE/DELETE queries.
        if (!hit && !st.guarded && method && /^(?:update|delete|replace|query)$/.test(name)) {
          const recvText = fContent.slice(call.what?.what?.loc?.start?.offset ?? 0, call.what?.what?.loc?.end?.offset ?? 0)
          const sqlText = name === "query" ? fContent.slice(args[0]?.loc?.start?.offset ?? 0, args[0]?.loc?.end?.offset ?? 0) : ""
          const modifies = name !== "query" || /^\s*["'`]?\s*(?:UPDATE|DELETE)\b/i.test(sqlText)
          if (/wpdb|\bdb\b|dbo|database/i.test(recvText) && modifies && args.some((a) => fromRequest(a)) && !/webhook|ipn|notify|callback|cron/i.test(`${hook} ${chain.join(" ")}`)) {
            const key = `${fFile}:${line}`
            if (!seen.has(key)) {
              seen.add(key)
              findings.push({ kind: "missing-authz", file: fFile, line, action: `${recvText}->${name}()`, hook, handler: chain[0], exposure, nonce: true, chain })
            }
            continue
          }
        }
        // Fixed-name settings written with a request value (no capability check on the way).
        const va = VALUE_ACTIONS[name]
        // Payment / webhook endpoints are public by design and store what the provider sent.
        if (!hit && va && !st.guarded && !/webhook|ipn|notify|callback|stripe|paypal|cron/i.test(`${hook} ${chain.join(" ")}`)) {
          const keyText = fContent.slice(args[0]?.loc?.start?.offset ?? 0, args[0]?.loc?.end?.offset ?? 0)
          const valueFromRequest = va.value < 0 ? true : !!args[va.value] && fromRequest(args[va.value])
          const targetOk = va.target === undefined || (!!args[va.target] && fromRequest(args[va.target]))
          const optionName = va.target === undefined ? keyText : fContent.slice(args[1]?.loc?.start?.offset ?? 0, args[1]?.loc?.end?.offset ?? 0)
          if (valueFromRequest && targetOk && !UI_STATE.test(optionName) && !(va.value < 0 && !fromRequest(args[0]))) {
            const key = `${fFile}:${line}`
            if (!seen.has(key)) {
              seen.add(key)
              findings.push({ kind: "missing-authz", settings: true, file: fFile, line, action: `${name}()`, hook, handler: chain[0], exposure, nonce: true, chain })
            }
            continue
          }
        }
        if (hit) {
          const key = `${fFile}:${line}`
          if (!seen.has(key)) {
            // Capability checked but no nonce: an admin can be made to do it from another site.
            if (st.guarded && !st.nonce && !UPLOADS.has(name)) {
              seen.add(key)
              findings.push({ kind: "csrf", file: fFile, line, action: `${name}()`, hook, handler: chain[0], exposure, nonce: false, chain })
            } else if (!st.guarded) {
              seen.add(key)
              findings.push({ kind: "missing-authz", file: fFile, line, action: `${name}()`, hook, handler: chain[0], exposure, nonce: st.nonce || UPLOADS.has(name), chain })
            }
          }
          continue
        }
        // Anonymous callers receiving user records or secret options.
        if (!st.guarded && exposure === "public" && OUTPUT.test(name)) {
          const shown = args.map((a) => fContent.slice(a?.loc?.start?.offset ?? 0, a?.loc?.end?.offset ?? 0)).join(" ")
          if (SENSITIVE.test(shown) || [...shown.matchAll(/\$(\w+)/g)].some((m) => sensitiveVars.has(m[1]))) {
            const key = `x:${fFile}:${line}`
            if (!seen.has(key)) {
              seen.add(key)
              findings.push({ kind: "data-exposure", file: fFile, line, action: `${name}()`, hook, handler: chain[0], exposure, nonce: st.nonce, chain })
            }
          }
        }
        if (st.guarded && st.nonce) continue
        const def = project.lookupDef(name, method)
        if (def) visitFn(def.node, def.file, def.content, [...chain, `${name}()`], depth + 1, st, stack)
      }
      stack.delete(fnNode)
    }
  }
}

const ADMIN_PAGE_CALLBACK: Record<string, number> = {
  add_menu_page: 4, add_submenu_page: 5, add_options_page: 4, add_management_page: 4, add_theme_page: 4, add_users_page: 4,
  add_dashboard_page: 4, add_plugins_page: 4, add_posts_page: 4, add_media_page: 4, add_pages_page: 4, add_comments_page: 4,
  add_links_page: 4, add_object_page: 4, add_utility_page: 4, add_meta_box: 2, add_settings_field: 2, add_settings_section: 2,
}
const ADMIN_HOOKS = /^(?:admin_menu|network_admin_menu|user_admin_menu|admin_notices|network_admin_notices|all_admin_notices|admin_footer|admin_head|admin_enqueue_scripts|admin_print_scripts|current_screen|load-.+|in_admin_.+|manage_.+|add_meta_boxes.*|admin_page_.+|toplevel_page_.+|.+_page_.+|show_user_profile|edit_user_profile|personal_options.*|edit_user_profile_update|personal_options_update|admin_action_.+|wp_dashboard_setup|activate_.+|deactivate_.+|upgrader_process_complete|customize_register)$/

export interface Reach {
  /** functions a visitor or any logged-in user can reach (hook → call chain) */
  open: Map<Node, string>
  /** functions reached from admin screens only (menu pages, meta boxes, admin-only hooks) */
  admin: Set<Node>
}

/** Who can run which project function, following hooks and calls by name (six levels). */
export function reachability(project: Project): Reach {
  const open = new Map<Node, string>()
  const admin = new Set<Node>()
  const visit = (start: { node: Node; file: string; content: string }, mark: (n: Node) => boolean) => {
    const queue: { node: Node; depth: number }[] = [{ node: start.node, depth: 0 }]
    while (queue.length) {
      const { node, depth } = queue.shift()!
      if (!mark(node) || depth >= 6) continue
      for (const call of callsInOrder(node.body ?? node)) {
        const { name, method } = calleeName(call)
        const def = name ? project.lookupDef(name, method) : null
        if (def) queue.push({ node: def.node, depth: depth + 1 })
      }
    }
  }
  const openStarts: { h: { node: Node; file: string; content: string }; label: string }[] = []
  const adminStarts: { node: Node; file: string; content: string }[] = []
  for (const { file, content, ast } of project.allFiles()) {
    if (!/add_action|add_filter|register_rest_route|add_\w+_page|add_meta_box|add_settings_field/.test(content)) continue
    walk(ast, (n) => {
      if (n.kind !== "call" || n.what?.kind !== "name") return
      const fn = lower(n.what.name)
      const args: Node[] = n.arguments ?? []
      if ((fn === "add_action" || fn === "add_filter") && args[0]?.kind === "string") {
        const hook = String(args[0].value)
        const cbs = project.resolveCallback(args[1], file)
        if (PUBLIC_HOOKS.test(hook) || USER_HOOKS.test(hook)) for (const h of cbs) openStarts.push({ h, label: hook })
        else if (ADMIN_HOOKS.test(hook)) adminStarts.push(...cbs)
      } else if (fn in ADMIN_PAGE_CALLBACK) {
        adminStarts.push(...project.resolveCallback(args[ADMIN_PAGE_CALLBACK[fn]], file))
      } else if (fn === "register_rest_route") {
        const opts = args[2]
        const routes: Node[] = opts?.kind === "array" && opts.items?.[0]?.kind === "entry" && opts.items[0].key == null ? opts.items.map((i: Node) => i.value) : [opts]
        for (const r of routes) {
          if (r?.kind !== "array") continue
          const entry = (k: string) => r.items?.find((i: Node) => i?.kind === "entry" && i.key?.kind === "string" && i.key.value === k)?.value
          const cbs = project.resolveCallback(entry("callback"), file)
          if (isOpenPermission(entry("permission_callback"), project, file)) for (const h of cbs) openStarts.push({ h, label: `REST ${args[1]?.kind === "string" ? args[1].value : "…"}` })
          else adminStarts.push(...cbs)
        }
      }
    })
  }
  for (const { h, label } of openStarts) visit(h, (n) => (open.has(n) ? false : (open.set(n, label), true)))
  for (const h of adminStarts) visit(h, (n) => (admin.has(n) || open.has(n) ? false : (admin.add(n), true)))
  return { open, admin }
}

/** permission_callback that lets anyone in. */
function isOpenPermission(pc: Node, project: Project, file: string): boolean {
  if (!pc) return true
  if (pc.kind === "string" && /^__return_true$/i.test(pc.value)) return true
  if (pc.kind === "boolean" && pc.value) return true
  const defs = project.resolveCallback(pc, file)
  if (!defs.length) return false
  return defs.every((d) => {
    let open = true
    walk(d.node.body ?? d.node, (n) => {
      if (n.kind === "call" && (CAP_CHECKS.has(calleeName(n).name) || /auth|permission|can_|nonce|verify|logged/i.test(calleeName(n).name))) open = false
      if (n.kind === "return" && !(n.expr?.kind === "boolean" && n.expr.value)) open = false
    })
    return open
  })
}
