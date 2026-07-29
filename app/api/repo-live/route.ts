import { NextResponse } from "next/server"
import { isPublicGitUrl } from "@/lib/url-guard"
import { run } from "@/lib/clone-runner"

/**
 * Is this repository still there and still public?
 *
 * A shared report is a snapshot; the page offers a fresh scan so a reader can
 * see the repository as it is now. That offer is only worth making if the repo
 * can still be cloned — repositories get archived, renamed, made private and
 * deleted, and a button that leads to "clone failed" is worse than no button.
 *
 * `git ls-remote` answers exactly the question that matters: not "does a web
 * page exist" but "can this be cloned anonymously". It transfers no objects, so
 * it is cheap enough to run on a page view.
 *
 * Kept out of the shared page's server render on purpose. That page has to stay
 * readable with no JavaScript and no waiting; a network round trip to a third
 * party in its critical path would make every visit as slow as the slowest host.
 */
export const runtime = "nodejs"
export const maxDuration = 30

export async function POST(request: Request) {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const url = String((body as { url?: unknown })?.url ?? "").trim()
  if (!url) return NextResponse.json({ error: "Provide `url`." }, { status: 400 })

  // Same guard as the scanner. A share link is attacker-supplied input as far as
  // this route is concerned, so it must not become a probe of the private network.
  const safe = await isPublicGitUrl(url)
  if (!safe.ok) {
    return NextResponse.json({ live: false, reason: safe.reason }, { status: 200 })
  }

  const res = await run("git", ["ls-remote", "--exit-code", url, "HEAD"], {
    timeoutMs: 10_000,
    // Refuse interactive credential prompts: a private repo must fail fast, not
    // block the process waiting for a username nobody will type.
    env: { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "echo" },
  })

  return NextResponse.json(
    { live: res.code === 0 },
    { headers: { "cache-control": "public, max-age=300" } },
  )
}
