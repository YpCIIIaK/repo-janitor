import type { ScanContext } from "./scanner"

/**
 * Polyglot dependency extraction.
 *
 * Parses non-npm package manifests / lockfiles into a flat `{ ecosystem, name,
 * version }` list keyed by the OSV ecosystem identifier, so a single OSV
 * `querybatch` can check Python, Go, Rust and Ruby projects — not just npm.
 *
 * Everything is best-effort and regex/JSON based (no per-ecosystem parser
 * dependency). Lockfiles are preferred for exact versions; manifests are a
 * fallback that uses the floor of the declared range, mirroring the npm path in
 * `vulnerable-deps`.
 */

/** OSV ecosystem identifiers we support (exact strings the OSV API expects). */
export type OsvEcosystem = "npm" | "PyPI" | "Go" | "crates.io" | "RubyGems" | "Packagist"

export interface ManifestDep {
  ecosystem: OsvEcosystem
  name: string
  version: string
  /** the file this dependency was read from, e.g. "requirements.txt" */
  manifest: string
}

/** First semver-ish version token in a string, e.g. ">=1.2.3,<2" → "1.2.3". */
function firstVersion(s: string | undefined): string | null {
  const m = (s ?? "").match(/(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)/)
  return m ? m[1] : null
}

/** De-duplicate by ecosystem+name+version, keeping first occurrence (lockfile wins). */
function dedupe(deps: ManifestDep[]): ManifestDep[] {
  const seen = new Set<string>()
  const out: ManifestDep[] = []
  for (const d of deps) {
    const key = `${d.ecosystem}::${d.name}::${d.version}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(d)
  }
  return out
}

// ---------------------------------------------------------------------------
// Python (PyPI)
// ---------------------------------------------------------------------------

/** Parse a single PEP 508 requirement string → name + floor version, or null. */
function parsePyRequirement(line: string): { name: string; version: string } | null {
  const stripped = line.split("#")[0].trim()
  if (!stripped || stripped.startsWith("-")) return null // options / -r includes / -e
  // name[extras] <op> version ; markers
  const m = stripped.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[[^\]]*\])?\s*([=<>!~]=?[^;]*)?/)
  if (!m) return null
  const name = m[1].toLowerCase()
  const version = firstVersion(m[2])
  if (!version) return null // unpinned (no concrete version) → can't query precisely
  return { name, version }
}

async function collectPython(ctx: ScanContext, fileSet: Set<string>): Promise<ManifestDep[]> {
  const deps: ManifestDep[] = []
  const have = new Map<string, string>() // name → version (lockfile precedence)

  const add = (name: string, version: string, manifest: string) => {
    if (!have.has(name)) {
      have.set(name, version)
      deps.push({ ecosystem: "PyPI", name, version, manifest })
    }
  }

  // 1) poetry.lock — [[package]] name="x" version="1.2.3" (exact).
  if (fileSet.has("poetry.lock")) {
    const txt = await ctx.readFile("poetry.lock")
    if (txt) {
      const re = /\[\[package\]\][\s\S]*?name\s*=\s*"([^"]+)"[\s\S]*?version\s*=\s*"([^"]+)"/g
      let m: RegExpExecArray | null
      while ((m = re.exec(txt))) add(m[1].toLowerCase(), m[2], "poetry.lock")
    }
  }

  // 2) Pipfile.lock — JSON: { default: { name: { version: "==1.2.3" } }, develop: {...} }.
  if (fileSet.has("Pipfile.lock")) {
    const txt = await ctx.readFile("Pipfile.lock")
    if (txt) {
      try {
        const json = JSON.parse(txt) as Record<string, Record<string, { version?: string }>>
        for (const group of ["default", "develop"]) {
          for (const [name, info] of Object.entries(json[group] ?? {})) {
            const v = firstVersion(info?.version)
            if (v) add(name.toLowerCase(), v, "Pipfile.lock")
          }
        }
      } catch {
        /* malformed lockfile */
      }
    }
  }

  // 3) requirements.txt (and common variants) — fallback to declared pins.
  for (const f of ["requirements.txt", "requirements-dev.txt", "requirements/base.txt"]) {
    if (!fileSet.has(f)) continue
    const txt = await ctx.readFile(f)
    if (!txt) continue
    for (const line of txt.split(/\r?\n/)) {
      const r = parsePyRequirement(line)
      if (r) add(r.name, r.version, f)
    }
  }

  // 4) pyproject.toml — PEP 621 `dependencies = [...]` and poetry `[tool.poetry.dependencies]`.
  if (fileSet.has("pyproject.toml")) {
    const txt = await ctx.readFile("pyproject.toml")
    if (txt) {
      // PEP 621: dependencies = ["requests>=2.0", "django==4.2"]
      const arr = txt.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)
      if (arr) {
        for (const item of arr[1].split(",")) {
          const r = parsePyRequirement(item.replace(/['"]/g, ""))
          if (r) add(r.name, r.version, "pyproject.toml")
        }
      }
      // Poetry: [tool.poetry.dependencies]\n requests = "^2.0"
      const sec = txt.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/)
      if (sec) {
        for (const line of sec[1].split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Za-z0-9._-]+)\s*=\s*["']?([^"'\n{]*)/)
          if (!m || m[1].toLowerCase() === "python") continue
          const v = firstVersion(m[2])
          if (v) add(m[1].toLowerCase(), v, "pyproject.toml")
        }
      }
    }
  }

  return deps
}

// ---------------------------------------------------------------------------
// Go
// ---------------------------------------------------------------------------

async function collectGo(ctx: ScanContext, fileSet: Set<string>): Promise<ManifestDep[]> {
  if (!fileSet.has("go.mod")) return []
  const txt = await ctx.readFile("go.mod")
  if (!txt) return []

  const deps: ManifestDep[] = []
  // Matches both `require module v1.2.3` and entries inside a `require ( ... )` block.
  const re = /^\s*(?:require\s+)?([a-z0-9][\w.\-/]+\.[\w.\-/]+)\s+v(\d+\.\d+\.\d+[\w.\-+]*)/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(txt))) {
    // OSV's Go ecosystem accepts the bare semver (no leading "v").
    deps.push({ ecosystem: "Go", name: m[1], version: m[2], manifest: "go.mod" })
  }
  return deps
}

// ---------------------------------------------------------------------------
// Rust (crates.io)
// ---------------------------------------------------------------------------

async function collectRust(ctx: ScanContext, fileSet: Set<string>): Promise<ManifestDep[]> {
  // Cargo.lock — [[package]] name="x" version="1.2.3" (exact, preferred).
  if (fileSet.has("Cargo.lock")) {
    const txt = await ctx.readFile("Cargo.lock")
    if (txt) {
      const deps: ManifestDep[] = []
      const re = /\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"\s*\nversion\s*=\s*"([^"]+)"/g
      let m: RegExpExecArray | null
      while ((m = re.exec(txt))) deps.push({ ecosystem: "crates.io", name: m[1], version: m[2], manifest: "Cargo.lock" })
      if (deps.length) return deps
    }
  }

  // Cargo.toml fallback — [dependencies]\n serde = "1.0"  OR  serde = { version = "1.0" }
  if (fileSet.has("Cargo.toml")) {
    const txt = await ctx.readFile("Cargo.toml")
    if (txt) {
      const deps: ManifestDep[] = []
      const sec = txt.match(/\[(?:dev-|build-)?dependencies\]([\s\S]*?)(?:\n\[|$)/g) ?? []
      for (const block of sec) {
        for (const line of block.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Za-z0-9._-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/)
          if (!m) continue
          const v = firstVersion(m[2] ?? m[3])
          if (v) deps.push({ ecosystem: "crates.io", name: m[1], version: v, manifest: "Cargo.toml" })
        }
      }
      return deps
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// Ruby (RubyGems)
// ---------------------------------------------------------------------------

async function collectRuby(ctx: ScanContext, fileSet: Set<string>): Promise<ManifestDep[]> {
  // Gemfile.lock — under "GEM\n  specs:\n    name (1.2.3)" (exact, preferred).
  if (fileSet.has("Gemfile.lock")) {
    const txt = await ctx.readFile("Gemfile.lock")
    if (txt) {
      const deps: ManifestDep[] = []
      const seen = new Set<string>()
      // Spec lines are indented 4 spaces: "    rails (7.0.4)"; deps of a gem are
      // indented 6 spaces — the {4}(?!\s) guard skips those.
      const re = /^ {4}(?! )([A-Za-z0-9._-]+) \((\d+\.\d+(?:\.\d+)?[\w.-]*)\)/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(txt))) {
        if (seen.has(m[1])) continue
        seen.add(m[1])
        deps.push({ ecosystem: "RubyGems", name: m[1], version: m[2], manifest: "Gemfile.lock" })
      }
      if (deps.length) return deps
    }
  }

  // Gemfile fallback — gem "rails", "~> 7.0.4"
  if (fileSet.has("Gemfile")) {
    const txt = await ctx.readFile("Gemfile")
    if (txt) {
      const deps: ManifestDep[] = []
      const re = /^\s*gem\s+["']([^"']+)["']\s*,\s*["']([^"']+)["']/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(txt))) {
        const v = firstVersion(m[2])
        if (v) deps.push({ ecosystem: "RubyGems", name: m[1], version: v, manifest: "Gemfile" })
      }
      return deps
    }
  }

  return []
}

// ---------------------------------------------------------------------------
// PHP (Packagist / Composer)
// ---------------------------------------------------------------------------

/** True for Composer platform requirements (not real packages on Packagist). */
function isComposerPlatform(name: string): boolean {
  return name === "php" || name.startsWith("ext-") || name.startsWith("lib-") || !name.includes("/")
}

async function collectPhp(ctx: ScanContext, fileSet: Set<string>): Promise<ManifestDep[]> {
  const deps: ManifestDep[] = []
  const have = new Set<string>()
  const add = (name: string, version: string, manifest: string) => {
    const n = name.toLowerCase()
    if (!have.has(n)) {
      have.add(n)
      deps.push({ ecosystem: "Packagist", name: n, version, manifest })
    }
  }

  // composer.lock — exact versions (preferred). Composer versions may carry a "v".
  if (fileSet.has("composer.lock")) {
    const txt = await ctx.readFile("composer.lock")
    if (txt) {
      try {
        const json = JSON.parse(txt) as Record<string, { name?: string; version?: string }[]>
        for (const grp of ["packages", "packages-dev"]) {
          for (const p of json[grp] ?? []) {
            if (p?.name && typeof p.version === "string") add(p.name, p.version.replace(/^v/, ""), "composer.lock")
          }
        }
      } catch {
        /* malformed lockfile */
      }
    }
  }

  // composer.json — declared floors (skip php / ext-* / lib-* platform reqs).
  if (fileSet.has("composer.json")) {
    const txt = await ctx.readFile("composer.json")
    if (txt) {
      try {
        const json = JSON.parse(txt) as Record<string, Record<string, string>>
        for (const grp of ["require", "require-dev"]) {
          for (const [name, range] of Object.entries(json[grp] ?? {})) {
            if (isComposerPlatform(name)) continue
            const v = firstVersion(range)
            if (v) add(name, v, "composer.json")
          }
        }
      } catch {
        /* malformed composer.json */
      }
    }
  }

  return deps
}

/**
 * Collect dependencies from every non-npm manifest present in the repo. npm is
 * handled separately by `vulnerable-deps` (it already resolves versions from the
 * JS lockfiles and tracks dev dependencies).
 */
export async function collectManifestDeps(ctx: ScanContext): Promise<ManifestDep[]> {
  const fileSet = new Set(ctx.files)
  const groups = await Promise.all([
    collectPython(ctx, fileSet),
    collectGo(ctx, fileSet),
    collectRust(ctx, fileSet),
    collectRuby(ctx, fileSet),
    collectPhp(ctx, fileSet),
  ])
  return dedupe(groups.flat())
}

/**
 * Collect only **direct** dependencies, read from manifests (never lockfiles) so
 * transitive deps are excluded. Used by registry-backed checks (outdated /
 * abandoned) where one network call per package means we must stay on the small
 * direct set. Versions are the declared floor (or the pinned `go.mod` version).
 */
export async function collectDirectDeps(ctx: ScanContext): Promise<ManifestDep[]> {
  const fileSet = new Set(ctx.files)
  const out: ManifestDep[] = []

  // Python — requirements*.txt + pyproject (PEP 621 + Poetry direct deps).
  for (const f of ["requirements.txt", "requirements-dev.txt"]) {
    if (!fileSet.has(f)) continue
    const txt = await ctx.readFile(f)
    if (!txt) continue
    for (const line of txt.split(/\r?\n/)) {
      const r = parsePyRequirement(line)
      if (r) out.push({ ecosystem: "PyPI", name: r.name, version: r.version, manifest: f })
    }
  }
  if (fileSet.has("pyproject.toml")) {
    const txt = await ctx.readFile("pyproject.toml")
    if (txt) {
      const arr = txt.match(/dependencies\s*=\s*\[([\s\S]*?)\]/)
      if (arr) {
        for (const item of arr[1].split(",")) {
          const r = parsePyRequirement(item.replace(/['"]/g, ""))
          if (r) out.push({ ecosystem: "PyPI", name: r.name, version: r.version, manifest: "pyproject.toml" })
        }
      }
      const sec = txt.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\n\[|$)/)
      if (sec) {
        for (const line of sec[1].split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Za-z0-9._-]+)\s*=\s*["']?([^"'\n{]*)/)
          if (!m || m[1].toLowerCase() === "python") continue
          const v = firstVersion(m[2])
          if (v) out.push({ ecosystem: "PyPI", name: m[1].toLowerCase(), version: v, manifest: "pyproject.toml" })
        }
      }
    }
  }

  // Go — go.mod direct requires only (skip `// indirect`).
  if (fileSet.has("go.mod")) {
    const txt = await ctx.readFile("go.mod")
    if (txt) {
      const re = /^\s*(?:require\s+)?([a-z0-9][\w.\-/]+\.[\w.\-/]+)\s+v(\d+\.\d+\.\d+[\w.\-+]*)(.*)$/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(txt))) {
        if (/\/\/\s*indirect/.test(m[3])) continue
        out.push({ ecosystem: "Go", name: m[1], version: m[2], manifest: "go.mod" })
      }
    }
  }

  // Rust — Cargo.toml [dependencies] (and dev/build) direct deps.
  if (fileSet.has("Cargo.toml")) {
    const txt = await ctx.readFile("Cargo.toml")
    if (txt) {
      const blocks = txt.match(/\[(?:dev-|build-)?dependencies\]([\s\S]*?)(?:\n\[|$)/g) ?? []
      for (const block of blocks) {
        for (const line of block.split(/\r?\n/)) {
          const m = line.match(/^\s*([A-Za-z0-9._-]+)\s*=\s*(?:"([^"]+)"|\{[^}]*version\s*=\s*"([^"]+)")/)
          if (!m) continue
          const v = firstVersion(m[2] ?? m[3])
          if (v) out.push({ ecosystem: "crates.io", name: m[1], version: v, manifest: "Cargo.toml" })
        }
      }
    }
  }

  // Ruby — Gemfile direct gems (only those with a pinned version to compare).
  if (fileSet.has("Gemfile")) {
    const txt = await ctx.readFile("Gemfile")
    if (txt) {
      const re = /^\s*gem\s+["']([^"']+)["']\s*,\s*["']([^"']+)["']/gm
      let m: RegExpExecArray | null
      while ((m = re.exec(txt))) {
        const v = firstVersion(m[2])
        if (v) out.push({ ecosystem: "RubyGems", name: m[1], version: v, manifest: "Gemfile" })
      }
    }
  }

  // PHP — composer.json direct require/require-dev (skip platform reqs).
  if (fileSet.has("composer.json")) {
    const txt = await ctx.readFile("composer.json")
    if (txt) {
      try {
        const json = JSON.parse(txt) as Record<string, Record<string, string>>
        for (const grp of ["require", "require-dev"]) {
          for (const [name, range] of Object.entries(json[grp] ?? {})) {
            if (isComposerPlatform(name)) continue
            const v = firstVersion(range)
            if (v) out.push({ ecosystem: "Packagist", name: name.toLowerCase(), version: v, manifest: "composer.json" })
          }
        }
      } catch {
        /* malformed composer.json */
      }
    }
  }

  return dedupe(out)
}
