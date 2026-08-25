# -*- coding: utf-8 -*-
"""Приём мишени из свободного текста: имя, ссылка, условия — на выходе
готовая мишень со скоупом, проверенным по фактам.

ЗАЧЕМ. Мишень сейчас берётся только из нашего снимка рынка, а половина
площадок машинно закрыта: у Standoff, TumarOne, Uzhunter и BugBounty.ru
список программ живёт под логином — проверено запросами. Такую программу
руками в `targets.json` не занесёшь: нужен скоуп, репозитории и адреса.
Этот инструмент принимает то, что человек видит своими глазами (страницу
или вставленный текст условий), и превращает в мишень.

ГЛАВНОЕ РЕШЕНИЕ: МОДЕЛЬ НЕ ПОРОЖДАЕТ ФАКТЫ. Ссылки на репозитории, адреса
контрактов, домены — их достают регулярные выражения из исходного текста.
Модель нужна там, где нужен смысл: разделить «в скоупе» и «вне скоупа»,
понять уровни выплат. Но выбирать она может ТОЛЬКО из уже найденного:
всё, чего нет во входном тексте дословно, отбрасывается.

Причина простая. Языковая модель, спрошенная «какие контракты в скоупе у
проекта X», ответит уверенно и правдоподобно всегда — в том числе когда
страница пустая. Правдоподобный адрес неотличим от настоящего на вид, а
цена ошибки — вечер работы по чужому коду.

ТРОЕ ВОРОТ, и все офлайн от модели:

    репозиторий  отдаёт ли GitHub 200 (в скоупе Spark три ссылки мёртвые)
    адрес        есть ли по нему код в сети (адрес без кода — опечатка)
    дословность  встречается ли строка во входном тексте

Отброшенное не исчезает молча, а печатается с причиной: иначе не отличить
«на странице этого нет» от «мы плохо разобрали».

ЗАКРЫТЫЕ СТРАНИЦЫ. Половина баунти-страниц отдаёт оболочку SPA. Если по
ссылке пришло пусто, инструмент так и говорит и работает по вставленному
тексту — а не идёт спрашивать модель, что бы там могло быть.

ЗАПУСК

    python intake.py --name "Acme" --url https://... --terms scope.txt
    python intake.py --name "Acme" --url https://...          --add
"""
import argparse
import json
import pathlib
import re
import sys

sys.stdout.reconfigure(encoding="utf-8")

import runlog

ROOT = pathlib.Path(__file__).resolve().parent
TARGETS = ROOT / "data" / "targets.json"

GH = re.compile(r"https?://github\.com/([\w.-]+)/([\w.-]+)")
ADDR = re.compile(r"\b0x[a-fA-F0-9]{40}\b")
TAG = re.compile(r"<(?:script|style)[^>]*>.*?</(?:script|style)>|<[^>]{1,200}>",
                 re.S | re.I)
MONEY = re.compile(r"\$\s?[\d][\d,._]{2,12}")
# Веб-активы в скоупе пишут доменом. Служебные хосты отсеиваем: они
# есть в любом тексте и мишенью не являются.
DOMAIN = re.compile(r"\bhttps?://([a-z0-9-]+(?:\.[a-z0-9-]+)+)", re.I)
NOTHOST = ("github.com", "etherscan.io", "immunefi.com", "twitter.com",
           "x.com", "discord.com", "discord.gg", "t.me", "medium.com",
           "docs.google.com", "youtube.com", "linkedin.com",
           "polygonscan.com", "arbiscan.io", "basescan.org",
           "optimistic.etherscan.io", "bscscan.com")

# Сети, которые умеем проверять по коду. Ключ — как пишут в условиях.
CHAINS = {
    "ethereum": 1, "mainnet": 1, "eth": 1,
    "optimism": 10, "op mainnet": 10,
    "base": 8453,
    "arbitrum": 42161, "arbitrum one": 42161,
}


def strip_html(t):
    t = TAG.sub(" ", t or "")
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&lt;", "<"), ("&gt;", ">"),
                 ("&quot;", '"'), ("&#39;", "'")):
        t = t.replace(a, b)
    return re.sub(r"[ \t\r\f\v]+", " ", t)


