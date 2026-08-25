"""Проверка инструмента против реальности. Запускать офлайн по скачанному.

Вес файла в recon.py я назначил по смыслу. Это гипотеза, а не измерение.
Здесь она проверяется единственным честным способом: берём конкурсы, где
известно, в каких файлах оказались настоящие находки, и смотрим, попадают
ли эти файлы наверх.

Сравнение обязательно с базовыми линиями, иначе цифра ничего не значит:
  * случайный порядок  — нижняя граница, ниже неё инструмент вреден;
  * по размеру файла   — «просто читай самое большое», бесплатная стратегия;
  * по числу входных точек — тоже бесплатная и осмысленная.
Если ранжирование не бьёт вторую и третью, оно не нужно, и я это напишу.

    python validate.py              все тесты по тому, что скачано
    python validate.py --test rank  только попадание в топ
    python validate.py --test lift  какие признаки реально предсказывают
    python validate.py --test curve кривая «прочитано кода / найдено находок»
    python validate.py --min 20     требовать минимум 20 конкурсов

Сети не требует: работает по data/cache и data/repos. Чего не скачано —
пропускает и честно пишет, сколько конкурсов реально участвовало.
"""
import argparse
import pathlib
import random
import statistics as st

from scout import corpus, recon
from scout.http import ROOT

REPOS = ROOT / "data" / "repos"


def repo_dir(repo, commit):
    return REPOS / repo.replace("/", "__") / ((commit or "head")[:12])


def has_code(d):
    d = pathlib.Path(d)
    return d.exists() and any(
        p.suffix.lower() in (".sol", ".rs", ".vy") for p in d.rglob("*") if p.is_file())


def cases(min_files=8, min_issues=3):
    """Конкурсы, по которым можно судить: есть код на диске и есть отчёт."""
    out = []
    for d in corpus.load_offline():
        rep = d.get("report") or ""
        if len(rep) < 500:
            continue
        iss = [x for x in corpus.parse_report(rep) if x["files"]]
        if len(iss) < min_issues:
            continue
        mirror = d.get("template_repo_name")
        rows, seen = [], set()
        for r in d.get("scope") or []:
            files = [f.get("name") for f in (r.get("files") or []) if f.get("name")]
            for cand, sc in ((repo_dir(r.get("repo"), r.get("commit_hash")), files),
                             (repo_dir(mirror, None), files)):
                if has_code(cand):
                    for row in recon.walk(cand, scope_files=sc):
                        if row["path"] not in seen:
                            seen.add(row["path"]); rows.append(row)
                    break
        if len(rows) < min_files:
            continue
        rows.sort(key=lambda r: -r["score"])
        out.append({"name": (mirror or "").replace("sherlock-audit/", ""),
                    "rows": rows, "issues": iss, "pool": d.get("prize_pool") or 0})
    return out


def names(rows):
    return {pathlib.Path(r["path"]).name for r in rows}


def hit(order, issues, k):
    top = names(order[:k])
    return sum(1 for x in issues if x["files"] & top) / len(issues)


def test_rank(cs, seed=7):
    random.seed(seed)
    print("=" * 92)
    print("ТЕСТ 1. ДОЛЯ НАХОДОК, ЧЕЙ ФАЙЛ ПОПАЛ В ПЕРВЫЕ K")
    print("=" * 92)
    print("%-5s%12s%12s%12s%12s%10s"
          % ("K", "по весу", "по размеру", "по входам", "случайно", "конкурсов"))
    print("-" * 92)
    for k in (3, 5, 10, 15, 20):
        a = b = c = d = 0.0
        n = 0
        for x in cs:
            rows = x["rows"]
            if len(rows) <= k:
                continue
            by_size = sorted(rows, key=lambda r: -r["nsloc"])
            by_ext = sorted(rows, key=lambda r: -r["ext"])
            rnd = rows[:]
            random.shuffle(rnd)
            a += hit(rows, x["issues"], k)
            b += hit(by_size, x["issues"], k)
            c += hit(by_ext, x["issues"], k)
            d += hit(rnd, x["issues"], k)
            n += 1
        if n:
            print("%-5d%11.0f%%%11.0f%%%11.0f%%%11.0f%%%10d"
                  % (k, a / n * 100, b / n * 100, c / n * 100, d / n * 100, n))
    print("""
Вывод читать строго: «по весу» должно заметно бить «по размеру». Если
разница в пределах пары процентов, ранжирование по признакам не окупается
и правильнее просто читать крупные файлы — это бесплатно.""")


