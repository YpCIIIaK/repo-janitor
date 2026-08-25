"""Карта репозитория: что в скоупе и сколько это читать.

ЧТО ИЗМЕРЕНО И ЧТО ИЗ ЭТОГО ВЫШЛО (validate.py, 25 конкурсов, 435 находок).

Первая версия ранжировала ФАЙЛЫ по признакам с весами, назначенными по
смыслу. Проверка на 106 конкурсах и 1575 находках показала, что это не
работает:

    доля находок в первых K файлах     K=3   K=5   K=10  K=15
      по весу признаков                51%   62%   77%   83%
      просто по размеру файла          53%   65%   82%   88%

Причина не в признаках, а в гранулярности: в большом файле больше всего,
поэтому размер уже несёт ту же информацию.

НА УРОВНЕ ФУНКЦИЙ то же ранжирование работает — см. FUNC_LIFT ниже. Функция
это единица, которую человек читает целиком, и там признаки различают.

ПОЭТОМУ файловый вид сортируется по размеру (честная базовая линия), а
основным сделан функциональный. Признаки в файловом виде показываются как
пометки: они говорят, ЧТО в файле, а не «здесь баг».
"""
import collections
import pathlib
import re

# Признаки. Вторая колонка — ИЗМЕРЕННЫЙ лифт: во сколько раз чаще файл с
# этим признаком содержит находку. Считано на 768 файлах 25 конкурсов, где
# доля файлов с находкой в среднем 36%. Признаки ниже 1.2 оставлены как
# пометки, но в вес не идут — они ничего не отличают.
SIGNALS = (
    ("деньги",      2.45, re.compile(
        r"\.transfer\(|\.transferFrom\(|safeTransfer|\.call\{value|"
        r"\bmint\(|\b_mint\(|\bburn\(|\b_burn\(|selfdestruct")),
    ("реентранси",  2.26, re.compile(r"nonReentrant|ReentrancyGuard")),
    ("доступ",      2.25, re.compile(
        r"onlyOwner|onlyRole|onlyAdmin|onlyGovernance|_checkRole|"
        r"require\s*\(\s*msg\.sender")),
    ("цикл",        2.13, re.compile(r"\bfor\s*\(|\bwhile\s*\(")),
    ("математика",  1.57, re.compile(
        r"unchecked\s*\{|\bmulDiv|\*\s*\d*\s*/|<<|>>|sqrt\(|\bpow\(")),
    ("оракул",      1.47, re.compile(
        r"latestRoundData|latestAnswer|getPrice|consult|observe\(|"
        r"priceFeed|oracle", re.I)),
    ("обновляемость", 1.40, re.compile(
        r"initializer|__\w+_init|upgradeTo|UUPS|_authorizeUpgrade|__gap")),
    ("внешний вызов", 1.33, re.compile(
        r"\.call\(|\.delegatecall\(|\.staticcall\(|functionCall")),
    ("подпись",     1.23, re.compile(r"ecrecover|\bpermit\(|EIP712|_hashTypedData")),
    ("ассемблер",   1.18, re.compile(r"\bassembly\s*\{")),
)

EXTERNAL = re.compile(r"function\s+\w+\s*\([^)]*\)\s*(external|public)", re.S)
SKIP_DIR = ("test", "tests", "mock", "mocks", "script", "scripts",
            "lib", "node_modules", ".git", "out", "artifacts", "cache")
SKIP_FILE = re.compile(r"(^|/)(I[A-Z]\w*|.*[Ii]nterface|.*Mock|.*Test)\.sol$")


def nsloc(text):
    """Значащие строки: без пустых, без комментариев."""
    n, block = 0, False
    for line in text.splitlines():
        s = line.strip()
        if block:
            if "*/" in s:
                block = False
                s = s.split("*/", 1)[1].strip()
            else:
                continue
        if s.startswith("/*"):
            block = "*/" not in s
            continue
        if not s or s.startswith("//"):
            continue
        n += 1
    return n


def analyse(text):
    """Признаки и их количество в одном файле."""
    hits = {}
    for name, w, rx in SIGNALS:
        c = len(rx.findall(text))
        if c:
            hits[name] = c
    return hits, len(EXTERNAL.findall(text))


def score(loc, hits, ext):
    """Справочный вес: сумма логарифмов измеренного лифта по сработавшим
    признакам. НЕ используется для сортировки по умолчанию — проверка
    показала, что такой порядок не бьёт порядок по размеру. Оставлен, чтобы
    было видно, чего в файле много, и чтобы эксперимент можно было повторить.
    """
    import math
    return sum(math.log(w) for name, w, _ in SIGNALS
               if w > 1.2 and hits.get(name))


