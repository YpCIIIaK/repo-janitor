import type { ScanReport } from "../schema"

/** Machine-readable report — the exact shape the dashboard / `/api/ingest` consume. */
export function renderJson(report: ScanReport): string {
  return JSON.stringify(report, null, 2)
}
