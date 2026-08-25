"""Отчёты Code4rena как корпус — второй источник рядом с Cantina.

ЗАЧЕМ ИМЕННО ОТЧЁТЫ, А НЕ ПРОГРАММЫ. Конкурсы Code4rena как мишени мы уже
мерили и закрыли: 38$ за заявку, фонд тесноту не предсказывает. А вот их
опубликованные отчёты — сырьё для приёмов, которые у нас работают:

  * blindspots — файл, не названный НИ ОДНИМ отчётом, конкурентов не имеет
    по построению. Чем больше отчётов в корпусе, тем честнее это «ни одним».
  * недочиненная половина — заголовок находки говорит, ЧТО искали; соседний
    симметричный путь часто остаётся открытым.

ГДЕ ЛЕЖИТ ТЕКСТ. Страница `code4rena.com/reports/<slug>` весит 3.7 МБ и
держит тело отчёта внутри RSC-нагрузки — разбирать это регулярками значит
чинить парсер каждый релиз их фронтенда. Тот же отчёт лежит чистым markdown
в репозитории находок:

    https://raw.githubusercontent.com/code-423n4/<slug>-findings/main/report.md

129 КБ текста вместо 3.7 МБ разметки, без ключей и без лимита GitHub API
(raw-хост его не трогает).

ЧЕГО ЗДЕСЬ НЕТ. Ссылок на заплатки почти нет: у Code4rena починку делает
спонсор ПОСЛЕ конкурса и в отчёт не вносит. Проверено на lukso — один
коммит на весь отчёт. Поэтому этот корпус кормит blindspots, а не audits:
обещать «заплатки Code4rena» было бы враньём.
"""
import asyncio
import re

from .http import get_json, get_text

API = "https://code4rena.com/api/v1/audits"
RAW = "https://raw.githubusercontent.com/code-423n4/%s-findings/main/report.md"

# Пути к исходникам в теле отчёта. Расширения те же, что у сигналов от дерева.
SRC = re.compile(r"[\w./-]+\.(?:sol|rs|vy|cairo|move)")
# Заголовок находки. Два формата, и различать их приходится ТОЧНО.
#
#   старые отчёты:  «## [H-01] Название» — скобки, обычный дефис;
#   с 2025 года:    «H‑01\n Название» — без скобок, но дефис
#                   неразрывный (U+2011).
#
# В тексте находки на соседнюю ссылаются ОБЫЧНЫМ дефисом: «Combines
# with L-01». Поэтому «H-01» без скобок и с обычным дефисом заголовком
# НЕ считаем — иначе в список находок вместо названий попадали бы
# куски чужой прозы.
FIND = re.compile(
    r"\[([HMLGQ])-(\d+)\]\s*([^\n<]{4,120})"
    r"|\b([HMLGQ])‑(\d+)\b\s*([^\n<]{4,120})")
FIX = re.compile(r"github\.com/[\w.-]+/[\w.-]+/(?:commit|pull)/[\w]+")


async def audits(c, pages=20, fresh=False):
    """Все конкурсы Code4rena. 475 штук по 25 на страницу."""
    out = []
    for p in range(1, pages + 1):
        d = await get_json(c, API, {"page": p}, ttl=not fresh)
        rows = (d or {}).get("data", {}).get("audits") or []
        if not rows:
            break
        out += rows
        if not ((d or {}).get("pagination") or {}).get("nextPage"):
            break
    return out


PAGE = "https://code4rena.com/reports/%s"


async def report(c, slug):
    """Текст отчёта. Сначала чистый markdown, потом страница.

    Замерено: `report.md` есть только у 68 конкурсов из 475 — так публикуют
    отчёты последних лет. У остальных текст живёт только страницей на 1–4 МБ,
    где тело отчёта лежит экранированным внутри RSC-нагрузки. Разбирать её
    регулярками некрасиво, но мы достаём оттуда ИМЕНА ФАЙЛОВ и ЗАГОЛОВКИ
    НАХОДОК — это содержимое, а не разметка, и от смены их фронтенда оно не
    зависит.

    Качаем по требованию, а не пачкой: 412 страниц по 1–4 МБ — это полтора
    гигабайта ради корпуса, из которого по одной мишени нужны две-три штуки.
    """
    t = await get_text(c, RAW % slug)
    if t:
        return t
    return await get_text(c, PAGE % slug)


