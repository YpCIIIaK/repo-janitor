# -*- coding: utf-8 -*-
"""Отчёты Code4rena по мишени: что уже прочитано аудиторами, а что нет.

ЗАЧЕМ. `blindspots.py` считает файл нетронутым, если его не назвал ни один
отчёт ИЗ САМОГО РЕПОЗИТОРИЯ. Но отчёта в репозитории часто нет вовсе, а
конкурс по протоколу был. Тогда «не назван ни одним» означает лишь «отчётов
не нашли», и сигнал врёт в самую опасную сторону — обещает пустоту там, где
топтались сотни человек.

Этот инструмент закрывает дыру со стороны Code4rena: 475 конкурсов, у
каждого опубликованный отчёт. Он отвечает на два вопроса:

    какие файлы мишени уже названы в отчётах  -> вычесть из blindspots
    что именно там находили                   -> недочиненная половина

ЧЕГО ЗДЕСЬ МАЛО. Ссылок на заплатки: у Code4rena чинит спонсор после
конкурса и в отчёт не вносит. Что нашлось — печатается, но основной приём
кормится не отсюда, а из PDF в репозиториях (`audits.py`).

СВЯЗЬ ПО ИМЕНИ, А НЕ ПО ССЫЛКЕ. `repo` конкурса всегда указывает на зеркало
`code-423n4/<slug>`, поэтому мишень с отчётом связывается по словам названия.
Совпадения печатаются с их названиями — проверять глазами, а не верить.

ЗАПУСК

    python c4.py --index              обновить список конкурсов (475 штук)
    python c4.py Morpho               отчёты по мишени, файлы и находки
    python c4.py --repo morpho-org/morpho-blue
"""
import asyncio
import json
import pathlib
import sys

sys.stdout.reconfigure(encoding="utf-8")

from scout import c4reports as C4
from scout.http import client

IDX = pathlib.Path(__file__).resolve().parent / "data" / "c4_index.json"


def load():
    try:
        return json.loads(IDX.read_text(encoding="utf-8"))
    except Exception:
        return []


async def build():
    async with client() as c:
        rows = await C4.audits(c, fresh=True)
    keep = [{k: r.get(k) for k in
             ("slug", "title", "league", "status", "repo", "endTime",
              "codeAccess", "hasMandatoryProofOfConcept")}
            for r in rows if r.get("slug")]
    IDX.parent.mkdir(parents=True, exist_ok=True)
    IDX.write_text(json.dumps(keep, ensure_ascii=False), encoding="utf-8")
    done = sum(1 for r in keep if r.get("status") == "Completed")
    print("список обновлён: %d конкурсов, из них завершённых %d -> %s"
          % (len(keep), done, IDX))


async def look(needle, limit=6):
    rows = load()
    if not rows:
        print("списка нет. Сначала: python c4.py --index")
        return
    hits = C4.match(rows, needle)
    # Завершённые полезнее: у идущего конкурса отчёта ещё нет.
    hits.sort(key=lambda r: (r.get("status") != "Completed",
                             str(r.get("endTime") or "")), reverse=False)
    print("=" * 78)
    print("КОНКУРСЫ CODE4RENA ПО «%s»: %d" % (needle, len(hits)))
    print("=" * 78)
    if not hits:
        print("  совпадений нет. Это НЕ значит, что протокол не аудирован —")
        print("  значит, у Code4rena его не было. Смотреть Cantina и PDF в репо.")
        return
    files_all, finds_all = {}, []
    async with client() as c:
        for r in hits[:limit]:
            print("\n  %-40s %-10s %s"
                  % (r["title"][:40], r.get("status"), r["slug"]))
            txt = await C4.report(c, r["slug"])
            if not txt:
                print("     отчёта нет (конкурс идёт или не опубликован)")
                continue
            p = C4.parse(txt)
            files_all.update({f: 1 for f in p["files"]})
            finds_all += [(r["slug"], s, n, t) for s, n, t in p["findings"]]
            print("     названо файлов %d, находок %d, ссылок на починку %d"
                  % (len(p["files"]), len(p["findings"]), len(p["fixes"])))
            for u in p["fixes"][:3]:
                print("       починка: %s" % u)
    if files_all:
        print("\n  УЖЕ НАЗВАНЫ В ОТЧЁТАХ (%d) — вычитать из blindspots:"
              % len(files_all))
        for f in sorted(files_all)[:40]:
            print("     %s" % f)
    sev = [x for x in finds_all if x[1] in ("H", "M")]
    # Пусто в High/Medium — не повод показывать пустой раздел: у вытоптанных
    # протоколов там честно ничего нет, и молчание выглядело бы поломкой
    # разбора. Тогда печатаем что есть, но говорим, что это Low.
    low = not sev and finds_all
    rows = sev or finds_all
    if rows:
        print("\n  ЧТО НАХОДИЛИ (%s, %d) — искать симметричную половину:"
              % ("только Low: High/Medium в этих отчётах нет" if low
                 else "High/Medium", len(rows)))
        for slug, s, n, t in rows[:25]:
            print("     [%s-%02d] %-58s %s" % (s, n, t[:58], slug[:18]))


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    if a[0] == "--index":
        asyncio.run(build())
        return
    needle = a[1] if a[0] == "--repo" and len(a) > 1 else " ".join(a)
    if a[0] == "--repo" and len(a) > 1:
        # owner/repo -> слова: и владелец, и имя годятся для поиска
        needle = needle.replace("/", " ").replace("-", " ")
    asyncio.run(look(needle))


if __name__ == "__main__":
    main()
