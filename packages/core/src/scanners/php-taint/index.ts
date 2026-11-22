import type { FlowStep, Issue } from "../../schema"
import type { Scanner, ScanContext } from "../../scanner"
import { Project, type Finding } from "./analyze"
import { auditAccessControl, reachability } from "./authz"
import { auditLogic, LOGIC_RULES } from "./logic"
import { RULES, SKIP_PATH } from "./model"

const PHP_FILE = /\.(?:php|phtml|php[3-8]|inc)$/i
const MAX_BYTES = 1_000_000
const MAX_FILES = 8000
const MAX_FINDINGS = 400

/**
 * php-taint — an optional, deeper PHP vulnerability scanner (off by default).
 *
 * Parses PHP into an AST and follows request data (superglobals, php://input,
 * framework request objects) through assignments, string building, branches
 * and the project's own functions to SQL, shell, eval/include, file, URL,
 * HTML output, redirect, unserialize and LDAP sinks, honouring escaping per
 * sink kind and validation guards. Enable with `--with php-taint` or
 * `"addons": ["php-taint"]` in .repo-anti-rot.json.
 */
export const phpTaintScanner: Scanner = {
  id: "php-taint",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const project = new Project()
    const contents = new Map<string, string>()
    let files = 0
    for (const file of ctx.files) {
      const norm = file.replace(/\\/g, "/")
      if (!PHP_FILE.test(norm) || SKIP_PATH.test(norm)) continue
      if (files >= MAX_FILES) break
      const size = await ctx.fileSize?.(file)
      if (size != null && size > MAX_BYTES) continue
      const content = await ctx.readFile(file)
      if (!content || content.length > MAX_BYTES) continue
      if (project.add(norm, content)) {
        contents.set(norm, content)
        files++
      }
    }
    if (!files) return []
    project.run()

    const issues: Issue[] = []
    const seen = new Set<string>()
    // One finding per sink, but every distinct path into it is kept: DVWA's
    // xss_r/index.php echoes $html from low.php, medium.php and high.php, and
    // each source file is a separate place to fix.
    const byId = new Map<string, Issue>()
    const reach = reachability(project)
    const CAP = /\b(?:current_user_can|is_super_admin|user_can|check_admin_referer)\s*\(/
    for (const f of project.findings.sort(byPlace)) {
      if (issues.length >= MAX_FINDINGS) break
      const rule = RULES[f.kind]
      const id = `${rule.id}-${f.file}:${f.line}`
      if (seen.has(id)) {
        const first = byId.get(id)
        const flow = flowOf(f)
        const key = (fl: FlowStep[]) => fl.map((x) => `${x.text}@${x.file ?? ""}:${x.line ?? ""}`).join(">")
        if (first?.flow && key(flow) !== key(first.flow) && !(first.altFlows ?? []).some((a) => key(a) === key(flow)) && (first.altFlows?.length ?? 0) < MAX_ALT_FLOWS)
          first.altFlows = [...(first.altFlows ?? []), flow]
        continue
      }
      seen.add(id)
      let ageDays = 0
      try { ageDays = await ctx.git.blameAgeDays(f.file, f.line) } catch { /* blame unavailable */ }
      const line = contents.get(f.file)?.split(/\r?\n/)[f.line - 1]?.trim().slice(0, 200)
      // Who can get here: a public entry point names itself; admin-only code is one step less certain.
      const def = project.defAt(f.file, f.line)
      const entry = def ? reach.open.get(def.node) : undefined
      const body = def ? (contents.get(def.file) ?? "").split(/\r?\n/).slice((def.node.loc?.start?.line ?? 1) - 1, f.line - 1).join("\n") : ""
      const adminOnly = !!def && !entry && (reach.admin.has(def.node) || CAP.test(body))
      let confidence: Issue["confidence"] = f.weak ? "medium" : "high"
      if (adminOnly) confidence = confidence === "high" ? "medium" : "low"
      // The Host header / the whole $_SERVER array: web servers usually accept only configured hosts.
      // Still worth a look for SQL and shell; for paths, includes, redirects and output, listed with --all.
      if (/HTTP_HOST|^\$_SERVER$/.test(f.source) && f.kind !== "sql" && f.kind !== "cmd") confidence = confidence === "high" ? "medium" : "low"
      // The request path ($_SERVER['REQUEST_URI'], PHP_SELF, PATH_INFO) arrives URL-encoded and
      // mostly flows into the app's own links and same-page redirects: 7 of 7 reviewed were noise.
      if (/REQUEST_URI|PHP_SELF|PATH_INFO|QUERY_STRING|DOCUMENT_ROOT|SCRIPT_NAME/.test(f.source) && f.kind !== "sql" && f.kind !== "cmd") confidence = "low"
      // A guard on the same value just above the sink: an allowlist, a pattern check, a same-host check.
      if (guardedNearby(contents.get(f.file) ?? "", f.line, f.source, f.kind)) confidence = "low"
      // Request values packed into a query string behind a fixed URL (http_build_query) choose
      // parameters, not where the browser goes: 2 of 2 reviewed "open redirects".
      if (f.kind === "redirect" && f.steps.some((s) => /http_build_query/.test(s.text))) confidence = "low"
      const where = entry ? ` Reachable from ${entry}.` : adminOnly ? " Reachable from admin screens only (or after a capability check): an administrator would have to be the attacker or be tricked into it." : ""
      issues.push({
        id,
        category: "security",
        severity: rule.severity,
        title: rule.title,
        location: `${f.file}:${f.line}`,
        ageDays,
        detail: `${rule.detail} Data flow: ${trace(f)}.${where}`,
        ...(line ? { evidence: line } : {}),
        rule: rule.id,
        confidence,
        flow: flowOf(f),
        ...(f.alt?.length ? { altFlows: distinctFlows(flowOf(f), f.alt.map(flowOf)) } : {}),
      })
      byId.set(id, issues[issues.length - 1])
    }

    // Broken access control: public / any-user entry points reaching privileged actions.
    for (const a of auditAccessControl(project)) {
      if (issues.length >= MAX_FINDINGS) break
      const rule = `php-taint-${a.kind}`
      const id = `${rule}-${a.file}:${a.line}`
      if (seen.has(id)) continue
      seen.add(id)
      let ageDays = 0
      try { ageDays = await ctx.git.blameAgeDays(a.file, a.line) } catch { /* blame unavailable */ }
      const who = a.exposure === "public" ? "any visitor (no login)" : "any logged-in user, including subscribers"
      const line = contents.get(a.file)?.split(/\r?\n/)[a.line - 1]?.trim().slice(0, 200)
      const path = `${a.hook} → ${a.chain.join(" → ")} → ${a.action}`
      const text = a.kind === "csrf"
        ? { severity: "warning" as const, title: `CSRF: ${a.action} changes data without a nonce check`, detail: `${path} checks the user's capability but not a nonce, so another site can make a logged-in administrator's browser send this request. Verify a nonce (check_admin_referer / check_ajax_referer) before acting.`, confidence: "medium" as const }
        : a.kind === "data-exposure"
          ? { severity: "critical" as const, title: `Sensitive data sent to unauthenticated requests by ${a.action}`, detail: `${who} can call ${path}, which returns user records or secret options with no capability check. Return only public fields, or require the right capability.`, confidence: "medium" as const }
          : a.settings
            ? { severity: "critical" as const, title: `Missing authorization: ${a.exposure === "public" ? "unauthenticated" : "any logged-in user's"} request changes settings via ${a.action}`, detail: `${who} can call ${path} and store a value from the request, with no capability check (current_user_can) on the way. Plugin settings changed by visitors are a common takeover path (redirect URLs, script snippets, role defaults). Check the capability before saving.`,
                // Anonymous AJAX / REST: shown. Subscriber-level handlers and every-request hooks: listed with --all.
                confidence: (a.exposure === "public" && !/^(?:init|admin_init|wp_loaded|plugins_loaded|wp|template_redirect)$/.test(a.hook) ? "medium" : "low") as "medium" | "low" }
            : { severity: "critical" as const, title: `Missing authorization: ${a.action} is reachable by ${a.exposure === "public" ? "unauthenticated" : "any logged-in"} requests`, detail: `${who} can call ${path} with no capability check (current_user_can) on the way${a.nonce ? "; a nonce is checked, but a nonce is a CSRF token, not a permission" : ""}. Check the capability the action needs before doing it.`, confidence: (a.nonce || a.exposure === "user" ? "medium" : "high") as "medium" | "high" }
      issues.push({
        id,
        category: "security",
        severity: text.severity,
        title: text.title,
        location: `${a.file}:${a.line}`,
        ageDays,
        detail: text.detail,
        ...(line ? { evidence: line } : {}),
        rule,
        confidence: text.confidence,
      })
    }

    // Logic flaws: ignored checks, guards that do not stop, loose secret compares, weak tokens, magic switches.
    for (const l of auditLogic(project)) {
      if (issues.length >= MAX_FINDINGS) break
      if (SKIP_PATH.test(l.file)) continue
      const rule = LOGIC_RULES[l.kind]
      const id = `${rule.id}-${l.file}:${l.line}`
      if (seen.has(id)) continue
      seen.add(id)
      let ageDays = 0
      try { ageDays = await ctx.git.blameAgeDays(l.file, l.line) } catch { /* blame unavailable */ }
      const line = contents.get(l.file)?.split(/\r?\n/)[l.line - 1]?.trim().slice(0, 200)
      issues.push({
        id, category: "security", severity: rule.severity, title: rule.title, location: `${l.file}:${l.line}`, ageDays,
        detail: `${rule.detail} Here: ${l.what}.`, ...(line ? { evidence: line } : {}), rule: rule.id,
        // A file left in the web root is judged by its name alone; 3 of 3 reviewed were dump
        // scripts and helper CLIs never served. Listed with --all.
        confidence: l.kind === "public-sensitive-file" ? "low" : l.weak ? "medium" : "high",
      })
    }
    return issues
  },
}

