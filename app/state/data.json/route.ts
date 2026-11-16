import { readFileSync } from "node:fs"
import { join } from "node:path"

/** The same public benchmark aggregates as /state. No usage or private reports. */
export const dynamic = "force-static"

export function GET() {
  const snapshot = readFileSync(join(process.cwd(), "benchmark", "stats.json"), "utf8")
  return new Response(snapshot, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="repo-janitor-public-stats.json"',
    },
  })
}
