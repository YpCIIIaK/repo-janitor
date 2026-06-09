import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Secrets scanner (working tree only).
 *
 * Flags committed credentials in the current checkout using high-confidence
 * provider patterns (AWS, Stripe, GitHub, Slack, Google, private keys) plus a
 * generic high-entropy fallback for `secret = "…"`-style assignments.
 *
 * History scanning (`git log -p`) is intentionally out of scope here — it needs a
 * ScanContext extension and is much slower; see ROADMAP A2. Everything flagged is
 * `critical`: a live key in the tree is the most shareable, highest-stakes finding.
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

export const secretsScanner: Scanner = {
  id: "secrets",
  category: "secret",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (BINARY_EXT.test(file) || SKIP_NAME.test(file)) continue
      // .env.example documents placeholders by design — never a real secret.
      if (file.endsWith(".env.example")) continue

      const content = await ctx.readFile(file)
      // skip empty, oversized, or binary (NUL-containing) files
      if (!content || content.length > MAX_BYTES || content.includes(NUL)) continue

      // Secrets in test/example/fixture files are downgraded, not dropped.
      const lowConf = isLowConfidenceSecretFile(file)

      const lines = content.split("\n")
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const lineNo = i + 1
        let named = false

        for (const det of DETECTORS) {
          const hit = det.re.exec(line)
          if (!hit) continue
          named = true
          const ageDays = await ctx.git.blameAgeDays(file, lineNo)
          issues.push({
            id: `secret-${det.id}-${file}:${lineNo}`,
            category: "secret",
            severity: lowConf ? "info" : "critical",
            title: `${det.label} ${lowConf ? "in test/example file" : "committed"} (${file})`,
            location: `${file}:${lineNo}`,
            ageDays,
            detail: lowConf
              ? `Matched ${det.label} pattern in a test/example/fixture file — most likely a sample value, not a live secret. Confirm it isn't a real key; if it is, rotate it and move it out of the repo.`
              : `Matched ${det.label} pattern. Rotate the credential immediately and purge it from history.`,
            evidence: redactLine(line, hit[0]),
          })
        }

        if (named) continue // don't double-flag the same line via entropy

        const m = line.match(ASSIGN_RE)
        if (m) {
          const value = m[2]
          if (!PLACEHOLDER_RE.test(value) && entropy(value) >= 4.0) {
            const ageDays = await ctx.git.blameAgeDays(file, lineNo)
            issues.push({
              id: `secret-entropy-${file}:${lineNo}`,
              category: "secret",
              severity: lowConf ? "info" : "critical",
              title: `High-entropy secret assigned ${lowConf ? "in test/example file" : ""} (${file})`.replace(/\s+\(/, " ("),
              location: `${file}:${lineNo}`,
              ageDays,
              detail: lowConf
                ? `A long, high-entropy value is assigned to "${m[1]}" in a test/example/fixture file — likely a sample value. Confirm it isn't a live credential.`
                : `A long, high-entropy value is assigned to "${m[1]}". If this is a live credential, rotate it and move it to a secret store.`,
              evidence: redactLine(line, value),
            })
          }
        }
      }
    }

    return issues
  },
}
