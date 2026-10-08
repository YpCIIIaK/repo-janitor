/** Opt-in paid provider smoke test. Never reads a key unless explicitly enabled. */
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { afterEach, expect, it, vi } from "vitest"
import { POST } from "@/app/api/ai/complete/route"
import { analyzeOneIssue } from "@/lib/ai-enrich"
import { generateSummary } from "@/lib/ai-summary"
import { DEFAULT_SETTINGS, saveAiSettings } from "@/lib/ai-settings"
import { installWindow, issue } from "./helpers"

afterEach(() => vi.unstubAllGlobals())

it.skipIf(!process.env.AI_LIVE_KEY_FILE)("checks real finding/summary responses with and without web search", async () => {
  const apiKey = readFileSync(process.env.AI_LIVE_KEY_FILE!, "utf8").trim()
  installWindow()
  const evidence: unknown[] = []
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    if (url === "/api/ai/complete") return POST(new Request("http://localhost/api/ai/complete", init))
    const started = Date.now()
    const requestBody = init?.body ? JSON.parse(String(init.body)) : null
    if (requestBody) expect(requestBody.plugins).toBeUndefined()
    // Use the OS transport: Node fetch can hang behind local Windows networking.
    // Headers/body travel on stdin, never in command arguments or a saved file.
    const config = [
      `url = ${JSON.stringify(url)}`, `request = ${init?.method ?? "GET"}`, "silent", "show-error", "max-time = 15",
      ...Object.entries(init?.headers ?? {}).map(([k, v]) => `header = ${JSON.stringify(`${k}: ${v}`)}`),
      ...(requestBody ? [`data = ${JSON.stringify(JSON.stringify(requestBody))}`] : []), 'write-out = "\\n%{http_code}"',
    ].join("\n")
    const raw = spawnSync("curl.exe", ["--config", "-"], { input: config, encoding: "utf8", timeout: 50_000, windowsHide: true })
    if (raw.status !== 0) throw new Error("OS transport failed or timed out")
    const split = raw.stdout.lastIndexOf("\n")
    const response = new Response(raw.stdout.slice(0, split), { status: Number(raw.stdout.slice(split + 1)) })
    const data = await response.clone().json()
    evidence.push({
      endpoint: url,
      status: response.status, elapsedMs: Date.now() - started,
      model: data.model, finish: data.choices?.[0]?.finish_reason,
      contentPreview: data.choices?.[0]?.message?.content?.slice(0, 600),
      sources: data.choices?.[0]?.message?.annotations?.map((a: { url_citation?: { url?: string; title?: string } }) => ({ url: a.url_citation?.url, title: a.url_citation?.title })),
      usage: data.usage,
      errorCode: data.error?.code,
    })
    return response
  })
  const finding = issue({ id: "live-sharp", category: "security", severity: "warning",
    title: "sharp@0.35.4 has a known vulnerability (GHSA-wq5f-xc86-pv6w)",
    location: "package.json", detail: "sharp : Vulnerability in librsvg dependency CVE-2026-96889. sharp@0.35.4 (npm) is affected by GHSA-wq5f-xc86-pv6w (high severity). Fixed in 0.35.5 — upgrade to 0.35.5 or later. (transitive dependency) Advisory: https://osv.dev/GHSA-wq5f-xc86-pv6w" })
  const outcomes: { kind: string; web: boolean; success: boolean }[] = []
  for (const webSearch of [false, true]) {
    if (process.env.AI_LIVE_WEB_FINDING_ONLY === "1" && !webSearch) continue
    const settings = { ...DEFAULT_SETTINGS, apiKey, model: "nvidia/nemotron-3.5-lightning:free", webSearch }
    saveAiSettings(settings)
    for (const kind of ["finding", "summary"]) {
      if (process.env.AI_LIVE_WEB_FINDING_ONLY === "1" && kind !== "finding") continue
      const result = kind === "finding"
        ? await analyzeOneIssue(finding, settings)
        : await generateSummary({ repoId: "YpCIIIaK/repo-janitor", owner: "YpCIIIaK", name: "repo-janitor", issues: [finding] }, { force: true })
      outcomes.push({ kind, web: webSearch, success: !!result })
      console.log(JSON.stringify({ ...outcomes.at(-1), result, upstream: evidence.splice(0) }).replaceAll(apiKey, "[REDACTED]"))
    }
  }
  expect(outcomes.every((item) => item.success)).toBe(true)
}, 240_000)
