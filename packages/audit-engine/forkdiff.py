# -*- coding: utf-8 -*-
"""ЧУЖОЙ КОД, ПОДПРАВЛЕННЫЙ СВОЕЙ РУКОЙ: диффы форка против первоисточника.

Зачем. Форк аудирован дважды и не аудирован ни разу. Читающий видит знакомый
`UniswapV2Pair` или `Comptroller`, узнаёт его и проскакивает — файл же
известный, его проверяли годами. А правки в нём не проверял никто: аудитор
первоисточника их не видел (их тогда не было), аудитор форка счёл файл
чужим и зрелым.

История это подтверждает крупно. Uranium Finance — форк с изменённой
константой в формуле. Merlin Lab, Autoshark — форки PancakeBunny, взломанные
одинаково, по унаследованному и недоправленному куску. Общий вид всегда
один: строк изменено мало, а весь риск ровно в них.

Отсюда приём. Сопоставить дерево мишени с деревом первоисточника, оставить
файлы со сходством 55–99.5% и показать РОВНО ТО, ЧТО ИЗМЕНЕНО, отсортировав
по тому, насколько правка касается защиты. Идентичные файлы выбрасываются:
их закрывают аудиты первоисточника. Собственные файлы тоже выбрасываются —
это работа `blindspots.py`.

ГЛАВНЫЙ СИГНАЛ — МАЛЕНЬКИЙ ДИФФ В БОЛЬШОМ ЗНАКОМОМ ФАЙЛЕ. Чем меньше
изменено, тем сильнее иллюзия знакомости и тем меньше вероятность, что
кто-то читал эти строки внимательно.

ЧЕГО ИНСТРУМЕНТ НЕ ЗНАЕТ. Он не понимает, зачем правка сделана: смена
константы под другую сеть выглядит так же, как смена константы по ошибке.
И он не находит первоисточник сам — его надо назвать. Зато назвать обычно
легко: `package.json`, `remappings.txt`, `lib/` или просто имя контракта.

использование:
    forkdiff.py <корень мишени> <корень первоисточника>
    forkdiff.py <корень мишени> --gh Uniswap/v2-core[@ref]

    --min 0.55     нижний порог сходства (ниже — считаем своим кодом)
    --max 0.995    верхний (выше — считаем неизменённым)
    --show N       сколько файлов расписать построчно (по умолчанию 12)
    --all          показывать и правки без признаков защиты
"""
import difflib
import io
import os
import re
import sys
import tarfile

import solsrc

CACHE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                     "data", "upstream")

# --- вес правки ----------------------------------------------------------
# Порядок чтения задаётся тем, чего правка КОСНУЛАСЬ. Снятая проверка важнее
# добавленной: добавили — подумали, сняли — решили, что можно.

MARKS = [
    (6.0, "снята проверка",
     re.compile(r"require\s*\(|revert\s|assert\s*\(|\bif\s*\(")),
    (6.0, "снят модификатор",
     re.compile(r"\b(?:only\w+|nonReentrant|whenNotPaused|whenPaused|"
                r"auth|restricted|onlyOwner|onlyRole)\b")),
    (5.0, "видимость/мутабельность",
     re.compile(r"\b(?:public|external|internal|private|view|pure|payable)\b")),
    (4.5, "арифметика или константа",
     re.compile(r"\b\d{2,}\b|\*|/|<<|>>|1e\d+|\*\*")),
    (4.0, "внешний вызов",
     re.compile(r"\.(?:call|delegatecall|staticcall|transfer|transferFrom|"
                r"send)\s*[({]")),
    (3.5, "unchecked",
     re.compile(r"\bunchecked\b")),
    (3.0, "запись состояния",
     re.compile(r"^\s*[A-Za-z_]\w*(?:\[[^\]]*\])*\s*(?:=(?!=)|\+=|-=)")),
]


NOISE = re.compile(r"^\s*(?:import\b|pragma\b|//|/\*|\*)")


