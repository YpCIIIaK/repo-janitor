import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Secrets scanner (working tree + git history).
 *
 * Flags committed credentials using high-confidence provider patterns (AWS,
 * Stripe, GitHub, Slack, Google, private keys) plus a generic high-entropy
 * fallback for `secret = "…"`-style assignments.
 *
 * Two passes share the same detectors:
 *  1. **Working tree** — every line of the current checkout.
 *  2. **Git history** — lines introduced by past commits (via
 *     `ctx.git.historyAdditions`). This catches a credential that was committed
 *     and later deleted: gone from the tree, but still recoverable from history.
 *     The history pass is skipped when no git adapter is available, and dedupes
 *     against pass 1 (a secret still present in the tree isn't reported twice).
 *
 * Everything is `critical` (downgraded to `info` only in test/example/fixture
 * files): a leaked key is the most shareable, highest-stakes finding.
 */

interface Detector {
  id: string
  label: string
  re: RegExp
}

// Provider-specific patterns. Anchored/length-bounded to keep false positives low.
const DETECTORS: Detector[] = [
  { id: "aws-access-key", label: "AWS access key ID", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "stripe-secret", label: "Stripe live secret key", re: /\b(?:sk|rk)_live_[0-9a-zA-Z]{24,}\b/ },
  { id: "github-pat", label: "GitHub personal access token", re: /\bgh[opsur]_[0-9A-Za-z]{36}\b/ },
  { id: "github-fine-pat", label: "GitHub fine-grained token", re: /\bgithub_pat_[0-9A-Za-z_]{82}\b/ },
  { id: "slack-token", label: "Slack token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: "google-api-key", label: "Google API key", re: /\bAIza[0-9A-Za-z\-_]{35}\b/ },
  { id: "private-key", label: "Private key", re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/ },
]

// Generic: a secret-ish identifier assigned a long literal → entropy-checked.
const ASSIGN_RE =
  /(password|passwd|pwd|secret|token|api[_-]?key|access[_-]?key|client[_-]?secret|auth[_-]?token)["']?\s*[:=]\s*["`']([^"`'\s]{20,})["`']/i

// Obvious non-secrets we never want to flag via the entropy path.
const PLACEHOLDER_RE = /^(your|example|changeme|placeholder|redacted|dummy|test|sample|xxx+|<|\$\{|process\.env)/i

// Skip binary / vendored / lockfile content where matches are noise or unreadable.
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|bmp|pdf|zip|gz|tar|woff2?|ttf|eot|mp[34]|mov|wasm)$/i
const SKIP_NAME = /(?:^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/
const NUL = String.fromCharCode(0)
const MAX_BYTES = 1_000_000

/**
 * Test / example / fixture files. Credentials here are almost always sample
 * values (test fixtures, docs, mocks), not live secrets — flagging them
 * `critical` floods the report and tanks the score. We DON'T drop them (a real
 * key carelessly committed to a test still leaks), but downgrade to `info` so
 * they stay visible without dominating. `.env.example` is skipped entirely above.
 */
const LOW_CONFIDENCE_DIR =
  /(?:^|\/)(?:tests?|__tests__|__mocks__|spec|specs?|e2e|fixtures?|__fixtures__|testdata|mocks?|examples?|samples?|docs?)\//i
const LOW_CONFIDENCE_NAME =
  /(?:^|[\/._-])(?:test|tests|spec|specs|example|examples|sample|samples|fixture|fixtures|mock|mocks|dummy|stub|demo)\.[a-z0-9]+$/i

/** True when a path looks like test/example/fixture/docs content. */
function isLowConfidenceSecretFile(file: string): boolean {
  return LOW_CONFIDENCE_DIR.test(file) || LOW_CONFIDENCE_NAME.test(file)
}

/**
 * Mask a sensitive token inside its source line so the line can be shown as
 * evidence without leaking the credential. Keeps a 4-char prefix for
 * recognizability, replaces the rest with bullets, and trims surrounding context.
 */
function redactLine(line: string, token: string): string {
  const masked =
    token.length <= 4 ? "••••" : token.slice(0, 4) + "•".repeat(Math.min(token.length - 4, 12))
  // Replace EVERY occurrence — a token repeated on the line must not leak via a
  // second copy. split/join avoids regex-escaping the (arbitrary) token.
  let out = line.split(token).join(masked).trim()
  if (out.length > 120) out = out.slice(0, 117) + "…"
  return out
}

/** Shannon entropy in bits per char — high for random keys, low for words. */
function entropy(s: string): number {
  const freq: Record<string, number> = {}
  for (const ch of s) freq[ch] = (freq[ch] ?? 0) + 1
  let h = 0
  for (const ch in freq) {
    const p = freq[ch] / s.length
    h -= p * Math.log2(p)
  }
  return h
}

/** A secret detected on a single line: its raw token plus how it was matched. */
interface LineHit {
  /** detector id ("aws-access-key", …) or "entropy" for the generic fallback */
  id: string
  /** the raw matched credential — used as evidence (after redaction) and to dedupe */
  token: string
  /** human label ("AWS access key ID") or the assigned variable name for entropy */
  label: string
  /** true for the generic high-entropy fallback */
  entropyHit: boolean
}

/**
 * Apply every detector (and the entropy fallback) to one line. A line may match
 * several provider patterns; the entropy fallback only runs when no named
 * detector fires, matching the original single-line behaviour.
 */
function findSecretsInLine(line: string): LineHit[] {
  const hits: LineHit[] = []
  for (const det of DETECTORS) {
    const hit = det.re.exec(line)
    if (hit) hits.push({ id: det.id, token: hit[0], label: det.label, entropyHit: false })
  }
  if (hits.length > 0) return hits // don't double-flag a named hit via entropy

  const m = line.match(ASSIGN_RE)
  if (m) {
    const value = m[2]
    if (!PLACEHOLDER_RE.test(value) && entropy(value) >= 4.0) {
      hits.push({ id: "entropy", token: value, label: m[1], entropyHit: true })
    }
  }
  return hits
}

/** Should this path be skipped entirely (binary/lockfile/.env.example)? */
function isSkippedSecretFile(file: string): boolean {
  return BINARY_EXT.test(file) || SKIP_NAME.test(file) || file.endsWith(".env.example")
}

const HISTORY_MAX_COMMITS = 1000
const HISTORY_MAX_FINDINGS = 50

export const secretsScanner: Scanner = {
  id: "secrets",
  category: "security",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []
    // Raw tokens flagged in the working tree — a secret still present in the tree
    // must not be reported a second time from history.
    const flaggedTokens = new Set<string>()

    // --- Pass 1: working tree -------------------------------------------------
    for (const file of ctx.files) {
      if (isSkippedSecretFile(file)) continue

      const content = await ctx.readFile(file)
      // skip empty, oversized, or binary (NUL-containing) files
      if (!content || content.length > MAX_BYTES || content.includes(NUL)) continue

      // Secrets in test/example/fixture files are downgraded, not dropped.
      const lowConf = isLowConfidenceSecretFile(file)

      const lines = content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineNo = i + 1
        for (const hit of findSecretsInLine(line)) {
          flaggedTokens.add(hit.token)
          const ageDays = await ctx.git.blameAgeDays(file, lineNo)
          issues.push(
            hit.entropyHit
              ? {
                  id: `secret-entropy-${file}:${lineNo}`,
                  category: "security",
                  severity: lowConf ? "info" : "critical",
                  title: `High-entropy secret assigned ${lowConf ? "in test/example file" : ""} (${file})`.replace(/\s+\(/, " ("),
                  location: `${file}:${lineNo}`,
                  ageDays,
                  detail: lowConf
                    ? `A long, high-entropy value is assigned to "${hit.label}" in a test/example/fixture file — likely a sample value. Confirm it isn't a live credential.`
                    : `A long, high-entropy value is assigned to "${hit.label}". If this is a live credential, rotate it and move it to a secret store.`,
                  evidence: redactLine(line, hit.token),
                }
              : {
                  id: `secret-${hit.id}-${file}:${lineNo}`,
                  category: "security",
                  severity: lowConf ? "info" : "critical",
                  title: `${hit.label} ${lowConf ? "in test/example file" : "committed"} (${file})`,
                  location: `${file}:${lineNo}`,
                  ageDays,
                  detail: lowConf
                    ? `Matched ${hit.label} pattern in a test/example/fixture file — most likely a sample value, not a live secret. Confirm it isn't a real key; if it is, rotate it and move it out of the repo.`
                    : `Matched ${hit.label} pattern. Rotate the credential immediately and purge it from history.`,
                  evidence: redactLine(line, hit.token),
                },
          )
        }
      }
    }

    // --- Pass 2: git history --------------------------------------------------
    // Catch credentials that were committed then deleted — gone from the tree
    // above, but still recoverable from history. Degrades to a no-op when no git
    // adapter is wired (e.g. scanning a non-git directory).
    if (ctx.git.historyAdditions) {
      let additions: Awaited<ReturnType<NonNullable<typeof ctx.git.historyAdditions>>> = []
      try {
        additions = await ctx.git.historyAdditions({ maxCommits: HISTORY_MAX_COMMITS })
      } catch {
        additions = [] // history unavailable → working-tree findings still stand
      }

      // Report a given credential once (newest commit wins — additions arrive
      // newest-first), and never if it's already a working-tree finding.
      const seen = new Set<string>()
      let count = 0
      for (const add of additions) {
        if (count >= HISTORY_MAX_FINDINGS) break
        if (isSkippedSecretFile(add.file)) continue
        if (add.text.length > MAX_BYTES || add.text.includes(NUL)) continue

        const lowConf = isLowConfidenceSecretFile(add.file)
        for (const hit of findSecretsInLine(add.text)) {
          if (flaggedTokens.has(hit.token)) continue // still in the tree → already flagged
          const key = `${hit.id}:${hit.token}`
          if (seen.has(key)) continue
          seen.add(key)
          count++

          const ageDays = Math.max(0, Math.floor((Date.now() - add.date) / (1000 * 60 * 60 * 24)))
          const where = `${add.file} @ ${add.commit}`
          const subject = hit.entropyHit ? "High-entropy secret" : hit.label
          issues.push({
            id: `secret-history-${hit.id}-${add.file}@${add.commit}`,
            category: "security",
            severity: lowConf ? "info" : "critical",
            title: `${subject} found in git history (${where})`,
            location: where,
            ageDays,
            detail: lowConf
              ? `Introduced by commit ${add.commit} in a test/example/fixture path — most likely a sample value. It is no longer in the working tree but remains in history; confirm it isn't a real key.`
              : `Introduced by commit ${add.commit} and no longer in the working tree, but still recoverable from git history. Rotate the credential and purge it from history (e.g. git filter-repo or BFG).`,
            evidence: redactLine(add.text, hit.token),
          })

          if (count >= HISTORY_MAX_FINDINGS) break
        }
      }
    }

    return issues
  },
}
