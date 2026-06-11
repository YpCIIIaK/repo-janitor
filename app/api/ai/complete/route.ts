import { NextResponse } from "next/server"
import { checkBearer } from "@/lib/api-auth"

/**
 * AI completion proxy (OpenRouter).
 *
 * The browser POSTs { apiKey, model, system, prompt } here and we forward it to
 * OpenRouter server-side. This keeps the user's key out of the client bundle and
 * out of third-party network logs: the key only travels browser → our own origin
 * (HTTPS body) → OpenRouter. We never log the key.
 *
 * The key may also come from the server env (OPENROUTER_API_KEY) so a deploy can
 * provide a shared key without each user pasting one. That shared-key path is
 * abuse-hardened: it requires `Authorization: Bearer <RAR_AI_PROXY_TOKEN>` (so an
 * anonymous caller can't spend the owner's credits) and an optional model
 * allowlist (`OPENROUTER_ALLOWED_MODELS`). Either way `maxTokens` is clamped.
 */
export const runtime = "nodejs"
export const maxDuration = 60

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
const MAX_TOKENS_CAP = 4000

interface Body {
  apiKey?: string
  model?: string
  system?: string
  prompt?: string
  maxTokens?: number
  /** When true, attach OpenRouter's web-search plugin so the model can read live advisories. */
  web?: boolean
}

// OpenRouter web plugin: a few results is plenty to read an advisory and keeps cost down.
const WEB_MAX_RESULTS = 3

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const userKey = (body.apiKey || "").trim()
  const serverKey = (process.env.OPENROUTER_API_KEY || "").trim()
  // The shared server key is only used when the caller didn't bring their own.
  const usingServerKey = !userKey && !!serverKey
  const apiKey = userKey || serverKey
  const model = (body.model || "").trim()
  const prompt = (body.prompt || "").trim()

  if (!apiKey) {
    return NextResponse.json({ error: "No API key. Add one in Settings." }, { status: 400 })
  }
  if (!model) {
    return NextResponse.json({ error: "No model id. Set one in Settings." }, { status: 400 })
  }
  if (!prompt) {
    return NextResponse.json({ error: "Empty prompt." }, { status: 400 })
  }

  // Abuse-harden the shared-key path: spending the owner's credits requires a
  // proxy token, and (optionally) a whitelisted model. Requests carrying the
  // user's own key are unaffected — they pay for their own usage.
  if (usingServerKey) {
    const proxyToken = process.env.RAR_AI_PROXY_TOKEN
    if (!proxyToken) {
      return NextResponse.json(
        { error: "Server AI key is set but RAR_AI_PROXY_TOKEN is not — refusing anonymous use." },
        { status: 503 },
      )
    }
    if (!checkBearer(request, proxyToken)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const allowed = (process.env.OPENROUTER_ALLOWED_MODELS || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(model)) {
      return NextResponse.json({ error: `Model "${model}" is not allowed.` }, { status: 403 })
    }
  }

  // Clamp output size so no caller (even with the shared key) can request a
  // runaway/expensive completion.
  const maxTokens = Math.min(MAX_TOKENS_CAP, Math.max(1, Math.floor(body.maxTokens ?? 1500)))

  const messages = [
    ...(body.system ? [{ role: "system" as const, content: body.system }] : []),
    { role: "user" as const, content: prompt },
  ]

  let res: Response
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Recommended by OpenRouter for attribution; harmless if ignored.
        "X-Title": "Repo Anti-Rot",
      },
      body: JSON.stringify({
        model,
        messages,
        max_tokens: maxTokens,
        temperature: 0.2,
        // Opt-in web search: lets the model consult live advisories (e.g. a CVE
        // published after its training cutoff) instead of echoing the prompt.
        ...(body.web ? { plugins: [{ id: "web", max_results: WEB_MAX_RESULTS }] } : {}),
      }),
    })
  } catch (err) {
    return NextResponse.json({ error: `Upstream request failed: ${String(err)}` }, { status: 502 })
  }

  const data = (await res.json().catch(() => null)) as
    | { choices?: { message?: { content?: string } }[]; error?: { message?: string } }
    | null

  if (!res.ok) {
    const msg = data?.error?.message || `OpenRouter error (${res.status})`
    return NextResponse.json({ error: msg }, { status: res.status })
  }

  const text = data?.choices?.[0]?.message?.content?.trim() ?? ""
  if (!text) {
    return NextResponse.json({ error: "Model returned an empty response." }, { status: 502 })
  }

  return NextResponse.json({ text })
}