def test_lift(cs):
    """Какие признаки реально отличают файл с находкой от файла без неё.

    Это то, чем надо было заменить назначенные веса. Считаем долю файлов с
    находкой среди тех, где признак есть, и среди тех, где его нет.
    """
    print("=" * 92)
    print("ТЕСТ 2. КАКИЕ ПРИЗНАКИ ПРЕДСКАЗЫВАЮТ НАХОДКУ")
    print("=" * 92)
    stat = {}
    tot_hit = tot = 0
    for x in cs:
        hitnames = set()
        for i in x["issues"]:
            hitnames |= i["files"]
        for r in x["rows"]:
            is_hit = pathlib.Path(r["path"]).name in hitnames
            tot += 1
            tot_hit += is_hit
            for sig, _, _ in recon.SIGNALS:
                a, b, c, d = stat.setdefault(sig, [0, 0, 0, 0])
                if r["hits"].get(sig):
                    stat[sig][0] += 1
                    stat[sig][1] += is_hit
                else:
                    stat[sig][2] += 1
                    stat[sig][3] += is_hit
    base = tot_hit / tot if tot else 0
    print("файлов всего %d, из них с находкой %d (%.0f%%)\n"
          % (tot, tot_hit, base * 100))
    print("%-16s%10s%12s%12s%10s" %
          ("признак", "файлов", "с находкой", "без признака", "лифт"))
    print("-" * 92)
    rows = []
    for sig, (n1, h1, n0, h0) in stat.items():
        if n1 < 10 or n0 < 10:
            continue
        p1, p0 = h1 / n1, h0 / n0
        rows.append((p1 / p0 if p0 else 0, sig, n1, p1, p0))
    for lift, sig, n1, p1, p0 in sorted(rows, key=lambda r: -r[0]):
        print("%-16s%10d%11.0f%%%11.0f%%%10.2f" % (sig, n1, p1 * 100, p0 * 100, lift))
    print("""
Лифт 1.0 означает, что признак не отличает ничего. Веса в recon.SIGNALS
стоит переписать по этой колонке — тогда они станут измеренными, а не
назначенными. Признаки с лифтом около единицы убрать вовсе.""")


def test_curve(cs):
    """Сколько находок покрыто, если прочесть X% кода по нашему порядку."""
    print("=" * 92)
    print("ТЕСТ 3. КРИВАЯ «ПРОЧИТАНО КОДА / НАКРЫТО НАХОДОК»")
    print("=" * 92)
    print("%-14s%14s%14s%14s" % ("прочитано", "по весу", "по размеру", "случайно"))
    print("-" * 92)
    random.seed(11)
    for frac in (0.1, 0.2, 0.3, 0.5, 0.7):
        acc = [0.0, 0.0, 0.0]
        n = 0
        for x in cs:
            rows, iss = x["rows"], x["issues"]
            total = sum(r["nsloc"] for r in rows)
            if total < 500:
                continue
            orders = [rows, sorted(rows, key=lambda r: -r["nsloc"]), rows[:]]
            random.shuffle(orders[2])
            for j, order in enumerate(orders):
                got, take = 0, []
                for r in order:
                    if got + r["nsloc"] > total * frac and take:
                        break
                    take.append(r); got += r["nsloc"]
                acc[j] += hit(take, iss, len(take))
            n += 1
        if n:
            print("%-14s%13.0f%%%13.0f%%%13.0f%%"
                  % ("%.0f%% строк" % (frac * 100),
                     acc[0] / n * 100, acc[1] / n * 100, acc[2] / n * 100))
    print("""
Идеальный инструмент даёт 80%% находок за 20%% кода. Диагональ (сколько
прочёл, столько и накрыл) — это отсутствие пользы.""")


def fit_weights(cs):
    """Веса из измеренного лифта, а не из головы. Логарифм отношения долей."""
    import math
    stat = {}
    for x in cs:
        hn = set()
        for i in x["issues"]:
            hn |= i["files"]
        for r in x["rows"]:
            h = pathlib.Path(r["path"]).name in hn
            for sig, _, _ in recon.SIGNALS:
                s = stat.setdefault(sig, [0, 0, 0, 0])
                if r["hits"].get(sig):
                    s[0] += 1; s[1] += h
                else:
                    s[2] += 1; s[3] += h
    w = {}
    for sig, (n1, h1, n0, h0) in stat.items():
        if n1 < 10 or n0 < 10 or not h0:
            continue
        lift = (h1 / n1) / (h0 / n0)
        if lift > 1.0:
            w[sig] = math.log(lift)
    return w


