import { SESSION_COOKIE, isSecureRequest } from "@/lib/session"

/**
 * Sign out: clear the cookie.
 *
 * POST only. A GET logout can be triggered by any `<img src>` on any page, which
 * is not a security hole so much as a way for strangers to keep signing you out.
 *
 * There is nothing server-side to invalidate — see `lib/session.ts` for why the
 * session is stateless and what that trade costs.
 */
export const runtime = "nodejs"
export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const secure = isSecureRequest(request) ? "; Secure" : ""
  return new Response(null, {
    status: 204,
    headers: {
      "Set-Cookie": `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`,
    },
  })
}
