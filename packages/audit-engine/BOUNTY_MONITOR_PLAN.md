# План: Bounty Market Monitor (Vercel + Telegram + AI)

Сервис: каждое утро сканит рынок баг-баунти (новые/изменённые программы + новости),
прогоняет через ИИ, шлёт дайджест в Telegram. Есть кнопка ручного рескана. Хостинг — Vercel.

Отдельный от `d:\auditscout` проект (не тащим локальный воркбенч в деплой). Логику источников
можно подсмотреть в `bounties.py` / `market.py` / `contests.py` / `watch.py`, но портируем в TS.

---

## 1. Стек и почему

- **Next.js (App Router, TypeScript) на Vercel** — нативный cron, serverless API routes, простой веб-UI для кнопки.
- **Vercel Cron Jobs** — расписание в `vercel.json`, дёргает `/api/scan` раз в сутки. Надёжно, бесплатно (Hobby: cron есть).
- **Upstash Redis** (через `@upstash/redis`, free tier) — хранит прошлый снапшот и хэши программ для диффа. Vercel stateless, поэтому состояние снаружи.
- **OpenRouter → `stealth/ox-alpha`** (free, ctx 1M) для анализа. ⚠️ cloaked-модель логирует промпты — кормить ТОЛЬКО публичными рыночными данными, никаких приватных находок/NDA.
- **Telegram Bot API** — `sendMessage` (Markdown), сплит по 4096 символов.

### Про «чтобы не засыпал»
Vercel serverless **не спит** как Render/Railway free — функции вызываются по требованию, cron гарантирует ежедневный запуск. Keep-warm пинги НЕ нужны (только жгут инвокейшены). Если очень хочется — второй cron на `/api/health`, но по умолчанию не делаем.

---

## 2. Структура проекта

```
bounty-monitor/
  app/
    page.tsx                 # UI: статус последнего скана + кнопка «Рескан»
    api/
      scan/route.ts          # основной пайплайн (cron + ручной)
      health/route.ts        # опционально, для аптайм-чека
  lib/
    sources/
      cantina.ts             # bounties + competitions (keyless API)
      immunefi.ts            # публичный список программ
      contests.ts            # Sherlock / Code4rena / Cantina competitions (open now)
      hackenproof.ts         # best-effort (Cloudflare-gated, см. §5)
      news.ts                # RSS-агрегатор новостей
    diff.ts                  # снапшот-хэши, классификация new/changed/removed
    rank.ts                  # детерминированный скоринг под наш эдж (§6)
    ai.ts                    # вызов stealth/ox-alpha через OpenRouter
    telegram.ts              # sendMessage + сплит
    store.ts                 # Upstash Redis get/set снапшота
  vercel.json                # cron
  .env.example
```

---

## 3. Источники данных

| Источник | Как брать | Заметки |
|---|---|---|
| **Cantina bounties** | `GET https://cantina.xyz/api/v0/bounties` (keyless) | 71 прог., поля: `id,name,totalRewardPot,submissionFee,kycRequired,totalFindings,createdAt,status,assetGroups`. Плотность = findings / кол-во активов. |
| **Cantina competitions** | Cantina API (раунды) | «открыто сейчас» для подачи. |
| **Sherlock** | Sherlock public API | контесты + даты. |
| **Code4rena** | code4rena.com (список аудитов) | живые/скоро. |
| **Immunefi** | публичный bounties JSON (см. `market.py`, источник immunefi) | ~6MB, парсить и кэшировать; крупнейший, KYC частый. |
| **HackenProof** | Cloudflare 403 из serverless | best-effort (§5). |
| **Новости** | RSS: rekt.news, Immunefi blog, Cantina blog, HackenProof blog, week-in-ethereum, (опц.) nitter-RSS избранных X-аккаунтов | дедуп по ссылке. |

---

## 4. Пайплайн `/api/scan`

1. **Auth**: cron шлёт `Authorization: Bearer $CRON_SECRET` (Vercel сам добавляет). Ручной вызов — тот же секрет или отдельный `MANUAL_TOKEN`.
2. **Fetch** всех источников параллельно (`Promise.allSettled`, таймауты, отказоустойчиво — один упавший источник не валит скан).
3. **Diff** (`diff.ts`): для каждой программы хэш от `{id,reward,fee,kyc,assets,findings,updatedAt}`. Сравнить со снапшотом в Redis → списки **new / changed / removed**. Новости — дедуп по URL против сохранённого множества.
4. **Rank** (`rank.ts`, §6): отсортировать new+changed по нашему эджу.
5. **AI** (`ai.ts`): скормить компактный JSON диффа + заголовки новостей в `stealth/ox-alpha`, попросить (a) топ-возможности под наш профиль, (b) 2 строки по новостям, (c) рекомендованное действие. Только публичные данные.
6. **Telegram**: собрать Markdown-дайджест, отправить (сплит >4096).
7. **Persist**: записать новый снапшот + множество новостей + `lastRun` в Redis.
8. Вернуть JSON-статус (для UI).

