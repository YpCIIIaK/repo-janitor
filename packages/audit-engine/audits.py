"""Поиск заплаток в опубликованных аудитах — мишени для приёма
«недочиненная половина».

ЗАЧЕМ. Находка на Paxos родилась так: взять опубликованный отчёт аудита,
найти ИСПРАВЛЕННУЮ находку, открыть заплатку и проверить, все ли
симметричные пути ею покрыты. У Zellic была починена агрегатная половина и
оставлена кошельковая.

ПОЧЕМУ НЕ СЧИТАЕМ СТАТУСЫ. Первая версия ранжировала мишени по
распределению статусов (Resolved / Partially Resolved / Unresolved) и
ПРОВАЛИЛА проверку на двух случаях, разобранных вручную. Причина: каждая
контора пишет по-своему. Zellic — «a fix was implemented in commit 8a5f...»,
где fix существительным, а шаблон ловил только «fixed». Trail of Bits
держит идентификатор находки и в сводной таблице, и в разборе, отчего
«Risk Accepted» терялось. Общим регулярным выражением статусы надёжно не
достать, а неверное ранжирование ХУЖЕ отсутствия ранжирования: оно уверенно
шлёт не туда.

ЧТО ИЩЕМ ВМЕСТО ЭТОГО. Ссылки на заплатки — номера коммитов и
пулл-реквестов. Они однозначны у всех контор и полезнее статуса: каждая
такая ссылка есть готовый дифф, который надо прочитать. Инструмент достаёт
их вместе с куском текста вокруг, чтобы было видно, что чинили.

В КАКОМ ПОРЯДКЕ ИХ ЧИТАТЬ. Заплаток набирается больше, чем есть вечеров,
поэтому инструмент считает ПОКРЫТИЕ ПОДСИСТЕМЫ: сколько разных отчётов
упоминает каждый файл исходника, и к какому файлу относится каждая заплатка.
Файл, аудированный один раз, — свежая подсистема, а именно там половины
остаются открытыми. Итоговый список «ЗАПЛАТКИ ПО СВЕЖЕСТИ ПОДСИСТЕМЫ» и есть
порядок работы; ранг репозитория рядом с ним грубоват, потому что внутри
одного репозитория соседствуют вытоптанные файлы и нетронутые.

Проверено на известной находке: запущенный вслепую, инструмент ставит
заплатку 8a5fc784 (ту самую, у которой осталась открытая половина) второй
строкой сверху.

Оценки «важности» находки тут намеренно нет. Инструмент не решает за
человека, он сокращает работу: вместо чтения сотен страниц PDF — список
конкретных диффов в разумном порядке.

ЗАПУСК

    python audits.py --repo paxosglobal/paxos-token-contracts
    python audits.py --repos repos.txt
    python audits.py --known      # проверка на двух разобранных вручную случаях

ЛИМИТ. Без токена GitHub даёт 60 запросов в час, с токеном — 5000. Токен
читается из переменной окружения GITHUB_TOKEN и больше нигде не хранится:

    $env:GITHUB_TOKEN = "..."      # PowerShell, на время окна
    setx GITHUB_TOKEN "..."        # навсегда, нужен новый терминал

Права токену не нужны НИКАКИЕ: всё, что читает инструмент, — публичные
репозитории. Классический токен создаётся без единой галочки, тонкий — с
доступом «Public repositories, read-only». Такой токен ничем не рискует,
даже если утечёт: он не даёт того, чего нельзя получить анонимно, кроме
скорости.

 Листинг папок тратит лимит,
сами файлы тянутся с raw.githubusercontent и лимит не трогают; всё
скачанное кэшируется в data/audits.
"""
import argparse
import io
import json
import os
import re
import hashlib
import urllib.error
import urllib.parse
import urllib.request

import sys

# Текст аудитов полон типографики (стрелки, тире, неразрывные пробелы), а
# консоль Windows по умолчанию cp1251 и на первом же таком знаке падает.
# Заменяем непредставимые знаки, а не роняем прогон.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.abspath(__file__))
CACHE = os.path.join(ROOT, "data", "audits")

AUDIT_DIRS = ("audits", "audit", "security", "reports",
              "docs/audits", "docs/audit", "assets/audits")

DOC_EXT = (".pdf", ".md", ".txt")

# Ссылка на заплатку: глагол исправления, затем номер коммита или PR.
#   Zellic         «a fix was implemented in commit8a5fc784»
#   Trail of Bits  «Resolved in PR #99»
#
# ВАЖНО про склейку. При извлечении из PDF пробел между словом и хешем
# часто теряется — получается «commit8a5fc784». Поэтому после ключевого
# слова граница слова НЕ требуется. Зато само ключевое слово (commit / PR /
# pull request) или знак # обязательны: без них голый шестнадцатеричный
# кусок ловится в адресах и подписях.
FIXREF = re.compile(
    r"(?:fix(?:e[sd])?|resolv(?:ed|es)|address(?:ed|es)|mitigat(?:ed|es)|patch(?:ed)?)"
    r"[^.]{0,60}?"
    r"(?:(?:commit|PR|pull\s+request)\s*(#?[0-9a-f]{7,40}|#?\d{1,5})"
    r"|(#\d{1,5}))",
    re.I,
)

