"""Корпус находок: что вообще находят и за что не приходится делиться.

Работает ПОЛНОСТЬЮ ОФЛАЙН по тому, что уже скачано в data/cache. Сети не
требует. Карточка конкурса у Sherlock содержит поле `report` — полный текст
всех принятых находок с уровнем серьёзности и списком нашедших, поэтому
корпус собирается из кэша без единого запроса.

Зачем. Измерено: треть валидных Medium и четверть High нашёл ровно один
человек. Значит вопрос не «какие баги бывают», а «какие баги пропускают
все остальные». На это отвечает разбивка классов находок по доле одиночек.
"""
import json
import pathlib
import re
import statistics as st

from .http import CACHE

ISSUE = re.compile(r"^#+\s*Issue\s+([A-Z]+)-(\d+):(.*)$", re.M)
FOUND = re.compile(r"##\s*Found by\s*\n(.+)")
PATHRE = re.compile(r"[\w./-]+\.(?:sol|rs|vy|move|cairo)")

# Классы находок. Ключ — по каким словам узнаём, значение — как называем.
# Список собран из формулировок, которые реально встречаются в заголовках,
# а не из учебника: учебник даёт классы, которых в отчётах нет.
CLASSES = (
    ("округление",      r"round(ing)?|precision|truncat|dust|off by one|off-by-one"),
    ("оракул и цена",   r"oracle|price feed|stale|twap|chainlink|manipulat\w* price"),
    ("реентранси",      r"reentran|re-entran"),
    ("доступ",          r"access control|permission|unauthor|only ?owner|privileg|"
                        r"missing (check|modifier)|anyone can"),
    ("ликвидация",      r"liquidat"),
    ("проценты и долг", r"interest|borrow|debt|accru|repay|collateral"),
    ("доля хранилища",  r"share|vault|inflat|first deposit|donation"),
    ("комиссия",        r"\bfee\b|fees"),
    ("слippage",        r"slippage|minimum ?out|min ?amount|deadline|front ?run|sandwich"),
    ("токен нестандарт", r"fee-on-transfer|rebasing|usdt|return value|non-standard|weird erc"),
    ("подпись",         r"signature|ecrecover|permit|replay|nonce|eip-?712"),
    ("газ и цикл",      r"gas|dos|out of gas|unbounded|loop|revert.*block"),
    ("инициализация",   r"initiali[sz]|upgrade|proxy|storage (slot|collision)|gap"),
    ("учёт",            r"accounting|balance|double count|not updated|stale state|"
                        r"incorrect(ly)? (updat|track|calculat)"),
    ("мостовое/кросс",  r"cross-?chain|bridge|layerzero|ccip|message"),
)
CLASSES = tuple((name, re.compile(rx, re.I)) for name, rx in CLASSES)


def classify(title):
    """Один заголовок может попасть в несколько классов — так и есть в жизни."""
    return tuple(n for n, rx in CLASSES if rx.search(title)) or ("прочее",)


# Пермалинк на github с номерами строк: .../Contract.sol#L120-L145
LINK = re.compile(r"([\w./-]+\.(?:sol|rs|vy))#L(\d+)(?:-L(\d+))?")


def parse_lines(body):
    """Привязка находки к строкам, а не только к файлу.

    Измерено: 91% находок (2761 из 3023) содержат хотя бы один пермалинк с
    номером строки. Это даёт разметку точнее файловой и позволяет проверять
    инструмент на уровне функций.

    Оговорка, которую надо держать в голове: ссылка может указывать на другой
    коммит, чем тот, что мы склонировали, и тогда номера строк уедут. Ссылки
    на ветку main совпадают с зеркалом, на явный хеш — не всегда.
    """
    out = {}
    for path, a, b in LINK.findall(body):
        f = path.split("/")[-1]
        a = int(a)
        b = int(b) if b else a
        if b < a:
            a, b = b, a
        out.setdefault(f, set()).update(range(a, min(b, a + 200) + 1))
    return out


def parse_report(rep):
    """-> [{'sev','n','title','files'}]"""
    parts = ISSUE.split(rep)
    out = []
    for i in range(1, len(parts) - 3, 4):
        sev, title, body = parts[i], parts[i + 2].strip(), parts[i + 3]
        m = FOUND.search(body)
        n = len([x for x in m.group(1).split(",") if x.strip()]) if m else 0
        files = {p.split("/")[-1] for p in PATHRE.findall(body)}
        out.append({"sev": sev, "n": n, "title": title,
                    "files": files, "lines": parse_lines(body),
                    "body_len": len(body)})
    return out


def load_offline(cache=None):
    """Все карточки конкурсов, какие лежат в кэше. Ни одного запроса в сеть."""
    cache = pathlib.Path(cache or CACHE)
    out = []
    for f in cache.glob("*.json"):
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(d, dict) and "prize_pool" in d and "num_competition_issues" in d:
            out.append(d)
    return out


def findings(contests, min_len=500):
    """Плоский список находок по всем конкурсам, с привязкой к фонду."""
    out = []
    for d in contests:
        rep = d.get("report") or ""
        if len(rep) < min_len:
            continue
        iss = [x for x in parse_report(rep) if x["n"] > 0]
        if not iss:
            continue
        name = (d.get("template_repo_name") or "").replace("sherlock-audit/", "")
        pool = float(d.get("prize_pool") or 0)
        # доля фонда на находку по весовой сетке Sherlock
        W = {"C": 10.0, "H": 5.0, "M": 1.0, "L": 0.2}
        tot = sum(W.get(x["sev"], 1.0) for x in iss)
        for x in iss:
            x["contest"] = name
            x["pool"] = pool
            x["pay"] = (pool * W.get(x["sev"], 1.0) / tot / x["n"]) if tot else 0.0
            x["classes"] = classify(x["title"])
            out.append(x)
    return out


def by_class(fs, min_n=8):
    """Класс -> (сколько, доля одиночек, медиана нашедших, медиана выплаты)."""
    g = {}
    for x in fs:
        for cl in x["classes"]:
            g.setdefault(cl, []).append(x)
    out = {}
    for cl, v in g.items():
        if len(v) < min_n:
            continue
        solo = sum(1 for x in v if x["n"] == 1) / len(v)
        out[cl] = (len(v), solo,
                   st.median([x["n"] for x in v]),
                   st.median([x["pay"] for x in v]))
    return out
