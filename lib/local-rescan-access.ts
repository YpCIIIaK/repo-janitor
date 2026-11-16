/** Enabled only by the loopback-bound local launcher; never a public API. */
export function localRescanEnabled(headers: Pick<Headers, "get">): boolean {
  if (process.env.REPO_JANITOR_LOCAL_RESCAN !== "1") return false
  const host = headers.get("host") ?? ""
  if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/i.test(host)) return false
  try { return new URL(`http://${host}`).host.toLowerCase() === host.toLowerCase() } catch { return false }
}

export function localRescanRequest(request: Request, mutation = false): boolean {
  if (!localRescanEnabled(request.headers)) return false
  const origin = request.headers.get("origin")
  // Next may normalize request.url to localhost even when the browser used
  // 127.0.0.1. Compare with the already validated Host, never forwarded headers.
  const expected = new URL(`${new URL(request.url).protocol}//${request.headers.get("host")}`).origin
  if (origin && origin !== expected) return false
  return !mutation || origin === expected &&
    request.headers.get("x-repo-janitor-local") === "1" &&
    request.headers.get("content-type")?.split(";")[0].trim() === "application/json"
}