def norm_lines(path):
    """Строки без комментариев и без разницы в пробелах."""
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        src = fh.read()
    out = []
    for ln in solsrc.strip(src, strings=False).splitlines():
        s = re.sub(r"\s+", " ", ln).strip()
        if s:
            out.append(s)
    return out


def collect(root):
    """{относительный путь: (имя файла, строки)} по дереву .sol."""
    out = {}
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames
                       if d not in (".git", "node_modules", "out", "cache",
                                    "artifacts", "broadcast", "coverage")]
        for f in files:
            if not f.endswith(".sol") or re.search(r"\.(?:t|s)\.sol$", f):
                continue
            p = os.path.join(dirpath, f)
            try:
                out[solsrc.rel(p, root)] = (f, norm_lines(p))
            except Exception:
                pass
    return out


def fetch_gh(spec):
    """Скачать первоисточник с GitHub в кеш и вернуть корень."""
    import audits
    ref = "HEAD"
    if "@" in spec:
        spec, ref = spec.rsplit("@", 1)
    owner, _, repo = spec.partition("/")
    dst = os.path.join(CACHE, owner, "%s@%s" % (repo, ref))
    if os.path.isdir(dst) and os.listdir(dst):
        return _single_child(dst)
    os.makedirs(dst, exist_ok=True)
    url = "https://codeload.github.com/%s/%s/tar.gz/%s" % (owner, repo, ref)
    print("тяну %s ..." % url)
    blob = audits._get(url, raw=True, timeout=120)
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tf:
        members = [m for m in tf.getmembers()
                   if m.isfile() and m.name.endswith((".sol", ".json", ".txt"))]
        tf.extractall(dst, members=members)
    return _single_child(dst)


def _single_child(d):
    kids = [os.path.join(d, x) for x in os.listdir(d)]
    kids = [k for k in kids if os.path.isdir(k)]
    return kids[0] if len(kids) == 1 else d


def best_match(name, lines, up_by_name, up_all):
    """Файл первоисточника, ближайший к данному. Сначала по имени."""
    cands = up_by_name.get(name)
    if not cands:
        # переименовали — ищем по содержимому, но только среди похожих по
        # размеру, иначе перебор становится квадратичным и бессмысленным
        n = len(lines)
        cands = [p for p, (_, l) in up_all.items()
                 if n and 0.6 <= len(l) / float(n or 1) <= 1.6]
        cands = cands[:400]
    best, ratio = None, 0.0
    for p in cands:
        ul = up_all[p][1]
        sm = difflib.SequenceMatcher(None, lines, ul)
        if sm.real_quick_ratio() < ratio or sm.quick_ratio() < ratio:
            continue
        r = sm.ratio()
        if r > ratio:
            best, ratio = p, r
    return best, ratio


def score_hunks(up_lines, my_lines):
    """Изменённые куски и их вес. Возвращает (вес, список кусков)."""
    sm = difflib.SequenceMatcher(None, up_lines, my_lines)
    hunks, total = [], 0.0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            continue
        gone = up_lines[i1:i2]
        came = my_lines[j1:j2]
        # import и pragma не несут сигнала, но косыми в пути ловятся как
        # «арифметика» и забивают вывод. Показываем, но не взвешиваем.
        g_s = [l for l in gone if not NOISE.match(l)]
        c_s = [l for l in came if not NOISE.match(l)]
        why, w = [], 0.0
        for weight, label, rx in MARKS:
            hit_gone = any(rx.search(l) for l in g_s)
            hit_came = any(rx.search(l) for l in c_s)
            if not (hit_gone or hit_came):
                continue
            # исчезнувшая защита весит больше появившейся
            if hit_gone and not hit_came and weight >= 5.0:
                why.append(label + " ИСЧЕЗЛА")
                w = max(w, weight + 1.5)
            else:
                why.append(label)
                w = max(w, weight)
        hunks.append({"tag": tag, "gone": gone, "came": came,
                      "why": why, "w": w, "line": j1 + 1})
        total += w
    return total, hunks


