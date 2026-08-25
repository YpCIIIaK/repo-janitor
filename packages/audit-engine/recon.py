"""Фаза 1: карта репозитория — с чего начинать чтение.

    python recon.py --contest 1279          скачать скоуп конкурса и разобрать
    python recon.py --path d:\\repo          разобрать локальный код
    python recon.py --contest 1279 --hours 8  что успеть за восемь часов

Скоуп берётся из API Sherlock: он даёт репозиторий, коммит и точный список
файлов, за которые платят. Всё, что вне списка, не читается — это самая
дешёвая экономия внимания из возможных.
"""
import argparse
import asyncio
import pathlib
import subprocess
import sys

from scout import recon, sherlock
from scout.http import client, get_json, ROOT

REPOS = ROOT / "data" / "repos"


def clone(repo, commit, dst):
    """Тянем ровно один коммит без истории.

    Заказчики почти всегда закрывают или удаляют репозиторий после конкурса,
    поэтому основной источник — не он, а зеркало sherlock-audit, которое
    остаётся публичным. Пробуем оба: сначала точный коммит, потом ветку.
    """
    dst = pathlib.Path(dst)
    if dst.exists() and any(p for p in dst.iterdir() if p.name != ".git"):
        return True, "уже скачан"
    dst.mkdir(parents=True, exist_ok=True)
    url = "https://github.com/%s.git" % repo
    for cmd in (["git", "init", "-q"],
                ["git", "remote", "add", "origin", url]):
        subprocess.run(cmd, cwd=dst, capture_output=True, text=True)
    last = "не удалось"
    for ref in ([commit] if commit else []) + ["main", "master"]:
        r = subprocess.run(["git", "fetch", "-q", "--depth", "1", "origin", ref],
                           cwd=dst, capture_output=True, text=True)
        if r.returncode:
            last = ((r.stderr or r.stdout).strip().splitlines() or ["ошибка"])[-1]
            continue
        subprocess.run(["git", "checkout", "-q", "FETCH_HEAD"],
                       cwd=dst, capture_output=True, text=True)
        return True, ("скачан @ %s" % ref[:12])
    return False, last


def clone_any(repo, commit, mirror):
    """Сначала оригинал, потом зеркало Sherlock."""
    for r, cm, what in ((repo, commit, "оригинал"), (mirror, None, "зеркало")):
        if not r:
            continue
        dst = REPOS / r.replace("/", "__") / ((cm or "head")[:12])
        ok, msg = clone(r, cm, dst)
        if ok:
            return dst, "%s %s: %s" % (what, r, msg)
    return None, "ни оригинал, ни зеркало не открылись"


async def get_scope(cid):
    async with client() as c:
        d = await get_json(c, "https://mainnet-contest.sherlock.xyz/contests/%s" % cid)
    if not d:
        return None
    return d


def report(rows, hours, title):
    print("=" * 100)
    print(title)
    print("=" * 100)
    if not rows:
        print("  ни одного файла не разобрано")
        return
    total = sum(r["nsloc"] for r in rows)
    take, got, cap = recon.budget(rows, hours)
    print("файлов в скоупе: %d, строк всего: %d" % (len(rows), total))
    print("за %d ч вдумчивого чтения (250 строк/ч) успеваешь %d строк — это %d файлов сверху,"
          % (hours, cap, len(take)))
    ext_all = sum(r["ext"] for r in rows) or 1
    print("то есть %.0f%% кода и %.0f%% внешних точек входа\n"
          % (got / total * 100, sum(r["ext"] for r in take) / ext_all * 100))

    print("%-52s%7s%6s  %s" % ("файл", "строк", "вход", "что внутри"))
    print("-" * 100)
    for i, r in enumerate(rows[:30]):
        mark = ">" if r in take else " "
        sig = ", ".join("%s:%d" % (k, v) for k, v in
                        sorted(r["hits"].items(), key=lambda kv: -kv[1])[:4])
        print("%s%-51s%7d%6d  %s"
              % (mark, r["path"][-50:], r["nsloc"], r["ext"], sig))
    if len(rows) > 30:
        print("  ... ещё %d файлов" % (len(rows) - 30))
    print("""
'>' — попадает в бюджет чтения. Порядок — по размеру: проверка на 25
конкурсах и 435 находках показала, что сортировка по признакам его не бьёт
(см. шапку scout/recon.py). Пометки справа говорят, ЧТО в файле, а не
«здесь баг» — по ним выбирают, с какого конца читать сам файл.""")


