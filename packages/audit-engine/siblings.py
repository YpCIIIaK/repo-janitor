# -*- coding: utf-8 -*-
"""БЕЛАЯ ВОРОНА: одна реализация из семьи сделана иначе, чем остальные.

Зачем. Обе настоящие находки проекта пришли ровно отсюда, и обе — руками:

* agglayer: у `receive()` сняли `nonReentrant`, а `whenNotPaused` в той же
  строке остался. Родня — те же `receive()` у соседних мостов;
* Reserve, `SDaiCollateral`: единственный из ПЯТИ братьев зовёт `pot.drip()`
  без try-catch, хотя остальные четыре обёрнуты.

Оба раза сигналом было не «код плохой», а «код ОТЛИЧАЕТСЯ от родни». Это
механизируется: сгруппировать одноимённые функции по семьям (общая база или
общий каталог) и найти признак, который есть у всех, кроме одного, — или
есть ровно у одного.

Почему это сильный сигнал именно для баунти. Аудитор читает файл. Мы
сравниваем файлы МЕЖДУ СОБОЙ, а на это у аудитора нет ни времени, ни
инструмента: расхождение видно только когда пять реализаций лежат рядом в
одной таблице. Конкурентов здесь нет по построению — они читают, а не
сравнивают.

ЧЕГО ИНСТРУМЕНТ НЕ ЗНАЕТ. Асимметрия чаще ОПРАВДАНА, чем ошибочна: у брата
другая семантика, и модификатор снят осознанно. Инструмент даёт не находки,
а очередь вопросов «почему здесь иначе». Отдача ожидается на уровне приёма
«недочиненная половина», то есть единицы процентов, — но вопросы дешёвые,
каждый закрывается взглядом на одну строку.

использование:
    siblings.py <корень исходников> [--min 3] [--dir] [--all]

    --min N   минимальный размер семьи (по умолчанию 3)
    --dir     семьи по каталогу, а не только по общей базе
    --all     показывать и слабые расхождения (тело/require)
"""
import os
import re
import sys
from collections import defaultdict

import solsrc

# Признаки тела, которые стоит сравнивать между братьями. Каждый — про
# защиту или про обработку отказа, то есть ровно про то, где отсутствие у
# одного из родни означает дыру.
BODY_MARKS = [
    ("try/catch",      re.compile(r"\btry\s")),
    ("unchecked",      re.compile(r"\bunchecked\s*\{")),
    ("require",        re.compile(r"\brequire\s*\(")),
    ("revert",         re.compile(r"\brevert\s")),
    ("assembly",       re.compile(r"\bassembly\s*\{")),
    ("safeTransfer",   re.compile(r"\bsafeTransfer\w*\s*\(")),
    ("низкоуровневый вызов",
     re.compile(r"\.(?:call|delegatecall|staticcall)\s*[({]")),
    ("проверка нуля",  re.compile(r"==\s*0\b|!=\s*0\b|address\(0\)")),
]

# Общие модификаторы-обёртки, снятие которых у одного из родни — самое
# ценное, что этот инструмент умеет находить.
WEIGHTY = re.compile(
    r"only|auth|role|guard|nonReentrant|whenNot|whenPaused|paused|"
    r"restricted|permission|admin|owner|gated", re.I)


def families(cons, by_dir=False, min_size=3):
    """Семьи контрактов: по общей базе, при --dir ещё и по каталогу."""
    fam = defaultdict(list)
    for c in cons:
        if c.kind == "interface":
            continue
        for b in c.bases:
            fam["base:" + b].append(c)
        if by_dir:
            fam["dir:" + os.path.dirname(c.path)].append(c)
    return {k: v for k, v in fam.items() if len(v) >= min_size}


def marks_of(f):
    """Множество признаков одной функции: модификаторы + метки тела."""
    s = set("mod:" + m for m in f.mods)
    for name, rx in BODY_MARKS:
        if rx.search(f.body or ""):
            s.add("тело:" + name)
    return s


