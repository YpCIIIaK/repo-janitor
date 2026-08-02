import "server-only"

/**
 * Tiny mail sender: Resend when configured, otherwise console (dev / self-host).
 *
 * Subscriptions must work without a key — the store is the product; mail is the
 * delivery channel. Logging instead of throwing keeps local tests and dogfood
 * from failing just because nobody pasted RESEND_API_KEY.
 */

export type MailMessage = {
  to: string
  subject: string
  text: string
  html?: string
}

export type SendMailResult =
  | { ok: true; via: "resend" | "console" }
  | { ok: false; error: string }

function resendKey(): string | undefined {
  return process.env.RESEND_API_KEY?.trim() || undefined
}

function resendFrom(): string {
  return (
    process.env.RESEND_FROM?.trim() || "Repo Anti-Rot <onboarding@resend.dev>"
  )
}

export async function sendMail(msg: MailMessage): Promise<SendMailResult> {
  const key = resendKey()
  if (!key) {
    console.info(
      `[mail:console] to=${msg.to} subject=${JSON.stringify(msg.subject)}\n${msg.text}`,
    )
    return { ok: true, via: "console" }
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: resendFrom(),
        to: [msg.to],
        subject: msg.subject,
        text: msg.text,
        html: msg.html ?? undefined,
      }),
    })
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      return { ok: false, error: `Resend ${res.status}: ${detail}` }
    }
    return { ok: true, via: "resend" }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" }
  }
}