function byPlace(a: Finding, b: Finding) {
  return a.file.localeCompare(b.file) || a.line - b.line
}

/**
 * The same path as `trace`, as structured steps for the report's graph:
 * source → steps → sink. Placeholder steps ("string": the value was
 * concatenated into a string) are kept only when they are all there is.
 */
/** Paths shown as alternatives must start somewhere new: same files in the same order is the same fix. */
function distinctFlows(first: FlowStep[], alts: FlowStep[][]): FlowStep[][] {
  const sig = (fl: FlowStep[]) => [...new Set(fl.map((x) => x.file ?? ""))].join(">")
  const seen = new Set([sig(first)])
  return alts.filter((a) => !seen.has(sig(a)) && (seen.add(sig(a)), true))
}

/** Further paths kept per sink beyond the first: enough to name each place to fix. */
const MAX_ALT_FLOWS = 5

export function flowOf(f: Finding): FlowStep[] {
  const out: FlowStep[] = []
  const first = f.steps[0]
  const at = (s: { file?: string; line: number } | undefined) =>
    s ? { ...(s.file ?? f.file ? { file: s.file ?? f.file } : {}), ...(s.line ? { line: s.line } : {}) } : {}
  // Long paths keep only their last steps; the source still gets the earliest location known.
  if (!first || first.text !== f.source) out.push({ role: "source", text: f.source, ...at(first) })
  for (const [i, s] of f.steps.entries()) {
    if (s.text === "string" && f.steps.length > 1) continue
    out.push({ role: i === 0 && first?.text === f.source ? "source" : "step", text: s.text, ...at(s) })
  }
  // Interprocedural findings are reported at the call site (`find()`), which the
  // path already passed through; the dangerous call is then the path's last step.
  if (out.some((s) => s.text === f.sink && s.line === f.line) && out.length > 1) {
    out[out.length - 1] = { ...out[out.length - 1], role: "sink" }
    return out
  }
  out.push({ role: "sink", text: f.sink, file: f.file, line: f.line })
  return out
}

