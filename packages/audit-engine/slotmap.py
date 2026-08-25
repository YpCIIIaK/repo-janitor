# -*- coding: utf-8 -*-
"""СДВИГ РАСКЛАДКИ ХРАНИЛИЩА: апгрейд переставил слоты под прокси.

Зачем это отдельный сигнал. Прокси исполняет код реализации в СВОЁМ
хранилище. Если новая реализация переставила, вставила в середину или
сменила тип переменной состояния, то каждая переменная от точки сдвига и
ниже читает чужой слот. Классический исход — `owner` ложится на слот, куда
атакующий пишет через безобидный сеттер, и получает контракт целиком.

Почему берётся механически и почему это НАШ размер задачи. Раскладка — это
просто порядок объявления переменных состояния плюс их типы, с двумя
поправками: `constant` и `immutable` слотов НЕ занимают, а базовые контракты
ложатся ПЕРЕД производным в порядке наследования. Ни компиляции, ни solc для
этого не нужно — только разбор объявлений и линеаризация. Foundry и Hardhat
это умеют, но требуют собранного проекта; мы работаем по распакованному
дереву на закреплённой ревизии, где сборки нет.

Идеальная пара — с `deployed.py`: он уже достаёт и СТАРУЮ реализацию (из
зеркала или из Sourcify по прошлому адресу), и НОВУЮ (из прода). Скормить
обе сюда — и первая же разошедшаяся строка есть либо объяснимый
append-only, либо перехват.

ЧЕГО ИНСТРУМЕНТ НЕ ЗНАЕТ. Точную упаковку внутри слота (несколько мелких
типов в один слот) он не считает — только границы объявлений. Поэтому он
надёжно ловит СДВИГ (вставка/перестановка/удаление) и смену «влезающего» на
«не влезающий» тип, но не тонкую переупаковку двух uint128. Для перехвата
это и не нужно: перехват — всегда сдвиг.

использование:
    slotmap.py <корень>                      — печать раскладки контрактов
    slotmap.py <старый корень> <новый корень> --diff <Контракт>
    slotmap.py <корень> --contract <Имя>     — раскладка одного контракта
"""
import os
import re
import sys

import solsrc

# Размер типа в СЛОТАХ для грубой раскладки. Всё «влезающее» — 1 слот (мы не
# считаем упаковку). Массивы фиксированной длины и структуры оцениваем
# приблизительно; для сигнала «сдвиг» важнее ГРАНИЦА, а не точная ширина.
VALUE_1 = re.compile(
    r"^(?:address|bool|uint\d*|int\d*|bytes([1-9]|[12]\d|3[0-2])|"
    r"enum\b.*|contract\b.*|I[A-Z]\w*|[A-Z]\w*)$")
DYNAMIC = re.compile(r"^(?:mapping\b|string|bytes|.*\[\s*\])")   # 1 слот-голова


def var_type(decl):
    """Из объявления вытащить (тип, имя, флаги)."""
    d = decl.strip()
    is_const = bool(re.search(r"\bconstant\b", d))
    is_immut = bool(re.search(r"\bimmutable\b", d))
    # тип — всё до первого модификатора видимости/квалификатора или имени
    m = re.match(
        r"^\s*((?:mapping\s*\(.*?\)|[A-Za-z_][\w.]*)"
        r"(?:\s*\[[^\]]*\])*)\s+"
        r"(?:public\s+|private\s+|internal\s+|external\s+|constant\s+|"
        r"immutable\s+|transient\s+|override(?:\([^)]*\))?\s+)*"
        r"([A-Za-z_]\w*)\s*(?:=|;)", d, re.S)
    if not m:
        return None
    typ = re.sub(r"\s+", " ", m.group(1)).strip()
    return {"type": typ, "name": m.group(2),
            "const": is_const, "immut": is_immut}


# --- сбор переменных состояния В ПОРЯДКЕ ОБЪЯВЛЕНИЯ -----------------------
# solsrc отдаёт имена переменных, но для раскладки нужен ПОРЯДОК и ТИП, а
# также отсев constant/immutable. Разбираем тело контракта сами, пользуясь
# уже найденными границами функций из solsrc.


NOTVAR = re.compile(
    r"^\s*(?:function|constructor|receive|fallback|modifier|event|error|"
    r"struct|enum|using|type|import|pragma|contract|library|interface|"
    r"unchecked|abstract)\b")