def walk(root, exts=(".sol", ".rs", ".vy", ".move", ".cairo"), scope_files=None):
    """Обходим репозиторий. scope_files — если площадка дала список файлов
    в скоупе, то всё остальное просто не читаем: за это не платят."""
    root = pathlib.Path(root)
    out = []
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in exts:
            continue
        rel = p.relative_to(root).as_posix()
        if scope_files is not None:
            if not any(rel.endswith(f) or f.endswith(rel) for f in scope_files):
                continue
        elif any(("/%s/" % d) in ("/" + rel) for d in SKIP_DIR) or SKIP_FILE.search(rel):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        loc = nsloc(text)
        if loc < 10:
            continue
        hits, ext = analyse(text)
        out.append({"path": rel, "nsloc": loc, "hits": hits,
                    "ext": ext, "score": score(loc, hits, ext)})
    # По умолчанию — по размеру. Это измеренная базовая линия, и ничего
    # лучше неё найти не удалось. Сортировку по признакам можно включить
    # явно, но она не окупается: см. шапку модуля.
    out.sort(key=lambda r: -r["nsloc"])
    return out


# Лифт признаков, измеренный НА УРОВНЕ ФУНКЦИЙ: 141 конкурс, 27750 функций,
# из них 9% задеты находками. Числа другие, чем файловые, и разница
# содержательная. При росте выборки с 88 конкурсов до 141 они почти не
# сдвинулись — это и есть признак, что результат настоящий, а не шум.
#
# «доступ» на файлах даёт 1.78, на функциях 0.58. Функция с onlyOwner РЕЖЕ
# содержит находку. Файлы с контролем доступа — крупные важные файлы, отсюда
# файловая корреляция; но сама защищённая функция это админский вызов, куда
# посторонний не дотянется. Баги живут в беспермиссионных функциях, которые
# двигают деньги, крутят циклы и читают оракул. То же говорит корпус
# независимо: класс «доступ» там 27% одиночек и 468$ медианы.
FUNC_LIFT = {
    "деньги": 3.07, "реентранси": 2.54, "математика": 2.06, "цикл": 2.04,
    "оракул": 1.85, "подпись": 1.37,
    "ассемблер": 0.64, "внешний вызов": 0.59, "доступ": 0.58,
    "обновляемость": 0.37,
}

# ХОЛОДНЫЕ ПРИЗНАКИ.
#
# Первый список ловит места, куда дотягивается посторонний. Но разбор пробы
# на 2025-02-yieldoor показал именованную слепую зону: три из семи дорогих
# одиночных находок сидели в internal-функциях вспомогательных библиотек
# (ReserveLogic, InterestRateUtils), где нет ни денег, ни границы доверия,
# ни внешних вызовов — то есть ни одного из горячих признаков.
#
# Пример, ради которого это добавлено (ReserveLogic:150-163):
#
#     newTotalBorrows = newIndex * totalBorrows / oldIndex;  // может округлиться в 0
#     ...
#     reserve.lastUpdateTimestamp = block.timestamp;         // но время идёт всегда
#
# Ошибку эксплуатирует не атакующий, а само время. Признаки здесь другие:
# накопитель, метка времени, масштаб, приведение типа.
# Лифт измерен на 13994 холодных функциях 141 конкурса, базовая ставка 8%.
# Внутри своей подвыборки эти признаки работают ЛУЧШЕ горячих в своей:
# покрытие 16% находок за 10% строк против 8% у сортировки по размеру,
# то есть ровно вдвое. У горячих было 12% против 9%.
COLD_LIFT = {
    "накопитель": 4.44, "метка времени": 3.62, "необязательная запись": 3.33,
    "доля от общего": 3.09, "деление до умножения": 3.06,
    "ставка за период": 2.81, "масштаб": 2.36, "приведение вниз": 1.95,
}

COLD = (
    ("накопитель",  re.compile(
        r"\b\w*([Ii]ndex|[Aa]ccumulat|[Cc]umulative|[Pp]erShare|[Rr]ewardPer)\w*\s*"
        r"[\*/]|\*\s*\w*[Ii]ndex")),
    ("метка времени", re.compile(
        r"last\w*(Update|Accrual|Time|Block)\w*\s*=|"
        r"block\.(timestamp|number)\s*-|\w+\s*=\s*uint\d+\(block\.")),
    ("масштаб",     re.compile(
        r"\bPRECISION\b|\bWAD\b|\bRAY\b|1e(18|27|36)|10\s*\*\*\s*\d+")),
    ("деление до умножения", re.compile(r"/\s*[\w.()]+\s*\*")),
    ("ставка за период", re.compile(
        r"perSecond|perYear|perBlock|SECONDS_PER|_RATE\b|[Rr]ate\s*[\*/]")),
    ("приведение вниз", re.compile(r"uint(8|16|32|40|64|96|128)\s*\(")),
    ("доля от общего", re.compile(
        r"totalSupply\s*\(\s*\)|total(Supply|Assets|Borrows|Shares)\s*[\*/]")),
    ("необязательная запись", re.compile(r"if\s*\([^)]*>\s*0\s*\)")),
)


def analyse_cold(text):
    hits = {}
    for name, rx in COLD:
        c = len(rx.findall(text))
        if c:
            hits[name] = c
    return hits


FUNC_HEAD = re.compile(
    r"\b(?:function\s+(\w+)|(constructor)\s*\(|(receive|fallback)\s*\()")
# беспермиссионная точка входа: external/public без модификатора доступа
GUARD = re.compile(r"onlyOwner|onlyRole|onlyAdmin|onlyGovernance|onlyGuardian|"
                   r"_checkRole|onlyManager|onlyKeeper|auth\b")
