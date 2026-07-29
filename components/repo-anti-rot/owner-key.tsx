"use client"

import { useEffect, useState } from "react"
import { OWNER_CHANGED_EVENT } from "@/lib/owner-events"
import { KeyRound, Check, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

/**
 * Claiming the operator key, from Settings.
 *
 * The key is POSTed once and lives in an `httpOnly` cookie from then on — it is
 * never held in React state after the request, never written to localStorage,
 * and never readable by any script on the page, including this one. That is why
 * "am I unlocked?" is a question for the server rather than something this
 * component can answer from what it stored.
 */
export function OwnerKey() {
  const [state, setState] = useState<{ owner: boolean; configured: boolean } | null>(null)
  const [key, setKey] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetch("/api/unlock")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => setState(data))
      .catch(() => {})
  }, [])

  async function submit(method: "POST" | "DELETE") {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/unlock", {
        method,
        ...(method === "POST"
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ token: key }) }
          : {}),
      })
      const data = (await res.json().catch(() => null)) as { owner?: boolean; error?: string } | null
      if (!res.ok) {
        setError(data?.error ?? `Request failed (${res.status})`)
        return
      }
      // Dropped immediately: the value is in the cookie now, and keeping a copy
      // in a React tree is exactly what httpOnly was chosen to avoid.
      setKey("")
      setState((prev) => ({ configured: prev?.configured ?? true, owner: Boolean(data?.owner) }))
      // Anything showing a limit has to ask again: unlocking changes the answer,
      // and a form still holding the public cap will refuse work the server
      // would now accept.
      window.dispatchEvent(new Event(OWNER_CHANGED_EVENT))
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  // Nothing to offer on a deployment with no key configured. Showing an empty
  // field would advertise a door that does not exist.
  if (!state?.configured && !state?.owner) return null

  return (
    <div className="space-y-2 border-t border-border pt-5">
      <Label htmlFor="owner-key" className="flex items-center gap-1.5">
        <KeyRound className="size-4 text-primary" />
        Operator key
      </Label>

      {state?.owner ? (
        <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2">
          <p className="flex items-center gap-2 text-sm text-primary">
            <Check className="size-4" />
            Unlocked — scan limits do not apply to this browser.
          </p>
          <Button variant="outline" size="sm" onClick={() => submit("DELETE")} disabled={busy}>
            Sign out
          </Button>
        </div>
      ) : (
        <>
          <div className="flex gap-2">
            <Input
              id="owner-key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && key.trim() && !busy) void submit("POST")
              }}
              placeholder="REPO_ANTI_ROT_OWNER_TOKEN"
              className="font-mono text-sm"
              autoComplete="off"
            />
            <Button onClick={() => submit("POST")} disabled={busy || !key.trim()}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              Unlock
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </>
      )}

      <p className="text-xs text-muted-foreground">
        Lifts the per-hour scan allowance and the per-request repository cap for this browser.
        The limit on how many scans run at once still applies — that one protects the machine&apos;s
        memory, not its fairness.
      </p>
    </div>
  )
}
