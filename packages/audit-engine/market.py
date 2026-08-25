"""Каталог баунти-программ всего мира, одной таблицей.

    python market.py                    смарт-контрактные программы, по тесноте
    python market.py --all              включая веб и приложения
    python market.py --site immunefi    только одна площадка
    python market.py --repos            только те, где есть публичный GitHub
    python market.py --id <часть имени> карточка: скоуп, репозитории, ссылка
    python market.py --refresh          перекачать и переписать data/market.json
    python market.py --next <имя>       что запускать по выбранной мишени

Снимок ложится в `data/market.json` и дальше читается оттуда: список
программ меняется неделями, а перекачка Immunefi это шесть мегабайт.

СОРТИРОВКА повторяет то, что измерено, а не то, что кажется:

  1. без комиссии за подачу и без KYC — выше (комиссия делает поданную
     наугад заявку убыточной, KYC отсекает выплату вообще);
  2. дальше по ПЛОТНОСТИ заявок на актив — единственный предиктор шанса
     оказаться единственным нашедшим (r = -0.67), меньше значит лучше;
  3. плотность неизвестна (Immunefi не публикует счёт заявок) — такие идут
     после известных малоплотных, но перед заведомо тесными. Пустое поле
     это незнание, а не ноль.

ЧЕГО ЗДЕСЬ НЕТ. Intigriti (нужен токен исследователя), HackerOne (каталог
без ключа не отдаётся), Bugcrowd (programs.json закрыт), Hats Finance (API
не отвечает). Их смотреть руками:

    https://app.intigriti.com/researcher/programs
    https://hackerone.com/directory/programs
    https://bugcrowd.com/engagements
    https://app.hats.finance/bug-bounties
"""
import argparse
import asyncio
import dataclasses
import datetime as dt
import json
import pathlib

from scout import market
from scout.http import client

SNAP = pathlib.Path(__file__).resolve().parent / "data" / "market.json"


def carry_scopes(fresh, old):
    """Перенести скоупы, дотянутые `--scopes`, в новый снимок.

    Список программ у Hacken/YesWeHack скоуп не содержит — он тянется
    отдельно и поштучно. Без этого переноса каждый `--refresh` стирал бы всю
    ту работу, а вместе с ней и плотность, то есть сортировку.
    """
    if not old:
        return fresh
    have = {"%s:%s" % (p.site, p.pid): p for p in old}
    kept = 0
    for p in fresh:
        o = have.get("%s:%s" % (p.site, p.pid))
        if not p.assets and o is not None and o.assets:
            p.assets, p.repos = o.assets, o.repos
            kept += 1
    if kept:
        print("  перенесено дотянутых скоупов: %d" % kept)
    return fresh


def carry_dead_site(fresh, old):
    """Площадка, которая сегодня не ответила, не должна ИСЧЕЗАТЬ из снимка.

    hackenproof отдал 403 (Cloudflare), фетчер честно вернул пустой список
    — и `--refresh` молча стёр 78 живых программ вместе со скоупами,
    показав их в диффе как «ушла». Сетевой сбой не отличить от закрытия
    площадки по одному прогону, но по одному прогону и не надо: пусто
    там, где вчера было густо, — это почти всегда сбой. Переносим старое
    и говорим об этом вслух.
    """
    if not old:
        return fresh
    have = {}
    for p in fresh:
        have.setdefault(p.site, 0)
        have[p.site] += 1
    was = {}
    for p in old:
        was.setdefault(p.site, 0)
        was[p.site] += 1
    for site, n in sorted(was.items()):
        if n and not have.get(site):
            keep = [p for p in old if p.site == site]
            fresh += keep
            print("  %-12s НЕ ОТВЕТИЛА — оставляю вчерашние %d программ "
                  "(в диффе их не будет)" % (site, len(keep)))
    return fresh


async def collect(sites):
    progs = []
    async with client() as c:
        for name in sites:
            try:
                got = await market.SOURCES[name](c)
            except Exception as e:                      # площадка могла закрыться
                print("  %-12s ОШИБКА: %s" % (name, str(e)[:60]))
                continue
            print("  %-12s %d программ" % (name, len(got)))
            progs += got
    return progs


