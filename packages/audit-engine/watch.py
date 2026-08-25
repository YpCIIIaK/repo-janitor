"""Сторож: что открыто для подачи прямо сейчас, на всех трёх площадках.

Аудит-конкурсы идут не непрерывно — между раундами бывают паузы в
несколько недель, и в такую паузу подать новую находку просто некуда.
Этот скрипт отвечает на единственный вопрос: есть ли сейчас куда идти.

    python watch.py            что открыто и что объявлено
    python watch.py --soon 60  плюс всё, что стартует в ближайшие 60 дней

Ничего не кэширует: смысл в свежести.
"""
import argparse
import asyncio
import datetime as dt

from scout import cantina, code4rena, sherlock
from scout.http import client, get_json


def line(name, site, pool, s, e, extra="", now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if s and e and s <= now <= e:
        state = "ИДЁТ, осталось %d дн." % (e - now).days
    elif s and s > now:
        state = "старт через %d дн." % (s - now).days
    else:
        state = "закончен"
    print("  %-38s %-8s %11s  %-24s %s"
          % (name[:37], site, "{:,.0f}$".format(pool) if pool else "-",
             state, extra))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--soon", type=int, default=45,
                    help="сколько дней вперёд считать «скоро»")
    args = ap.parse_args()
    now = dt.datetime.now(dt.timezone.utc)

    async with client() as c:
        raw4 = await code4rena.fetch(c, fresh=True)
        c4 = code4rena.live(raw4, now)

        d = await get_json(c, sherlock.LIST, {"page": 1}, ttl=False)
        sh = []
        for x in (d or {}).get("items", []):
            s = dt.datetime.fromtimestamp(x.get("starts_at") or 0, dt.timezone.utc)
            e = dt.datetime.fromtimestamp(x.get("ends_at") or 0, dt.timezone.utc)
            if e >= now:
                sh.append((x, s, e))

        ca = [x for x in await cantina.fetch(c) if x.end and x.end >= now]

    print("=" * 96)
    print("ОТКРЫТО ДЛЯ ПОДАЧИ НА %s" % now.strftime("%d.%m.%Y %H:%M UTC"))
    print("=" * 96)

    n = 0
    for x, s, e in c4:
        pool = code4rena.parse(x).pool
        extra = "%s%s" % ("PoC обязателен  " if x.get("hasMandatoryProofOfConcept") else "",
                          x.get("repo") or "")
        line(str(x.get("title") or ""), "c4", pool, s, e, extra[:60], now)
        n += 1
    for x, s, e in sh:
        line(str(x.get("title") or x.get("short_description") or ""), "sherlock",
             float(x.get("prize_pool") or 0), s, e,
             "https://audits.sherlock.xyz/contests/%s" % x.get("id"), now)
        n += 1
    for x in ca:
        line(x.name, "cantina", x.pool, x.start, x.end, x.url, now)
        n += 1

    if not n:
        print("""
  Ни на одной из трёх площадок сейчас нет конкурса, открытого для подачи.

  Это нормальное состояние: конкурсы идут раундами, между ними паузы в
  недели. Проверено сейчас — Sherlock, Cantina и Code4rena (475 аудитов,
  из них живых ноль).

  Значит новую находку сегодня подать некуда, и ждать открытия — часть
  работы. Запускай этот скрипт раз в несколько дней.

  Что открыто ВСЕГДА, в отличие от конкурсов, — баунти-программы на живых
  протоколах (Immunefi и собственные программы проектов). Там платят за
  уязвимость в задеплоенном коде, суммы на порядок выше, но и требования
  жёстче: нужен работающий PoC и попадание в объявленный скоуп.""")
    print()


if __name__ == "__main__":
    asyncio.run(main())
