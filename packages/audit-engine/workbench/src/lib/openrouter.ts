import { getSetting } from "./db";

export function openRouterKey(): string {
  return process.env.OPENROUTER_API_KEY || getSetting("openrouter_key", "");
}

export function openRouterModel(): string {
  return getSetting("or_model", "nvidia/nemotron-3.5-lightning:free") || "nvidia/nemotron-3.5-lightning:free";
}

export async function chatJson(system: string, user: string, signal?: AbortSignal): Promise<{ raw: string; parsed: unknown }> {
  const key = openRouterKey();
  if (!key) throw new Error("Нет OPENROUTER_API_KEY в workbench/.env.local");
  const model = openRouterModel();
  const r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3333",
      "X-Title": "auditscout-workbench",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
  });
  const j = (await r.json()) as {
    error?: { message?: string };
    choices?: { message?: { content?: string } }[];
  };
  if (!r.ok) throw new Error(j.error?.message || `OpenRouter HTTP ${r.status}`);
  const raw = j.choices?.[0]?.message?.content || "";
  return { raw, parsed: extractJson(raw) };
}

function extractJson(s: string): unknown {
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  const src = fence ? fence[1] : s;
  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    if (src[i] === "{") depth++;
    if (src[i] === "}") depth--;
    if (depth === 0) {
      try {
        return JSON.parse(src.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
