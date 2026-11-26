/**
 * Is this repository an application worth a deep (whole-program) analysis?
 *
 * Deep engines analyse an application in full. A repository that is mostly
 * generated or minified code, copies of the same file, templated spam pages,
 * or a dump of unrelated exercise scripts gets the fast scanners only: a
 * whole-program data-flow analysis of it costs much and finds nothing a
 * maintainer would act on.
 *
 * Cheap by design: file names and sizes for every file, contents for at most
 * MAX_READ source files, each capped at MAX_BYTES.
 */
import type { ScanContext } from "./scanner"

const SOURCE = /\.(?:php|phtml|py|[cm]?jsx?|tsx?|rb|go|java|kt|cs|c|cc|cpp|h|hpp|swift|rs|html?|vue|svelte)$/i
const GENERATED_NAME = /(?:^|\/)[^/]*(?:\.min\.[a-z]+|[.-]bundle\.[a-z]+|\.generated\.[a-z]+|_pb2(?:_grpc)?\.py|\.pb\.go|\.g\.dart)$|(?:^|\/)chunk-[\w-]+\.js$/i
const SKIP_DIR = /(?:^|\/)(?:node_modules|vendor|third[-_]?party|bower_components|site-packages)\//
const EXERCISE = /(?:^|[-_ /])(?:day|week|lesson|lecture|exercise|exercises|ex|task|lab|homework|hw|assignment|problem|kata|challenge|leetcode|hackerrank|codewars|practice|tutorial|chapter|ch|session|module)[-_ ]?\d+/i
const MANIFEST = /(?:^|\/)(?:package\.json|composer\.json|pyproject\.toml|setup\.py|requirements\.txt|go\.mod|pom\.xml|build\.gradle(?:\.kts)?|Cargo\.toml|Gemfile|[^/]+\.csproj)$/i
const MAX_READ = 3000
const MAX_BYTES = 512 * 1024

export interface RepoProfile {
  junk: boolean
  /** Why, in words, when junk. */
  reasons: string[]
  metrics: {
    sourceFiles: number
    sourceBytes: number
    /** Share of source bytes in generated or minified files. */
    generated: number
    /** Source files read that are not generated: the code a person wrote. */
    handwritten: number
    /** Share of source files whose text (whitespace aside) another file repeats. */
    duplicate: number
    /** Distinct texts among them, as a share: low when most files are copies. */
    distinct: number
    /** Distinct texts once strings and numbers are blanked: low for one template filled many times. */
    distinctShapes: number
    /** Top-level directories holding a few loose source files and no manifest. */
    looseDirs: number
    /** Share of those whose name reads like an exercise (day12, lesson-3, leetcode…). */
    exerciseDirs: number
  }
}

/** FNV-1a: a fast hash, good enough to bucket file texts. */
function hash(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return `${h.toString(36)}:${s.length}`
}

const share = (n: number, d: number) => (d ? n / d : 0)
const round = (x: number) => Math.round(x * 100) / 100

export async function profileRepo(ctx: Pick<ScanContext, "files" | "readFile" | "fileSize">): Promise<RepoProfile> {
  const files = ctx.files.map((f) => f.replace(/\\/g, "/")).filter((f) => SOURCE.test(f) && !SKIP_DIR.test(f))
  let bytes = 0, generatedBytes = 0, read = 0, minified = 0
  const exact = new Map<string, number>(), shape = new Map<string, number>()
  const texts: { exact: string; shape: string }[] = []
  for (const f of files) {
    const size = (await ctx.fileSize?.(f)) ?? 0
    if (GENERATED_NAME.test(f)) { generatedBytes += size; bytes += size; continue }
    if (read >= MAX_READ || size > MAX_BYTES) { bytes += size; continue }
    const text = await ctx.readFile(f)
    if (text == null) continue
    read++
    const len = size || text.length
    bytes += len
    const lines = text.split("\n")
    // Minified: a few very long lines carry the file.
    if (len > 2000 && len / lines.length > 250) { generatedBytes += len; minified++; continue }
    if (len < 200) continue
    const e = hash(text.replace(/\s+/g, ""))
    const s = hash(text.replace(/(["'`])(?:\\.|(?!\1)[^\\\n])*\1/g, "S").replace(/\d+/g, "0").replace(/\s+/g, ""))
    exact.set(e, (exact.get(e) ?? 0) + 1)
    shape.set(s, (shape.get(s) ?? 0) + 1)
    texts.push({ exact: e, shape: s })
  }
  const duplicate = share(texts.filter((t) => exact.get(t.exact)! > 1).length, texts.length)

  // Top-level directories with a few loose source files and nothing that builds them.
  const byTop = new Map<string, { src: number; manifest: boolean }>()
  for (const f of ctx.files) {
    const slash = f.indexOf("/")
    if (slash < 0) continue
    const top = f.slice(0, slash)
    const d = byTop.get(top) ?? { src: 0, manifest: false }
    if (SOURCE.test(f)) d.src++
    if (MANIFEST.test(f)) d.manifest = true
    byTop.set(top, d)
  }
  const loose = [...byTop].filter(([, d]) => d.src > 0 && d.src <= 3 && !d.manifest)
  const exerciseDirs = share(loose.filter(([name]) => EXERCISE.test(name)).length, loose.length)

  const metrics = {
    sourceFiles: files.length,
    sourceBytes: bytes,
    generated: round(share(generatedBytes, bytes)),
    handwritten: read - minified,
    duplicate: round(duplicate),
    distinct: round(share(exact.size, texts.length)),
    distinctShapes: round(share(shape.size, texts.length)),
    looseDirs: loose.length,
    exerciseDirs: round(exerciseDirs),
  }
  const reasons: string[] = []
  // Junk is a repository with little left to analyse once generated code and copies are set
  // aside — not one that merely ships built assets or a few templates next to its own code
  // (TCPDF's font tables, a committed vuetify.min.js, scaffolds copied per package).
  if (files.length >= 30) {
    if (metrics.generated >= 0.6 && metrics.handwritten < 20) reasons.push(`${Math.round(metrics.generated * 100)}% of the source is generated or minified, ${metrics.handwritten} files written by hand`)
    if (texts.length >= 200 && metrics.distinct <= 0.2) reasons.push(`${texts.length} source files hold only ${exact.size} distinct texts`)
    else if (texts.length >= 200 && metrics.distinctShapes <= 0.1) reasons.push(`${texts.length} source files are ${shape.size} templates with different text`)
    if (loose.length >= 20 && exerciseDirs >= 0.5) reasons.push(`${loose.length} loose top-level folders of exercise scripts`)
  }
  return { junk: reasons.length > 0, reasons, metrics }
}
