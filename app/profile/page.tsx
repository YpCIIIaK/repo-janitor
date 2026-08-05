import { cookies } from "next/headers"

import { SESSION_COOKIE, readSession } from "@/lib/session"
import { oauthConfig } from "@/lib/github-oauth"
import { personCardMarkdown } from "@/lib/github-user"
import { SignOutButton } from "./sign-out-button"

/**
 * The signed-in profile: your cards, and the snippets to paste them somewhere.
 *
 * Rendered on the server from the session cookie, so a signed-out visitor never
 * receives a page that briefly shows somebody's profile before a fetch corrects
 * it. The cards themselves come from `/api/card/person/<login>` as images —
 * this page holds no card logic of its own, which is what keeps the generator
 * the single source of truth for what a card looks like.
 */

export const dynamic = "force-dynamic"

const ERRORS: Record<string, string> = {
  cancelled: "Sign-in was cancelled.",
  bad_state: "That sign-in link expired or did not belong to this browser. Try again.",
  no_code: "GitHub did not send a code back. Try again.",
  exchange_failed: "GitHub would not exchange the code. Try again in a moment.",
  who_failed: "Signed in, but GitHub would not say who you are. Try again.",
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const store = await cookies()
  const session = readSession(
    store.get(SESSION_COOKIE)?.value,
    process.env.REPO_ANTI_ROT_SESSION_SECRET,
  )
  const configured = Boolean(oauthConfig() && process.env.REPO_ANTI_ROT_SESSION_SECRET)

  const params = await searchParams
  const rawError = typeof params.error === "string" ? params.error : null
  const error = rawError ? (ERRORS[rawError] ?? "Sign-in did not complete.") : null

  if (!session) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-2xl font-bold">Your profile</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          Sign in with GitHub to see your cards. Nothing is stored: the sign-in
          only proves the handle is yours, and the session lives in a cookie.
        </p>

        {error ? (
          <p className="border-destructive/40 bg-destructive/10 mt-6 rounded-lg border px-4 py-3 text-sm">
            {error}
          </p>
        ) : null}

        {configured ? (
          <a
            href="/api/auth/github?next=/profile"
            className="bg-foreground text-background mt-8 inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            Sign in with GitHub
          </a>
        ) : (
          <p className="text-muted-foreground mt-8 rounded-lg border px-4 py-3 text-sm">
            Sign-in is not configured on this deploy. It needs a GitHub OAuth app
            (<code>GITHUB_OAUTH_CLIENT_ID</code>, <code>GITHUB_OAUTH_CLIENT_SECRET</code>)
            and a <code>REPO_ANTI_ROT_SESSION_SECRET</code>.
          </p>
        )}
      </main>
    )
  }

  const { login } = session
  const card = (qs = "") => `/api/card/person/${login}${qs}`

  return (
    <main className="mx-auto max-w-5xl px-6 py-16">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">@{login}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Signed in with GitHub. Session expires{" "}
            {new Date(session.exp * 1000).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "short",
            })}
            .
          </p>
        </div>
        <SignOutButton />
      </div>

      <h2 className="mt-12 text-lg font-semibold">Your cards</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        Built from your public GitHub profile. Everything on them is already
        public — the card just arranges it.
      </p>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <figure className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card()} alt={`${login} card`} width={300} height={420} className="rounded-xl" />
          <figcaption className="text-muted-foreground text-xs">Portrait</figcaption>
        </figure>
        <figure className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={card("?detail=full")}
            alt={`${login} detailed card`}
            width={300}
            height={420}
            className="rounded-xl"
          />
          <figcaption className="text-muted-foreground text-xs">Detailed</figcaption>
        </figure>
      </div>

      <figure className="mt-6 space-y-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={card("?size=wide&detail=full")}
          alt={`${login} wide card`}
          width={480}
          height={300}
          className="rounded-xl"
        />
        <figcaption className="text-muted-foreground text-xs">Wide, for a README</figcaption>
      </figure>

      <h2 className="mt-12 text-lg font-semibold">Paste it somewhere</h2>
      <pre className="bg-muted mt-3 overflow-x-auto rounded-lg p-4 text-xs">
        <code>{personCardMarkdown(login, "")}</code>
      </pre>
      <p className="text-muted-foreground mt-2 text-xs">
        Prefix the path with your deploy&rsquo;s origin. Add{" "}
        <code>?size=wide</code> or <code>?detail=full</code> to taste.
      </p>
    </main>
  )
}