/** `$_GET['id'] (index.php:3) → $id → string → mysqli_query() (index.php:5)` */
export function trace(f: Finding): string {
  const parts: string[] = []
  let lastFile = ""
  // Long paths keep only their last steps; always name where the data came from.
  if (f.steps[0]?.text !== f.source) parts.push(`${f.source} … `)
  for (const s of f.steps) {
    const where = s.file && s.file !== lastFile ? ` (${s.file}:${s.line})` : s.line ? ` (line ${s.line})` : ""
    if (s.text === "string" && parts.at(-1) === "string") continue
    parts.push(`${s.text}${where}`)
    if (s.file) lastFile = s.file
  }
  parts.push(`${f.sink} (${f.file === lastFile ? `line ${f.line}` : `${f.file}:${f.line}`})`)
  return parts.filter((p) => !p.startsWith("string")).join(" → ")
}

/** Name of the request key behind a source label: `$_POST['format']` → format, `->get('referer')` → referer. */
function sourceKey(source: string): string | null {
  return source.match(/\[\s*['"]([\w-]+)['"]\s*\]|\(\s*['"]([\w-]+)['"]\s*\)/)?.slice(1).find(Boolean) ?? null
}

/**
 * Up to eight lines above the sink, a check that bounds the value: in_array / array_key_exists /
 * preg_match on the same request key, or a lookup in the project's own map (isset($formats[$v])).
 * For redirects, a comparison with the site's own host. isset() on the superglobal itself only
 * says the key is present. Deep-PHP review 2026-11-17: 3 allowlist and 3 same-host false positives.
 */
export function guardedNearby(content: string, line: number, source: string, kind: string): boolean {
  if (!content) return false
  const window = content.split(/\r?\n/).slice(Math.max(0, line - 9), line).join("\n")
  if (kind === "redirect" && /getHost\s*\(|getSchemeAndHttpHost\s*\(|PHP_URL_HOST|\$_SERVER\[\s*['"](?:HTTP_HOST|SERVER_NAME)['"]\s*\]\s*[!=]==?|redirect_allow|allowed_?hosts|isSameOrigin|is_safe_url|wp_validate_redirect/i.test(window)) return true
  const key = sourceKey(source)
  if (!key) return false
  return window.split("\n").some((l) => l.includes(key) && /\b(?:in_array|array_key_exists|preg_match)\s*\(|\bisset\s*\(\s*\$(?!_(?:GET|POST|REQUEST|COOKIE|SERVER|FILES)\b)\w+\s*\[\s*\$/.test(l))
}