CONTEXT = 170

# Код находки, которым конторы метят низкую серьёзность: N-03 (Note),
# I-02 (Informational), G-01 (Gas). Буквы L (Low) тут НЕТ намеренно: у
# Trail of Bits и Spearbit под Low попадают настоящие логические ошибки, а
# находка на Paxos у Zellic вообще шла как Critical — но соседние в том же
# отчёте были Low и содержательными.
LOWCODE = re.compile(r"\b[NIG]-\d{2}\b")

# Признаки косметической заплатки. У такой нет «половин»: документация,
# событие или опечатка не бывают исправлены наполовину по путям кода.
#
# Список собран по прочитанным вручную: из пятнадцати заплаток содержательных
# было пять, остальные — NatSpec, газ, события, стиль require, «remove payable
# from stakeEth()». Каждая такая — потерянный вечер, и отличима она заранее.
#
# Отсев МЯГКИЙ: заплатка не выбрасывается, а уходит в конец очереди. Слово
# «documentation» встречается и в разборе настоящих находок, и жёсткий фильтр
# однажды съел бы нужное.
TRIVIAL = re.compile(
    r"documentation|natspec|typo|comment|gas (?:optimi|saving)|misleading name"
    r"|naming|unused (?:variable|import|code)|test coverage|readability"
    r"|code style|remove payable|emit(?:ted)? event|missing event"
    # маркеры разделов, куда конторы складывают заведомо неопасное
    r"|notes? (?:&|and) additional information"
    r"|severity:\s*(?:informational|note)|non-critical",
    re.I,
)

# Имя файла исходника внутри текста отчёта. Ведущее подчёркивание разрешено
# (`_beforeTokenTransfer.sol` встречается), точка обязательна.
# Левая граница задана явно, а не через \b: \b перед подчёркиванием не
# срабатывает.
#
# ОСТАТОЧНЫЙ ШУМ, ЛЕЧИТЬ НЕ СТАЛИ. pypdf рвёт длинные имена пробелом на
# переносе строки, и `remove_whitelisted_address.rs` приезжает как
# «rem ove_whitelisted_address.rs». Обрубок считается отдельным файлом и
# получает покрытие 1, то есть выглядит свежее, чем есть. Ошибка идёт в
# опасную сторону — лишняя мишень, — но видна сразу: имя начинается с
# подчёркивания или обрывка слова. Склеивать перенос вслепую хуже: так же
# слипнутся и соседние настоящие имена.
SCOPE_FILE = re.compile(
    r"(?<![A-Za-z0-9_.])([A-Za-z_][A-Za-z0-9_]{2,40}\.(?:sol|rs|move|cairo|vy))\b")

# Файлы, которые есть у всех и ничего не говорят о покрытии подсистемы.
SCOPE_NOISE = {
    "ierc20.sol", "erc20.sol", "safeerc20.sol", "ownable.sol", "context.sol",
    "address.sol", "math.sol", "safemath.sol", "strings.sol", "pausable.sol",
    "initializable.sol", "ecdsa.sol", "test.sol", "console.sol", "script.sol",
    "enumerableset.sol", "accesscontrol.sol", "reentrancyguard.sol",
}


# Квалифицированный вызов: `SharesLib.calcShares(`, `StorageLib.toUint48(`.
# Zellic (и не она одна) в тексте находки НЕ называет файлов вообще — только
# код. Библиотека в квалификаторе есть прямое имя файла, и это единственная
# ниточка от заплатки к подсистеме в таких отчётах.
QUALIFIED = re.compile(r"\b([A-Z][A-Za-z0-9_]{2,40})\.[a-z_][A-Za-z0-9_]*\s*\(")

# Самая точная привязка, когда она есть: контора называет подсистему в шапке
# находки. Zellic — «Target PayoutGroupFacet», Cantina — «Context:
# DelegationToken.sol#L134». Имя файла без расширения дополняем сами.
TARGET = re.compile(r"(?:target|context|contract)s?\s*:?\s+([A-Z][A-Za-z0-9_]{2,40})", re.I)


def scope_of(text):
    """Файлы исходников, упомянутые в отчёте.

    Это ПРОКСИ, а не скоуп: отчёт может упомянуть файл мимоходом, и такое
    упоминание засчитается как покрытие. Ошибка идёт в безопасную сторону —
    покрытие завышается, значит недоаудированных файлов находится МЕНЬШЕ, чем
    есть. Ложная мишень хуже пропущенной: на неё тратится вечер.
    """
    return {f for f in SCOPE_FILE.findall(text) if f.lower() not in SCOPE_NOISE}

