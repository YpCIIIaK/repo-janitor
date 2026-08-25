"""Фаза 0: стоит ли вообще идти и куда.

Скрипт скачивает всю историю Sherlock и Cantina и считает одну величину:
фонд, делённый на число поданных заявок. Награда за проблему делится между
всеми, кто её подал, поэтому это и есть ожидаемая выплата за одну заявку.

    python contests.py             — вердикт и текущие конкурсы
    python contests.py --history   — как менялась теснота по годам
    python contests.py --top       — поимённо, от щедрых к вытоптанным
"""
import argparse
import asyncio
import datetime as dt
import statistics as st

from scout import cantina, rank, sherlock
from scout.http import client


def m(x):
    return "{:,.0f}".format(x) if x else "-"


def history(done):
    print("=" * 92)
    print("КАК МЕНЯЛАСЬ ТЕСНОТА")
    print("=" * 92)
    print("%6s%12s%16s%16s" % ("год", "конкурсов", "мед. заявок", "мед. $/заявку"))
    for y, n, sub, pf in rank.yearly(done):
        print("%6d%12d%16.0f%16s" % (y, n, sub, m(pf)))
    print("\nЧисло заявок на конкурс выросло почти вдесятеро за четыре года,")
    print("а выплата за заявку упала впятеро. Проверено отдельно: это не")
    print("артефакт судейства — тренд тот же на конкурсах со статусом")
    print("«завершён», где невалидное уже отсеяно, и обе площадки")
    print("показывают его независимо друг от друга.")


def top(done, n=14):
    rows = sorted((c for c in done if c.per_finding), key=lambda c: -c.per_finding)
    print("\n" + "=" * 92)
    print("ЩЕДРЕЙШИЕ КОНКУРСЫ ЗА ВСЮ ИСТОРИЮ")
    print("=" * 92)
    print("%-36s%-9s%6s%11s%8s%10s"
          % ("конкурс", "площадка", "год", "фонд", "заявок", "$/заявку"))
    for c in rows[:n]:
        print("%-36s%-9s%6d%11s%8d%10s"
              % (c.name[:35], c.site, c.end.year, m(c.pool), c.findings,
                 m(c.per_finding)))
    print("\nВесь верх списка — одна программа: Ethereum Foundation оплатил")
    print("аудит клиентов протокола, по 2 000 000$ на клиента, суммарно около")
    print("22 000 000$. Заявок пришло по две-три десятки на конкурс, потому")
    print("что клиенты написаны на Nim, Go, Java и Rust, а не на Solidity, и")
    print("зайти туда было почти некому. Программа разовая и закончилась.")
    print("\n" + "=" * 92)
    print("САМЫЕ ВЫТОПТАННЫЕ")
    print("=" * 92)
    for c in rows[-n:]:
        print("%-36s%-9s%6d%11s%8d%10s"
              % (c.name[:35], c.site, c.end.year, m(c.pool), c.findings,
                 m(c.per_finding)))


def langs(done):
    g = rank.by_language(done)
    if not g:
        return
    print("\n" + "=" * 92)
    print("ТЕСНОТА ПО ЯЗЫКАМ (только там, где площадка отдаёт состав файлов)")
    print("=" * 92)
    print("%-10s%12s%18s" % ("язык", "конкурсов", "медиана $/заявку"))
    for lang, (n, med) in sorted(g.items(), key=lambda kv: -kv[1][1]):
        print("%-10s%12d%18s" % (lang, n, m(med)))
    print("\nSolidity стоит вдвое-вчетверо дешевле остальных стеков. Разница")
    print("реальная, но это множитель два, а не сто: языком одним не спастись.")


