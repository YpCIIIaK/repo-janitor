import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Broken Doc Links scanner.
 *
 * Scans markdown files for RELATIVE links/images whose target doesn't exist in
 * the repo — the classic "moved a file, forgot the doc" rot. Only local relative
 * paths are checked: external URLs (http/https), anchors (#…), mailto/tel, and
 * root-absolute (/…) links are ignored to avoid false positives.
 *
 * Fenced and inline code are blanked out first (preserving line numbers) so code
 * examples don't produce phantom links. A link that resolves to a directory
 * containing files is treated as valid.
 */

const MD_RE = /\.(md|mdx|markdown)$/i
// [text](target) and ![alt](target); capture the target portion.
const LINK_RE = /!?\[[^\]]*\]\(([^)]+)\)/g
const MAX_TOTAL = 50

/** Directory of a repo-relative path ("docs/a.md" -> "docs", "a.md" -> ""). */
function dirOf(path: string): string {
  const i = path.lastIndexOf("/")
  return i === -1 ? "" : path.slice(0, i)
}

/** Resolve a relative target against a base dir, collapsing . and .. segments. */
function resolveRel(baseDir: string, target: string): string {
  const stack: string[] = []
  for (const seg of `${baseDir}/${target}`.split("/")) {
    if (seg === "" || seg === ".") continue
    if (seg === "..") stack.pop()
    else stack.push(seg)
  }
  return stack.join("/")
}

/** Blank out code (fenced + inline) with spaces, keeping newlines for line math. */
function stripCode(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/~~~[\s\S]*?~~~/g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/`[^`\n]*`/g, (m) => " ".repeat(m.length))
}

function lineAt(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index && i < text.length; i++) if (text[i] === "\n") line++
  return line
}

/** Should this link target be checked as a local relative path? */
function isLocalRelative(target: string): boolean {
  if (!target) return false
  // external, protocol-relative, anchors, mail/tel, data URIs, root-absolute
  if (/^([a-z][a-z0-9+.-]*:|\/\/|#|\/|data:)/i.test(target)) return false
  return true
}

export const brokenDocLinksScanner: Scanner = {
  id: "broken-doc-links",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const fileSet = new Set(ctx.files.map((f) => f.replace(/\\/g, "/")))
    // Lets us treat a link to a directory (that holds files) as valid.
    const dirSet = new Set<string>()
    for (const f of fileSet) {
      let d = dirOf(f)
      while (d) {
        dirSet.add(d)
        d = dirOf(d)
      }
    }

    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (!MD_RE.test(norm)) continue

      const raw = await ctx.readFile(file)
      if (!raw || !raw.includes("](")) continue
      const text = stripCode(raw)
      const baseDir = dirOf(norm)

      LINK_RE.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = LINK_RE.exec(text)) !== null) {
        if (issues.length >= MAX_TOTAL) break
        // Strip an optional "title" and surrounding <> from the target.
        let target = m[1].trim().split(/\s+/)[0].replace(/^<|>$/g, "")
        // Drop anchor / query suffix.
        target = target.split("#")[0].split("?")[0]
        if (!isLocalRelative(target)) continue

        let decoded = target
        try {
          decoded = decodeURIComponent(target)
        } catch {
          /* keep raw on malformed escape */
        }

        const resolved = resolveRel(baseDir, decoded)
        if (!resolved) continue // resolved to repo root
        if (fileSet.has(resolved) || dirSet.has(resolved)) continue

        const line = lineAt(text, m.index)
        issues.push({
          id: `doclink-${norm}:${line}:${target}`,
          category: "hygiene",
          severity: "warning",
          title: `Broken link in docs → ${target}`,
          location: `${norm}:${line}`,
          ageDays: 0,
          detail:
            `${norm} links to \`${target}\`, but no such file or directory exists in the repo. ` +
            "The target was probably moved or renamed — update or remove the link.",
          evidence: target,
        })
      }
    }

    return issues
  },
}