def fetch(url):
    """Текст страницы или пусто. Пусто — это ответ, а не повод фантазировать."""
    if not url:
        return ""
    try:
        import asyncio

        from scout.http import client, get_text

        async def go():
            async with client() as c:
                return await get_text(c, url, ttl=False)

        return strip_html(asyncio.run(go()) or "")
    except Exception as e:
        print("   страницу взять не удалось: %s" % str(e)[:80])
        return ""


def extract(text):
    """Факты из текста. Только регулярки — модель сюда не допущена."""
    repos, seen = [], set()
    for m in GH.finditer(text):
        owner, repo = m.group(1), m.group(2).replace(".git", "").rstrip(".,)")
        key = "%s/%s" % (owner, repo)
        if key.lower() in seen:
            continue
        seen.add(key.lower())
        repos.append(key)
    addrs = sorted({a.lower() for a in ADDR.findall(text)})
    low = text.lower()
    chains = sorted({cid for word, cid in CHAINS.items() if word in low})
    money = sorted({m.group(0) for m in MONEY.finditer(text)})
    hosts = sorted({h.lower() for h in DOMAIN.findall(text)
                    if not any(h.lower().endswith(n) for n in NOTHOST)})
    return {"repos": repos, "addrs": addrs, "chains": chains,
            "money": money, "hosts": hosts}


# ------------------------------------------------------------------- ворота

