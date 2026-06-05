import { normalizeFormat } from "@repo-anti-rot/core"

/** File extension used for each normalized report format. */
const FORMAT_EXT: Record<string, string> = {
  json: "json",
  md: "md",
  terminal: "txt",
  sarif: "sarif",
}

/**
 * Make a filesystem-safe report filename for a repo.
 *
 * The directory name is sanitized (anything outside `[A-Za-z0-9_.-]` becomes `_`)
 * so an exotic repo name can't escape the output directory or break the path, and
 * the extension is derived from the (normalized) output format.
 */
export function reportFileName(dirName: string, format: string): string {
  const safe = dirName.replace(/[^a-zA-Z0-9_.-]/g, "_")
  const ext = FORMAT_EXT[normalizeFormat(format)]
  return `${safe}.${ext}`
}