# метаданные репозиториев, собранные при обходе организации
META = {}


def _get(url, raw=False, timeout=45):
    headers = {
        "User-Agent": "auditscout/1.0",
        "Accept": "*/*" if raw else "application/vnd.github+json",
    }
    # Токен берётся ТОЛЬКО из окружения и никогда не пишется в файлы, вывод
    # или кеш. Без него лимит 60 запросов в час, с ним — 5000. Нужен токен
    # без единого права: все читаемые данные и так публичны.
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token and "api.github.com" in url:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read() if raw else json.load(r)


# Чужой код внутри репозитория. Отчёты зависимостей нам не нужны, а
# node_modules у крупных проектов даёт сотни ложных SECURITY.md.
SKIP_PARTS = ("node_modules", "/lib/", "/vendor/", "/out/", "/cache/",
              "/.git/", "site-packages")

AUDIT_HINT = ("audit", "security", "review", "report")


def _cache_path(owner, repo, name):
    d = os.path.join(CACHE, owner, repo)
    os.makedirs(d, exist_ok=True)
    return os.path.join(d, name)


def find_audit_files(owner, repo):
    """Файлы отчётов. ОДИН запрос на репозиторий, и то лишь в первый раз.

    Раньше обходили contents/ по каждой из семи вероятных папок — до семи
    запросов на репозиторий. Полное дерево через git/trees?recursive=1
    стоит один. При лимите 60 запросов в час это разница между десятком
    мишеней и сотней.

    Результат кешируется: повторные прогоны и самопроверка работают
    полностью офлайн и лимит не трогают. Это важно не только для скорости —
    исчерпав лимит, инструмент переставал проверяться.
    """
    cached = _cache_path(owner, repo, "_files.json")
    if os.path.exists(cached):
        try:
            return json.load(io.open(cached, encoding="utf-8"))
        except Exception:
            pass

    tree = _tree(owner, repo)
    if tree is not None:
        out = []
        for it in tree.get("tree", []):
            if it.get("type") != "blob":
                continue
            path = it["path"]
            low = "/" + path.lower()
            if not low.endswith(DOC_EXT):
                continue
            if any(s in low for s in SKIP_PARTS):
                continue
            # отчёт лежит либо в папке с говорящим именем, либо сам так назван
            if any(h in low for h in AUDIT_HINT):
                out.append(path)
        # дерево может прийти обрезанным на огромных репозиториях
        if tree.get("truncated"):
            print("   дерево обрезано, часть файлов могла не попасть")
        io.open(cached, "w", encoding="utf-8").write(json.dumps(out))
        return out
    return []


_TREES = {}


def _tree(owner, repo):
    """Полное дерево репозитория. ОДИН запрос на репозиторий за прогон.

    Дерево нужно двум потребителям — поиску отчётов и списку существующих
    исходников. Раньше каждый ходил за ним сам, и репозиторий стоил два
    запроса из шестидесяти в час. Это вдвое сокращало число мишеней за
    прогон ни за что.
    """
    key = (owner, repo)
    if key in _TREES:
        return _TREES[key]
    for branch in ("master", "main"):
        url = ("https://api.github.com/repos/%s/%s/git/trees/%s?recursive=1"
               % (owner, repo, branch))
        try:
            tree = _get(url)
        except urllib.error.HTTPError as e:
            if e.code == 403:
                print("   лимит GitHub исчерпан — этот репозиторий пропущен")
                _TREES[key] = None
                return None
            continue
        except Exception:
            continue
        _TREES[key] = tree
        return tree
    _TREES[key] = None
    return None


def _is_foreign(path):
    """Чужой код: зависимости, а не исходники проекта.

    Здесь НЕЛЬЗЯ отбрасывать всё, где встречается «/lib/», как это делает
    SKIP_PARTS для поиска отчётов. У Paxos собственная папка
    `contracts/lib/`, и по такому правилу StorageLib.sol объявлялся
    несуществующим — а на нём висит наша единственная настоящая находка.
    Зависимости Foundry лежат в `lib/` В КОРНЕ, это и проверяем.
    """
    low = path.lower()
    if low.startswith(("lib/", "node_modules/", "vendor/", "out/", "cache/")):
        return True
    return "node_modules/" in low or "/vendor/" in low