def state_vars(contract):
    """Список переменных состояния контракта В ПОРЯДКЕ, только слот-несущие."""
    # тело контракта без тел функций
    body = contract.body
    spans = []
    for f in contract.funcs:
        # найдём тело функции в body по её сигнатуре — грубо, по имени и '{'
        pass
    # проще: пройти body, вырезая сбалансированные {...} блоков функций.
    depth = 0
    kept = []
    i, n = 0, len(body)
    buf = []
    while i < n:
        c = body[i]
        if c == "{":
            depth += 1
            i += 1
            continue
        if c == "}":
            depth -= 1
            i += 1
            continue
        if depth == 0:
            buf.append(c)
        i += 1
    flat = "".join(buf)
    out = []
    for stmt in flat.split(";"):
        s = stmt.strip()
        if not s or NOTVAR.match(s):
            continue
        vt = var_type(s + ";")
        if not vt or vt["const"] or vt["immut"]:
            continue
        out.append(vt)
    return out


def linearize(name, by_name, seen=None):
    """Базовые классы ПЕРЕД производным (порядок раскладки Solidity).

    Приближение к C3: обходим базы слева направо в глубину, каждый контракт
    один раз, самый базовый — первым. Для раскладки хранилища это и есть
    нужный порядок (Solidity: most-base-first)."""
    seen = seen if seen is not None else []
    c = by_name.get(name)
    if not c or name in [x.name for x in seen]:
        return seen
    for b in c.bases:
        linearize(b, by_name, seen)
    if name not in [x.name for x in seen]:
        seen.append(c)
    return seen


def layout(cname, by_name):
    """Полная раскладка: (слот, тип, имя, контракт-владелец)."""
    chain = linearize(cname, by_name)
    slots, idx = [], 0
    for c in chain:
        for v in state_vars(c):
            slots.append({"slot": idx, "type": v["type"], "name": v["name"],
                          "owner": c.name})
            idx += 1              # одна переменная — один слот (грубо)
    return slots


def load(root):
    cons = solsrc.parse_tree(root, skip_tests=True)
    by_name = {}
    for c in cons:
        by_name.setdefault(c.name, c)     # первый выигрывает
    return by_name


def print_layout(slots, title):
    print("\nРаскладка %s — %d слот-несущих переменных:" % (title, len(slots)))
    for s in slots:
        print("  [%3d] %-28s %-24s (%s)"
              % (s["slot"], s["type"], s["name"], s["owner"]))


def diff(old_slots, new_slots, cname):
    print("=" * 78)
    print("СДВИГ РАСКЛАДКИ %s: старая %d слотов, новая %d"
          % (cname, len(old_slots), len(new_slots)))
    print("=" * 78)
    n = max(len(old_slots), len(new_slots))
    first_shift = None
    for i in range(n):
        o = old_slots[i] if i < len(old_slots) else None
        nw = new_slots[i] if i < len(new_slots) else None
        on = "%s %s" % (o["type"], o["name"]) if o else "—"
        nn = "%s %s" % (nw["type"], nw["name"]) if nw else "—"
        same = o and nw and o["type"] == nw["type"] and o["name"] == nw["name"]
        # append-only: старого слота нет, новый добавлен в хвост — законно
        appended = (o is None and nw is not None)
        if same:
            continue
        mark = "  + добавлено в хвост (законно, если это append-only)" \
            if appended else "  !! СДВИГ"
        if not appended and first_shift is None:
            first_shift = i
        print("  [%3d] %-32s -> %-32s%s" % (i, on[:32], nn[:32], mark))

    print("-" * 78)
    if first_shift is None:
        print("Сдвига нет: все существовавшие слоты на местах. Изменения —")
        print("только добавления в хвост. Это безопасный апгрейд по раскладке.")
    else:
        print("ПЕРВЫЙ СДВИГ на слоте %d. Всё от него и ниже под прокси читает" % first_shift)
        print("чужой слот. Смотреть, какая переменная В СТАРОЙ версии стояла на")
        print("сдвинутых слотах и есть ли на неё внешний сеттер: если да — это")
        print("путь к перезаписи (в пределе — перехват owner). Это критично по")
        print("любой шкале, если контракт за прокси и апгрейд уже в проде.")


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    if "--diff" in a:
        cname = a[a.index("--diff") + 1]
        old_root, new_root = a[0], a[1]
        old = layout(cname, load(old_root))
        new = layout(cname, load(new_root))
        if not old or not new:
            print("контракт %s не найден в одном из деревьев (старое %d, новое %d)"
                  % (cname, len(old), len(new)))
            return
        diff(old, new, cname)
        return
    root = a[0]
    by_name = load(root)
    if "--contract" in a:
        cname = a[a.index("--contract") + 1]
        print_layout(layout(cname, by_name), cname)
        return
    # без флагов — печатаем раскладки всех НЕинтерфейсных контрактов с >0 слотов
    for name, c in sorted(by_name.items()):
        if c.kind == "interface":
            continue
        sl = layout(name, by_name)
        if sl:
            print_layout(sl, name)


if __name__ == "__main__":
    main()
