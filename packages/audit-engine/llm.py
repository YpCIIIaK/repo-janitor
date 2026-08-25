# -*- coding: utf-8 -*-
"""Двухтировый маршрутизатор моделей: лёгкое — Lightning, тяжёлое — Ultra.

Зачем. Инструменты проекта (deployed, siblings, statesync, ...) — чистый
Python и модели не требуют вовсе. Модель нужна на ДРУГОМ: прочитать вывод
инструмента, прочитать код, рассудить «оправдана ли асимметрия», написать
черновой PoC. Эта работа делится надвое, и тиры разной цены:

    LIGHT  nvidia/nemotron-3.5-lightning     чтение, извлечение, форматирование,
                                             первый отсев очевидно-законного
    HEAVY  nvidia/nemotron-3-ultra-550b-a55b  суждение «это находка?»,
                                             межконтрактный поток, PoC
    FALLBACK poolside/laguna-s-2.1            запасная, взаимозаменяема с обоими:
                                             если выбранная молчит все ретраи,
                                             проход переключается на неё, а не
                                             падает. Цепочка: выбранная → резерв
                                             → второй тир.

Разделение окупается: тяжёлую модель зовём только по кандидатам, которые
LIGHT не смог закрыть, а таких после механического отсева единицы.

Провайдер — OpenRouter (суффикс `:free` — его конвенция), эндпоинт
OpenAI-совместимый. Ключ берётся ТОЛЬКО из окружения и никуда не пишется —
та же дисциплина, что у GITHUB_TOKEN в audits.py:

    $env:OPENROUTER_API_KEY = "sk-or-..."      # PowerShell, на время окна
    setx OPENROUTER_API_KEY "sk-or-..."        # навсегда, нужен новый терминал

Урок сегодняшнего дня (xchain поймал его на RPC): ответ ненадёжного free-тира
нельзя путать с результатом. Поэтому здесь ретраи с отступом, а пустой/рваный
ответ — это ошибка, а не «модель так решила».
"""
import json
import os
import sys
import time
import urllib.request

BASE = "https://openrouter.ai/api/v1/chat/completions"

LIGHT = "nvidia/nemotron-3.5-lightning:free"
HEAVY = "nvidia/nemotron-3-ultra-550b-a55b:free"

# Запасная модель, взаимозаменяемая с обоими тирами: если выбранная не
# ответила за все ретраи (free-тир упал, лёг под нагрузку, снят с раздачи),
# переключаемся на неё, а не роняем весь проход. Порядок важен: сначала то,
# что попросили, резерв — только когда основное молчит.
FALLBACK = "poolside/laguna-s-2.1:free"

# Цепочка на случай, если и резерв ляжет: тиры взаимозаменяемы, поэтому
# другой тир — тоже кандидат. Дубликаты и None отсеиваются при сборке.
def _chain(model):
    seen, out = set(), []
    for m in (model, FALLBACK, HEAVY if model != HEAVY else LIGHT):
        if m and m not in seen:
            seen.add(m)
            out.append(m)
    return out

# Порог веса, выше которого задачу отдаём HEAVY. Инструменты проекта ранжируют
# находки весом; договорённость: 6.0 — граница между «прочитать и отсеять» и
# «рассудить, находка ли». Совпадает с весами ungated/siblings/forkdiff, где
# 6+ — снятый гейт, произвольный вызов, сдвиг слота.
HEAVY_WEIGHT = 6.0

# Задачи, которые ВСЕГДА тяжёлые независимо от веса.
HEAVY_KINDS = {"judge", "poc", "exploit", "crosscontract", "decide-submit"}
# ... и всегда лёгкие.
LIGHT_KINDS = {"read", "extract", "summarize", "format", "triage-obvious",
               "ledger"}


def tier_for(kind=None, weight=None):
    """Выбор тира. Явный вид задачи важнее веса; вес — запасной критерий."""
    if kind in HEAVY_KINDS:
        return HEAVY
    if kind in LIGHT_KINDS:
        return LIGHT
    if weight is not None and weight >= HEAVY_WEIGHT:
        return HEAVY
    return LIGHT


def _key():
    k = os.environ.get("OPENROUTER_API_KEY")
    if not k:
        raise RuntimeError(
            "OPENROUTER_API_KEY не задан. Ключ только из окружения:\n"
            "  $env:OPENROUTER_API_KEY = \"sk-or-...\"   (на время окна)\n"
            "  setx OPENROUTER_API_KEY \"sk-or-...\"     (навсегда)")


def build_payload(model, messages, temperature=0.2, max_tokens=1500,
                  tools=None, tool_choice=None):
    """Тело запроса. Вынесено отдельно, чтобы проверять БЕЗ сети.

    tools/tool_choice — путь ОРКЕСТРАЦИИ. Проверено вживую 16.08: оба тира
    возвращают корректный tool_call с верными аргументами. Это важнее, чем
    чистый текст: обе модели reasoning-типа и в обычный content ЛЬЮТ
    рассуждение (не слушают «одним словом»), а вот структурный tool_call
    отдают чисто. Значит петлю строить на tool-calls, а не на парсинге прозы."""
    p = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
        "max_tokens": max_tokens,
    }
    if tools:
        p["tools"] = tools
        p["tool_choice"] = tool_choice or "auto"
    return p


