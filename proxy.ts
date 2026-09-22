import { NextResponse, type NextRequest } from "next/server"

function comparableOrigin(value: string): string {
  try {
    const url = new URL(value)
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) url.hostname = "localhost"
    return url.origin
  } catch { return value }
}

export function proxy(request: NextRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    const origin = request.headers.get("origin")
    // Render terminates TLS before Next.js, so nextUrl may describe the internal
    // HTTP hop. Use deployment configuration, never client-forwarded headers.
    const expected = process.env.PUBLIC_ORIGIN || process.env.RENDER_EXTERNAL_URL || request.nextUrl.origin
    if (origin && comparableOrigin(origin) !== comparableOrigin(expected)) {
      return NextResponse.json({ error: "Cross-origin mutation refused" }, { status: 403 })
    }
    if (Number(request.headers.get("content-length")) > 2 * 1024 * 1024) {
      return NextResponse.json({ error: "Request too large" }, { status: 413 })
    }
  }
  return NextResponse.next()
}

export const config = { matcher: "/api/:path*" }