PREV = SNAP.parent / "market_prev.json"


def save(progs):
    SNAP.parent.mkdir(parents=True, exist_ok=True)
    if SNAP.exists():                       # прошлый снимок — основа для диффа
        PREV.write_text(SNAP.read_text(encoding="utf-8"), encoding="utf-8")
    SNAP.write_text(json.dumps([dataclasses.asdict(p) for p in progs],
                               ensure_ascii=False), encoding="utf-8")


def diff(limit=25):
    """Что изменилось между прошлым снимком и нынешним.

    Ежедневно ценен не список, а его ПРОИЗВОДНАЯ. Новая программа — это
    минимально возможная плотность, и живёт такое состояние дни. Рост числа
    активов означает, что в скоуп внесли свежий код. Рост числа заявок —
    что мишень уходит.
    """
    if not PREV.exists():
        print("прошлого снимка нет: дифф появится со второго --refresh")
        return
    def index(path):
        return {"%s:%s" % (d["site"], d["pid"]): d
                for d in json.loads(path.read_text(encoding="utf-8"))}
    old, new = index(PREV), index(SNAP)
    gone = [old[k] for k in old.keys() - new.keys()]
    fresh = [new[k] for k in new.keys() - old.keys()]
    grown, busier = [], []
    for k in old.keys() & new.keys():
        a, b = old[k], new[k]
        if len(b.get("assets") or []) > len(a.get("assets") or []):
            grown.append((b, len(a.get("assets") or []), len(b.get("assets") or [])))
        if (b.get("reports") or 0) > (a.get("reports") or 0) >= 0:
            busier.append((b, a["reports"], b["reports"]))
    print("=" * 96)
    print("ИЗМЕНЕНИЯ С ПРОШЛОГО СНИМКА: новых %d, исчезло %d, скоуп вырос у %d"
          % (len(fresh), len(gone), len(grown)))
    print("=" * 96)
    for d in sorted(fresh, key=lambda x: -(x.get("reward") or 0))[:limit]:
        print("  НОВАЯ    %-30s %-11s %10s $  активов %s"
              % (d["name"][:29], d["site"], m(d.get("reward") or 0),
                 len(d.get("assets") or []) or "-"))
    for d, a, b in sorted(grown, key=lambda x: x[1] - x[2])[:limit]:
        print("  СКОУП+   %-30s %-11s активов %d -> %d"
              % (d["name"][:29], d["site"], a, b))
    for d in gone[:limit]:
        print("  ушла     %-30s %-11s" % (d["name"][:29], d["site"]))
    if busier:
        print("\n  теснеют (заявок стало больше): %s"
              % ", ".join("%s +%d" % (d["name"][:20], b - a)
                          for d, a, b in sorted(busier, key=lambda x: x[1] - x[2])[:8]))
    print("""
Новая программа — самая разреженная, какая бывает, и это состояние живёт
дни. Смотреть сюда дешевле, чем перечитывать весь рынок.""")


def load():
    if not SNAP.exists():
        return None
    raw = json.loads(SNAP.read_text(encoding="utf-8"))
    out = []
    for d in raw:
        d["assets"] = tuple(d.get("assets") or ())
        d["repos"] = tuple(d.get("repos") or ())
        d["tags"] = tuple(d.get("tags") or ())
        out.append(market.Program(**d))
    return out


