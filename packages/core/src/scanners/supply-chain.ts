import type { Scanner, ScanContext } from "../scanner"
import type { Issue, Severity } from "../schema"
import { isFixturePath } from "./config-conflict"

/**
 * Supply-chain scanner — npm lifecycle scripts and dependency install URLs.
 *
 * A `postinstall` that pipes `curl` into a shell is the classic "install this
 * package, get owned" pattern. Same for plain-HTTP git dependencies: the
 * transport is not integrity-checked the way the registry is.
 *
 * High precision on purpose. Custom scripts named `predev` / `build` are not
 * lifecycle hooks and are only flagged when they literally pipe curl/wget into
 * a shell — a rare, unambiguous smell.
 */

const PACKAGE_JSON_RE = /(^|\/)package\.json$/i

/** Hooks npm/yarn/pnpm run automatically on install. */
const LIFECYCLE = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
])

/** curl|sh / wget|bash and spaced variants (`curl … | sh`). */
const REMOTE_SHELL_RE =
  /\b(?:curl|wget)\b[\s\S]{0,200}\|\s*(?:ba)?sh\b|\b(?:curl|wget)\s[^|&;\n]*\|\s*(?:ba)?sh\b/i

const NODE_EVAL_RE = /\bnode\s+(?:-e|--eval)\b/i

/** Dependency installed over cleartext HTTP (not https / git+ssh). */
const HTTP_GIT_RE = /^(?:git\+)?http:\/\//i

const MAX_ISSUES = 20

interface PkgJson {
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

function parsePkg(raw: string): PkgJson | null {
  try {
    const v = JSON.parse(raw) as unknown
    if (!v || typeof v !== "object" || Array.isArray(v)) return null
    return v as PkgJson
  } catch {
    return null
  }
}

function pushIssue(
  out: Issue[],
  opts: {
    id: string
    severity: Severity
    title: string
    detail: string
    location: string
    evidence?: string
  },
) {
  if (out.length >= MAX_ISSUES) return
  out.push({
    id: opts.id,
    category: "security",
    severity: opts.severity,
    title: opts.title,
    location: opts.location,
    ageDays: 0,
    detail: opts.detail,
    evidence: opts.evidence,
  })
}

function scanScripts(
  out: Issue[],
  file: string,
  scripts: Record<string, string>,
) {
  for (const [name, body] of Object.entries(scripts)) {
    if (typeof body !== "string" || !body.trim()) continue
    const location = `${file}#scripts.${name}`
    const isLifecycle = LIFECYCLE.has(name)

    if (REMOTE_SHELL_RE.test(body)) {
      if (isLifecycle) {
        pushIssue(out, {
          id: `supply-lifecycle-remote-shell-${file}-${name}`,
          severity: "critical",
          title: `Lifecycle script "${name}" pipes curl/wget into a shell`,
          detail:
            "This runs on every install with the privileges of whoever installs the package. " +
            "Replace the remote pipe with a pinned, reviewed script in the repository, or drop " +
            "the hook. Supply-chain malware almost always arrives this way.",
          location,
          evidence: body.slice(0, 160),
        })
      } else {
        pushIssue(out, {
          id: `supply-scripts-curl-pipe-${file}-${name}`,
          severity: "warning",
          title: `Script "${name}" pipes curl/wget into a shell`,
          detail:
            "Piping a downloaded script into a shell skips integrity checks. Prefer a committed " +
            "script, or at least `curl -fsSL … -o file && sh file` after a checksum.",
          location,
          evidence: body.slice(0, 160),
        })
      }
      continue
    }

    if (isLifecycle && NODE_EVAL_RE.test(body)) {
      pushIssue(out, {
        id: `supply-lifecycle-node-eval-${file}-${name}`,
        severity: "warning",
        title: `Lifecycle script "${name}" runs node -e`,
        detail:
          "Inline `node -e` in an install hook is hard to review and a common place to hide " +
          "network callbacks. Move the logic into a committed `.js` file and call that instead.",
        location,
        evidence: body.slice(0, 160),
      })
    }
  }
}

function scanDeps(
  out: Issue[],
  file: string,
  field: string,
  deps: Record<string, string> | undefined,
) {
  if (!deps) return
  for (const [name, version] of Object.entries(deps)) {
    if (typeof version !== "string") continue
    if (!HTTP_GIT_RE.test(version)) continue
    pushIssue(out, {
      id: `supply-dep-git-http-${file}-${field}-${name}`,
      severity: "warning",
      title: `Dependency "${name}" installed over cleartext HTTP`,
      detail:
        "An HTTP git/tarball URL can be swapped on the wire. Use `https://`, a registry version, " +
        "or `git+ssh://` with a known host key.",
      location: `${file}#${field}.${name}`,
      evidence: version.slice(0, 160),
    })
  }
}

export const supplyChainScanner: Scanner = {
  id: "supply-chain",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []
    // Fixtures are not the project. A security tool, a package manager or a
    // linter keeps sample manifests under test/__fixtures__ precisely because
    // they are malicious; reporting one as the repository's own *critical*
    // finding costs ten points for doing the right thing, and lands hardest on
    // the people most likely to try this scanner.
    const files = ctx.files
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => PACKAGE_JSON_RE.test(f) && !isFixturePath(f))

    for (const file of files) {
      if (issues.length >= MAX_ISSUES) break
      const raw = await ctx.readFile(file)
      if (!raw) continue
      const pkg = parsePkg(raw)
      if (!pkg) continue

      if (pkg.scripts) scanScripts(issues, file, pkg.scripts)
      scanDeps(issues, file, "dependencies", pkg.dependencies)
      scanDeps(issues, file, "devDependencies", pkg.devDependencies)
      scanDeps(issues, file, "optionalDependencies", pkg.optionalDependencies)
      scanDeps(issues, file, "peerDependencies", pkg.peerDependencies)
    }

    return issues
  },
}