def funcs_report(fs, hours, title):
    """Функциональный вид — тот, что подтвердился проверкой.

    Измерено на 141 конкурсе и 27750 функциях (validate.py --test funcs):
    доля функций, задетых находками, при базовой ставке 9%

        беспермиссионная + деньги      29%   (1212 функций, 4% от числа)
        защищённая + деньги            20%
        беспермиссионная, без денег     9%
        защищённая, без денег           8%

    Отсюда порядок: сначала то, куда дотянется посторонний и где двигаются
    деньги. Это не гарантия бага, это тройная плотность против среднего.
    """
    print("=" * 100)
    print(title)
    print("=" * 100)
    if not fs:
        print("  ни одной функции не разобрано")
        return
    fs = sorted(fs, key=lambda f: (-(f["score"] + (0.7 if f["open"] else 0)),
                                   -f["nsloc"]))
    total = sum(f["nsloc"] for f in fs)
    cap = hours * 250
    take, got = [], 0
    for f in fs:
        if got + f["nsloc"] > cap and take:
            break
        take.append(f); got += f["nsloc"]
    hot = [f for f in fs if f["open"] and f["hits"].get("деньги")]
    print("функций в скоупе: %d, строк %d" % (len(fs), total))
    print("беспермиссионных, двигающих деньги: %d (%.0f%% строк) — начинать с них"
          % (len(hot), sum(f["nsloc"] for f in hot) / total * 100 if total else 0))
    print("за %d ч (250 строк/ч) успеваешь %d строк — верхние %d функций, %.0f%% кода\n"
          % (hours, cap, len(take), got / total * 100 if total else 0))
    cold = [f for f in fs if f.get("is_cold") and f["score"] > 1.5]
    print("холодных функций с накопительной математикой: %d — второй по важности слой"
          % len(cold))
    print("%-30s%-34s%7s%7s  %s"
          % ("функция", "файл", "строк", "вход", "что внутри"))
    print("-" * 100)
    for f in fs[:35]:
        mark = ">" if f in take else " "
        keys = sorted(f["hits"], key=lambda k: -f["hits"][k])[:3]
        if f.get("is_cold"):
            keys += sorted(f.get("cold", {}), key=lambda k: -f["cold"][k])[:3]
        print("%s%-29s%-34s%7d%7s  %s"
              % (mark, f["name"][:28], f["path"].split("/")[-1][-33:], f["nsloc"],
                 "открыт" if f["open"] else "хол." if f.get("is_cold") else "",
                 ", ".join(keys)))
    if len(fs) > 35:
        print("  ... ещё %d функций" % (len(fs) - 35))
    print("""
'открыт' — external/public без модификатора доступа, то есть вызвать может
любой. Порядок: измеренный лифт признаков плюс надбавка за достижимость.
Функция с onlyOwner идёт вниз намеренно — по измерению она содержит находку
реже среднего (лифт 0.58), потому что посторонний до неё не дотягивается.""")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--contest", help="id конкурса на Sherlock")
    ap.add_argument("--path", help="локальный путь к коду")
    ap.add_argument("--hours", type=int, default=8, help="бюджет чтения, часов")
    ap.add_argument("--files", action="store_true",
                    help="файловый вид вместо функционального")
    args = ap.parse_args()

    if args.path:
        if args.files:
            report(recon.walk(args.path), args.hours, "КАРТА: %s" % args.path)
        else:
            funcs_report(recon.walk_functions(args.path), args.hours,
                         "ФУНКЦИИ: %s" % args.path)
        return

    if not args.contest:
        ap.error("нужен --contest или --path")

    d = await get_scope(args.contest)
    if not d:
        print("конкурс %s не найден" % args.contest)
        return
    name = (d.get("template_repo_name") or "").replace("sherlock-audit/", "")
    scope = d.get("scope") or []
    print("конкурс: %s   фонд %s$   заявок %s"
          % (name, "{:,.0f}".format(d.get("prize_pool") or 0),
             d.get("num_competition_issues")))
    if not scope:
        print("у этого конкурса площадка не отдаёт состав скоупа")
        return

    mirror = d.get("template_repo_name")
    allrows, allfuncs, seen, fseen = [], [], set(), set()
    for r in scope:
        repo, commit = r.get("repo"), r.get("commit_hash")
        files = [f.get("name") for f in (r.get("files") or []) if f.get("name")]
        print("\nрепозиторий %s @ %s — файлов в скоупе %d, строк %d"
              % (repo, (commit or "")[:12], len(files), r.get("total_nsloc") or 0))
        dst, msg = clone_any(repo, commit, mirror)
        print("   %s" % msg)
        if not dst:
            continue
        for row in recon.walk(dst, scope_files=files):
            if row["path"] not in seen:
                seen.add(row["path"]); allrows.append(row)
        for f in recon.walk_functions(dst, scope_files=files):
            k = (f["path"], f["l0"], f["name"])
            if k not in fseen:
                fseen.add(k); allfuncs.append(f)

    print()
    if args.files:
        report(allrows, args.hours, "КАРТА КОНКУРСА %s" % name)
    else:
        funcs_report(allfuncs, args.hours, "ФУНКЦИИ КОНКУРСА %s" % name)


if __name__ == "__main__":
    asyncio.run(main())
