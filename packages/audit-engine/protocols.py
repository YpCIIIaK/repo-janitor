"""Справочник по типам протоколов, собранный из 2937 находок 235 отчётов.

Не пересказ статей. Каждая цифра здесь получена из отчётов площадок:
у каждой находки известны уровень, число нашедших и доля фонда.

    python protocols.py                 сводка по типам протоколов
    python protocols.py --type кредит   механики и дорогие находки этого типа
    python protocols.py --list          какие типы вообще есть

Работает офлайн по data/cache, сети не требует.
"""
import argparse

from scout import domains


def overview(rows):
    s = domains.summary(rows)
    print("=" * 104)
    print("ГДЕ ЖИВУТ ДЕНЬГИ ПО ТИПАМ ПРОТОКОЛОВ")
    print("=" * 104)
    print("%-16s%10s%10s%10s%12s%14s%10s"
          % ("тип", "конкурсов", "находок", "доля High", "одиночек",
             "мед. выплата", "у одиночек"))
    print("-" * 104)
    tot = sum(v["n"] for v in s.values())
    for t, v in sorted(s.items(), key=lambda kv: -kv[1]["solo_pay"]):
        print("%-16s%10d%10d%9.0f%%%11.0f%%%14s%10s"
              % (t, v["contests"], v["n"], v["high"] * 100, v["solo"] * 100,
                 "{:,.0f}".format(v["pay"]), "{:,.0f}".format(v["solo_pay"])))
    print("-" * 104)
    print("всего находок: %d\n" % tot)
    print("""Колонка «у одиночек» — медиана выплаты за находку, которую подал
ровно один человек. Это и есть цена входа в тему: чем выше, тем дороже
стоит знание предметной области, потому что остальные туда не дошли.""")


def detail(rows, ptype):
    s = domains.summary(rows).get(ptype)
    if not s:
        print("тип «%s» не найден. Список: python protocols.py --list" % ptype)
        return
    print("=" * 104)
    print("ТИП: %s" % ptype.upper())
    print("=" * 104)
    print("конкурсов %d, находок %d, доля High %.0f%%, одиночек %.0f%%"
          % (s["contests"], s["n"], s["high"] * 100, s["solo"] * 100))
    print("медиана выплаты %s$, у одиночек %s$\n"
          % ("{:,.0f}".format(s["pay"]), "{:,.0f}".format(s["solo_pay"])))

    print("-" * 104)
    print("ЧТО ЛОМАЕТСЯ ИМЕННО ЗДЕСЬ")
    print("-" * 104)
    print("слова из заголовков, характерные для этого типа и редкие в остальных")
    print("(счёт по конкурсам, не по находкам)\n")
    m = domains.mechanics(rows, ptype)
    for i in range(0, len(m), 2):
        pair = m[i:i + 2]
        print("  " + "".join("%-24s x%-6.1f" % (w, lift) for lift, w, a, b in pair))

    print("\n" + "-" * 104)
    print("САМЫЕ ДОРОГИЕ НАХОДКИ, КОТОРЫЕ УВИДЕЛИ ОДИН-ДВА ЧЕЛОВЕКА")
    print("-" * 104)
    print("это и есть справочник: не «бывает reentrancy», а что реально ломалось\n")
    for x in domains.best(rows, ptype):
        print("  [%s] %s$  нашли %d  — %s"
              % (x["sev"], "{:,.0f}".format(x["pay"]), x["n"], x["contest"][:34]))
        print("      %s" % x["title"][:150])
        files = ", ".join(sorted(x["files"])[:3])
        if files:
            print("      файлы: %s" % files[:96])
        print()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--type", help="тип протокола")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    rows = domains.findings_by_type()
    if not rows:
        print("кэш пуст, запусти contests.py")
        return
    if args.list:
        for t in sorted(domains.summary(rows)):
            print(" ", t)
    elif args.type:
        detail(rows, args.type)
    else:
        overview(rows)


if __name__ == "__main__":
    main()