def source_files(owner, repo):
    """Имена файлов исходников, существующих в репозитории СЕЙЧАС.

    Зачем. Отчёты живут в репозитории вечно, а код — нет. Аудит Morpho от
    2023 года разбирает bundler v2, которого больше не существует: его
    заменил bundler3 с другой архитектурой. Заплатка к исчезнувшему файлу
    неприменима, читать её незачем, и в очереди она только мешает.

    Берётся из того же дерева, что и отчёты, — лишних запросов нет.
    """
    cached = _cache_path(owner, repo, "_src.json")
    if os.path.exists(cached):
        try:
            return set(json.load(io.open(cached, encoding="utf-8")))
        except Exception:
            pass
    tree = _tree(owner, repo)
    if tree is not None:
        out = sorted({os.path.basename(it["path"]) for it in tree.get("tree", [])
                      if it.get("type") == "blob"
                      and it["path"].lower().endswith((".sol", ".rs", ".vy"))
                      and not _is_foreign(it["path"])})
        io.open(cached, "w", encoding="utf-8").write(json.dumps(out))
        return set(out)
    # ветка ниже недостижима при успешном дереве
    # Сети нет — не выдумываем. Пустое множество означает «не проверяли»,
    # и ни одна заплатка не будет ошибочно объявлена мёртвой.
    return set()


def fetch(owner, repo, path):
    local = os.path.join(CACHE, owner, repo, path.replace("/", "_"))
    os.makedirs(os.path.dirname(local), exist_ok=True)
    if os.path.exists(local) and os.path.getsize(local) > 0:
        return local
    # в именах отчётов почти всегда пробелы — без кодирования будет 404
    quoted = urllib.parse.quote(path)
    for branch in ("master", "main"):
        url = "https://raw.githubusercontent.com/%s/%s/%s/%s" % (owner, repo, branch, quoted)
        try:
            data = _get(url, raw=True)
        except Exception:
            continue
        with open(local, "wb") as f:
            f.write(data)
        return local
    return None


def text_of(path):
    if path.lower().endswith(".pdf"):
        try:
            from pypdf import PdfReader
        except ImportError:
            return ""
        try:
            t = "\n".join(pg.extract_text() or "" for pg in PdfReader(path).pages)
        except Exception:
            return ""
    else:
        t = io.open(path, encoding="utf-8", errors="ignore").read()
    # распакованные PDF часто идут посимвольно — склеиваем
    t = re.sub(r"[ \t]*\n[ \t]*", " ", t)
    return re.sub(r"\s{2,}", " ", t)


# Заголовок находки. Разные конторы, один смысл — начало нового раздела.
#   Cantina/Spearbit  «3.1.7 Use init functions provided by ...»
#   Trail of Bits     «TOB-FOLIO-4: Users do not receive shares»
#   OpenZeppelin      «N-03 Constant Not Using UPPER_CASE»
HEADING = re.compile(
    # Точка после последнего номера необязательна: Zellic пишет «3.1. Group
    # shares are not...», Cantina — «3.1.7 Use init functions...».
    #
    # Номер раздела НЕ начинается с нуля и не продолжает другое число. Без
    # этого «a perPeriodRate of 0.5. A payout group has...» из текста находки
    # принималось за заголовок, находка рвалась пополам, и код с вызовом
    # SharesLib.calcShares оказывался в чужом куске — привязка терялась.
    r"(?=(?:(?<![\d.])[1-9]\d?\.\d{1,2}(?:\.\d{1,2})?\.?\s+[A-Z]"
    r"|TOB-[A-Z0-9]+-\d+\b"
    r"|\b[A-Z]{1,3}-\d{2}\b))"
)

# Только известные слова. Свободное «([a-z]+)» ловило «severity and ...» и
# возвращало «and» — молчаливый мусор, который потом сравнивался со списком
# косметичных и всегда давал «не косметика».
SEVERITY = re.compile(
    r"severity\s*:?\s*"
    r"(critical|high|medium|low|informational|note|gas|undetermined)", re.I)


