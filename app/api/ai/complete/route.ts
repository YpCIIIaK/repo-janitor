import { NextResponse } from "next/server"

/**
 * AI completion proxy (OpenRouter).
 *
 * The browser POSTs { apiKey, model, system, prompt } here and we forward it to
 * OpenRouter server-side. This keeps the user's key out of the client bundle and
 * out of third-party network logs: the key only travels browser → our own origin
 * (HTTPS body) → OpenRouter. We never log the key.
 *
 * The key may also come from the server env (OPENROUTER_API_KEY) so a deploy can
 * provide a shared key without each user pasting one.
 */
export const runtime = "nodejs"
export const maxDuration = 60

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

interface Body {
  apiKey?: string
  model?: string
  system?: string
  prompt?: string
  maxTokens?: number
}

export async function POST(request: Request) {
  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const apiKey = (body.apiKey || process.env.OPENROUTER_API_KEY || "").trim()
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
        max_tokens: body.maxTokens ?? 1500,
        temperature: 0.2,
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
