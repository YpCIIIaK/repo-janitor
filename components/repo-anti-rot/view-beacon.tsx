"use client"

import { useEffect, useRef } from "react"
import { usageHeaders, usageOptedOut } from "@/lib/visitor"

/**
 * Tells the server that this shared report was opened.
 *
 * Renders nothing and blocks nothing. Everything about the page works whether or
 * not this fires — it is a counter, so a failure is simply an uncounted visit.
 */
export function ViewBeacon({ owner, name }: { owner: string; name: string }) {
  const sent = useRef(false)

  useEffect(() => {
    // React runs effects twice in development; a double count would be a lie.
    if (sent.current || usageOptedOut()) return
    sent.current = true
    void fetch("/api/usage/view", {
      method: "POST",
      headers: { "content-type": "application/json", ...usageHeaders() },
      body: JSON.stringify({ owner, name }),
      keepalive: true,
    }).catch(() => {})
  }, [owner, name])

  return null
}
