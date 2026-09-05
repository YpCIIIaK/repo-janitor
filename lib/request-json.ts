/** Bound streamed bodies too: Content-Length can be absent or dishonest. */
export async function readJson(request: Request, maxBytes = 256 * 1024): Promise<unknown> {
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
    return JSON.parse(Buffer.concat(chunks).toString("utf8"))
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
