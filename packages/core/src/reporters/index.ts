import type { ScanReport } from "../schema"
import { renderJson } from "./json"
import { renderTerminal } from "./terminal"
import { renderMarkdown } from "./markdown"
import { renderSarif } from "./sarif"

export { renderJson, renderTerminal, renderMarkdown, renderSarif }

export type ReportFormat = "json" | "terminal" | "md" | "sarif"

/** Aliases accepted on the CLI / Action so `markdown`, `text`, etc. all work. */
const ALIASES: Record<string, ReportFormat> = {
  json: "json",
  terminal: "terminal",
  text: "terminal",
  md: "md",
  markdown: "md",
  sarif: "sarif",
}

export function normalizeFormat(format: string): ReportFormat {
  return ALIASES[format.toLowerCase()] ?? "terminal"
}

/** Render a report in the requested format (unknown formats fall back to terminal). */
export function renderReport(report: ScanReport, format: string): string {
  switch (normalizeFormat(format)) {
    case "json":
      return renderJson(report)
    case "md":
      return renderMarkdown(report)
    case "sarif":
      return renderSarif(report)
    default:
      return renderTerminal(report)
  }
}
