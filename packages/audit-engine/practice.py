"""Тренировка на завершённом конкурсе: можешь ли ты вообще найти находку.

Весь остальной проект измеряет рынок. Здесь измеряется единственное, что
осталось непроверенным, — ты сам. Стоит это ноль долларов: конкурс уже
прошёл, отчёт опубликован, репозиторий на диске.

Правила, иначе упражнение бессмысленно:

  1. Отчёт НЕ открывать, пока не закончишь. Он лежит в data/practice/
     и печатается только по команде --reveal.
  2. Засечь время. Оценивать надо не «нашёл или нет», а «нашёл за сколько».
  3. Записывать находки по ходу в файл ответов, а не по памяти после.

    python practice.py --pick            подобрать конкурсы для пробы
    python practice.py --start 1029      начать: карта функций и бланк ответов
    python practice.py --reveal 1029     сверка с отчётом, после работы
"""
import argparse
import asyncio
import datetime as dt
import pathlib
import statistics as st

from scout import corpus, recon
from scout.http import ROOT, client, get_json

REPOS = ROOT / "data" / "repos"
WORK = ROOT / "data" / "practice"


def repo_dir(repo, commit):
    return REPOS / repo.replace("/", "__") / ((commit or "head")[:12])


def has_code(d):
    d = pathlib.Path(d)
    return d.exists() and any(p.suffix.lower() == ".sol"
                              for p in d.rglob("*") if p.is_file())


def load(cid=None):
    """Карточки конкурсов из кэша, при желании одна конкретная."""
    out = []
    for d in corpus.load_offline():
        if cid and str(d.get("id")) != str(cid):
            continue
        out.append(d)
    return out


def funcs_of(d):
    mirror = d.get("template_repo_name")
    fs, seen = [], set()
    for r in d.get("scope") or []:
        files = [f.get("name") for f in (r.get("files") or []) if f.get("name")]
        for cand in (repo_dir(r.get("repo"), r.get("commit_hash")),
                     repo_dir(mirror, None)):
            if has_code(cand):
                for f in recon.walk_functions(cand, scope_files=files):
                    k = (f["path"], f["l0"], f["name"])
                    if k not in seen:
                        seen.add(k); fs.append(f)
                break
    return fs


def pick(n=10):
    """Конкурсы, пригодные для пробы: скоуп на вечер, есть что искать."""
    rows = []
    for d in load():
        rep = d.get("report") or ""
        if len(rep) < 500:
            continue
        iss = [x for x in corpus.parse_report(rep) if x["n"] > 0]
        if not (4 <= len(iss) <= 18):
            continue
        nsloc = int(d.get("nsloc") or 0) or sum(
            int(r.get("total_nsloc") or 0) for r in d.get("scope") or [])
        if not (300 <= nsloc <= 2500):
            continue
        fs = funcs_of(d)
        if len(fs) < 20:
            continue
        end = dt.datetime.fromtimestamp(d.get("ends_at") or 0, dt.timezone.utc)
        solo = sum(1 for x in iss if x["n"] == 1)
        highs = sum(1 for x in iss if x["sev"] in ("H", "C"))
        hot = [f for f in fs if f["open"] and f["hits"].get("деньги")]
        rows.append({
            "d": d, "id": d.get("id"),
            "name": (d.get("template_repo_name") or "").replace("sherlock-audit/", ""),
            "nsloc": nsloc, "funcs": len(fs), "hot": len(hot),
            "iss": len(iss), "solo": solo, "high": highs,
            "year": end.year, "pool": float(d.get("prize_pool") or 0),
            "hours": sum(f["nsloc"] for f in hot) / 250,
        })
    # сортируем по свежести и по доле одиночек: там было что пропустить
    rows.sort(key=lambda r: (-r["year"], -(r["solo"] / r["iss"]), r["nsloc"]))
    print("=" * 104)
    print("КОНКУРСЫ ДЛЯ ПРОБЫ")
    print("=" * 104)
    print("%-6s%-30s%6s%8s%8s%8s%7s%7s%9s"
          % ("id", "конкурс", "год", "строк", "функций", "горячих",
             "проблем", "одних", "часов"))
    print("-" * 104)
    for r in rows[:n]:
        print("%-6s%-30s%6d%8d%8d%8d%7d%7d%9.1f"
              % (r["id"], r["name"][:29], r["year"], r["nsloc"], r["funcs"],
                 r["hot"], r["iss"], r["solo"], r["hours"]))
    print("""
«горячих» — беспермиссионные функции, двигающие деньги: с них начинать.
«одних»   — сколько проблем подал ровно один человек. Чем больше, тем
            честнее проба: значит их реально было пропустить.
«часов»   — на прочтение горячих функций в темпе 250 строк в час.

Бери верхнюю строку и запускай:  python practice.py --start <id>""")


