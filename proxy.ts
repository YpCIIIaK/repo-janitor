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
    const expected = process.env.PUBLIC_ORIGIN || request.nextUrl.origin
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
