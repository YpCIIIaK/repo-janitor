# -*- coding: utf-8 -*-
"""Файлы в репозитории, которых НЕ КОСНУЛСЯ НИ ОДИН отчёт.

Зачем это отдельно от `audits.py`. Основной приём читает ИСПРАВЛЕННЫЕ
находки и ищет недочиненную половину. Он работает, но упирается в тесноту:
на Agglayer 552 заявки, и все идут по одним и тем же опубликованным
находкам, потому что ссылка на заплатку — единственный указатель, который
виден всем.

Файл, не упомянутый ни в одном отчёте, указателя не имеет вовсе. Туда никто
не идёт именно потому, что туда ничто не ведёт.

ЧЕСТНО О СИЛЕ СИГНАЛА. Молчание отчёта не означает, что файл не читали.
Аудитор мог прочесть его и не найти ничего — тогда там пусто, как и у нас.
Поэтому это НЕ замена основному приёму, а вторая удочка: хуже по качеству
сигнала, лучше по свежести участка.

ЧЕГО ЭТОТ ИНСТРУМЕНТ НЕ ЗНАЕТ. Список файлов берётся с HEAD репозитория, а
платят за развёрнутое. На agglayer это разошлось на две мажорные версии.
Поэтому вывод — не очередь на чтение, а список кандидатов; развёрнутую
версию сверять отдельно, до чтения.
"""
import asyncio
import json
import pathlib
import re
import sys

import audits

# Файлы без собственной логики: там нечему ломаться, и молчание отчётов
# про них ничего не значит.
SKIP = re.compile(
    r"(?:^I[A-Z].*\.sol$)"              # интерфейсы: IERC20.sol, IBridge.sol
    r"|(?:\.t\.sol$)|(?:\.s\.sol$)"     # тесты и скрипты форджа
    r"|(?:^Mock)|(?:Mock\.sol$)|(?:Mocks?\.sol$)"
    r"|(?:Test.*\.sol$)|(?:.*Test(?:Base)?\.sol$)"
    # Обвязка для тестов по соглашению Lido: `AccessControl__Harness.sol`,
    # `Accounting__MockForSanityChecker.sol`. Их 265 в списке нетронутого
    # по lidofinance/core — то есть настоящие файлы в нём было не найти.
    r"|(?:__(?:Harness|Mock)\w*\.sol$)|(?:Harness\.sol$)"
    r"|(?:^Deploy)|(?:^Upgrade)|(?:^Set[A-Z])"
    r"|(?:\.generic$)|(?:^lib\.rs$)|(?:^mod\.rs$)|(?:^main\.rs$)"
    r"|(?:^build\.rs$)|(?:^tests?\.rs$)|(?:^error\.rs$)"
    r"|(?:\.md$)|(?:\.json$)|(?:\.toml$)|(?:\.txt$)",
    re.I)

CODE = re.compile(r"\.(?:sol|rs|go|vy|cairo|move)$", re.I)


C4IDX = pathlib.Path(__file__).resolve().parent / "data" / "c4_index.json"


def c4_named(owner, repo):
    """Файлы, названные в отчётах Code4rena по ЭТОМУ ЖЕ протоколу.

    Зачем. Свой список отчётов инструмент берёт из самого репозитория, а их
    там часто нет вовсе: на Alchemix разбор дал ноль имён, хотя конкурс
    Code4rena по Alchemix есть и назвал 27 файлов. Без этого вычитания
    «не назван ни одним отчётом» врёт в опасную сторону — обещает пустоту
    там, где топтался целый конкурс.

    Связываем по СЛОВАМ имени владельца и репозитория: `repo` конкурса
    указывает на зеркало code-423n4, а не на репозиторий протокола, так что
    сопоставить по ссылке нечего. Совпавшие конкурсы возвращаются наружу и
    печатаются — проверять глазами, а не верить.

    Молчит и возвращает пустое, если индекса нет или сети нет: сигнал,
    который падает вместе с сетью, перестаёт работать ровно тогда, когда
    нужен.
    """
    try:
        from scout import c4reports as C4
        from scout.http import client
        idx = json.loads(C4IDX.read_text(encoding="utf-8"))
    except Exception:
        return set(), []
    needle = "%s %s" % (owner.replace("-", " "), repo.replace("-", " "))
    hits = [h for h in C4.match(idx, needle) if h.get("status") == "Completed"]
    if not hits:
        return set(), []

    async def go():
        files = set()
        async with client() as c:
            for h in hits[:4]:
                txt = await C4.report(c, h["slug"])
                if txt:
                    files |= set(C4.parse(txt)["files"])
        return files

    try:
        return asyncio.run(go()), [h["slug"] for h in hits[:4]]
    except Exception:
        return set(), []


def blind(owner, repo, seen=None, use_c4=True):
    res = audits.scan(owner, repo, seen)
    if not res:
        return None
    src = res.get("src") or set()
    cov = res.get("coverage") or {}
    if not src:
        return None
    untouched = sorted(f for f in src
                       if CODE.search(f) and f not in cov and not SKIP.search(f))
    # Внешний корпус вычитается ПОСЛЕ своего: своё покрытие точнее, потому
    # что привязано к репозиторию, а не к имени протокола.
    ext, slugs = ((set(), []) if not use_c4 else c4_named(owner, repo))
    removed = [f for f in untouched if f in ext]
    if removed:
        untouched = [f for f in untouched if f not in ext]
    # Упомянутые хотя бы раз — для сравнения: если отчёты не назвали почти
    # ничего, то «нетронутое» означает лишь, что разбор отчётов не удался.
    return {"repo": res["repo"], "src": len(src), "named": len(cov),
            "reports": res["files"], "untouched": untouched,
            "c4_removed": sorted(removed), "c4_slugs": slugs}


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        print("использование: blindspots.py owner/repo [owner/repo ...]")
        print("           или: blindspots.py --file repos.txt")
        return
    if args[0] == "--file":
        repos = [l.strip() for l in open(args[1], encoding="utf-8")
                 if l.strip() and not l.startswith("#")]
    else:
        repos = args
    seen = set()
    for r in repos:
        owner, _, repo = r.partition("/")
        if not repo:
            continue
        print("=" * 74)
        b = blind(owner, repo, seen)
        if not b:
            print("%s — отчётов нет или дерево недоступно" % r)
            continue
        print("%s — отчётов %d, файлов %d, названо в отчётах %d"
              % (b["repo"], b["reports"], b["src"], b["named"]))
        if b["c4_slugs"]:
            print("   внешний корпус Code4rena: %s" % ", ".join(b["c4_slugs"]))
        if b["c4_removed"]:
            # Вычтенное печатаем ПОИМЁННО: это единственный способ заметить,
            # что связывание по имени притянуло чужой протокол.
            print("   снято внешним корпусом (%d) — по ним конкурс уже прошёл:"
                  % len(b["c4_removed"]))
            for f in b["c4_removed"]:
                print("      %s" % f)
        if not b["named"] and not b["c4_slugs"]:
            print("   разбор отчётов дал ноль имён файлов — доверять нечему")
            continue
        if not b["named"] and b["c4_slugs"]:
            print("   своих отчётов в репозитории нет; опора только на Code4rena")
        u = b["untouched"]
        print("   НЕ НАЗВАН НИ ОДНИМ ОТЧЁТОМ — %d файлов:" % len(u))
        for f in u:
            print("      %s" % f)


if __name__ == "__main__":
    main()