# Слова, по которым совпадать НЕЛЬЗЯ: они есть в названии половины
# протоколов. Без этого «Compound Finance» находит «Yeti Finance», а
# «Sky Protocol» — любой конкурс со словом protocol, и корпус отчётов
# начинает вычитать из blindspots файлы чужого проекта. Ошибка молчаливая
# и в опасную сторону: файл объявляется прочитанным, хотя его никто не
# смотрел.
STOP = {"finance", "protocol", "protocols", "labs", "network", "foundation",
        "dao", "core", "contracts", "contract", "token", "tokens", "bug",
        "bounty", "audit", "review", "mitigation", "contest", "invitational",
        "the", "and", "for", "com", "org", "xyz", "app", "apps", "smart",
        "chain", "defi", "web", "main", "master", "beta", "alpha"}


def norm(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def _same(a, b):
    """Одно ли это слово. Точное совпадение или начало — но не подстрока.

    Владельца репозитория пишут слитно: `lidofinance/core` против конкурса
    «Lido Finance». Без совпадения по началу связь терялась, и вычитать из
    blindspots было нечего.

    Подстрокой где угодно совпадать нельзя: «noya» сидит внутри «annoyance»,
    и корпус чужого протокола молча объявил бы файлы прочитанными. Начало
    слова — компромисс, который эту пару отсекает.
    """
    if a == b:
        return True
    return len(a) >= 4 and len(b) >= 4 and (a.startswith(b) or b.startswith(a))


def match(rows, needle):
    """Конкурсы, относящиеся к мишени. Совпадение по СЛОВАМ, не по подстроке.

    `repo` у Code4rena всегда указывает на их собственное зеркало
    (`code-423n4/<slug>`), а не на репозиторий протокола, поэтому связать
    отчёт с мишенью по ссылке нельзя — только по имени.

    Совпадение по подстроке брать нельзя: «noya» найдётся внутри «annoyance»,
    а короткие имена протоколов встречаются в чужих названиях постоянно.
    """
    want = [w for w in norm(needle).split() if len(w) > 2 and w not in STOP]
    if not want:
        return []
    out = []
    for r in rows:
        words = set(norm(r.get("title")).split()) | set(norm(r.get("slug")).split())
        if any(_same(w, x) for w in want for x in words):
            out.append(r)
    return out


async def reports(c, slugs, workers=8):
    """Качаем параллельно, но вежливо: raw-хост чужой, а спешить некуда."""
    out, sem = {}, asyncio.Semaphore(workers)

    async def one(s):
        async with sem:
            t = await report(c, s)
            if t:
                out[s] = t

    await asyncio.gather(*(one(s) for s in slugs))
    return out


ESC = ((r"\u003c", "<"), (r"\u003e", ">"), (r"\u0026", "&"),
       (r"\n", "\n"), (r"\"", "\""), ("&nbsp;", " "), ("&amp;", "&"))
TAG = re.compile(r"<[^>]{1,80}>")


def unescape(text):
    """Тело отчёта на странице лежит экранированным внутри RSC-нагрузки.

    Без этого шага в имена файлов просачивался мусор разметки: путь
    `>dvn.cairo` попадал в список как файл `u003edvn.cairo` — и такой
    файл не совпадал бы ни с чем в дереве, то есть тихо терялся из покрытия.
    """
    for a, b in ESC:
        text = text.replace(a, b)
    return TAG.sub(" ", text)


def parse(text):
    """Что достаём из отчёта: названные файлы, находки, ссылки на починку."""
    text = unescape(text)
    files = {}
    for m in SRC.finditer(text):
        p = m.group(0).lstrip("./")
        # Хвост имени важнее пути: в отчёте он пишется то полным, то от корня.
        files[p.rsplit("/", 1)[-1]] = files.get(p.rsplit("/", 1)[-1], 0) + 1
    finds = []
    seen = set()
    for m in FIND.finditer(text):
        sev = m.group(1) or m.group(4)
        num = m.group(2) or m.group(5)
        title = (m.group(3) or m.group(6) or "").strip()
        key = (sev, num)
        if key in seen:
            continue
        seen.add(key)
        finds.append((sev, int(num), title))
    return {"files": files, "findings": finds,
            "fixes": sorted(set(FIX.findall(text)))}
