import type { Scanner, ScanContext } from "../scanner"
import type { Issue } from "../schema"

/**
 * Dockerfile hygiene scanner.
 *
 * High-signal, low-false-positive checks on committed Dockerfiles:
 *  - **unpinned base image** — `FROM img:latest` or `FROM img` (no tag) makes
 *    builds non-reproducible. Warning. Digest-pinned (`@sha256:`), `scratch`,
 *    build-arg (`$IMG`) and multi-stage aliases (`FROM build`) are exempt.
 *  - **runs as root** — no non-root `USER` instruction, so the container runs as
 *    root by default. Info (often intentional in base images, but worth a nudge).
 *  - **ADD of a remote URL** — `ADD https://…` silently downloads at build time;
 *    prefer `COPY` for local files and an explicit `curl`/`wget` for remote ones.
 *    Info.
 */

const DOCKERFILE_RE = /(^|\/)Dockerfile(\.[\w.-]+)?$|\.dockerfile$/i
const MAX_TOTAL = 40

/** Extract the tag from an image ref, accounting for registry ports/paths. */
function tagOf(image: string): string | null {
  const lastSeg = image.split("/").pop() ?? image // strip registry/path (host:port/…)
  const colon = lastSeg.lastIndexOf(":")
  return colon >= 0 ? lastSeg.slice(colon + 1) : null
}

export const dockerfileScanner: Scanner = {
  id: "dockerfile",
  category: "hygiene",
  async run(ctx: ScanContext): Promise<Issue[]> {
    const issues: Issue[] = []

    for (const file of ctx.files) {
      if (issues.length >= MAX_TOTAL) break
      const norm = file.replace(/\\/g, "/")
      if (!DOCKERFILE_RE.test(norm)) continue

      const content = await ctx.readFile(file)
      if (!content) continue

      const lines = content.split(/\r?\n/)
      const stageAliases = new Set<string>()
      let hasNonRootUser = false
      let sawFrom = false

      for (let i = 0; i < lines.length; i++) {
        if (issues.length >= MAX_TOTAL) break
        const line = lines[i]
        if (/^\s*#/.test(line)) continue
        const lineNo = i + 1

        // FROM <image>[:tag|@digest] [AS <alias>]
        const from = line.match(/^\s*FROM\s+(\S+)(?:\s+[Aa][Ss]\s+(\S+))?/)
        if (from) {
          sawFrom = true
          const image = from[1]
          const alias = from[2]
          const isStageRef = stageAliases.has(image)
          const isArg = image.startsWith("$")
          const isPinned = image.includes("@sha256:") || image.includes("@sha")
          const isScratch = image.toLowerCase() === "scratch"

          if (!isStageRef && !isArg && !isPinned && !isScratch) {
            const tag = tagOf(image)
            if (!tag) {
              issues.push({
                id: `docker-untagged-${norm}:${lineNo}`,
                category: "hygiene",
                severity: "warning",
                title: `Unpinned base image: ${image} (no tag)`,
                location: `${norm}:${lineNo}`,
                ageDays: 0,
                detail:
                  `FROM ${image} has no tag, so it resolves to :latest and the build is not ` +
                  `reproducible — pin a specific version (or a @sha256 digest) instead.`,
                evidence: line.trim().slice(0, 120),
              })
            } else if (tag.toLowerCase() === "latest") {
              issues.push({
                id: `docker-latest-${norm}:${lineNo}`,
                category: "hygiene",
                severity: "warning",
                title: `Base image pinned to :latest (${image})`,
                location: `${norm}:${lineNo}`,
                ageDays: 0,
                detail:
                  `FROM ${image} uses the :latest tag, so rebuilds can silently change the base ` +
                  `image — pin a specific version (or a @sha256 digest) for reproducible builds.`,
                evidence: line.trim().slice(0, 120),
              })
            }
          }
          if (alias) stageAliases.add(alias)
          continue
        }

        // USER <name> — track whether a non-root user is set.
        const user = line.match(/^\s*USER\s+(\S+)/)
        if (user) {
          const name = user[1].replace(/^\$\{?/, "").toLowerCase()
          if (name !== "root" && name !== "0" && !name.startsWith("$")) hasNonRootUser = true
          if (user[1].startsWith("$")) hasNonRootUser = true // arg-provided user — give benefit of the doubt
          continue
        }

        // ADD of a remote URL.
        const add = line.match(/^\s*ADD\s+(?:--\S+\s+)*(https?:\/\/\S+)/i)
        if (add) {
          issues.push({
            id: `docker-add-url-${norm}:${lineNo}`,
            category: "hygiene",
            severity: "info",
            title: "ADD downloads a remote URL",
            location: `${norm}:${lineNo}`,
            ageDays: 0,
            detail:
              `ADD ${add[1]} fetches a remote file at build time (no checksum, poor caching). ` +
              `Prefer COPY for local files, or an explicit RUN curl/wget with a verified checksum.`,
            evidence: line.trim().slice(0, 120),
          })
        }
      }

      // Root-by-default: only meaningful if the file actually builds an image.
      if (sawFrom && !hasNonRootUser && issues.length < MAX_TOTAL) {
        issues.push({
          id: `docker-root-${norm}`,
          category: "hygiene",
          severity: "info",
          title: "Container runs as root (no USER set)",
          location: norm,
          ageDays: 0,
          detail:
            "No non-root USER instruction is set, so the container runs as root — a privilege-" +
            "escalation risk if the process is compromised. Add a dedicated non-root USER.",
        })
      }
    }

    return issues
  },
}