Если diff пустой — короткое «изменений нет» (или вовсе молчать по флагу).

---

## 5. HackenProof (Cloudflare)

Маркетплейс отдаёт 403 на API/WebFetch из облака. Варианты по возрастанию усилий:
- **A.** Пропустить автоскан, раз в неделю напоминание «проверь HackenProof вручную».
- **B.** Их публичный GraphQL / sitemap, если доступен из Vercel-региона (проверить эмпирически).
- **C.** Внешний обход Cloudflare (сторонний скрейпер/браузерless-сервис) — сложно/платно, не в MVP.

MVP: вариант A + попытка B.

---

## 6. Скоринг под наш эдж (детерминированный, до ИИ)

Из памяти воркбенча (`protocol-field-guide`, `market.py`):
1. **no submissionFee + no KYC** — выше (иначе матожидание отрицательное / выплата недоступна).
2. далее по **плотности** = заявок / актив (r = −0.67, меньше = лучше).
3. бонус за наш профиль: **EVM/Solidity, свежий неаудированный код, cross-chain** (ниша divergence/msgauth), новизна `createdAt`.
4. штраф: закрытый исходник, только-web, только Cairo/не-EVM.

ИИ получает уже отсортированное — он объясняет и приоритизирует, не считает с нуля.

---

## 7. ENV (`.env.example`)

```
OPENROUTER_API_KEY=
OPENROUTER_MODEL=stealth/ox-alpha
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
UPSTASH_REDIS_REST_URL=
UPSTASH_REDIS_REST_TOKEN=
CRON_SECRET=
MANUAL_TOKEN=
```

---

## 8. `vercel.json` (cron)

```json
{
  "crons": [
    { "path": "/api/scan", "schedule": "0 6 * * *" }
  ]
}
```
Cron в UTC. 06:00 UTC ≈ утро; подогнать под свой пояс. (Hobby-план: минимум суточная гранулярность подходит.)

---

## 9. AI-промпт (скелет для `ai.ts`)

- System: «Ты аналитик рынка баг-баунти. Профиль охотника: EVM/Solidity, ищет свежий неаудированный код, cross-chain (divergence/msgauth), no-KYC, низкая плотность заявок. Данные ПУБЛИЧНЫЕ. Верни кратко Markdown: 🎯 Топ-3 возможности (почему), 📰 Новости (2 строки), ✅ Действие дня.»
- User: JSON `{new:[...], changed:[...], removed:[...], news:[...]}` (обрезать до разумного; 1M контекст позволяет много, но держим компактно).

---

## 10. Порядок сборки (фазы)

1. **Каркас**: `create-next-app` (TS), деплой пустого на Vercel, подключить Upstash Redis (Vercel Integrations).
2. **Источники**: `cantina.ts` (первый, самый простой keyless) → `immunefi.ts` → `contests.ts` → `news.ts`. Каждый тестировать отдельным route.
3. **diff + store**: снапшот в Redis, классификация.
4. **telegram.ts**: создать бота у @BotFather, получить `chat_id`, отправить тестовое.
5. **ai.ts**: подключить `stealth/ox-alpha`, прогнать на реальном диффе.
6. **/api/scan**: собрать всё, защитить `CRON_SECRET`.
7. **vercel.json cron** + UI-кнопка на `page.tsx` (POST на scan с `MANUAL_TOKEN`).
8. **hackenproof.ts** best-effort в конце.

---

## 11. Открытые вопросы (решить в новом чате)

- Точное время cron (пояс пользователя).
- Формат дайджеста: всегда слать, или только при изменениях?
- Immunefi 6MB — тянуть каждый день или через ETag/условный запрос?
- Нужен ли `chat` (личка) или канал/группа в Telegram.
- Ручная кнопка: публичная страница с токеном или закрыть Vercel-аутентификацией.

## Референсы в текущем воркбенче (логика источников)
`d:\auditscout\bounties.py` (Cantina API + поля), `market.py` (Immunefi + скоринг плотности),
`contests.py` / `watch.py` (Sherlock/Code4rena/Cantina competitions).
Память: `protocol-field-guide.md`, `bounty-market-sources.md`, `audit-contests-closed.md`.