def run(mine_root, up_root, lo=0.55, hi=0.995, show=12, show_all=False):
    mine = collect(mine_root)
    up = collect(up_root)
    if not mine or not up:
        print("пусто: мишень %d файлов, первоисточник %d" % (len(mine), len(up)))
        return
    up_by_name = {}
    for p, (n, _) in up.items():
        up_by_name.setdefault(n, []).append(p)

    print("=" * 78)
    print("мишень %d .sol, первоисточник %d .sol" % (len(mine), len(up)))
    print("=" * 78)

    same, own, forked = 0, 0, []
    for p, (name, lines) in sorted(mine.items()):
        if not lines:
            continue
        best, ratio = best_match(name, lines, up_by_name, up)
        if not best or ratio < lo:
            own += 1
            continue
        if ratio > hi:
            same += 1
            continue
        w, hunks = score_hunks(up[best][1], lines)
        # доля изменённых строк: чем МЕНЬШЕ, тем сильнее иллюзия знакомости
        changed = sum(len(h["came"]) for h in hunks)
        share = changed / float(len(lines))
        # приоритет = вес защиты, делённый на долю правок
        prio = w / max(share, 0.02) ** 0.5 if w else 0.0
        forked.append({"path": p, "up": best, "ratio": ratio, "w": w,
                       "share": share, "prio": prio, "hunks": hunks})

    forked.sort(key=lambda f: -f["prio"])
    print("идентичны первоисточнику: %d  (закрыты его аудитами)" % same)
    print("свой код (сходства нет):   %d  (это к blindspots.py)" % own)
    print("ФОРК С ПРАВКАМИ:           %d" % len(forked))
    if not forked:
        print("\nправленых файлов нет — либо не тот первоисточник, либо форк чистый")
        return

    print("\n" + "-" * 78)
    for f in forked[:show]:
        print("\n[%.0f] %s" % (f["prio"], f["path"]))
        print("     против %s — сходство %.1f%%, изменено %.1f%% строк"
              % (f["up"], f["ratio"] * 100, f["share"] * 100))
        hs = sorted([h for h in f["hunks"] if h["w"] or show_all],
                    key=lambda h: -h["w"])
        # Кандидат для runlog: путь:строка топ-хунка в формате, который ловит
        # hits_in — иначе правка форка не течёт в память как остальные сигналы.
        if hs:
            print("   ЦЕЛЬ %s:%d  (форк-правка, вес %.1f)"
                  % (f["path"], hs[0]["line"], hs[0]["w"]))
        for h in hs[:6]:
            why = ", ".join(dict.fromkeys(h["why"])) or "правка"
            print("     ~ %s  (вес %.1f, строка ~%d)" % (why, h["w"], h["line"]))
            for l in h["gone"][:3]:
                print("        - %s" % l[:96])
            for l in h["came"][:3]:
                print("        + %s" % l[:96])

    print("\n" + "-" * 78)
    print("Читать сверху: приоритет = вес правки, делённый на её долю.")
    print("Три строки, изменённые в файле на тысячу, — лучшая цель, какая")
    print("бывает: файл узнают в лицо и не перечитывают.")
    print("Пометка ИСЧЕЗЛА значит, что в первоисточнике проверка была, а тут")
    print("её нет. Это первое, что нужно объяснить.")


def main():
    a = sys.argv[1:]
    if len(a) < 2:
        print(__doc__)
        return
    mine = a[0]
    if "--gh" in a:
        up = fetch_gh(a[a.index("--gh") + 1])
    else:
        up = a[1]
    lo = float(a[a.index("--min") + 1]) if "--min" in a else 0.55
    hi = float(a[a.index("--max") + 1]) if "--max" in a else 0.995
    show = int(a[a.index("--show") + 1]) if "--show" in a else 12
    run(mine, up, lo, hi, show, "--all" in a)


if __name__ == "__main__":
    main()