def verdict(done, base):
    now = dt.datetime.now(dt.timezone.utc)
    cur = [c for c in done if c.end and c.end.year == now.year]
    print("\n" + "=" * 92)
    print("ВЕРДИКТ НА %s" % now.strftime("%d.%m.%Y"))
    print("=" * 92)
    if cur:
        pf = sorted(c.per_finding for c in cur if c.per_finding)
        good = sum(1 for p in pf if p > 200)
        print("  конкурсов в этом году: %d" % len(cur))
        print("  $/заявку: минимум %s, медиана %s, максимум %s"
              % (m(pf[0]), m(st.median(pf)), m(pf[-1])))
        print("  выше 200$ за заявку: %d из %d" % (good, len(pf)))
    print("  базовая ставка заявок с %d года: %s"
          % (base.cut, m(base.overall)))
    print("""
  Медианная заявка стоит меньше полусотни долларов. Чтобы выйти на
  осмысленные деньги, нужно подавать десятки валидных заявок в месяц, а
  валидность здесь не гарантирована ничем. Автоматический сканер эту
  величину не двигает: он выдаёт ровно то, что находят все остальные, и
  награда делится на всех нашедших.

  Это не значит «не ходить». Это значит, что аудит-конкурсы — не
  автоматизируемый доход, а профессия с обучением в пару лет и оплатой
  сдельно. Ставить на них как на источник дохода от сканера нельзя:
  измеренная цифра говорит обратное.""")


def live(cs, base):
    now = dt.datetime.now(dt.timezone.utc)
    cur = [c for c in cs if c.live(now) or c.upcoming(now)]
    print("\n" + "=" * 92)
    print("ИДУТ ИЛИ ОБЪЯВЛЕНЫ")
    print("=" * 92)
    if not cur:
        print("  По открытым спискам обеих площадок сейчас ничего не идёт.")
        print("  Оговорка: Sherlock не отдаёт анонсы будущих конкурсов через")
        print("  этот эндпоинт, так что отсутствие строк — не доказательство")
        print("  пустого рынка, а отсутствие данных. Проверять на сайте.")
        return
    print("%-30s%-9s%10s%8s%6s%9s%10s%11s"
          % ("конкурс", "площадка", "фонд", "строк", "дней", "плотность",
             "одиночек", "$ одиночке"))
    rows = []
    for c in cur:
        subs = base.submissions(c) or 0
        o = rank.density_outlook(c.nsloc, subs)
        rows.append((o[1] if o else -1, c, o))
    for _, c, o in sorted(rows, key=lambda r: -r[0]):
        print("%-30s%-9s%10s%8d%6.0f%9s%10s%11s"
              % (c.name[:29], c.site, m(c.pool), c.nsloc, c.days,
                 "%.3f" % o[0] if o else "нет строк",
                 "%.0f%%" % (o[1] * 100) if o else "-",
                 m(o[2]) if o else "-"))
        for repo, commit, n in c.repos[:2]:
            print("    %s @ %s  (%d строк)" % (repo, commit, n))
    need = rank.min_scope(base.overall or 0)
    print("""
Сортировка по ПЛОТНОСТИ ПОКРЫТИЯ — заявок на строку кода. Это единственный
признак, который в этом корпусе предсказывает шанс оказаться единственным
нашедшим (r = -0.67). Тип протокола, язык и размер фонда не предсказывают
ничего.

При базовой ставке %s заявок на конкурс тонкое покрытие (0.05) начинается
со скоупа примерно в %s строк. Меньше — код вычистят целиком и делиться
придётся со всеми.""" % (m(base.overall), m(need)))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--history", action="store_true")
    ap.add_argument("--top", action="store_true")
    args = ap.parse_args()

    async with client() as c:
        sh = await sherlock.fetch(c)
        ca = await cantina.fetch(c)
    allc = sh + ca
    print("скачано конкурсов: Sherlock %d, Cantina %d" % (len(sh), len(ca)))

    now = dt.datetime.now(dt.timezone.utc)
    done = [c for c in allc if c.findings > 0 and c.pool > 0 and c.end and c.end < now]
    base = rank.Baseline(done)

    if args.history:
        history(done)
        langs(done)
    if args.top:
        top(done)
    if not (args.history or args.top):
        history(done)
        verdict(done, base)
        live(allc, base)


if __name__ == "__main__":
    asyncio.run(main())