def start(cid):
    ds = load(cid)
    if not ds:
        print("конкурс %s не найден в кэше" % cid)
        return
    d = ds[0]
    name = (d.get("template_repo_name") or "").replace("sherlock-audit/", "")
    fs = funcs_of(d)
    if not fs:
        print("код конкурса не скачан: python prefetch.py --repos")
        return
    rep = d.get("report") or ""
    iss = [x for x in corpus.parse_report(rep) if x["n"] > 0]

    WORK.mkdir(parents=True, exist_ok=True)
    # отчёт откладываем в сторону, чтобы случайно не попался на глаза
    (WORK / ("%s_report.md" % cid)).write_text(rep, encoding="utf-8")

    fs.sort(key=lambda f: (-(f["score"] + (0.7 if f["open"] else 0)), -f["nsloc"]))
    hot = [f for f in fs if f["open"] and f["hits"].get("деньги")]

    ans = WORK / ("%s_answers.md" % cid)
    if not ans.exists():
        lines = ["# Проба: %s" % name, "",
                 "Фонд %s$, проблем в отчёте: %d (не подглядывать)."
                 % ("{:,.0f}".format(float(d.get("prize_pool") or 0)), len(iss)),
                 "Начато: %s" % dt.datetime.now().strftime("%Y-%m-%d %H:%M"),
                 "", "## Что я нашёл", "",
                 "Формат: файл:строка — уровень — в чём проблема.",
                 "Писать по ходу, а не после. Пустая догадка тоже запись —",
                 "потом видно, куда смотрел и почему не увидел.", "",
                 "1. ", "2. ", "3. ", "", "## Время", "",
                 "закончил: ", "потрачено часов: ", ""]
        ans.write_text("\n".join(lines), encoding="utf-8")

    print("=" * 100)
    print("ПРОБА: %s" % name)
    print("=" * 100)
    print("фонд %s$   функций %d   из них горячих %d   строк в горячих %d"
          % ("{:,.0f}".format(float(d.get("prize_pool") or 0)),
             len(fs), len(hot), sum(f["nsloc"] for f in hot)))
    print("в отчёте проблем: %d — сколько именно каких, узнаешь в конце\n" % len(iss))
    for r in d.get("scope") or []:
        dd = repo_dir(r.get("repo"), r.get("commit_hash"))
        if not has_code(dd):
            dd = repo_dir(d.get("template_repo_name"), None)
        print("код: %s" % dd)
    print("\nбланк ответов: %s" % ans)
    print("отчёт спрятан:  %s  (не открывать!)\n" % (WORK / ("%s_report.md" % cid)))

    print("НАЧИНАТЬ ОТСЮДА — беспермиссионные функции, двигающие деньги:")
    print("%-28s%-30s%7s  %s" % ("функция", "файл", "строк", "что внутри"))
    print("-" * 100)
    for f in hot[:20]:
        print("%-28s%-30s%7d  %s"
              % (f["name"][:27], f["path"].split("/")[-1][-29:], f["nsloc"],
                 ", ".join(sorted(f["hits"], key=lambda k: -f["hits"][k])[:4])))
    print("\nДальше по списку — остальные открытые функции:")
    rest = [f for f in fs if f["open"] and f not in hot][:12]
    for f in rest:
        print("  %-26s%-30s%7d  %s"
              % (f["name"][:25], f["path"].split("/")[-1][-29:], f["nsloc"],
                 ", ".join(sorted(f["hits"], key=lambda k: -f["hits"][k])[:3])))
    print("""
Засеки время. Когда закончишь — python practice.py --reveal %s""" % cid)


def reveal(cid):
    ds = load(cid)
    if not ds:
        print("конкурс %s не найден" % cid)
        return
    d = ds[0]
    iss = [x for x in corpus.parse_report(d.get("report") or "") if x["n"] > 0]
    if not iss:
        print("в отчёте нет разобранных проблем")
        return
    W = {"C": 10.0, "H": 5.0, "M": 1.0, "L": 0.2}
    pool = float(d.get("prize_pool") or 0)
    tot = sum(W.get(x["sev"], 1.0) for x in iss)
    print("=" * 100)
    print("ЧТО БЫЛО В ОТЧЁТЕ: %s"
          % (d.get("template_repo_name") or "").replace("sherlock-audit/", ""))
    print("=" * 100)
    for x in sorted(iss, key=lambda x: (x["sev"] != "H", x["n"])):
        pay = pool * W.get(x["sev"], 1.0) / tot / x["n"] if tot else 0
        files = ", ".join(sorted(x["files"])[:3]) or "-"
        print("\n[%s] нашли %d чел., выплата ~%s$  (%s)"
              % (x["sev"], x["n"], "{:,.0f}".format(pay), files))
        print("    %s" % x["title"][:160])
        print("    класс: %s" % ", ".join(corpus.classify(x["title"])))
    solo = [x for x in iss if x["n"] == 1]
    print("\n" + "-" * 100)
    print("всего проблем %d, из них подал один человек: %d" % (len(iss), len(solo)))
    print("медиана нашедших: %.0f" % st.median([x["n"] for x in iss]))
    print("""
Сверяй по файлам и строкам, а не по формулировке: попасть в то же место
и не понять до конца — это уже половина. Что считать успехом: одна
проблема из списка, найденная за отведённое время, означает, что порог
проходим. Ноль — тоже ответ, и он дешевле, чем узнать это на живом
конкурсе.""")


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pick", action="store_true")
    ap.add_argument("--start")
    ap.add_argument("--reveal")
    ap.add_argument("--n", type=int, default=10)
    args = ap.parse_args()

    if args.start:
        start(args.start)
    elif args.reveal:
        reveal(args.reveal)
    else:
        pick(args.n)


if __name__ == "__main__":
    asyncio.run(main())
