# -*- coding: utf-8 -*-
"""ЗАБЫТЫЙ СПУТНИК: переменные, которые всегда пишут вместе, — а тут не все.

Откуда приём. Эмпирическое исследование 116 реальных дефектов класса
«inconsistent state update» в 352 протоколах за 2021–2024 (arXiv 2508.06192)
разложило их по корневым причинам:

    47%  забыли обновить зависимую переменную в многошаговой операции
    34%  логика обновления неверна (порядок, условие)
    10%  нужной переменной нет вовсе
     8%  нет инициализации/переинициализации

Главное для нас в этой работе — её же вывод: этот класс «крайне трудно
аудировать существующими автоматическими средствами». Slither его не ищет:
там нет ни опасного вызова, ни known-паттерна, есть только пропуск. А 47% —
это ровно та форма, которая берётся СЧЁТОМ, без понимания смысла: если A и B
пишутся вместе в трёх функциях, а в четвёртой пишется только A, — вопрос
задан механически.

Второй способ выхлопа — ранний выход: `return` посреди функции, после
которого остальные записи не выполняются. В исследовании это отдельная
подпричина того же 47-процентного класса.

ЧЕГО ИНСТРУМЕНТ НЕ ЗНАЕТ. Он не различает «забыли» и «не нужно»: сеттер,
который по смыслу трогает одно поле, попадёт в вывод. Поэтому порог
поддержки (в скольких функциях пара ходит вместе) — главная ручка, и
поднимать её дешевле, чем читать вывод.

использование:
    statesync.py <корень исходников> [--support 3] [--file X.sol] [--early]

    --support N  пара считается связкой, если ходит вместе в N функциях (3)
    --file X     только этот файл
    --early      ещё и ранние выходы посреди записи состояния
"""
import os
import re
import sys
from collections import defaultdict

import solsrc

# Формы записи в переменную состояния.
def writes_of(body, names):
    """Множество имён из `names`, в которые эта функция ПИШЕТ."""
    out = set()
    for n in names:
        pat = (r"\b%s\b\s*(?:\[[^\]]*\]|\.\w+)*\s*"
               r"(?:=(?!=)|\+=|-=|\*=|/=|\|=|&=|\+\+|--)" % re.escape(n))
        if re.search(pat, body):
            out.add(n)
            continue
        if re.search(r"\bdelete\s+%s\b" % re.escape(n), body):
            out.add(n)
            continue
        if re.search(r"\b%s\b\s*(?:\[[^\]]*\])*\s*\.(?:push|pop)\s*\(" %
                     re.escape(n), body):
            out.add(n)
    return out


def reads_of(body, names):
    out = set()
    for n in names:
        if re.search(r"\b%s\b" % re.escape(n), body):
            out.add(n)
    return out


EARLY = re.compile(r"\breturn\b\s*;|\breturn\b\s+[^;]{0,80};")


def analyse(contracts, support=3):
    """Для каждого контракта — пары-связки и функции, где связка разорвана."""
    res = []
    for c in contracts:
        names = [v for v in set(c.vars) if len(v) > 2]
        if len(names) < 2:
            continue
        writers = []
        for f in c.funcs:
            if f.kind == "modifier" or not f.body:
                continue
            w = writes_of(f.body, names)
            if w:
                writers.append((f, w))
        if len(writers) < support + 1:
            continue

        # сколько раз пара переменных писалась вместе
        together = defaultdict(int)
        alone = defaultdict(list)
        for f, w in writers:
            ws = sorted(w)
            for i, a in enumerate(ws):
                for b in ws[i + 1:]:
                    together[(a, b)] += 1
        for f, w in writers:
            for (a, b), k in together.items():
                if k < support:
                    continue
                if a in w and b not in w:
                    alone[(a, b, "нет " + b)].append(f)
                elif b in w and a not in w:
                    alone[(a, b, "нет " + a)].append(f)

        for (a, b, missing), fs in alone.items():
            k = together[(a, b)]
            # чем больше связка подтверждена и чем реже разорвана, тем выше
            if len(fs) > k:
                continue
            miss = missing[4:]
            for f in fs:
                # если пропущенная переменная в функции даже не ЧИТАЕТСЯ —
                # сигнал сильнее: про неё не подумали вовсе.
                touched = bool(re.search(r"\b%s\b" % re.escape(miss), f.body))
                res.append({
                    "w": k / float(len(fs)) + (0 if touched else 1.0),
                    "contract": c, "func": f, "pair": (a, b),
                    "missing": miss, "support": k, "breaks": len(fs),
                    "touched": touched,
                })
    res.sort(key=lambda r: -r["w"])
    return res


def early_exits(contracts, root):
    """Функции, где `return` стоит ПОСРЕДИ записей состояния."""
    out = []
    for c in contracts:
        names = [v for v in set(c.vars) if len(v) > 2]
        if not names:
            continue
        for f in c.funcs:
            if f.kind == "modifier" or not f.body or "return" not in f.body:
                continue
            w = writes_of(f.body, names)
            if len(w) < 2:
                continue
            for m in EARLY.finditer(f.body):
                before = f.body[:m.start()]
                after = f.body[m.end():]
                wb = writes_of(before, names)
                wa = writes_of(after, names)
                skipped = wa - wb
                if wb and skipped:
                    out.append({
                        "contract": c, "func": f,
                        "done": sorted(wb), "skipped": sorted(skipped),
                        "line": f.line + before.count("\n"),
                    })
                    break
    return out


def run(root, support=3, only=None, do_early=False):
    if os.path.isfile(root):
        cons, root = solsrc.parse_file(root), os.path.dirname(root)
    else:
        cons = solsrc.parse_tree(root)
    if only:
        cons = [c for c in cons if os.path.basename(c.path) == only]
    print("=" * 78)
    print("контрактов %d, порог связки %d" % (len(cons), support))
    print("=" * 78)

    rows = analyse(cons, support)
    if not rows:
        print("связок с разрывом не найдено")
    for r in rows[:60]:
        a, b = r["pair"]
        f = r["func"]
        print("\n[%.1f] %s: пишет %s, но НЕ %s"
              % (r["w"], f.name, a if r["missing"] == b else b, r["missing"]))
        print("      связка (%s, %s) подтверждена в %d функциях, разорвана в %d"
              % (a, b, r["support"], r["breaks"]))
        print("      %s  %s:%d"
              % (r["contract"].name, solsrc.rel(f.path, root), f.line))
        if not r["touched"]:
            print("      %s в этой функции не упоминается ВОВСЕ" % r["missing"])

    if do_early:
        ee = early_exits(cons, root)
        print("\n" + "=" * 78)
        print("РАННИЕ ВЫХОДЫ посреди записи состояния — %d" % len(ee))
        for e in ee[:40]:
            print("\n  %s.%s  %s:%d"
                  % (e["contract"].name, e["func"].name,
                     solsrc.rel(e["func"].path, root), e["line"]))
            print("     до return записаны: %s" % ", ".join(e["done"]))
            print("     после return остались: %s" % ", ".join(e["skipped"]))

    print("\n" + "-" * 78)
    print("Вопрос к строке: инвариант между этими переменными существует?")
    print("Если да — разрыв и есть дефект, и он ПОЧТИ ВСЕГДА обналичивается")
    print("повтором вызова или ценой (56% случаев в исследовании — ошибка")
    print("счёта, 23% — повторная транзакция).")


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    support = int(a[a.index("--support") + 1]) if "--support" in a else 3
    only = a[a.index("--file") + 1] if "--file" in a else None
    run(a[0], support, only, "--early" in a)


if __name__ == "__main__":
    main()