def score_with(row, w, size_pow=0.0):
    """Вес файла по измеренным коэффициентам. size_pow=0 — размер не учитываем."""
    import math
    s = sum(v for sig, v in w.items() if row["hits"].get(sig))
    if size_pow:
        s *= max(row["nsloc"], 1) ** size_pow
    return s


def test_weights(cs, folds=2):
    """Обучаем веса на одной половине конкурсов, проверяем на другой.

    Иначе получится то, за что я уже ловил себя в этом проекте: подогнать
    коэффициенты по тем же данным и объявить результат измерением.
    """
    print("=" * 92)
    print("ТЕСТ 4. ИЗМЕРЕННЫЕ ВЕСА, ПРОВЕРКА НА ОТЛОЖЕННЫХ КОНКУРСАХ")
    print("=" * 92)
    if len(cs) < 8:
        print("  мало конкурсов для разбиения")
        return
    idx = list(range(len(cs)))
    random.seed(3)
    random.shuffle(idx)
    parts = [[cs[i] for i in idx[f::folds]] for f in range(folds)]

    print("%-14s%14s%14s%14s%14s"
          % ("прочитано", "изм. веса", "веса x размер", "по размеру", "случайно"))
    print("-" * 92)
    for frac in (0.1, 0.2, 0.3, 0.5):
        acc = [0.0, 0.0, 0.0, 0.0]
        n = 0
        for f in range(folds):
            train = [c for g in range(folds) if g != f for c in parts[g]]
            w = fit_weights(train)
            for x in parts[f]:
                rows, iss = x["rows"], x["issues"]
                total = sum(r["nsloc"] for r in rows)
                if total < 500:
                    continue
                o0 = sorted(rows, key=lambda r: -score_with(r, w))
                o1 = sorted(rows, key=lambda r: -score_with(r, w, 0.5))
                o2 = sorted(rows, key=lambda r: -r["nsloc"])
                o3 = rows[:]
                random.shuffle(o3)
                for j, order in enumerate((o0, o1, o2, o3)):
                    got, take = 0, []
                    for r in order:
                        if got + r["nsloc"] > total * frac and take:
                            break
                        take.append(r); got += r["nsloc"]
                    acc[j] += hit(take, iss, len(take))
                n += 1
        if n:
            print("%-14s%13.0f%%%13.0f%%%13.0f%%%13.0f%%"
                  % ("%.0f%% строк" % (frac * 100),
                     acc[0] / n * 100, acc[1] / n * 100,
                     acc[2] / n * 100, acc[3] / n * 100))
    w = fit_weights(cs)
    print("\nвеса, измеренные по всем данным (log лифта):")
    for sig, v in sorted(w.items(), key=lambda kv: -kv[1]):
        print("    %-16s %.2f" % (sig, v))
    print("""
Колонка «изм. веса» — порядок по одним признакам, размер не учитывается.
«веса x размер» — то же, но с поправкой на корень из размера. Если ни одна
не бьёт «по размеру» на отложенных конкурсах, признаки не окупаются как
способ упорядочить чтение, сколько их ни взвешивай.""")


def fcases(min_funcs=30, min_issues=3):
    """То же, что cases(), но на уровне ФУНКЦИЙ и с разметкой по строкам.

    Гипотеза: файловая гранулярность слишком груба. Большой файл выигрывает
    просто потому, что в нём много всего; функция — единица, которую человек
    читает целиком, и там признаки могут начать различать.
    """
    out = []
    for d in corpus.load_offline():
        rep = d.get("report") or ""
        if len(rep) < 500:
            continue
        iss = [x for x in corpus.parse_report(rep) if x["lines"]]
        if len(iss) < min_issues:
            continue
        mirror = d.get("template_repo_name")
        funcs, seen = [], set()
        for r in d.get("scope") or []:
            files = [f.get("name") for f in (r.get("files") or []) if f.get("name")]
            for cand in (repo_dir(r.get("repo"), r.get("commit_hash")),
                         repo_dir(mirror, None)):
                if has_code(cand):
                    for f in recon.walk_functions(cand, scope_files=files):
                        key = (f["path"], f["l0"], f["name"])
                        if key not in seen:
                            seen.add(key); funcs.append(f)
                    break
        if len(funcs) < min_funcs:
            continue
        # какие функции реально задеты находками
        for f in funcs:
            f["hit"] = False
        for x in iss:
            for fname, lines in x["lines"].items():
                for f in funcs:
                    if f["file"] == fname and any(f["l0"] <= l <= f["l1"] for l in lines):
                        f["hit"] = True
        out.append({"name": (mirror or "").replace("sherlock-audit/", ""),
                    "funcs": funcs, "issues": iss})
    return out


