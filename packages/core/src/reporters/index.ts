import type { ScanReport } from "../schema"
import { renderJson } from "./json"
import { renderTerminal } from "./terminal"
import { renderMarkdown } from "./markdown"

export { renderJson, renderTerminal, renderMarkdown }

export type ReportFormat = "json" | "terminal" | "md"

/** Aliases accepted on the CLI / Action so `markdown`, `text`, etc. all work. */
const ALIASES: Record<string, ReportFormat> = {
  json: "json",
  terminal: "terminal",
  text: "terminal",
  md: "md",
  markdown: "md",
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
    default:
      return renderTerminal(report)
  }
}
