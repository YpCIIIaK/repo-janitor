import type { Issue } from "./schema"

/**
 * Rule taxonomy: which specific check produced a finding, one level finer than
 * the scanner. Derived from the finding id, whose prefix every scanner already
 * makes stable, so reports written before `rule` existed classify the same way.
 *
 * Order matters — the first match wins, so longer prefixes come first.
 */
interface RuleDef {
  rule: string
  label: string
  test: RegExp
}

const INSECURE: Record<string, string> = {
  "eval-dynamic": "eval() on a dynamic value",
  "new-function": "new Function() on a dynamic value",
  "exec-interpolated": "Shell command built from variables",
  "sql-interpolated": "SQL built by string interpolation",
  "innerhtml-dynamic": "innerHTML set from a variable",
  "react-dangerous-html": "dangerouslySetInnerHTML",
  "tls-verification-off": "TLS verification disabled",
  "weak-hash": "Weak hash (MD5/SHA-1)",
  "random-for-secret": "Math.random() for a secret",
  "localstorage-secret": "Secret in localStorage",
  "document-write-dynamic": "document.write() of a variable",
  "py-shell-true": "subprocess with shell=True",
  "py-os-system": "os.system() call",
  "py-yaml-load": "Unsafe yaml.load()",
  "py-pickle-load": "pickle.load() of untrusted data",
  "py-eval-exec": "Python eval()/exec()",
  "py-verify-false": "requests with verify=False",
}

const WORKFLOW: Record<string, string> = {
  "action-tag-first-party": "First-party action pinned to a mutable tag",
  "action-tag": "Third-party action pinned to a mutable tag",
  "action-unpinned": "Action not pinned to a commit",
  "self-hosted-runner": "Self-hosted runner on public triggers",
  "script-injection": "Script injection in a workflow",
  "pr-target-checkout": "pull_request_target checks out PR code",
  "no-permissions": "Workflow token permissions not restricted",
}