VISIBLE = re.compile(r"\b(external|public)\b")


def func_score(f):
    """Вес функции по измеренным лифтам.

    Две шкалы, потому что измерялись на разных подвыборках и складывать их
    напрямую нельзя: горячие признаки считались на всех функциях, холодные —
    только на холодных, где базовая ставка своя (8% против 10%). Поэтому
    холодные применяются лишь к холодным функциям.

    Признаки с лифтом ниже единицы вес уменьшают. Это не ошибка, а измеренный
    факт: функция с onlyOwner содержит находку вдвое реже средней.
    """
    import math
    s = sum(math.log(FUNC_LIFT[k]) for k in f["hits"] if k in FUNC_LIFT)
    if f.get("is_cold"):
        s += sum(math.log(COLD_LIFT[k]) for k in f.get("cold", ()) if k in COLD_LIFT)
    return s


def mask(text):
    """Копия текста, где комментарии и строковые литералы забиты пробелами.

    Длина и переводы строк сохраняются, поэтому смещения и номера строк
    совпадают с оригиналом. Без этого разбор ломался: комментарий вида
    `// function to withdraw` ловился как заголовок функции, и дальше по
    скобкам собиралось «тело» на пятьсот строк с чужим именем.
    """
    out = list(text)
    i, n = 0, len(text)
    while i < n:
        c, nxt = text[i], text[i + 1] if i + 1 < n else ""
        if c == "/" and nxt == "/":
            while i < n and text[i] != "\n":
                out[i] = " "; i += 1
        elif c == "/" and nxt == "*":
            while i < n and not (text[i] == "*" and i + 1 < n and text[i + 1] == "/"):
                if text[i] != "\n":
                    out[i] = " "
                i += 1
            for k in range(i, min(i + 2, n)):
                out[k] = " "
            i += 2
        elif c in "\"'":
            q = c
            out[i] = " "; i += 1
            while i < n and text[i] != q:
                if text[i] == "\\":
                    out[i] = " "; i += 1
                if i < n and text[i] != "\n":
                    out[i] = " "
                i += 1
            if i < n:
                out[i] = " "; i += 1
        else:
            i += 1
    return "".join(out)


def functions(text):
    """Разбиваем файл на функции со счётом строк.

    Заголовки и скобки ищем по замаскированной копии — там нет ни
    комментариев, ни строк, поэтому ни `// function to ...`, ни литерал
    `"{"` разбор не сломают. Тело берём из оригинала по номерам строк.
    """
    m_text = mask(text)
    lines = text.splitlines()
    out = []
    for m in FUNC_HEAD.finditer(m_text):
        name = m.group(1) or m.group(2) or m.group(3)
        i = m_text.find("{", m.end())
        semi = m_text.find(";", m.end())
        if i < 0 or (0 <= semi < i):
            continue                      # объявление без тела (интерфейс)
        depth, j, n = 0, i, len(m_text)
        while j < n:
            c = m_text[j]
            if c == "{":
                depth += 1
            elif c == "}":
                depth -= 1
                if depth == 0:
                    break
            j += 1
        if depth != 0:
            continue
        l0 = text.count("\n", 0, m.start()) + 1
        l1 = text.count("\n", 0, j) + 1
        body = "\n".join(lines[l0 - 1:l1])
        head = m_text[m.start():i]        # сигнатура до тела: там модификаторы
        hits, ext = analyse(body)
        f = {"name": name, "l0": l0, "l1": l1,
             "nsloc": nsloc(body), "hits": hits, "ext": ext,
             "cold": analyse_cold(body),
             "open": bool(VISIBLE.search(head)) and not GUARD.search(head)}
        # «холодная» функция: снаружи не дозваться и денег не двигает —
        # ровно тот класс, который горячие признаки отправляют в самый низ
        f["is_cold"] = not f["open"] and not hits.get("деньги")
        f["score"] = func_score(f)
        out.append(f)
    return out


def walk_functions(root, scope_files=None, exts=(".sol",)):
    """Все функции всех файлов в скоупе, плоским списком."""
    root = pathlib.Path(root)
    out = []
    for p in root.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in exts:
            continue
        rel = p.relative_to(root).as_posix()
        if scope_files is not None:
            if not any(rel.endswith(f) or f.endswith(rel) for f in scope_files):
                continue
        elif any(("/%s/" % d) in ("/" + rel) for d in SKIP_DIR) or SKIP_FILE.search(rel):
            continue
        try:
            text = p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for f in functions(text):
            if f["nsloc"] < 3:
                continue
            f["path"] = rel
            f["file"] = p.name
            out.append(f)
    return out


def budget(rows, hours, loc_per_hour=250):
    """Сколько файлов сверху реально прочесть за отпущенное время.
    250 строк в час — темп вдумчивого чтения незнакомого кода, не беглого."""
    cap = hours * loc_per_hour
    got, take = 0, []
    for r in rows:
        if got + r["nsloc"] > cap and take:
            break
        take.append(r)
        got += r["nsloc"]
    return take, got, cap