def test_funcs(cs):
    """Кривая покрытия на уровне функций, с теми же базовыми линиями."""
    import math
    print("=" * 92)
    print("ТЕСТ 5. ТО ЖЕ НА УРОВНЕ ФУНКЦИЙ, А НЕ ФАЙЛОВ")
    print("=" * 92)
    if not cs:
        print("  нет конкурсов с разметкой по строкам и скачанным кодом")
        return
    nf = sum(len(x["funcs"]) for x in cs)
    nh = sum(sum(1 for f in x["funcs"] if f["hit"]) for x in cs)
    print("конкурсов %d, функций %d, из них задето находками %d (%.0f%%)\n"
          % (len(cs), nf, nh, nh / nf * 100 if nf else 0))

    # лифт признаков на уровне функции
    stat = {}
    for x in cs:
        for f in x["funcs"]:
            for sig, _, _ in recon.SIGNALS:
                s = stat.setdefault(sig, [0, 0, 0, 0])
                if f["hits"].get(sig):
                    s[0] += 1; s[1] += f["hit"]
                else:
                    s[2] += 1; s[3] += f["hit"]
    print("%-16s%10s%12s%12s%10s"
          % ("признак", "функций", "задето", "без признака", "лифт"))
    print("-" * 92)
    w = {}
    rows = []
    for sig, (n1, h1, n0, h0) in stat.items():
        if n1 < 20 or n0 < 20 or not h0:
            continue
        p1, p0 = h1 / n1, h0 / n0
        lift = p1 / p0
        rows.append((lift, sig, n1, p1, p0))
        if lift > 1.0:
            w[sig] = math.log(lift)
    for lift, sig, n1, p1, p0 in sorted(rows, key=lambda r: -r[0]):
        print("%-16s%10d%11.0f%%%11.0f%%%10.2f" % (sig, n1, p1 * 100, p0 * 100, lift))

    # достижимость посторонним — прямая проверка гипотезы из инверсии «доступа»
    grp = {}
    for x in cs:
        for f in x["funcs"]:
            k = (bool(f.get("open")), bool(f["hits"].get("деньги")))
            a = grp.setdefault(k, [0, 0])
            a[0] += 1; a[1] += f["hit"]
    print("\nДОСТИЖИМОСТЬ ПОСТОРОННИМ ПРОТИВ ДЕНЕГ")
    print("%-34s%10s%12s" % ("класс функции", "функций", "задето"))
    print("-" * 92)
    label = {(True, True): "беспермиссионная + деньги",
             (True, False): "беспермиссионная, без денег",
             (False, True): "защищённая/внутренняя + деньги",
             (False, False): "защищённая/внутренняя, без денег"}
    for k in sorted(grp, key=lambda k: -(grp[k][1] / grp[k][0] if grp[k][0] else 0)):
        n, h = grp[k]
        if n < 20:
            continue
        print("%-34s%10d%11.0f%%" % (label[k], n, h / n * 100))

    # кривая покрытия при бюджете в строках, с перекрёстной проверкой
    print("\n%-14s%14s%14s%14s%14s"
          % ("прочитано", "по признакам", "по размеру", "по входам", "случайно"))
    print("-" * 92)
    random.seed(5)
    idx = list(range(len(cs)))
    random.shuffle(idx)
    parts = [[cs[i] for i in idx[f::2]] for f in range(2)]
    for frac in (0.05, 0.1, 0.2, 0.3, 0.5):
        acc = [0.0, 0.0, 0.0, 0.0]
        n = 0
        for fold in range(2):
            train = parts[1 - fold]
            ws = {}
            st_ = {}
            for x in train:
                for f in x["funcs"]:
                    for sig, _, _ in recon.SIGNALS:
                        s = st_.setdefault(sig, [0, 0, 0, 0])
                        if f["hits"].get(sig):
                            s[0] += 1; s[1] += f["hit"]
                        else:
                            s[2] += 1; s[3] += f["hit"]
            for sig, (n1, h1, n0, h0) in st_.items():
                if n1 >= 20 and n0 >= 20 and h0 and (h1 / n1) > (h0 / n0):
                    ws[sig] = math.log((h1 / n1) / (h0 / n0))
            for x in parts[fold]:
                fu = x["funcs"]
                tot = sum(f["nsloc"] for f in fu)
                hits_all = sum(1 for f in fu if f["hit"])
                if tot < 300 or not hits_all:
                    continue
                o0 = sorted(fu, key=lambda f: -sum(
                    v for s, v in ws.items() if f["hits"].get(s)))
                o1 = sorted(fu, key=lambda f: -f["nsloc"])
                o2 = sorted(fu, key=lambda f: -f["ext"])
                o3 = fu[:]
                random.shuffle(o3)
                for j, order in enumerate((o0, o1, o2, o3)):
                    got, cnt = 0, 0
                    for f in order:
                        if got + f["nsloc"] > tot * frac and cnt >= 0 and got:
                            break
                        got += f["nsloc"]
                        cnt += f["hit"]
                    acc[j] += cnt / hits_all
                n += 1
        if n:
            print("%-14s%13.0f%%%13.0f%%%13.0f%%%13.0f%%"
                  % ("%.0f%% строк" % (frac * 100),
                     acc[0] / n * 100, acc[1] / n * 100,
                     acc[2] / n * 100, acc[3] / n * 100))
    print("""
Здесь бюджет считается в строках функций, а покрытие — в доле задетых
находками функций. Веса обучены на половине конкурсов и применены к другой,
поэтому подгонки нет. Если «по признакам» бьёт «по размеру» — файловый
уровень был просто слишком грубым, и инструмент имеет смысл на функциях.""")


