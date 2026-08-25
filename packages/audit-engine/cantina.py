# -*- coding: utf-8 -*-
"""Отчёты Cantina по мишени: где команда сама призналась, что чинила не всё.

ЗАЧЕМ. Находка на Paxos родилась из опубликованного аудита: взять
ИСПРАВЛЕННУЮ находку, открыть заплатку, проверить, все ли симметричные
пути ею покрыты. Узкое место приёма — найти отчёт. `audits.py` ищет PDF
внутри репозитория, но их там часто нет вовсе: по `InfiniFi-Labs` он
вернул «заплаток не найдено», а здесь у того же проекта отчёт есть.

ЧТО ДАЁТ ИМЕННО ЭТОТ ИСТОЧНИК. У каждого из 756 отчётов есть PDF, хеши
коммитов (готовые диффы) и разбивка находок на найденные и починенные.
Последнее — прямой указатель: команда своей рукой отметила часть
исправленной, а часть оставила.

ЧЕГО НЕ НАДО ПУТАТЬ. Ноль починенных по всему отчёту почти никогда не
значит «не чинили ничего»: на публичных конкурсах починку не отслеживают
вовсе (37 отчётов из 51). Поэтому такие помечаются «неизвестно», а не
«не чинили», и идут ниже.

ЗАПУСК

    python cantina.py --index                 обновить список (756 отчётов)
    python cantina.py --repo morpho-org/morpho-blue
    python cantina.py Alchemix
"""
import asyncio
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

from scout import cantina_reports as CR
from scout.http import client

IDX = pathlib.Path(__file__).resolve().parent / "data" / "cantina_index.json"

MARK = {"partial": "ЧИНИЛИ ЧАСТИЧНО", "none": "починку не отмечали",
        "full": "починено всё", "empty": "без critical/high/medium"}


def load():
    try:
        return json.loads(IDX.read_text(encoding="utf-8"))
    except Exception:
        return []


async def build():
    async with client() as c:
        rows = await CR.fetch(c, fresh=True)
    idx = [CR.compact(r) for r in rows]
    IDX.parent.mkdir(parents=True, exist_ok=True)
    IDX.write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
    g = {}
    for r in idx:
        g[r["grade"]] = g.get(r["grade"], 0) + 1
    print("список обновлён: %d отчётов -> %s" % (len(idx), IDX))
    print("  из них частично починенных: %d, починку не отмечали: %d, "
          "починено всё: %d" % (g.get("partial", 0), g.get("none", 0),
                                g.get("full", 0)))


def look(repo="", name="", limit=8):
    rows = load()
    if not rows:
        print("списка нет. Сначала: python cantina.py --index")
        return
    hits, how = CR.match(rows, repo=repo, name=name)
    print("=" * 78)
    print("ОТЧЁТЫ CANTINA ПО «%s»: %d%s"
          % (repo or name, len(hits), (" (связь по %s)" % how) if how else ""))
    print("=" * 78)
    if not hits:
        print("  совпадений нет. Это НЕ значит, что протокол не аудирован —")
        print("  значит, у Cantina его нет. Смотреть c4.py и PDF в репозитории.")
        return
    for r in CR.order(hits)[:limit]:
        left = r["total"] - r["fixed"]
        print("\n  %-44s %s" % (r["title"][:44], r["at"]))
        print("     %-22s находок %d, починено %d, осталось %d"
              % (MARK.get(r["grade"], r["grade"]), r["total"], r["fixed"], left))
        if r["grade"] == "partial":
            print("     ЧИТАТЬ ЗДЕСЬ: часть закрыта, часть нет — ровно та почва,")
            print("     на которой выросла находка Paxos.")
        # Не у всех отчётов есть файл: у части в поле лежит корень
        # сайта. Печатать его как «отчёт» — посылать в никуда.
        pdf = r["pdf"] if "/reports/" in r["pdf"] else ""
        print("     отчёт:  %s" % (pdf or "PDF не опубликован — только диффы ниже"))
        for h in r["commits"][:4]:
            for repo_name in r["repos"][:1]:
                print("     дифф:   https://github.com/%s/commit/%s"
                      % (repo_name, h))
    part = [r for r in hits if r["grade"] == "partial"]
    if not part:
        print("\n  Частично починенных нет: у этой мишени указателя «чинили не")
        print("  всё» не будет. Работать по диффам коммитов и по blindspots.")


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    if a[0] == "--index":
        asyncio.run(build())
        return
    if a[0] == "--repo" and len(a) > 1:
        look(repo=a[1], name=a[1].replace("/", " ").replace("-", " "))
        return
    look(name=" ".join(a))


if __name__ == "__main__":
    main()
