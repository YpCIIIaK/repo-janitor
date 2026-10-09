/**
 * Longest array any request body may carry.
 *
 * Bodies here are validated with zod, and zod (through 4.6.5, CVE-2023-54404)
 * builds one issue object per failing element of an unbounded array: a 2 MB
 * body of `[{},{},…]` is ~700k elements and enough to exhaust memory. A real
 * report has at most a few hundred findings, so the cap is far above any
 * legitimate payload and is checked before the body ever reaches a schema.
 */
export const MAX_ARRAY_LENGTH = 5000

/** First array in `value` longer than `max`, as a path, or null. Iterative: no stack to blow. */
export function oversizedArray(value: unknown, max = MAX_ARRAY_LENGTH): string | null {
  const stack: [unknown, string][] = [[value, "$"]]
  while (stack.length) {
    const [node, path] = stack.pop()!
    if (Array.isArray(node)) {
      if (node.length > max) return path
      node.forEach((v, i) => {
        if (v && typeof v === "object") stack.push([v, `${path}[${i}]`])
      })
    } else if (node && typeof node === "object") {
      for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") stack.push([v, `${path}.${k}`])
    }
  }
  return null
}

/** Bound streamed bodies too: Content-Length can be absent or dishonest. */
export async function readJson(request: Request | Response, maxBytes = 256 * 1024): Promise<unknown> {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new Error("Request too large")
  if (!request.body) throw new Error("Empty body")
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) throw new Error("Request too large")
      chunks.push(value)
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"))
    const big = oversizedArray(parsed)
    if (big) throw new Error(`Array at ${big} is longer than ${MAX_ARRAY_LENGTH} items`)
    return parsed
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
