/** Aggregate public pinned snapshots only. File presence is not scanner coverage. */
const FORMATS = {
  TypeScript: ["ts", "tsx", "mts", "cts"], JavaScript: ["js", "jsx", "mjs", "cjs"],
  Python: ["py"], Go: ["go"], Rust: ["rs"], Java: ["java"],
  Kotlin: ["kt", "kts"], PHP: ["php", "phtml"], Ruby: ["rb", "erb"],
  "C / C++": ["c", "cc", "cpp", "cxx", "h", "hpp"], "C#": ["cs"],
  Swift: ["swift"], Erlang: ["erl", "hrl"], Elixir: ["ex", "exs"],
  Scala: ["scala"], Dart: ["dart"], Terraform: ["tf"],
  Vue: ["vue"], Svelte: ["svelte"], Solidity: ["sol"],
}

/** `read(kind, name)` returns a parsed inventory or metadata snapshot, or null.
 * Historical aliases count as records; don't pretend per-format counts are
 * deduplicated projects. Reject other revisions rather than mixing pins. */
export function publicCoverage(corpus, read) {
  const formats = Object.entries(FORMATS).map(([name, extensions]) => ({ name, extensions, records: 0, files: 0 }))
  const out = {
    records: corpus.length, inventories: 0, metadataSnapshots: 0,
    auditedMetadataSnapshots: 0, legacyMetadataSnapshots: 0,
    policyLimitedMetadataSnapshots: 0, metadataOldestDay: null, metadataNewestDay: null,
    formats: [],
  }
  for (const repo of corpus) {
    const inventory = read("inventory", repo.name)
    if (inventory?.sha === repo.sha) {
      out.inventories++
      for (const row of formats) {
        const files = row.extensions.reduce((n, ext) => n + (inventory.exts?.[ext] ?? 0), 0)
        if (files > 0) { row.records++; row.files += files }
      }
    }
    const metadata = read("metadata", repo.name)
    if (metadata?.sha !== repo.sha) continue
    out.metadataSnapshots++
    const audit = metadata.networkAudit
    if (audit?.transportOK === true && [1, 2].includes(audit.version)) out.auditedMetadataSnapshots++
    else if (!audit) out.legacyMetadataSnapshots++
    if (audit?.policyLimitedResponses > 0) out.policyLimitedMetadataSnapshots++
    const time = Date.parse(metadata.checkedAt)
    if (Number.isFinite(time)) {
      const day = new Date(time).toISOString().slice(0, 10)
      if (!out.metadataOldestDay || day < out.metadataOldestDay) out.metadataOldestDay = day
      if (!out.metadataNewestDay || day > out.metadataNewestDay) out.metadataNewestDay = day
    }
  }
  out.formats = formats.filter(row => row.records).sort((a, b) => b.records - a.records || a.name.localeCompare(b.name))
    .map(({ name, records, files }) => ({ name, records, files }))
  return out
}
