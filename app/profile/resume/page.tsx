import Link from "next/link"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { SESSION_COOKIE, readSession } from "@/lib/session"
import { DEFAULT_RESUME } from "@/lib/resume-card-defaults"
import { ResumeEditor } from "./resume-editor"
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n"

/**
 * The resume card builder.
 *
 * Behind sign-in, not because the card is secret — it is made entirely of things
 * you type — but because the page opens on your own handle, and a builder that
 * greets a stranger with somebody else's name is confusing rather than useful.
 *
 * The handle from the session is only a starting value; it is editable like
 * everything else. Nothing here asserts that the card is about whoever is
 * signed in, so nothing needs to defend that claim.
 */
export const dynamic = "force-dynamic"

export default async function ResumeBuilderPage() {
  const store = await cookies()
  const ru = resolveLocale(store.get(LOCALE_COOKIE)?.value, null) === "ru"
  const session = readSession(
    store.get(SESSION_COOKIE)?.value,
    process.env.REPO_ANTI_ROT_SESSION_SECRET,
  )

  if (!session) redirect("/profile")

  return (
    <main className="mx-auto max-w-7xl px-6 py-12">
      <Link href="/profile" className="text-muted-foreground text-sm hover:underline">
        ← {ru ? "Профиль" : "Profile"}
      </Link>
      <h1 className="mt-4 text-2xl font-bold">{ru ? "Карточка резюме" : "Resume card"}</h1>
      <p className="text-muted-foreground mt-2 max-w-2xl text-sm">
        {ru ? "Большая карточка с вашими данными. Предпросмотр обновляется при редактировании прямо в браузере. Данные редактора не отправляются на сервер и не сохраняются." : "A poster-sized card built from what you type. The preview updates as you edit in your browser, with no server request or saved copy."}
      </p>

      <div className="mt-10">
        <ResumeEditor initial={{ ...DEFAULT_RESUME, handle: session.login }} />
      </div>
    </main>
  )
}
