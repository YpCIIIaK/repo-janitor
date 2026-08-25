"""Классификация конкурсов по типу протокола и добыча механик из отчётов.

Зачем. Измерено на четырёх пробах: 3 находки из 42, и провал сосредоточен
не в поиске файлов, а в предметной области — кредитная механика,
ликвидации, рестейкинг. Общие руководства этого не закрывают: они
перечисляют классы багов («бывает reentrancy»), а нужно знать, ЧТО именно
ломается в конкретном типе протокола и сколько за это платят.

Такого справочника в интернете нет, потому что он строится не из статей, а
из 2937 разобранных находок 235 отчётов, где у каждой известны уровень,
число нашедших и доля фонда.

Тип протокола определяется по имени конкурса, описанию и составу файлов из
scope — по трём источникам сразу, чтобы одно слово в названии не решало.
"""
import collections
import re
import statistics as st

from . import corpus

# Тип протокола -> слова-приметы. Порядок важен: первое совпадение с
# наибольшим весом выигрывает, поэтому специфичные идут раньше общих.
# Приметы намеренно СПЕЦИФИЧНЫЕ. Первая версия использовала слова вроде
# reward, lock, deposit, share — они встречаются в любом протоколе, и 128
# конкурсов из 235 свалились в «стейкинг». Здесь остались только те слова,
# которые почти не появляются вне своего типа.
TYPES = (
    ("рестейкинг",   r"restak|symbiotic|eigenlayer|karak|\bavs\b|middleware|"
                     r"\bslash(ing|ed)?\b|operator ?registry"),
    ("кредит",       r"\blend(ing|er)?\b|\bborrow|\bdebt\b|collateral|liquidat|"
                     r"\bltv\b|interest ?rate|utilization|health ?factor|"
                     r"ctoken|atoken|\baave\b|morpho|silo|euler|comptroller"),
    ("перпы",        r"\bperp|funding ?rate|margin ?account|clearing ?house|"
                     r"open ?interest|\bgmx\b|position ?size|mark ?price"),
    ("AMM/DEX",      r"\bamm\b|uniswap|curve ?pool|balancer|pool ?manager|"
                     r"\btick(s|Spacing|Lower|Upper)?\b|concentrated|sqrtprice|"
                     r"swap ?router|\bdex\b"),
    ("стейблкоин",   r"stablecoin|\bde-?peg|\bpsm\b|\bdai\b|\bfrax\b|"
                     r"collateral ?ratio|redemption ?queue"),
    ("хранилище",    r"erc-?4626|\bvault\b|strateg(y|ies)|harvest|auto-?compound|"
                     r"\byield\b"),
    ("стейкинг",     r"\bgauge|\bemission|ve[A-Z]\w+|voting ?escrow|"
                     r"reward ?(rate|per ?token|distributor)|\bepoch\b|\bvesting\b"),
    ("мост",         r"\bbridge|cross-?chain|layerzero|\bccip\b|wormhole|"
                     r"\brelayer|\bl1\b|\bl2\b|rollup|\bmessag(e|ing)\b"),
    ("NFT/игры",     r"erc-?721|erc-?1155|\bnft\b|auction|marketplace|\bgame\b"),
    ("управление",   r"\bgovern|\bdao\b|timelock|proposal|voting ?power|quorum"),
)
TYPES = tuple((n, re.compile(rx, re.I)) for n, rx in TYPES)


def classify_contest(d, fs=None):
    """Тип протокола по названию, описанию, файлам scope И ТЕКСТУ НАХОДОК.

    ПОЧЕМУ ТАК. Первая версия смотрела только на имя конкурса, описание и
    имена файлов scope. На этом она нашла 5 мостовых конкурсов из 235 и
    выдала «в мостах 52% одиночек — самая незанятая тема». Проверка по
    содержанию находок дала 14 кросс-чейн конкурсов, и доля одиночек
    оказалась 33% — НИЖЕ базовых 37%. Вывод был артефактом выборки.

    Заголовки находок — самый честный источник: аудиторы описывают ровно ту
    механику, которую сломали, а название репозитория часто говорит только
    о бренде.
    """
    name = str(d.get("template_repo_name") or "")
    desc = str(d.get("short_description") or "")
    files = []
    for r in d.get("scope") or []:
        for f in (r.get("files") or [])[:200]:
            files.append(str(f.get("name") or "").split("/")[-1])

    titles, ffiles = [], []
    for x in (fs or []):
        titles.append(x["title"])
        ffiles.extend(x["files"])

    hay_name = name + " " + desc
    hay_files = " ".join(files)
    hay_titles = " ".join(titles)
    hay_ffiles = " ".join(ffiles)

    best, score = None, 0
    for t, rx in TYPES:
        # заголовки находок весят столько же, сколько имя: они описывают
        # сломанную механику, а не бренд
        s = (len(rx.findall(hay_name)) * 3
             + len(rx.findall(hay_titles)) * 3
             + len(rx.findall(hay_files))
             + len(rx.findall(hay_ffiles)))
        if s > score:
            best, score = t, s
    return best or "прочее", score