const DEFS: RuleDef[] = [
  { rule: "secret-history", label: "Secret still in git history", test: /^secret-history-/ },
  { rule: "secret-generic", label: "High-entropy secret assignment", test: /^secret-entropy-/ },
  { rule: "secret-provider", label: "Provider credential (AWS, Stripe, GitHub…)", test: /^secret-/ },
  ...Object.entries(INSECURE).map(([id, label]) => ({
    rule: `insecure-${id}`,
    label,
    test: new RegExp(`^insecure-${id}-`),
  })),
  ...Object.entries(WORKFLOW).map(([id, label]) => ({ rule: `workflow-${id}`, label, test: new RegExp(`^${id}-`) })),
  { rule: "ci-tests-not-run", label: "CI never runs the tests", test: /^ci-tests-not-run/ },
  { rule: "ci-no-pr-trigger", label: "CI does not run on pull requests", test: /^ci-no-pr-trigger/ },
  { rule: "ci-silenced-failure", label: "CI step failures silenced", test: /^ci-silenced-failure-/ },
  { rule: "ci-disabled", label: "CI job disabled", test: /^ci-disabled-/ },
  { rule: "ci-swallowed", label: "CI errors swallowed", test: /^ci-swallowed-/ },
  { rule: "vuln", label: "Dependency with a known vulnerability", test: /^vuln-/ },
  { rule: "dep-unused", label: "Unused dependency", test: /^dep-unused-/ },
  { rule: "dep-deprecated", label: "Deprecated dependency", test: /^dep-deprecated-/ },
  { rule: "dep-abandoned", label: "Abandoned dependency", test: /^dep-abandoned-/ },
  { rule: "dep-outdated", label: "Outdated dependency", test: /^dep-outdated-/ },
  { rule: "eol-runner", label: "End-of-life CI runner image", test: /^eol-runner-/ },
  { rule: "eol-node", label: "End-of-life Node.js version", test: /^eol-node-/ },
  { rule: "eol-python", label: "End-of-life Python version", test: /^eol-python-/ },
  { rule: "eol-runtime", label: "End-of-life runtime version", test: /^eol-/ },
  { rule: "license-network", label: "Network copyleft license (AGPL…)", test: /^license-network-/ },
  { rule: "license-strong", label: "Strong copyleft license (GPL…)", test: /^license-strong-/ },
  { rule: "license-weak", label: "Weak copyleft license (LGPL, MPL…)", test: /^license-weak-/ },
  { rule: "license-proprietary", label: "Proprietary or unknown license", test: /^license-proprietary-/ },
  { rule: "lockfile-missing", label: "No lockfile committed", test: /^lockfile-missing/ },
  { rule: "lockfile-drift", label: "Lockfile out of sync with manifest", test: /^lockfile-drift-/ },
  { rule: "supply-remote-shell", label: "Install script pipes a download to a shell", test: /^supply-(lifecycle-remote-shell|scripts-curl-pipe)-/ },
  { rule: "supply-node-eval", label: "Install script evaluates code", test: /^supply-lifecycle-node-eval-/ },
  { rule: "supply-git-http", label: "Dependency fetched over plain HTTP", test: /^supply-dep-git-http-/ },
  { rule: "env-missing", label: "Env var used but not in .env.example", test: /^env-missing-/ },
  { rule: "env-dead", label: "Env var documented but never used", test: /^env-dead-/ },
  { rule: "env-no-example", label: "No .env.example", test: /^env-no-example/ },
  { rule: "branch-stale", label: "Stale branch", test: /^branch-stale-/ },
  { rule: "todo", label: "Old TODO / FIXME", test: /^todo-/ },
  { rule: "dead-export", label: "Export nothing imports", test: /^dead-(export|symbol)-/ },
  { rule: "dead-uikit", label: "Unused UI kit", test: /^dead-code-uikit-/ },
  { rule: "duplicate", label: "Duplicated block", test: /^duplicate-/ },
  { rule: "commented-code", label: "Commented-out code", test: /^commented-/ },
  { rule: "debug-leftover", label: "Leftover debug statement", test: /^debug-/ },
  { rule: "skipped-test", label: "Skipped or focused test", test: /^skiptest-/ },
  { rule: "bus-factor", label: "Old single-author file", test: /^busfactor-/ },
  { rule: "hygiene-no-readme", label: "No README", test: /^hygiene-no-readme/ },
  { rule: "hygiene-no-license", label: "No LICENSE", test: /^hygiene-no-license/ },
  { rule: "hygiene-no-tests", label: "No tests", test: /^hygiene-no-tests/ },
  { rule: "hygiene-no-ci", label: "No CI", test: /^hygiene-no-ci/ },
  { rule: "bloat", label: "Large or binary file in git", test: /^bloat-/ },
  { rule: "docker-latest", label: "Base image uses :latest", test: /^docker-latest-/ },
  { rule: "docker-untagged", label: "Base image has no tag", test: /^docker-untagged-/ },
  { rule: "docker-root", label: "Container runs as root", test: /^docker-root-/ },
  { rule: "docker-add-url", label: "ADD downloads a remote URL", test: /^docker-add-url-/ },
  { rule: "config-conflict", label: "Two configs, one ignored", test: /^config-conflict-/ },
  { rule: "docs-script", label: "Docs mention a missing script", test: /^docs-drift-script-/ },
  { rule: "docs-manager", label: "Docs use the wrong package manager", test: /^docs-drift-manager-/ },
  { rule: "docs-badge", label: "Badge points at something gone", test: /^docs-drift-badge-/ },
  { rule: "doc-link", label: "Broken relative link in docs", test: /^doclink-/ },
  { rule: "dead-link", label: "External link no longer resolves", test: /^deadlink-(\d|unreachable)/ },
  { rule: "dead-link-unverified", label: "External link could not be checked", test: /^deadlink-/ },
]

const LABELS = new Map(DEFS.map((d) => [d.rule, d.label]))

/** Stable rule key for a finding; falls back to its scanner, then "other". */
export function ruleOf(issue: Pick<Issue, "id" | "scanner">): string {
  for (const d of DEFS) if (d.test.test(issue.id)) return d.rule
  return issue.scanner ?? "other"
}

/** Human label for a rule key, or null when only the scanner is known. */
export function ruleLabel(rule: string): string | null {
  return LABELS.get(rule) ?? null
}