def odd_ones(group):
    """Признаки, которые есть у всех кроме одного — или ровно у одного."""
    n = len(group)
    cnt = defaultdict(list)
    for f in group:
        for m in marks_of(f):
            cnt[m].append(f)
    out = []
    for mark, owners in cnt.items():
        k = len(owners)
        if k == n - 1 and n >= 3:
            missing = [f for f in group if f not in owners][0]
            out.append(("НЕТ", mark, missing, k, n))
        elif k == 1 and n >= 3:
            out.append(("ТОЛЬКО У", mark, owners[0], k, n))
    return out


def weight(kind, mark):
    """Порядок чтения. Снятая обёртка-разрешение — вперёд всего."""
    w = 0.0
    if mark.startswith("mod:"):
        w += 2.0
        if WEIGHTY.search(mark):
            w += 3.0
    else:
        w += 1.0
        if "try/catch" in mark or "низкоуровневый" in mark:
            w += 1.5
    if kind == "НЕТ":
        w += 1.0          # «у всех есть, а тут нет» сильнее, чем наоборот
    return w


def run(root, min_size=3, by_dir=False, show_weak=False):
    cons = solsrc.parse_tree(root)
    if not cons:
        print("контрактов не найдено под %s" % root)
        return
    fam = families(cons, by_dir, min_size)
    print("=" * 78)
    print("контрактов %d, семей размера >=%d: %d"
          % (len(cons), min_size, len(fam)))
    print("=" * 78)

    seen = set()
    rows = []
    for fname, members in sorted(fam.items()):
        # одноимённые функции внутри семьи
        byname = defaultdict(list)
        for c in members:
            for f in c.funcs:
                if f.kind == "modifier":
                    continue
                byname[(f.name, f.arity)].append(f)
        for (name, arity), group in byname.items():
            # один контракт — один голос: перегрузки и повторы не считаем
            uniq, seen_c = [], set()
            for f in group:
                if f.contract not in seen_c:
                    seen_c.add(f.contract)
                    uniq.append(f)
            if len(uniq) < min_size:
                continue
            for kind, mark, who, k, n in odd_ones(uniq):
                w = weight(kind, mark)
                if not show_weak and w < 3.0:
                    continue
                key = (who.contract, who.name, mark, kind)
                if key in seen:
                    continue
                seen.add(key)
                rows.append({
                    "w": w, "kind": kind, "mark": mark, "who": who,
                    "fam": fname, "name": name, "n": n,
                    "peers": [f for f in uniq if f is not who],
                })

    rows.sort(key=lambda r: -r["w"])
    if not rows:
        print("расхождений не найдено — либо семья ровная, либо разбор пуст")
        return

    for r in rows:
        who = r["who"]
        print("\n[%.1f] %s  %s  %s()"
              % (r["w"], r["kind"], r["mark"], r["name"]))
        print("      белая ворона: %s  %s:%d"
              % (who.contract, solsrc.rel(who.path, root), who.line))
        print("      семья %s, всего %d" % (r["fam"], r["n"]))
        peers = ", ".join("%s:%d" % (p.contract, p.line) for p in r["peers"][:6])
        print("      родня: %s" % peers)
        if who.mods:
            print("      её модификаторы: %s" % " ".join(who.mods))

    print("\n" + "-" * 78)
    print("Читать сверху. Вопрос к каждой строке ОДИН: почему здесь иначе?")
    print("Ответ «у неё другая семантика» закрывает строку за секунды —")
    print("и это нормальный исход для большинства. Держать в LEDGER только")
    print("те, где ответа не нашлось.")


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    root = a[0]
    min_size = 3
    if "--min" in a:
        min_size = int(a[a.index("--min") + 1])
    run(root, min_size, "--dir" in a, "--all" in a)


if __name__ == "__main__":
    main()
