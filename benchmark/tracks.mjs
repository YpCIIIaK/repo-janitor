/**
 * Tracks: slices of the one corpus, each with an explicit population, its own
 * labelling target and its own precision. A repo is scanned once and may sit in
 * several tracks. Membership is derived from data (inventory, main language,
 * name) so new repos land in tracks by themselves; a corpus entry may also list
 * `tracks` explicitly, which adds to the derived ones.
 *
 *   import { TRACKS, tracksOf } from "./tracks.mjs"
 */
import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const here = dirname(fileURLToPath(import.meta.url))

export const VULNERABLE_RE =
  /goat|dvwa|dvna|dvws|vulnerab|juice-shop|vampi|dvga|pygoat|vulpy|govwa|crapi|xvwa|hackademic|vulnlab|vulnado|wrongsecrets|serverless-goat|sadcloud|cloudgoat|dvia|dsvw|inject-some-sql|testbed|terracotta|restaurant|awsgoat|webgoatphp|benchmarkjava/i

const SERVER_LANGS = new Set(["PHP", "Ruby", "Java", "C#", "Python", "Go"])
const MOBILE_LANGS = new Set(["Swift", "Kotlin", "Dart"])

/** Each track: what it is for, who is in it (as a rule a reader can check), labelling target. */
export const TRACKS = {
  general: {
    label: "General",
    population: "Every hand-picked repository in the corpus.",
    purpose: "Coverage and the cuts on /state (language, size, tools).",
    labelsPerRule: 10,
    test: (r) => r.layer !== "random",
  },
  random: {
    label: "Random layer",
    population: "Repositories drawn at random from active public GitHub projects (see random-layer.mjs).",
    purpose: "Corpus-wide percentages without selection bias.",
    labelsPerRule: 5,
    test: (r) => r.layer === "random",
  },
  security: {
    label: "Security",
    population: "Deliberately vulnerable applications and labs.",
    purpose: "Recall: known holes are still found. Every high-confidence finding is labelled.",
    labelsPerRule: 30,
    test: (r) => VULNERABLE_RE.test(r.name),
  },
  infra: {
    label: "Infrastructure",
    population: "Repositories with at least 3 Terraform files, a Helm chart or a kustomization.",
    purpose: "Precision of IaC and CI rules, per format.",
    labelsPerRule: 30,
    test: (r, d) => (d.inv?.exts?.tf ?? 0) >= 3 || !!d.inv?.names?.["chart.yaml"] || !!d.inv?.names?.["kustomization.yaml"],
  },
  mobile: {
    label: "Mobile",
    population: "Main language Swift, Kotlin or Dart, or at least 20 Swift or Dart files.",
    purpose: "Rules for languages that have few labels so far.",
    labelsPerRule: 30,
    test: (r, d) => MOBILE_LANGS.has(d.language) || (d.inv?.exts?.swift ?? 0) >= 20 || (d.inv?.exts?.dart ?? 0) >= 20,
  },
  webBackends: {
    label: "Web backends",
    population: "Main language PHP, Ruby, Java, C#, Python or Go, and runs as a service: it ships a docker-compose / compose file.",
    purpose: "Injection, deserialisation, SSRF and dependency rules.",
    labelsPerRule: 30,
    test: (r, d) =>
      SERVER_LANGS.has(d.language) &&
      Object.keys(d.inv?.names ?? {}).some((n) => /^(docker-compose.*\.ya?ml|compose\.ya?ml)$/.test(n)),
  },
}

function readJson(p) {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : null } catch { return null }
}

/** Main language by lines of code, from the stored report. */
export function mainLanguage(name) {
  const rep = readJson(join(here, ".results", `${name}.report.json`))
  const langs = rep?.profile?.languages ?? []
  return [...langs].sort((a, b) => (b.loc ?? 0) - (a.loc ?? 0))[0]?.language ?? null
}

/** Tracks a corpus entry belongs to: derived ones plus any it lists explicitly. */
export function tracksOf(repo) {
  const d = { inv: readJson(join(here, ".inventory", `${repo.name}.json`)), language: mainLanguage(repo.name) }
  const out = new Set(Array.isArray(repo.tracks) ? repo.tracks : [])
  for (const [id, t] of Object.entries(TRACKS)) if (t.test(repo, d)) out.add(id)
  return [...out]
}

/** Corpus entries in a track (all entries when `track` is empty). */
export function inTrack(corpus, track) {
  if (!track) return corpus
  if (!TRACKS[track]) throw new Error(`unknown track "${track}"; known: ${Object.keys(TRACKS).join(", ")}`)
  return corpus.filter((r) => tracksOf(r).includes(track))
}
