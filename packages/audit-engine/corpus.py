"""Фаза 3: корпус находок. Что пропускают все остальные.

Работает офлайн по кэшу, сети не требует.

    python corpus.py              классы находок по доле одиночек
    python corpus.py --solo       заголовки находок, которые нашёл один человек
    python corpus.py --mass       и наоборот, что находят все
    python corpus.py --words      слова, отличающие одиночек от массовых
"""
import argparse
import collections
import math
import re
import statistics as st

from scout import corpus


def table(fs):
    print("=" * 96)
    print("КЛАССЫ НАХОДОК: ГДЕ НЕ ПРИХОДИТСЯ ДЕЛИТЬСЯ")
    print("=" * 96)
    g = corpus.by_class(fs)
    print("%-20s%10s%12s%14s%14s" %
          ("класс", "находок", "одиночек", "мед. нашедших", "мед. выплата"))
    print("-" * 96)
    for cl, (n, solo, medn, pay) in sorted(g.items(), key=lambda kv: -kv[1][1]):
        print("%-20s%10d%11.0f%%%14.0f%14s"
              % (cl, n, solo * 100, medn, "{:,.0f}".format(pay)))
    print("""
Читать так: высокая доля одиночек означает, что этот класс остальные
пропускают. Низкая — что он в чек-листе у всех и делится на десятки человек.
Деньги не в редких классах сами по себе, а в редких классах с приличной
выплатой.""")


def solo(fs, n=30, want_solo=True):
    v = [x for x in fs if (x["n"] == 1 if want_solo else x["n"] >= 20)]
    v.sort(key=lambda x: -x["pay"])
    print("=" * 96)
    print("НАШЁЛ ОДИН ЧЕЛОВЕК" if want_solo else "НАШЛИ ВСЕ (20+ человек)")
    print("=" * 96)
    print("всего таких находок: %d" % len(v))
    for x in v[:n]:
        print("\n  %s-  %s$  нашли %d  [%s]"
              % (x["sev"], "{:,.0f}".format(x["pay"]), x["n"], ", ".join(x["classes"])))
        print("  %s" % x["title"][:150])
        print("  конкурс: %s" % x["contest"])


def words(fs, top=26):
    """Какие слова в заголовке отличают одиночную находку от массовой.

    ВАЖНО про методику. Первая версия считала частоту по находкам и выдала
    наверх `multiinvoker` — имя контракта из одного конкурса, где один
    человек нашёл девять проблем подряд. Находки внутри конкурса не
    независимы, и счёт по находкам ловит именно это, а не общее правило.

    Поэтому слово считается один раз на конкурс: в скольких РАЗНЫХ конкурсах
    оно встретилось у одиночек и в скольких у массовых. Имя одного протокола
    даёт единицу и наверх больше не всплывает.
    """
    STOP = set("""the a an to of in and or is are be by for with that this it as on
    from can will not no if when at any all which does do has have been than then
    their there they them these those into more most some such only other""".split())
    cs, cm = collections.Counter(), collections.Counter()
    solo_c, mass_c = set(), set()
    seen_s, seen_m = set(), set()
    for x in fs:
        w = {t for t in re.findall(r"[a-z]{4,}", x["title"].lower()) if t not in STOP}
        if x["n"] == 1:
            solo_c.add(x["contest"])
            for t in w:
                if (t, x["contest"]) not in seen_s:
                    seen_s.add((t, x["contest"])); cs[t] += 1
        elif x["n"] >= 5:
            mass_c.add(x["contest"])
            for t in w:
                if (t, x["contest"]) not in seen_m:
                    seen_m.add((t, x["contest"])); cm[t] += 1
    ns, nm = len(solo_c), len(mass_c)
    print("=" * 96)
    print("СЛОВА, ОТЛИЧАЮЩИЕ ОДИНОЧНУЮ НАХОДКУ ОТ МАССОВОЙ")
    print("=" * 96)
    print("считается по конкурсам, не по находкам: одиночных %d, массовых %d\n"
          % (ns, nm))
    rows = []
    for w in set(cs) | set(cm):
        a, b = cs[w], cm[w]
        if a + b < 10:
            continue
        lift = ((a + 0.5) / (ns + 1)) / ((b + 0.5) / (nm + 1))
        rows.append((lift, w, a, b))
    rows.sort(key=lambda r: -r[0])
    print("%-22s%8s%10s%10s" % ("слово", "лифт", "конк.один", "конк.масс"))
    print("  чаще у ОДИНОЧЕК — сюда мало кто смотрит:")
    for lift, w, a, b in rows[:top // 2]:
        print("%-22s%8.1f%10d%10d" % ("  " + w, lift, a, b))
    print("\n  чаще у МАССОВЫХ — это найдут и без тебя:")
    for lift, w, a, b in rows[-top // 2:]:
        print("%-22s%8.1f%10d%10d" % ("  " + w, lift, a, b))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo", action="store_true")
    ap.add_argument("--mass", action="store_true")
    ap.add_argument("--words", action="store_true")
    ap.add_argument("--n", type=int, default=30)
    args = ap.parse_args()

    cs = corpus.load_offline()
    fs = corpus.findings(cs)
    print("карточек в кэше: %d, конкурсов с отчётом: %d, находок разобрано: %d"
          % (len(cs), len({x["contest"] for x in fs}), len(fs)))
    if not fs:
        print("\nКэш пуст. Запусти сначала contests.py, он скачает карточки.")
        return
    sev = collections.Counter(x["sev"] for x in fs)
    print("по уровням: %s\n" % dict(sev.most_common()))

    if args.solo:
        solo(fs, args.n, True)
    elif args.mass:
        solo(fs, args.n, False)
    elif args.words:
        words(fs)
    else:
        table(fs)


if __name__ == "__main__":
    main()