def test_cold(cs):
    """Работают ли ХОЛОДНЫЕ признаки там, где горячие слепы.

    Проверяется отдельно на подвыборке холодных функций (снаружи не дозваться,
    денег не двигают). Там горячие признаки по построению молчат, поэтому
    сравнение идёт с базовой ставкой ИМЕННО этой подвыборки, а не общей —
    иначе получится сравнение с чем угодно и цифра ничего не скажет.
    """
    print("=" * 92)
    print("ТЕСТ 6. ХОЛОДНЫЕ ПРИЗНАКИ: МАТЕМАТИКА УЧЁТА ВО ВСПОМОГАТЕЛЬНЫХ БИБЛИОТЕКАХ")
    print("=" * 92)
    cold = [f for x in cs for f in x["funcs"] if f.get("is_cold")]
    warm = [f for x in cs for f in x["funcs"] if not f.get("is_cold")]
    if len(cold) < 200:
        print("  холодных функций мало (%d)" % len(cold))
        return
    ch = sum(1 for f in cold if f["hit"])
    wh = sum(1 for f in warm if f["hit"])
    print("холодных функций %d, задето находками %d (%.0f%%)"
          % (len(cold), ch, ch / len(cold) * 100))
    print("остальных       %d, задето находками %d (%.0f%%)"
          % (len(warm), wh, wh / len(warm) * 100 if warm else 0))
    base = ch / len(cold)
    print("\nбазовая ставка внутри холодной подвыборки: %.0f%%\n" % (base * 100))

    stat = {}
    for f in cold:
        for name, _ in recon.COLD:
            s = stat.setdefault(name, [0, 0, 0, 0])
            if f["cold"].get(name):
                s[0] += 1; s[1] += f["hit"]
            else:
                s[2] += 1; s[3] += f["hit"]
    print("%-24s%10s%12s%12s%10s"
          % ("признак", "функций", "задето", "без признака", "лифт"))
    print("-" * 92)
    rows = []
    for name, (n1, h1, n0, h0) in stat.items():
        if n1 < 20 or n0 < 20 or not h0:
            continue
        rows.append(((h1 / n1) / (h0 / n0), name, n1, h1 / n1, h0 / n0))
    for lift, name, n1, p1, p0 in sorted(rows, key=lambda r: -r[0]):
        print("%-24s%10d%11.0f%%%11.0f%%%10.2f" % (name, n1, p1 * 100, p0 * 100, lift))

    # покрытие внутри холодной подвыборки, с перекрёстной проверкой
    import math
    print("\nПОКРЫТИЕ ВНУТРИ ХОЛОДНОЙ ПОДВЫБОРКИ")
    print("%-14s%16s%14s%14s" % ("прочитано", "холодные пр.", "по размеру", "случайно"))
    print("-" * 92)
    random.seed(9)
    idx = list(range(len(cs)))
    random.shuffle(idx)
    parts = [[cs[i] for i in idx[f::2]] for f in range(2)]
    for frac in (0.1, 0.2, 0.3, 0.5):
        acc = [0.0, 0.0, 0.0]
        n = 0
        for fold in range(2):
            st_ = {}
            for x in parts[1 - fold]:
                for f in x["funcs"]:
                    if not f.get("is_cold"):
                        continue
                    for name, _ in recon.COLD:
                        s = st_.setdefault(name, [0, 0, 0, 0])
                        if f["cold"].get(name):
                            s[0] += 1; s[1] += f["hit"]
                        else:
                            s[2] += 1; s[3] += f["hit"]
            w = {}
            for name, (n1, h1, n0, h0) in st_.items():
                if n1 >= 20 and n0 >= 20 and h0 and (h1 / n1) > (h0 / n0):
                    w[name] = math.log((h1 / n1) / (h0 / n0))
            for x in parts[fold]:
                fu = [f for f in x["funcs"] if f.get("is_cold")]
                tot = sum(f["nsloc"] for f in fu)
                hits_all = sum(1 for f in fu if f["hit"])
                if tot < 200 or not hits_all:
                    continue
                o0 = sorted(fu, key=lambda f: -sum(
                    v for s, v in w.items() if f["cold"].get(s)))
                o1 = sorted(fu, key=lambda f: -f["nsloc"])
                o2 = fu[:]
                random.shuffle(o2)
                for j, order in enumerate((o0, o1, o2)):
                    got, cnt = 0, 0
                    for f in order:
                        if got + f["nsloc"] > tot * frac and got:
                            break
                        got += f["nsloc"]; cnt += f["hit"]
                    acc[j] += cnt / hits_all
                n += 1
        if n:
            print("%-14s%15.0f%%%13.0f%%%13.0f%%"
                  % ("%.0f%% строк" % (frac * 100),
                     acc[0] / n * 100, acc[1] / n * 100, acc[2] / n * 100))
    print("""
Если холодные признаки не бьют размер и внутри своей подвыборки — значит
слепая зона названа верно, но заполнить её этими признаками не вышло, и
честнее сказать это, чем поставить веса и сделать вид, что измерил.""")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test",
                    choices=("rank", "lift", "curve", "weights", "funcs",
                             "cold", "all"),
                    default="all")
    ap.add_argument("--min", type=int, default=8,
                    help="минимум конкурсов, иначе не делать выводов")
    args = ap.parse_args()

    if args.test in ("funcs", "cold"):
        fc = fcases()
        if args.test == "funcs":
            test_funcs(fc)
        else:
            test_cold(fc)
        return

    cs = cases()
    print("конкурсов, пригодных к проверке: %d" % len(cs))
    if cs:
        print("находок в них: %d, файлов: %d"
              % (sum(len(x["issues"]) for x in cs), sum(len(x["rows"]) for x in cs)))
        print("  " + ", ".join(x["name"][:22] for x in cs[:6])
              + (" и ещё %d" % (len(cs) - 6) if len(cs) > 6 else ""))
    print()
    if len(cs) < args.min:
        print("Мало данных для выводов: нужно минимум %d конкурсов." % args.min)
        print("Скачай репозитории: python prefetch.py --repos --limit 40")
        if not cs:
            return
        print("Ниже — предварительные числа, доверять им рано.\n")

    if args.test in ("rank", "all"):
        test_rank(cs)
    if args.test in ("lift", "all"):
        print()
        test_lift(cs)
    if args.test in ("curve", "all"):
        print()
        test_curve(cs)
    if args.test in ("weights", "all"):
        print()
        test_weights(cs)
    if args.test in ("funcs", "all"):
        print()
        fc = fcases()
        test_funcs(fc)


if __name__ == "__main__":
    main()
