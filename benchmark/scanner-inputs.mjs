/**
 * What each scanner reads, as predicates over a repo's file inventory
 * (benchmark/.inventory/<repo>.json, see inventory.mjs). A partial rescan
 * skips a repo for a scanner only when the repo has none of these files AND
 * its previous result had no finding from that scanner.
 *
 * `always: true` for scanners whose input is broad (any file, git branches,
 * many config kinds) — selection would buy nothing and risk misses.
 * Kept here, not in the scanners, so declaring inputs does not change a
 * scanner's fingerprint. `node benchmark/inventory.mjs --check` verifies the
 * declarations against every finding in the corpus.
 */

const SRC_ALL = ["ts", "tsx", "js", "jsx", "mjs", "mts", "cts", "cjs", "py", "go", "rs", "java", "rb", "php", "c", "cc", "cpp", "h", "hpp", "cs", "kt", "kts", "swift", "scala"]
const JS = ["ts", "tsx", "js", "jsx", "mjs", "mts", "cts", "cjs"]
const MD = ["md", "mdx", "markdown"]
const MANIFESTS = /^(package\.json|package-lock\.json|npm-shrinkwrap\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|yarn\.lock|bun\.lockb?|pyproject\.toml|poetry\.lock|uv\.lock|pipfile(\.lock)?|requirements.*\.txt|go\.(mod|sum)|cargo\.(toml|lock)|gemfile(\.lock)?|composer\.(json|lock))$/

export const INPUTS = {
  "insecure-code": { exts: [...SRC_ALL, "phtml", "inc", "cshtml", "erb"] },
  "todo-debt": { exts: SRC_ALL },
  "commented-code": { exts: ["ts", "tsx", "js", "jsx", "mjs", "mts", "cts", "java", "c", "cc", "cpp", "h", "hpp", "cs", "go", "rs", "swift", "kt", "scala", "php"] },
  "dead-code": { exts: JS },
  "leftover-debug": { exts: [...JS, "py"] },
  "skipped-tests": { exts: [...JS, "py"] },
  "dependency-funeral": { names: /^package\.json$/ },
  "supply-chain": { names: /^package\.json$/ },
  "lockfile-drift": { names: /^package\.json$/ },
  "outdated-deps": { names: MANIFESTS },
  "vulnerable-deps": { names: MANIFESTS },
  "dockerfile": { names: /^(dockerfile(\..+)?|.+\.dockerfile)$/ },
  "iac-security": { exts: ["tf", "yaml", "yml", "json"] },
  "workflow-security": { paths: [".github/workflows/"] },
  "broken-doc-links": { exts: MD },
  "dead-links": { exts: [...MD, ...SRC_ALL] },
  "docs-drift": { exts: [...MD, "rst", "txt"] },
  // Broad inputs: every repo.
  "ci-health": { always: true },
  "bus-factor": { always: true },
  "stale-branch": { always: true },
  "project-hygiene": { always: true },
  "repo-bloat": { always: true },
  "secrets": { always: true },
  "license-risk": { always: true },
  "config-conflict": { always: true },
  "eol-runtime": { always: true },
  "env-lifecycle": { always: true },
  "duplicate-code": { always: true },
}

/** Does this inventory contain anything the scanner reads? Unknown scanner → yes. */
export function mayProduce(id, inv) {
  const spec = INPUTS[id]
  if (!spec || spec.always || !inv) return true
  if (spec.exts?.some((e) => (inv.exts[e] ?? 0) > 0)) return true
  if (spec.names && Object.keys(inv.names).some((n) => spec.names.test(n))) return true
  if (spec.paths?.some((p) => (inv.paths[p] ?? 0) > 0)) return true
  return false
}