def split_findings(text):
    """Отчёт, разрезанный по находкам.

    Зачем это вместо окна вокруг ссылки. Серьёзность объявлена в заголовке
    находки, а ссылка на заплатку стоит в самом её конце, и расстояние между
    ними гуляет от двухсот знаков до полутора тысяч. Любое фиксированное
    окно ошибается в обе стороны: узкое пропустило пять косметических правок
    DelegationToken.sol, широкое убило 45 заплаток из 49. Границы находок
    известны точно — по ним и надо резать.

    Разрез считается удавшимся, только если кусков много И они небольшие.
    Одной проверки на число мало: отчёт Zellic разваливался на четыре куска
    по шестнадцать тысяч знаков, куски принимались за находки, и в один
    попадало полдокумента — вместе со словом «gas optimization» из
    посторонней главы. Настоящая Critical-находка получала ярлык
    «косметика». Не разрезали — работаем окном, это честнее.
    """
    parts = [p for p in HEADING.split(text) if p.strip()]
    if len(parts) < 5:
        return [text]
    # Судим по МЕДИАНЕ, а не по максимуму: одна раздутая глава (введение,
    # приложение с кодом) не должна отменять верный разрез всего отчёта. По
    # максимуму отчёт конкурса Cantina возвращался одним куском на 62 000
    # знаков, и серьёзность бралась от случайной соседней находки.
    sizes = sorted(len(p) for p in parts)
    if sizes[len(sizes) // 2] > 4000:
        return [text]
    return parts


def severity_of(seg):
    """Серьёзность находки: слово после «Severity:» либо буква кода.

    Буква L (Low) косметикой НЕ считается: под Low у Trail of Bits и
    Spearbit лежат настоящие логические ошибки.
    """
    m = SEVERITY.search(seg)
    if m:
        return m.group(1).lower()
    m = LOWCODE.search(seg)
    return {"N": "note", "I": "informational", "G": "gas"}[m.group(0)[0]] if m else ""


def find_fixrefs(text):
    """Список (ссылка, кусок текста вокруг, файлы рядом). Дубли снимаются.

    Файлы берутся из расширенного окна вокруг ссылки: описание находки почти
    всегда называет файл выше по тексту, чем строчку про заплатку. Это и
    связывает заплатку с подсистемой, а подсистему — с её покрытием.
    """
    segments = split_findings(text)
    # Разрез не удался — падаем на окно вокруг ссылки. Оно хуже, но брать
    # скоуп со всего отчёта нельзя: к заплатке прицепится каждый файл.
    windowed = len(segments) == 1

    out, seen = [], set()
    for seg in segments:
        if windowed:
            sev = ""
        else:
            sev = severity_of(seg)
        for m in FIXREF.finditer(seg):
            ref = m.group(1) or m.group(2)
            bare = ref.lstrip("#")
            # длинное десятичное — это год, сумма или номер строки, не хеш
            if not ref.startswith("#") and bare.isdigit():
                continue
            if ref in seen:
                continue
            seen.add(ref)
            if windowed:
                # Окно с примерно страницу отчёта: находка описывается сверху
                # вниз, а Remediation со ссылкой стоит в самом конце, за
                # колонтитулом. У Zellic до кода набегает больше двух тысяч
                # знаков, и на шести CONTEXT привязка молча терялась.
                scope = seg[max(0, m.start() - CONTEXT * 18):m.end() + 60]
            else:
                scope = seg
            fset = scope_of(scope) | {q + ".sol" for q in QUALIFIED.findall(scope)}
            # Шапка находки точнее всего, поэтому её имена идут отдельно и
            # перекрывают остальные при выборе файла — см. ref_cover().
            head = {t + ".sol" for t in TARGET.findall(scope[:400])}
            fset |= head
            # Сегмент может не называть ни файла, ни библиотеки — тогда
            # откатываемся на окно в ПОЛНОМ тексте. Без этого настройка
            # разреза превращается в качели: порог, спасающий один формат
            # отчёта, обнулял привязку в другом.
            fellback = False
            if not fset and not windowed:
                j = text.find(ref)
                if j > 0:
                    back = text[max(0, j - CONTEXT * 18):j + 60]
                    fset = scope_of(back) | {q + ".sol" for q in QUALIFIED.findall(back)}
                    # Раз сегмент не назвал файла, он и не про эту находку —
                    # значит его серьёзность тоже чужая. Иначе настоящая
                    # находка Reserve получала ярлык косметики от соседа.
                    fellback = True
                    scope = back
            # Серьёзность: по сегменту, если он есть, иначе по УЗКОМУ окну.
            # Широкое окно для этого не годится — оно дотягивается до соседней
            # находки, и «Insufficient test coverage» пометило косметикой
            # соседнюю настоящую TOB-FOLIO-4.
            if windowed or fellback:
                base = scope if fellback else seg
                a2 = base.rfind(ref)
                near = base[max(0, a2 - CONTEXT * 2):a2 + len(ref) + 40]
                triv = bool(TRIVIAL.search(near) or LOWCODE.search(near))
            else:
                triv = sev in ("informational", "note", "gas", "undetermined") \
                    or bool(TRIVIAL.search(scope))
            a = max(0, m.start() - CONTEXT)
            out.append((ref, " ".join(seg[a:m.end() + 30].split()), fset, triv))
    return out


def scan(owner, repo, seen_hashes=None):
    """seen_hashes — общий на весь прогон набор хешей уже прочитанных отчётов.

    Один и тот же PDF часто лежит сразу в нескольких репозиториях
    организации (у Morpho отчёт 2023-11-16 продублирован в трёх). Без
    дедупликации счёт заплаток задваивается и мишени врут.
    """
    files = find_audit_files(owner, repo)
    from_cache = False
    if not files:
        # API недоступен или лимит исчерпан — работаем по уже скачанному.
        # Отчёты кешируются навсегда, так что разбор остаётся возможен и
        # без сети. Инструмент, который умеет проверяться только онлайн,
        # проверяться перестаёт ровно тогда, когда это нужнее всего.
        d = os.path.join(CACHE, owner, repo)
        if os.path.isdir(d):
            files = [f for f in sorted(os.listdir(d))
                     if f.lower().endswith(DOC_EXT) and not f.startswith("_")]
            from_cache = bool(files)
            if from_cache:
                print("   сети нет — читаю %d отчётов из кеша" % len(files))
    if not files:
        return None
    per_file = []
    coverage = {}   # файл исходника -> сколько РАЗНЫХ отчётов его упоминают
    for path in files:
        local = os.path.join(CACHE, owner, repo, path) if from_cache             else fetch(owner, repo, path)
        txt = text_of(local) if local and os.path.exists(local) else ""
        if not txt.strip():
            per_file.append((os.path.basename(path), None, []))
            continue
        if seen_hashes is not None:
            h = hashlib.sha1(open(local, "rb").read()).hexdigest()
            if h in seen_hashes:
                per_file.append((os.path.basename(path) + "  [дубль]", 0, []))
                continue
            seen_hashes.add(h)
        for fn in scope_of(txt):
            coverage[fn] = coverage.get(fn, 0) + 1
        per_file.append((os.path.basename(path), len(txt), find_fixrefs(txt)))
    return {"repo": "%s/%s" % (owner, repo), "files": len(files),
            "per_file": per_file, "coverage": coverage,
            "src": source_files(owner, repo),
            "refs": sum(len(r) for _, _, r in per_file)}


def ref_cover(files, coverage):
    """Наименьшее покрытие среди файлов заплатки, и какой это файл.

    Берётся именно МИНИМУМ: заплатка ценна самым недоаудированным файлом,
    которого она касается. Ноль файлов рядом — покрытие неизвестно.
    """
    # только файлы, которые реально встречались в отчётах: имя из
    # квалификатора может оказаться интерфейсом или чужой библиотекой
    pairs = [(coverage[f], f) for f in files if f in coverage]
    return min(pairs) if pairs else (None, None)


def show(res, verbose=False):
    cov = res.get("coverage", {})
    print("\n%s — отчётов %d, ссылок на заплатки %d"
          % (res["repo"], res["files"], res["refs"]))
    for name, size, refs in res["per_file"]:
        if size is None:
            print("   %-56s не прочитался" % name[:56])
            continue
        if size == 0:
            continue
        print("   %-56s %s" % (name[:56], ("%d ссылок" % len(refs)) if refs else "-"))
        for ref, ctx, fset, triv in (refs if verbose else refs[:4]):
            n, fn = ref_cover(fset, cov)
            mark = "  [%s x%d]" % (fn, n) if fn else ""
            mark += "  косметика?" if triv else ""
            print("        %-10s %s%s" % (ref, ctx[-115:], mark))

    thin = sorted(f for f, n in cov.items() if n == 1)
    if thin:
        print("   ---")
        print("   файлов в скоупе всего %d, из них аудированы ОДИН раз: %d"
              % (len(cov), len(thin)))
        print("   " + ", ".join(thin[:14]) + (" ..." if len(thin) > 14 else ""))


KNOWN = [
    ("paxosglobal", "paxos-token-contracts",
     "ждём 8a5fc784, 0af60714, ff44b973 — отчёт Zellic по USDG Rewards"),
    ("reserve-protocol", "reserve-index-dtf",
     "ждём #99, #106, #136 — отчёты Trail of Bits"),
]

# Языки, на которых пишут проверяемые контракты. Интерфейсы и подграфы на
# TypeScript пропускаем — там аудитов не бывает.
CODE_LANGS = ("Solidity", "Rust", "Move", "Cairo", "Go", "C++")


def org_repos(org, limit=25):
    """Репозитории организации, годные под проверку. Один запрос.

    Возвращает словари, а не имена: дата создания нужна для оценки
    свежести подсистемы.
    """
    try:
        rs = _get("https://api.github.com/orgs/%s/repos?per_page=100&sort=pushed" % org)
    except urllib.error.HTTPError as e:
        if e.code == 403:
            raise SystemExit("   лимит GitHub исчерпан — подождать час")
        return []
    except Exception:
        return []
    out = []
    for r in rs:
        if r.get("fork") or r.get("archived"):
            continue
        if r.get("language") not in CODE_LANGS:
            continue
        out.append({"name": r["name"], "created": (r.get("created_at") or "")[:10]})
    return out[:limit]


def repo_meta(owner, repo):
    """Дата создания репозитория. Один запрос, кешируется.

    Возраст — вещь желательная, но не обязательная: при исчерпанном лимите
    возвращаем пустое, и оценка свежести просто становится осторожнее.
    Инструмент не должен падать из-за необязательных данных.
    """
    cached = _cache_path(owner, repo, "_meta.json")
    if os.path.exists(cached):
        try:
            return json.load(io.open(cached, encoding="utf-8"))
        except Exception:
            pass
    try:
        r = _get("https://api.github.com/repos/%s/%s" % (owner, repo))
        m = {"name": repo, "created": (r.get("created_at") or "")[:10]}
    except Exception:
        return {"name": repo, "created": ""}
    io.open(cached, "w", encoding="utf-8").write(json.dumps(m))
    return m


def age_years(created, today="2026-08-10"):
    """Возраст в годах по датам вида ГГГГ-ММ-ДД. Без сторонних библиотек."""
    if not created:
        return None
    try:
        y1, m1, d1 = (int(x) for x in created.split("-"))
        y2, m2, d2 = (int(x) for x in today.split("-"))
    except ValueError:
        return None
    return round((y2 - y1) + (m2 - m1) / 12.0 + (d2 - d1) / 365.0, 1)


def freshness(res):
    """Оценка перспективности мишени. ЭВРИСТИКА на трёх наблюдениях, не закон.

    Что различало три разобранные мишени:

        Paxos    один аудит подсистемы, коду 5 месяцев   -> НАХОДКА
        Reserve  пять аудитов, коду больше двух лет      -> пусто
        Morpho   много аудитов плюс верификация Certora  -> пусто

    Разделяет НЕ разрыв версий между кодом и аудитом. У Reserve аудиты для
    версии 2.0.0 при коде 6.0.0 — по этому признаку он был бы первым, а дал
    ноль. Разделяет ЧИСЛО АУДИТОВ и ВОЗРАСТ подсистемы: чем больше глаз
    прошло по коду и чем дольше он живёт, тем меньше шансов, что половина
    осталась открытой.

    ПРЕЖНИЙ ДЕФЕКТ УСТРАНЁН. Раньше делили на число отчётов в РЕПОЗИТОРИИ, и
    Paxos с его семью отчётами выглядел вытоптаннее Reserve — наоборот
    истине. Отчёты Paxos про разные вещи: кросс-чейн, PAXG, стейблкоин, USDG
    Rewards; систему долей аудировали ровно ОДИН раз. Теперь считается
    покрытие ПОДСИСТЕМЫ: сколько разных отчётов упоминает каждый файл
    исходника, и берётся медиана по файлам, которых касаются заплатки. Один
    отчёт на файл — подсистема свежая, сколько бы отчётов ни было у
    репозитория.

    Что осталось приблизительным: упоминание файла считается покрытием, хотя
    отчёт мог назвать его мимоходом. Ошибка завышает покрытие, то есть
    занижает число мишеней — сторона безопасная, см. scope_of().

    Без известного возраста возвращается None и мишень не ранжируется вовсе:
    неверное ранжирование хуже отсутствия ранжирования, на этом уже обожглись.
    """
    if res["refs"] == 0:
        return 0.0
    age = res.get("age")
    if age is None:
        return None
    cov = res.get("coverage") or {}
    touched = []
    for _, _, refs in res["per_file"]:
        for _, _, fset, _t in refs:
            n, _fn = ref_cover(fset, cov)
            if n:
                touched.append(n)
    # Привязать заплатку к файлу удаётся не всегда: Zellic ставит строчку про
    # коммит в самом конце находки, за колонтитулом, и файла рядом нет. Если
    # привязана меньше половины заплаток, медиана считается по огрызку и
    # ранжирование ВРЁТ — так Reserve однажды встал выше Paxos. Молчим.
    if len(touched) * 2 < res["refs"]:
        return None
    touched.sort()
    median = touched[len(touched) // 2]
    return round(10.0 / (1.0 + age) / median, 2)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", help="owner/name")
    ap.add_argument("--repos", help="файл со списком owner/name построчно")
    ap.add_argument("--org", help="обойти все годные репозитории организации")
    ap.add_argument("--limit", type=int, default=25, help="сколько репозиториев брать у организации")
    ap.add_argument("--known", action="store_true", help="проверка на разобранных вручную случаях")
    ap.add_argument("--verbose", action="store_true", help="все ссылки, не только первые")
    a = ap.parse_args()

    if a.known:
        targets = [(o, r) for o, r, _ in KNOWN]
    elif a.repo:
        targets = [tuple(a.repo.split("/"))]
    elif a.org:
        metas = org_repos(a.org, a.limit)
        print("у %s годных репозиториев: %d" % (a.org, len(metas)))
        targets = [(a.org, m["name"]) for m in metas]
        META.update({(a.org, m["name"]): m for m in metas})
    elif a.repos:
        targets = [tuple(l.strip().split("/")) for l in io.open(a.repos, encoding="utf-8")
                   if l.strip() and not l.startswith("#")]
    else:
        ap.error("нужен --repo, --org, --repos или --known")

    results = []
    seen_hashes = set()
    for o, r in targets:
        print("смотрю %s/%s ..." % (o, r))
        try:
            res = scan(o, r, seen_hashes)
        except SystemExit as e:
            print(e)
            break
        except Exception as e:
            print("   ошибка: %s" % e)
            continue
        if res is None or res["refs"] == 0:
            if not (a.org or a.repos):
                print("   заплаток в аудитах не найдено — приём неприменим")
            continue
        m = META.get((o, r)) or repo_meta(o, r)
        res["age"] = age_years(m.get("created"))
        res["score"] = freshness(res)
        results.append(res)
        show(res, a.verbose)

    if len(results) > 1:
        print("\n" + "=" * 78)
        print("МИШЕНИ ПО СВЕЖЕСТИ  (эвристика: мало аудитов + молодой код)")
        print("=" * 78)
        print("%-40s %6s %8s %9s %7s"
              % ("репозиторий", "лет", "1-раз", "заплаток", "оценка"))
        # мишени без известного возраста не ранжируются — уходят вниз с прочерком
        def key(x):
            sc = x.get("score")
            return (0 if sc is None else 1, sc or 0)
        for res in sorted(results, key=key, reverse=True):
            cov = res.get("coverage") or {}
            thin = len([1 for n in cov.values() if n == 1])
            age, sc = res.get("age"), res.get("score")
            print("%-40s %6s %5d/%-3d %9d %7s"
                  % (res["repo"][:40], "?" if age is None else age,
                     thin, len(cov), res["refs"], "—" if sc is None else "%.2f" % sc))
        # Настоящий порядок работы. Ранг репозитория грубоват — внутри одного
        # репозитория есть и вытоптанные файлы, и нетронутые. Читать надо
        # заплатки, а сортировать их по покрытию файла, которого они касаются.
        queue = []
        for res in results:
            cov = res.get("coverage") or {}
            src = res.get("src") or set()
            for _, _, refs in res["per_file"]:
                for ref, _ctx, fset, triv in refs:
                    n, fn = ref_cover(fset, cov)
                    if not n:
                        continue
                    # файла больше нет в репозитории — заплатка мертва
                    dead = bool(src) and fn not in src
                    queue.append((1 if (triv or dead) else 0, n,
                                  res["repo"], ref, fn, dead))
        if queue:
            queue.sort()
            print("\n" + "=" * 78)
            print("ЗАПЛАТКИ ПО СВЕЖЕСТИ ПОДСИСТЕМЫ — читать сверху")
            print("=" * 78)
            for triv, n, repo, ref, fn, dead in queue[:25]:
                note = "файла больше нет" if dead else ("косметика?" if triv else "")
                print("  отчётов %d  %-30s %-10s %-34s %s"
                      % (n, repo.split("/")[-1][:30], ref, fn, note))
            print("\nЯрлык «косметика?» — ПОДСКАЗКА, а не приговор. Когда")
            print("разрез отчёта ставит границу находки неверно, серьёзность")
            print("и файл берутся от соседа: так настоящая находка Reserve")
            print("38f6df4 помечена косметикой и приписана FolioDeployer.")
            print("Помеченное стоит просматривать глазами, хотя бы бегло.")
            print("\nПривязано %d заплаток из %d — у остальных рядом со ссылкой"
                  % (len(queue), sum(r["refs"] for r in results)))
            print("не названо ни файла, ни библиотеки, привязывать не к чему.")

        print("\nСтолбец «1-раз» — файлов, упомянутых ровно в ОДНОМ отчёте,")
        print("из всех файлов в скоупе. Это и есть свежая подсистема.")
        print("Прочерк в оценке — возраст неизвестен, ранжировать не на чем.")

    if a.known:
        print("\n" + "=" * 78)
        print("ЧТО ДОЛЖНО БЫЛО НАЙТИСЬ")
        print("=" * 78)
        for o, r, expect in KNOWN:
            print("%-42s %s" % ("%s/%s" % (o, r), expect))
        # Третья, более строгая проверка: покрытие должно разделять файлы
        # ВНУТРИ репозитория. Файлы системы долей Paxos обязаны оказаться
        # среди наименее покрытых — там нашлась находка.
        for res in results:
            if not res["repo"].endswith("paxos-token-contracts"):
                continue
            cov = res.get("coverage") or {}
            print("\nПОКРЫТИЕ ПОДСИСТЕМ (Paxos, проверка по известной находке)")
            for fn in ("SharesLib.sol", "PayoutGroupFacet.sol", "EIP3009.sol"):
                print("   %-24s отчётов %s" % (fn, cov.get(fn, "нет")))
            worst = max(cov.values()) if cov else 0
            ok = all(cov.get(f, 99) < worst for f in
                     ("SharesLib.sol", "PayoutGroupFacet.sol"))
            print("   %s система долей покрыта хуже самого хоженого файла"
                  % ("ДА  —" if ok else "НЕТ —"))


if __name__ == "__main__":
    main()