def ask(prompt, kind=None, weight=None, model=None, system=None,
        temperature=0.2, max_tokens=1500, tries=4, timeout=120,
        tools=None, tool_choice=None):
    """Один запрос к выбранному тиру. Возвращает {model, text, tool_calls, usage}.

    kind/weight выбирают модель, если model не задан явно. Ретраи с отступом:
    free-тир рвётся, и оборванный проход дороже лишней секунды сна. tools
    включают function-calling — путь оркестрации (см. build_payload)."""
    model = model or tier_for(kind, weight)
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        _key()                       # бросит с инструкцией
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})

    errors = []
    for m in _chain(model):
        try:
            r = _once(m, messages, key, temperature, max_tokens,
                      tools, tool_choice, tries, timeout)
            if m != model:
                r["fellback_from"] = model
            return r
        except Exception as e:
            errors.append("%s: %s" % (m.split("/")[-1], e))
    raise RuntimeError("ни одна модель не ответила — " + " | ".join(errors))


def _once(model, messages, key, temperature, max_tokens,
          tools, tool_choice, tries, timeout):
    """Одна модель с ретраями. Бросает, если не ответила за tries попыток."""
    body = json.dumps(build_payload(model, messages, temperature,
                                    max_tokens, tools, tool_choice)).encode()
    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + key,
        # OpenRouter просит эти два заголовка для атрибуции; необязательны.
        "HTTP-Referer": "https://localhost/auditscout",
        "X-Title": "auditscout",
    }
    last = None
    for k in range(tries):
        try:
            req = urllib.request.Request(BASE, body, headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                out = json.loads(r.read())
            if "error" in out:
                raise RuntimeError(out["error"])
            ch = (out.get("choices") or [])
            if not ch:
                raise RuntimeError("пустой choices — рваный ответ free-тира")
            msg = ch[0].get("message", {})
            tcs = msg.get("tool_calls")
            txt = msg.get("content")
            # при tool-calling content законно пуст — рвань только если нет
            # ни текста, ни вызова
            if (not txt or not txt.strip()) and not tcs:
                raise RuntimeError("пусто и content, и tool_calls — рваный ответ")
            return {"model": model, "text": txt or "",
                    "tool_calls": tcs, "usage": out.get("usage", {})}
        except Exception as e:
            last = e
            time.sleep(1.0 * (k + 1))
    raise RuntimeError("не ответила за %d попыток: %s" % (tries, last))


def selftest():
    """Проверка того, что НЕ требует сети: выбор тира и сборка тела.

    Живой вызов отдельно (--ping), потому что стоит ключа и запроса."""
    cases = [
        (("read", None), LIGHT),
        (("extract", None), LIGHT),
        (("judge", None), HEAVY),
        (("poc", None), HEAVY),
        ((None, 3.0), LIGHT),
        ((None, 6.0), HEAVY),
        ((None, 9.0), HEAVY),
        ((None, None), LIGHT),
        (("judge", 1.0), HEAVY),          # вид важнее веса
        (("read", 9.0), LIGHT),           # вид важнее веса
    ]
    ok = True
    for (kind, weight), want in cases:
        got = tier_for(kind, weight)
        mark = "ok" if got == want else "ПРОВАЛ"
        if got != want:
            ok = False
        print("  tier_for(kind=%-6s weight=%-4s) -> %-40s [%s]"
              % (kind, weight, got.split("/")[-1], mark))
    p = build_payload(HEAVY, [{"role": "user", "content": "hi"}])
    assert p["model"] == HEAVY and p["messages"][0]["content"] == "hi"
    print("  build_payload: ok")
    print("ИТОГ:", "все проверки офлайн прошли" if ok else "ЕСТЬ ПРОВАЛЫ")
    return ok


def main():
    a = sys.argv[1:]
    if not a or a[0] == "--help":
        print(__doc__)
        print("  llm.py --selftest              офлайн-проверка маршрутизации")
        print("  llm.py --ping                  живой вызов обоих тиров (нужен ключ)")
        print("  llm.py --ask \"...\" [--heavy]    один вопрос (по умолчанию light)")
        return
    if a[0] == "--selftest":
        selftest()
        return
    if a[0] == "--ping":
        for tier in (LIGHT, HEAVY, FALLBACK):
            try:
                r = ask("Ответь одним словом: работает?", model=tier,
                        max_tokens=20)
                print("[%s] -> %s" % (tier, r["text"].strip()[:80]))
            except Exception as e:
                print("[%s] ОШИБКА: %s" % (tier, e))
        return
    if a[0] == "--ask":
        prompt = a[1]
        model = HEAVY if "--heavy" in a else LIGHT
        try:
            r = ask(prompt, model=model)
        except RuntimeError as e:
            print(e)
            return
        print("=== %s ===" % r["model"])
        print(r["text"])
        print("--- usage:", r.get("usage"))
        return
    print("неизвестный аргумент; --help")


if __name__ == "__main__":
    main()
