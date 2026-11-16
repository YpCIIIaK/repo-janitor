import { localRescanRequest } from "@/lib/local-rescan-access"
import { catalog, createRun, getRun, listRuns, controlRun, launchRun, taskDetail, taskReport } from "@/benchmark/local-rescan-manager.mjs"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

export async function GET(request: Request) {
  if (!localRescanRequest(request)) return json({ error: "Not found" }, 404)
  try {
    const query = new URL(request.url).searchParams
    const root = process.cwd(), id = query.get("id"), name = query.get("repo")
    if (query.get("catalog") === "1") return json(await catalog(root))
    if (id && name && query.get("report")) return json(taskReport(root, id, name, query.get("report") === "metadata"))
    if (id && name) return json(taskDetail(root, id, name))
    if (id) return json(getRun(root, id))
    return json({ runs: listRuns(root) })
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Request failed" }, 400) }
}

export async function POST(request: Request) {
  if (!localRescanRequest(request, true)) return json({ error: "Not found" }, 404)
  try {
    if (Number(request.headers.get("content-length")) > 10_000_000) return json({ error: "Selection is too large" }, 413)
    const text = await request.text()
    if (text.length > 10_000_000) return json({ error: "Selection is too large" }, 413)
    const body = JSON.parse(text), root = process.cwd()
    if (body.action === "create") {
      const id = await createRun(root, body.config ?? {})
      launchRun(root, id)
      return json({ id }, 201)
    }
    controlRun(root, body.id, body.action)
    if (["resume", "retry"].includes(body.action)) launchRun(root, body.id)
    return json({ ok: true })
  } catch (error) { return json({ error: error instanceof Error ? error.message : "Request failed" }, 400) }
}