def contests_by_type():
    out = []
    for d in corpus.load_offline():
        if len((d.get("report") or "")) < 500:
            continue
        fs = corpus.findings([d])
        t, s = classify_contest(d, fs)
        out.append((t, s, d))
    return out


def findings_by_type():
    """Плоский список находок с проставленным типом протокола."""
    rows = []
    for d in corpus.load_offline():
        if len((d.get("report") or "")) < 500:
            continue
        fs = corpus.findings([d])
        if not fs:
            continue
        t, s = classify_contest(d, fs)
        for x in fs:
            x["ptype"] = t
            rows.append(x)
    return rows


def summary(rows):
    g = collections.defaultdict(list)
    for x in rows:
        g[x["ptype"]].append(x)
    out = {}
    for t, v in g.items():
        solo = sum(1 for x in v if x["n"] == 1)
        out[t] = {
            "n": len(v),
            "contests": len({x["contest"] for x in v}),
            "solo": solo / len(v),
            "pay": st.median([x["pay"] for x in v]),
            "solo_pay": st.median([x["pay"] for x in v if x["n"] == 1]) if solo else 0,
            "high": sum(1 for x in v if x["sev"] in ("H", "C")) / len(v),
        }
    return out


STOP = set("""the a an to of in and or is are be by for with that this it as on
from can will not no if when at any all which does do has have been than then
their there they them these those into more most some such only other via due
user users can't cannot may might should would could also both each after before
while during over under between about against because since until where what
who whom whose how why very just even still yet own same so too s t d ll m o re
ve y ain aren couldn didn doesn hadn hasn haven isn ma mightn mustn needn shan
shouldn wasn weren won wouldn""".split())


def mechanics(rows, ptype, top=22, min_docs=3):
    """Слова, характерные ИМЕННО для этого типа протокола.

    Считаем по конкурсам, а не по находкам — иначе один протокол с десятком
    находок одного человека забивает верх (эта ошибка уже ловилась на общем
    корпусе). Лифт: доля конкурсов данного типа, где слово встречается,
    делённая на долю среди остальных типов.
    """
    inside, outside = collections.Counter(), collections.Counter()
    ci, co = set(), set()
    seen_i, seen_o = set(), set()
    for x in rows:
        words = {w for w in re.findall(r"[a-zA-Z][a-zA-Z-]{3,}", x["title"].lower())
                 if w not in STOP}
        if x["ptype"] == ptype:
            ci.add(x["contest"])
            for w in words:
                if (w, x["contest"]) not in seen_i:
                    seen_i.add((w, x["contest"])); inside[w] += 1
        else:
            co.add(x["contest"])
            for w in words:
                if (w, x["contest"]) not in seen_o:
                    seen_o.add((w, x["contest"])); outside[w] += 1
    ni, no = max(len(ci), 1), max(len(co), 1)
    res = []
    for w, a in inside.items():
        if a < min_docs:
            continue
        b = outside[w]
        lift = ((a + 0.5) / (ni + 1)) / ((b + 0.5) / (no + 1))
        res.append((lift, w, a, b))
    return sorted(res, key=lambda r: -r[0])[:top]


def best(rows, ptype, n=12, solo_only=True):
    """Самые дорогие находки этого типа — дословно. Это и есть справочник."""
    v = [x for x in rows if x["ptype"] == ptype]
    if solo_only:
        v = [x for x in v if x["n"] <= 2]
    return sorted(v, key=lambda x: -x["pay"])[:n]
