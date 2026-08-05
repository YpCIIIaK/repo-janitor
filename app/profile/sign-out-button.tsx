"use client"

import { useState } from "react"

/**
 * Sign out, then reload.
 *
 * A form post rather than a link because the logout route refuses GET — see the
 * note there about `<img src>` signing people out.
 */
export function SignOutButton() {
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await fetch("/api/auth/logout", { method: "POST" })
          window.location.href = "/profile"
        } catch {
          // The cookie is still there, so leaving the button enabled is the
          // honest outcome: nothing happened, and it can be tried again.
          setBusy(false)
        }
      }}
      className="rounded-lg border px-4 py-2 text-sm font-medium disabled:opacity-60"
    >
      {busy ? "Signing out…" : "Sign out"}
    </button>
  )
}