def gate_repo(name):
    """Живой ли репозиторий. Мёртвая ссылка в скоупе — обычное дело."""
    try:
        import urllib.request
        req = urllib.request.Request(
            "https://api.github.com/repos/%s" % name,
            headers={"User-Agent": "auditscout", "Accept":
                     "application/vnd.github+json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            d = json.load(r)
        return True, "%s, обновлён %s" % (
            d.get("language") or "?", str(d.get("pushed_at") or "")[:10])
    except Exception as e:
        code = getattr(e, "code", None)
        return False, "GitHub %s" % (code or str(e)[:40])


def gate_addr(addr, chains):
    """Есть ли по адресу код хоть в одной из названных сетей."""
    try:
        import unverified as U
    except Exception:
        return None, "проверить нечем"
    todo = [c for c in (chains or []) if c in U.RPCS] or list(U.RPCS)
    for chain in todo:
        try:
            sz = U.D.codesize(U.RPCS[chain], addr)
        except Exception:
            continue
        if sz and sz > 0:
            src = None
            try:
                src = U.verified(chain, addr)
            except Exception:
                pass
            return True, "сеть %d, кода %d байт, исходник: %s" % (
                chain, sz, src or "НЕТ")
    return False, "кода нет ни в одной из проверенных сетей"


def gate_literal(value, text):
    """Встречается ли строка во входном тексте. Последний рубеж против выдумки."""
    return str(value).lower() in (text or "").lower()


# -------------------------------------------------------------------- смысл

# Перечислять скоуп модель НЕ просим: репозитории, адреса и домены уже
# добыты регулярками, а список из 255 активов она просто не дописывает —
# ответ обрывается на лимите и JSON не разбирается. Спрашиваем ровно то,
# чего регуляркой не взять: правила и исключения, написанные прозой.
ASK = """Ниже — условия программы поиска уязвимостей.

НЕ РАССУЖДАЙ. Первый символ ответа — {, последний — }. Без markdown:
{"out_of_scope": ["..."], "max_reward": "", "rules": ["..."]}

out_of_scope — что ЯВНО исключено (не больше 10 коротких строк).
rules — условия подачи: нужен ли PoC, KYC, куда сообщать (не больше 6).
Строки бери ДОСЛОВНО из текста. Чего в тексте нет — не пиши.

ТЕКСТ:
%s"""


def _best_json(raw):
    """Самый содержательный объект JSON из ответа модели.

    Лёгкий тир пишет рассуждения перед ответом и пересказывает в них ТУ
    ЖЕ схему: `{"out_of_scope": ["..."], ...}`. Разбор «от первой скобки»
    хватал именно этот шаблон, и дальше ворота честно выкидывали строки
    «...» как не найденные в тексте — выглядело как отказ модели, хотя
    настоящий ответ шёл ниже и был верным.

    Поэтому пробуем КАЖДУЮ открывающую скобку и берём разбор с наибольшим
    числом непустых значений. Заодно чиним оборванный хвост: ответ мог
    упереться в лимит токенов.
    """
    best, score = None, -1
    for i, ch in enumerate(raw):
        if ch != "{":
            continue
        tail = raw[i:]
        for cand in (tail, tail.rsplit("]", 1)[0] + "]}", tail.rstrip() + "}"):
            try:
                d = json.loads(cand)
            except Exception:
                continue
            if not isinstance(d, dict):
                continue
            n = sum(len([x for x in v if str(x).strip(". ")])
                    if isinstance(v, list) else bool(str(v).strip(". "))
                    for v in d.values())
            if n > score:
                best, score = d, n
            break
    return best


def structure(text, limit=12000):
    """Смысловая часть. Ошибка модели здесь не страшна: факты уже добыты."""
    if not text.strip():
        return {}, "текста нет — модель не звалась"
    try:
        import llm
        # ask отдаёт {model, text, tool_calls, usage}, а не строку.
        # Лёгкий тир — РАССУЖДАЮЩАЯ модель: на этой задаче она тратит
        # больше двух тысяч токенов на размышление вслух и только потом
        # пишет ответ. При лимите 900 и даже 2500 проход обрывался на
        # середине размышления — выглядело как «модель не смогла», хотя
        # она просто не успевала начать отвечать.
        #
        # Тир бесплатный, поэтому лимит тут не про деньги, а про то, чтобы
        # не резать на полуслове. Даём запас: ответ всё равно короткий,
        # длинного мы не просим.
        r = llm.ask(ASK % text[:limit], kind="light", max_tokens=8000,
                    system="Ты возвращаешь ТОЛЬКО JSON. Никаких рассуждений, "
                           "никакого текста до или после объекта.")
        raw = r.get("text") if isinstance(r, dict) else str(r)
        used = r.get("model") if isinstance(r, dict) else ""
    except Exception as e:
        return {}, "модель недоступна: %s" % str(e)[:60]
    d = _best_json(raw or "")
    if d is None:
        return {}, "JSON модели не разобрался (ответ оборван?)"
    # Каждая строка должна найтись во входном тексте. Всё прочее — выдумка.
    out, dropped = {}, 0
    for k in ("out_of_scope", "rules"):
        keep = []
        for v in (d.get(k) or [])[:40]:
            if gate_literal(str(v)[:60], text):
                keep.append(str(v)[:160])
            else:
                dropped += 1
        out[k] = keep
    out["max_reward"] = str(d.get("max_reward") or "")[:40]
    tail = ("выброшено как не найденное в тексте: %d" % dropped
            if dropped else "все строки подтверждены текстом")
    return out, "%s (%s)" % (tail, str(used or "?").split("/")[-1])


# --------------------------------------------------------------------- ход

def run(name, url, terms_text, add=False):
    log = runlog.Run(_slug(name), "intake", target=name, url=url or "")
    print("=" * 78)
    print("ПРИЁМ МИШЕНИ: %s" % name)
    print("=" * 78)

    with log.step("взять страницу", url=url or "") as s:
        page = fetch(url)
        s.done(chars=len(page))
    if page:
        print("  страница: %d знаков" % len(page))
    else:
        print("  страница пуста или закрыта — работаю по вставленному тексту")
        log.note("страница пуста или закрыта")
    text = (page + "\n" + (terms_text or "")).strip()
    if not text:
        print("  ВХОДА НЕТ: ни страницы, ни текста. Вставь условия через --terms.")
        log.end(status="err", error="пустой вход")
        return None

    with log.step("достать факты регулярками") as s:
        f = extract(text)
        s.done(repos=len(f["repos"]), addrs=len(f["addrs"]),
               chains=f["chains"], money=len(f["money"]))
    print("  найдено: репозиториев %d, адресов %d, сетей %d"
          % (len(f["repos"]), len(f["addrs"]), len(f["chains"])))

    good_repos, bad = [], []
    with log.step("ворота: репозитории", n=len(f["repos"])) as s:
        for r in f["repos"][:40]:
            ok, why = gate_repo(r)
            (good_repos if ok else bad).append((r, why))
            log.emit("verdict", kind_of="repo", value=r, ok=ok, why=why)
        s.done(ok=len(good_repos), bad=len(bad))

    good_addr, bad_addr = [], []
    with log.step("ворота: адреса", n=len(f["addrs"])) as s:
        for a in f["addrs"][:25]:
            ok, why = gate_addr(a, f["chains"])
            (good_addr if ok else bad_addr).append((a, why))
            log.emit("verdict", kind_of="addr", value=a, ok=bool(ok), why=why)
        s.done(ok=len(good_addr), bad=len(bad_addr))

    with log.step("разложить условия моделью") as s:
        st, note = structure(text)
        s.done(note=note, in_scope=len(st.get("in_scope") or []))
    print("  модель: %s" % note)

    print("\n  ПРИНЯТО")
    for r, why in good_repos:
        print("     репозиторий  %-44s %s" % (r, why))
    for a, why in good_addr:
        print("     адрес        %-44s %s" % (a, why))
    if bad or bad_addr:
        print("\n  ОТБРОШЕНО (не подтвердилось фактом)")
        for r, why in bad:
            print("     репозиторий  %-44s %s" % (r, why))
        for a, why in bad_addr:
            print("     адрес        %-44s %s" % (a, why))
    if f["hosts"]:
        print("\n  ДОМЕНЫ В ТЕКСТЕ (%d) — в активы НЕ идут, смотреть глазами:"
              % len(f["hosts"]))
        for h in f["hosts"][:12]:
            print("     %s" % h)
    for k, label in (("out_of_scope", "ВНЕ СКОУПА"), ("rules", "УСЛОВИЯ ПОДАЧИ")):
        rows = st.get(k) or []
        if rows:
            print("\n  %s (%d):" % (label, len(rows)))
            for v in rows[:12]:
                print("     %s" % v[:100])

    row = {
        "site": "manual", "pid": _slug(name), "name": name,
        "url": url or "", "reward": 0.0, "currency": "USD", "fee": 0.0,
        "kyc": False, "reports": -1,
        # Активы мишени — ТОЛЬКО адреса с кодом в сети.
        #
        # Домены В АКТИВЫ НЕ КЛАДЁМ. На живом приёме страница Immunefi дала
        # одиннадцать хостов, и почти все — подвал: w3.org, zendesk,
        # typeform, linktr.ee, блог аудитора. Ссылка в подвале не есть
        # скоуп, а чёрный список таких хостов не бывает полным: завтра
        # добавят двенадцатый. Поэтому домены печатаются человеку списком
        # «проверь глазами», но мишень ими не засоряется.
        "assets": [{"name": a, "type": "smart contract", "url": "",
                    "desc": why} for a, why in good_addr],
        "repos": ["https://github.com/%s" % r for r, _ in good_repos],
        "tags": ["ручной приём"], "updated": "",
        "slug": _slug(name),
    }
    if add:
        rows = []
        if TARGETS.exists():
            rows = json.loads(TARGETS.read_text(encoding="utf-8"))
        rows = [x for x in rows if x.get("slug") != row["slug"]]
        rows.append(row)
        TARGETS.write_text(json.dumps(rows, ensure_ascii=False, indent=1),
                           encoding="utf-8")
        print("\n  мишень записана: %s (репо %d, активов %d)"
              % (row["slug"], len(row["repos"]), len(row["assets"])))
        print("  дальше:  python targets.py --scan %s" % row["slug"])
    else:
        print("\n  это разбор без записи. Добавить: тот же вызов с --add")
    log.end(repos=len(row["repos"]), assets=len(row["assets"]), added=bool(add))
    return row


TRANSLIT = {
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e",
    "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
    "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u",
    "ф": "f", "х": "h", "ц": "c", "ч": "ch", "ш": "sh", "щ": "sch",
    "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
}


def _slug(name):
    """Имя мишени -> имя папки.

    Кириллицу надо переводить, а не выбрасывать: «UI Приём Тест» после
    отсева не-латиницы схлопывался в `ui`, и мишень уезжала в чужую папку
    с чужими прогонами. Проверено на живом приёме — именно так и вышло.
    """
    low = str(name or "").lower()
    low = "".join(TRANSLIT.get(ch, ch) for ch in low)
    s = re.sub(r"[^a-z0-9]+", "-", low).strip("-")
    return s[:40] or "target"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--name", required=True)
    ap.add_argument("--url", default="")
    ap.add_argument("--terms", help="файл с текстом условий (или - для stdin)")
    ap.add_argument("--add", action="store_true", help="записать в targets.json")
    a = ap.parse_args()
    terms = ""
    if a.terms == "-":
        terms = sys.stdin.read()
    elif a.terms:
        terms = pathlib.Path(a.terms).read_text(encoding="utf-8")
    run(a.name, a.url, terms, add=a.add)


if __name__ == "__main__":
    main()
