import { cookies } from "next/headers"

import { SESSION_COOKIE, readSession } from "@/lib/session"
import { oauthConfig } from "@/lib/github-oauth"
import { personCardMarkdown } from "@/lib/github-user"
import { SignOutButton } from "./sign-out-button"
import { LOCALE_COOKIE, resolveLocale } from "@/lib/i18n"

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
const ERRORS_RU: Record<string, string> = {
  cancelled: "Вход отменён.",
  bad_state: "Ссылка входа устарела или была создана в другом браузере. Попробуйте снова.",
  no_code: "GitHub не вернул код входа. Попробуйте снова.",
  exchange_failed: "Не удалось обменять код входа через GitHub. Попробуйте чуть позже.",
  who_failed: "Не удалось получить сведения о пользователе GitHub. Попробуйте снова.",
}

export default async function ProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const store = await cookies()
  const locale = resolveLocale(store.get(LOCALE_COOKIE)?.value, null)
  const ru = locale === "ru"
  const session = readSession(
    store.get(SESSION_COOKIE)?.value,
    process.env.REPO_ANTI_ROT_SESSION_SECRET,
  )
  const configured = Boolean(oauthConfig() && process.env.REPO_ANTI_ROT_SESSION_SECRET)

  const params = await searchParams
  const rawError = typeof params.error === "string" ? params.error : null
  const error = rawError ? (ru ? (ERRORS_RU[rawError] ?? "Не удалось завершить вход.") : (ERRORS[rawError] ?? "Sign-in did not complete.")) : null

  if (!session) {
    return (
      <main className="mx-auto max-w-2xl px-6 py-20">
        <h1 className="text-2xl font-bold">{ru ? "Ваш профиль" : "Your profile"}</h1>
        <p className="text-muted-foreground mt-3 text-sm">
          {ru ? "Войдите через GitHub, чтобы увидеть свои карточки и подписаться на уведомления о репозиториях. Логин и подтверждённая основная почта хранятся в подписанном cookie сеанса восемь дней. При подписке почта также сохраняется для отправки уведомлений." : "Sign in with GitHub to see your cards and subscribe to repository alerts. Your login and verified primary email are kept in a signed session cookie for eight days. Subscribing also stores your email with the watch."}
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
            {ru ? "Войти через GitHub" : "Sign in with GitHub"}
          </a>
        ) : (
          <p className="text-muted-foreground mt-8 rounded-lg border px-4 py-3 text-sm">
            {ru ? "Вход на этом сервере не настроен. Нужны приложение GitHub OAuth" : "Sign-in is not configured on this deploy. It needs a GitHub OAuth app"}
            (<code>GITHUB_OAUTH_CLIENT_ID</code>, <code>GITHUB_OAUTH_CLIENT_SECRET</code>)
            {ru ? "и" : "and a"} <code>REPO_ANTI_ROT_SESSION_SECRET</code>.
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
            {ru ? "Вход через GitHub. Сеанс истекает " : "Signed in with GitHub. Session expires "}
            {new Date(session.exp * 1000).toLocaleDateString(ru ? "ru-RU" : "en-GB", {
              day: "numeric",
              month: "short",
            })}
            .
          </p>
        </div>
        <SignOutButton />
      </div>

      <h2 className="mt-12 text-lg font-semibold">{ru ? "Ваши карточки" : "Your cards"}</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {ru ? "Созданы на основе публичного профиля GitHub. Карточки используют только уже опубликованные сведения." : "Built from your public GitHub profile. Everything on them is already public — the card just arranges it."}
      </p>

      <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <figure className="space-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={card()} alt={`${login} card`} width={300} height={420} className="rounded-xl" />
          <figcaption className="text-muted-foreground text-xs">{ru ? "Вертикальная" : "Portrait"}</figcaption>
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
          <figcaption className="text-muted-foreground text-xs">{ru ? "Подробная" : "Detailed"}</figcaption>
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
        <figcaption className="text-muted-foreground text-xs">{ru ? "Широкая, для README" : "Wide, for a README"}</figcaption>
      </figure>

      <h2 className="mt-12 text-lg font-semibold">{ru ? "Карточка резюме" : "Resume card"}</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        {ru ? "Стек, специализация, проекты и контакты. Можно редактировать, просматривать результат сразу и скачать SVG." : "The big one — stack, focus areas, projects, contacts. Editable, with a live preview, and downloadable as an SVG."}
      </p>
      <a
        href="/profile/resume"
        className="bg-foreground text-background mt-4 inline-flex items-center rounded-lg px-5 py-2.5 text-sm font-semibold"
      >
        {ru ? "Открыть редактор" : "Open the builder"}
      </a>

      <h2 className="mt-12 text-lg font-semibold">{ru ? "Код для вставки" : "Paste it somewhere"}</h2>
      <pre className="bg-muted mt-3 overflow-x-auto rounded-lg p-4 text-xs">
        <code>{personCardMarkdown(login, "")}</code>
      </pre>
      <p className="text-muted-foreground mt-2 text-xs">
        {ru ? "Добавьте перед путём адрес вашего сайта. Параметры оформления: " : "Prefix the path with your deploy’s origin. Layout parameters: "}
        <code>?size=wide</code> {ru ? "или" : "or"} <code>?detail=full</code>.
      </p>
    </main>
  )
}