def stale(progs, days=540):
    """Санитар снимка: что в нём выглядит мёртвым.

    Повод — программа HackenProof, ушедшая ШЕСТЬ ЛЕТ назад и всё это время
    лежавшая в каталоге как живая. Такие опаснее всего не тем, что бесполезны,
    а тем, что по плотности выглядят СВОБОДНЫМИ: заявок мало, потому что
    подавать давно некуда.

    Здесь не фильтр (фильтры стоят в источниках), а взгляд со стороны: если
    площадка снова начнёт отдавать мусор, это увидно будет здесь, а не через
    неделю работы по несуществующей мишени.
    """
    today = dt.date.today()
    old, empty, free = [], [], []
    for p in progs:
        d = None
        for f in ("%Y-%m-%d", "%d %b %Y"):
            try:
                d = dt.datetime.strptime((p.updated or "")[:11].strip(), f).date()
                break
            except ValueError:
                continue
        if d and (today - d).days > days:
            old.append((d, p))
        # У HackerOne в каталоге НЕТ ни наград, ни активов ни у одной
        # программы — пустая карточка там норма, а не признак мертвечины.
        if not p.reward and not p.assets and p.site != "hackerone":
            empty.append(p)
        if p.reports == 0 and p.assets:
            free.append(p)

    print("=" * 92)
    print("САНИТАР СНИМКА: программ %d" % len(progs))
    print("=" * 92)
    print("не обновлялись дольше %d дней: %d" % (days, len(old)))
    for d, p in sorted(old, key=lambda x: x[0])[:15]:
        print("  %s  %-30s %-12s %s" % (d, p.name[:29], p.site, p.url))
    print("\nбез награды и без активов (пустая карточка): %d" % len(empty))
    for p in empty[:10]:
        print("  %-30s %-12s %s" % (p.name[:29], p.site, p.url))
    print("\nноль заявок при непустом скоупе: %d — проверить, живая ли" % len(free))
    for p in free[:10]:
        print("  %-30s %-12s активов %d" % (p.name[:29], p.site, len(p.assets)))
    print("""
Ноль заявок бывает у по-настоящему новой программы, и тогда это лучшая
мишень на рынке. Он же бывает у закрытой — и тогда это ловушка. Различать
их надо ГЛАЗАМИ по ссылке, автоматике здесь верить нельзя.""")


def key(p):
    d = p.density
    # неизвестная плотность = 1.5: хуже разреженной, лучше явно тесной
    return (p.fee > 0, p.kyc, 1.5 if d is None else d, -p.reward)


def m(x):
    return "{:,.0f}".format(x) if x else "-"


def table(progs, limit=40):
    print("=" * 112)
    print("%-30s%-12s%11s%8s%8s%14s%9s%7s"
          % ("программа", "площадка", "макс.$", "активов", "заявок",
             "заявок/актив", "комис.", "репо"))
    print("-" * 112)
    for p in sorted(progs, key=key)[:limit]:
        d = p.density
        print("%-30s%-12s%11s%8s%8s%14s%9s%7s"
              % (p.name[:29], p.site, m(p.reward), p.n_assets or "-",
                 p.reports if p.reports >= 0 else "?",
                 "%.1f" % d if d is not None else "?",
                 ("%.0f$" % p.fee) if p.fee else ("KYC" if p.kyc else "нет"),
                 len(p.repos) or ""))
    print("""
«комис.» — нет / сумма за подачу / KYC. «заявок/актив» — плотность покрытия.
«?» значит площадка не публикует числа, а не ноль.
Карточка со скоупом:  python market.py --id <часть имени>""")


def detail(p, assets):
    print("=" * 100)
    print("%s   [%s]" % (p.name, p.site))
    print("=" * 100)
    print("ссылка:      %s" % p.url)
    print("максимум:    %s $%s" % (m(p.reward),
                                   "" if p.currency == "USD" else
                                   "  (исходно %s)" % p.currency))
    print("комиссия:    %s     KYC: %s"
          % (("%.0f$" % p.fee) if p.fee else "нет", "да" if p.kyc else "нет"))
    dens = (p.reports / len(assets)) if (p.reports >= 0 and assets) else None
    print("заявок:      %s     активов: %d     плотность: %s"
          % (p.reports if p.reports >= 0 else "не публикуется", len(assets),
             "%.1f" % dens if dens is not None else "?"))
    if p.tags:
        print("теги:        %s" % ", ".join(t for t in p.tags if t)[:80])
    print("\nАКТИВЫ В СКОУПЕ: %d" % len(assets))
    for a in assets[:60]:
        name = str(a.get("name") or a.get("url") or "")[:70]
        print("  %-70s %s" % (name, str(a.get("type") or "")[:22]))
    if len(assets) > 60:
        print("  ... ещё %d" % (len(assets) - 60))
    repos = market.repos_of(assets) or p.repos
    if repos:
        print("\nРЕПОЗИТОРИИ:")
        for r in repos:
            print("  %s" % r)
        print("\nЧТО ЗАПУСКАТЬ ДАЛЬШЕ:")
        org, repo = repos[0].split("/")[3:5]
        print("  python audits.py --org %s          отчёты и заплатки" % org)
        print("  python recodiff.py --org %s        скопированные рекомендации"
              % org)
        print("  скачать исходник: https://codeload.github.com/%s/%s/tar.gz/main"
              % (org, repo))
        print("  затем siblings.py / statesync.py / blindspots.py по дереву,")
        print("  и deployed.py по адресам из скоупа — ВЕРСИЯ В ПРОДЕ ПЕРВЫМ ДЕЛОМ.")
    else:
        print("\nРепозиториев в скоупе нет — исходник искать по адресам "
              "(deployed.py + Sourcify).")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--refresh", action="store_true")
    ap.add_argument("--diff", action="store_true",
                    help="что изменилось с прошлого снимка")
    ap.add_argument("--stale", action="store_true",
                    help="санитар: что в снимке выглядит мёртвым")
    ap.add_argument("--all", action="store_true", help="включая веб и приложения")
    ap.add_argument("--site", choices=sorted(market.SOURCES))
    ap.add_argument("--repos", action="store_true", help="только с GitHub в скоупе")
    ap.add_argument("--id", help="часть имени программы — карточка со скоупом")
    ap.add_argument("--scopes", choices=sorted(market.SCOPE),
                    help="дотянуть скоупы площадки в снимок (нужно для плотности)")
    ap.add_argument("--limit", type=int, default=40)
    args = ap.parse_args()

    progs = None if args.refresh else load()
    if progs is None:
        print("качаю площадки:")
        before = load()
        progs = carry_scopes(await collect(list(market.SOURCES)), before)
        progs = carry_dead_site(progs, before)
        save(progs)
        print("снимок: %s (%d программ)\n" % (SNAP, len(progs)))
        diff()
        print()

    if args.diff:
        diff()
        return

    if args.stale:
        stale(progs)
        return

    if args.scopes:
        # Список программ у Hacken/Standoff/YesWeHack скоуп не содержит, а без
        # него нет плотности — то есть нет и сортировки. Дотягиваем карточками.
        todo = [p for p in progs if p.site == args.scopes and not p.assets]
        async with client() as c:
            for i, p in enumerate(todo, 1):
                try:
                    got = await market.SCOPE[args.scopes](c, p.pid) or []
                except Exception as e:
                    print("  %-40s ОШИБКА %s" % (p.name[:39], str(e)[:40]))
                    continue
                p.assets = tuple(got)
                p.repos = market.repos_of(got)
                print("  %3d/%d  %-40s активов %d" % (i, len(todo),
                                                      p.name[:39], len(got)))
        save(progs)
        print("снимок обновлён")
        return

    if args.id:
        hits = [p for p in progs if args.id.lower() in p.name.lower()
                or args.id.lower() == p.pid.lower()]
        if not hits:
            print("не найдено")
            return
        p = sorted(hits, key=key)[0]
        assets = list(p.assets)
        if not assets and p.site in market.SCOPE:
            async with client() as c:
                assets = await market.SCOPE[p.site](c, p.pid) or []
        detail(p, assets)
        return

    sel = progs
    if args.site:
        sel = [p for p in sel if p.site == args.site]
    if not args.all:
        sel = [p for p in sel if p.sc]
    if args.repos:
        sel = [p for p in sel if p.repos]
    print("программ в выборке: %d из %d\n" % (len(sel), len(progs)))
    table(sel, args.limit)


if __name__ == "__main__":
    asyncio.run(main())
