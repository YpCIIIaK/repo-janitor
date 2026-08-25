"""Мишени: выбрать программы с любых площадок и завести по ним работу.

`market.py` отвечает на вопрос «куда идти», этот — «начали». Он держит
СПИСОК ВЫБРАННОГО (мультивыбор, площадки вперемешку) и по каждой мишени
готовит рабочую папку: скоуп, адреса, скачанный исходник, отчёты, прогон
всех сигналов.

    python targets.py                       что выбрано и в каком состоянии
    python targets.py --pick                выбрать из рынка: «1,4,7» или «1-5»
    python targets.py --pick --site immunefi --repos     тот же выбор с фильтром
    python targets.py --add immunefi:alchemix            без интерактива
    python targets.py --drop alchemix
    python targets.py --prep alchemix       папка, BRIEF.md, исходники, отчёты
    python targets.py --scan alchemix       прогнать сигналы по скачанному
    python targets.py --scan all            по всем подготовленным

Рабочая папка мишени — `data/bounty/<slug>/`:

    BRIEF.md        скоуп, адреса, репозитории, ссылка, что уже сделано
    signals/*.txt   вывод каждого сигнала, целиком
    src/            распакованный исходник (по репозиторию на подпапку)

ПОЧЕМУ ПАПКА, А НЕ ВЫВОД В КОНСОЛЬ. Сигнал даёт не находку, а вопросы, и
вопросов сотни. Их надо просматривать несколько заходов и вычёркивать; в
консоли это невозможно, а в файле — обычная работа.

ПОРЯДОК РАБОТЫ НЕ МЕНЯЕТСЯ: сначала `--prep`, потом взгляд в BRIEF на
адреса и версию в проде (`deployed.py`), и только потом чтение кода. Мишень
без публичного исходника `--prep` возьмёт, но читать там будет нечего —
такие видно сразу по строке «репозиториев 0».
"""
import argparse
import datetime as dt
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import tarfile
import urllib.request

import market as market_cli
import runlog

# Консоль Windows отдаёт cp1251, и печать русской строки роняла ВЕСЬ прогон
# на середине: UnicodeEncodeError убивал скан после первого же шага, а в
# журнале оставалось «идёт» навсегда. Вывод инструмента не должен зависеть
# от кодовой страницы того, кто его запустил.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
from scout import market as M

ROOT = pathlib.Path(__file__).resolve().parent
PICKED = ROOT / "data" / "targets.json"
WORK = ROOT / "data" / "bounty"

ADDR = re.compile(r"\b0x[a-fA-F0-9]{40}\b")


def slug(name):
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
    return s[:40] or "target"


def picked():
    if not PICKED.exists():
        return []
    return json.loads(PICKED.read_text(encoding="utf-8"))


def save(rows):
    PICKED.parent.mkdir(parents=True, exist_ok=True)
    PICKED.write_text(json.dumps(rows, ensure_ascii=False, indent=1),
                      encoding="utf-8")


def programs():
    progs = market_cli.load()
    if progs is None:
        print("снимка нет: сперва `python market.py --refresh`")
        sys.exit(1)
    return progs


def find(progs, ident):
    """«immunefi:alchemix», «alchemix» или часть имени."""
    site, _, pid = ident.partition(":")
    for p in progs:
        if pid and p.site == site and p.pid.lower() == pid.lower():
            return p
    # «immunefi:alchemix»: если площадка названа, ищем имя только внутри неё
    pool = [p for p in progs if p.site == site] if (pid and site in M.SOURCES) else progs
    low = (pid or ident).lower()
    hits = [p for p in pool if p.pid.lower() == low] or \
           [p for p in pool if low in p.name.lower()]
    return sorted(hits, key=market_cli.key)[0] if hits else None


def rowdict(p):
    return {"site": p.site, "pid": p.pid, "name": p.name, "url": p.url,
            "slug": slug(p.name), "reward": p.reward, "fee": p.fee,
            "kyc": p.kyc, "reports": p.reports,
            "assets": list(p.assets), "repos": list(p.repos)}


# ------------------------------------------------------------------ выбор

def parse_sel(text, n):
    """«1,4,7» и «1-5» вперемешку -> индексы."""
    out = []
    for part in re.split(r"[,\s]+", text.strip()):
        if not part:
            continue
        if "-" in part:
            a, _, b = part.partition("-")
            try:
                out += list(range(int(a), int(b) + 1))
            except ValueError:
                continue
        elif part.isdigit():
            out.append(int(part))
    return [i for i in out if 1 <= i <= n]


def pick(progs, args):
    sel = progs
    if args.site:
        sel = [p for p in sel if p.site == args.site]
    if not args.all:
        sel = [p for p in sel if p.sc]
    if args.repos:
        sel = [p for p in sel if p.repos]
    sel = sorted(sel, key=market_cli.key)[:args.limit]
    print("%-4s%-30s%-12s%11s%8s%8s%14s%7s"
          % ("№", "программа", "площадка", "макс.$", "активов", "заявок",
             "заявок/актив", "репо"))
    print("-" * 96)
    for i, p in enumerate(sel, 1):
        d = p.density
        print("%-4d%-30s%-12s%11s%8s%8s%14s%7s"
              % (i, p.name[:29], p.site, market_cli.m(p.reward),
                 p.n_assets or "-", p.reports if p.reports >= 0 else "?",
                 "%.1f" % d if d is not None else "?", len(p.repos) or ""))
    print("\nНомера через запятую, диапазоны через дефис. Пустая строка — выход.")
    try:
        text = input("выбрать: ")
    except EOFError:
        return
    idx = parse_sel(text, len(sel))
    if not idx:
        print("ничего не выбрано")
        return
    rows = picked()
    have = {(r["site"], r["pid"]) for r in rows}
    for i in idx:
        p = sel[i - 1]
        if (p.site, p.pid) in have:
            print("уже выбрано: %s" % p.name)
            continue
        rows.append(rowdict(p))
        print("добавлено: %-30s %s" % (p.name[:29], p.url))
    save(rows)
    print("\nДальше:  python targets.py --prep <имя>")


def show(rows):
    if not rows:
        print("мишеней не выбрано.  python targets.py --pick")
        return
    print("%-4s%-28s%-12s%11s%8s%8s   %s"
          % ("№", "мишень", "площадка", "макс.$", "репо", "активов", "готово"))
    print("-" * 88)
    for i, r in enumerate(rows, 1):
        d = WORK / r["slug"]
        state = []
        if (d / "BRIEF.md").exists():
            state.append("brief")
        if (d / "src").exists() and any((d / "src").iterdir()):
            state.append("src")
        sig = d / "signals"
        if sig.exists() and any(sig.iterdir()):
            state.append("сигналы")
        print("%-4d%-28s%-12s%11s%8s%8s   %s"
              % (i, r["name"][:27], r["site"], market_cli.m(r["reward"]),
                 len(r["repos"]) or "-", len(r["assets"]) or "-",
                 "+".join(state) or "-"))
    print("\n  --prep <имя>   подготовить      --scan <имя>   прогнать сигналы")


# --------------------------------------------------------------- подготовка

def gh_default_branch(owner, repo):
    """Реальная ветка по умолчанию из GitHub API. None если не спросить.

    Enzyme и не только держат код на нестандартной ветке (не main/master):
    без этого запроса prep брал пустоту и мишень уходила в скан без дерева."""
    api = "https://api.github.com/repos/%s/%s" % (owner, repo)
    head = {"User-Agent": "auditscout", "Accept": "application/vnd.github+json"}
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        head["Authorization"] = "Bearer " + tok
    try:
        d = json.loads(urllib.request.urlopen(
            urllib.request.Request(api, headers=head), timeout=30).read())
        return d.get("default_branch")
    except Exception:
        return None


def fetch_repo(url, dest):
    """Скачать дерево репозитория архивом. Ветку СПРАШИВАЕМ у API, потом
    пробуем main/master как запас (API мог не ответить)."""
    owner, repo = url.rstrip("/").split("/")[3:5]
    repo = repo.replace(".git", "")
    out = dest / ("%s__%s" % (owner, repo))
    if out.exists() and any(out.iterdir()):
        return out, "уже скачан"
    # реальная ветка первой, дальше запас; дедуп с сохранением порядка
    refs = [r for r in (gh_default_branch(owner, repo), "main", "master") if r]
    seen = set()
    refs = [r for r in refs if not (r in seen or seen.add(r))]
    for ref in refs:
        link = "https://codeload.github.com/%s/%s/tar.gz/%s" % (owner, repo, ref)
        try:
            req = urllib.request.Request(link, headers={"User-Agent": "Mozilla/5.0"})
            blob = urllib.request.urlopen(req, timeout=120).read()
        except Exception:
            continue
        out.mkdir(parents=True, exist_ok=True)
        with tarfile.open(fileobj=io.BytesIO(blob)) as t:
            # только исходники: архивы репозиториев тянут гигабайты картинок
            # Отсев по расширению мало: у Lido один репозиторий дал 34 МБ
            # артефактов сборки в .json. Режем ещё по размеру и по пути.
            noise = ("/node_modules/", "/artifacts/", "/cache/", "/coverage/",
                     "/.git/", "package-lock.json", "yarn.lock")
            members = [m for m in t.getmembers()
                       if m.isfile() and m.size <= 1_500_000
                       and not any(x in m.name for x in noise)
                       and pathlib.Path(m.name).suffix.lower() in
                       (".sol", ".rs", ".vy", ".move", ".cairo", ".go", ".ts",
                        ".js", ".json", ".md", ".toml", ".yaml", ".yml")]
            t.extractall(out, members=members, filter="data")
        return out, "скачан %s (%d файлов)" % (ref, len(members))
    return out, ("НЕ СКАЧАН (ветки %s не отдались, или репозиторий закрыт)"
                 % "/".join(refs or ["main", "master"]))


def brief(r, d, notes):
    addrs = sorted({a for x in r["assets"] for a in ADDR.findall(json.dumps(x))})
    L = ["# %s — %s" % (r["name"], r["site"]), "",
         "    ссылка   %s" % r["url"],
         "    максимум %s $" % market_cli.m(r["reward"]),
         "    комиссия %s     KYC %s" % (("%.0f$" % r["fee"]) if r["fee"] else "нет",
                                         "да" if r["kyc"] else "нет"),
         "    заявок   %s     активов %d"
         % (r["reports"] if r["reports"] >= 0 else "не публикуется",
            len(r["assets"])), ""]
    if r["repos"]:
        L += ["## Репозитории", ""] + ["    %s" % x for x in r["repos"]] + [""]
    L += ["## Активы в скоупе", ""]
    for a in r["assets"][:120]:
        L.append("    %-70s %s" % (str(a.get("name") or a.get("url") or "")[:70],
                                   str(a.get("type") or "")[:20]))
    if len(r["assets"]) > 120:
        L.append("    ... ещё %d" % (len(r["assets"]) - 120))
    if addrs:
        L += ["", "## Адреса из скоупа — СВЕРИТЬ ВЕРСИЮ В ПРОДЕ ДО ЧТЕНИЯ КОДА", ""]
        L += ["    %s" % a for a in addrs[:60]]
        L += ["", "    python deployed.py --rpc <URL> --addr-file <файл> --src src/"]
    L += ["", "## Что сделано при подготовке", ""] + ["    %s" % n for n in notes]
    L += ["", "## Порядок", "",
          "1. версия в проде по адресам (deployed.py) — ПЕРВЫМ делом;",
          "2. сигналы: python targets.py --scan %s;" % r["slug"],
          "3. читать signals/*.txt заходами, вычёркивая; каждую прочитанную",
          "   заплатку — строкой в data/LEDGER.md;",
          "4. подача только с PoC и только по каналу программы.", ""]
    (d / "BRIEF.md").write_text("\n".join(L), encoding="utf-8")


def prep(r):
    d = WORK / r["slug"]
    (d / "src").mkdir(parents=True, exist_ok=True)
    (d / "signals").mkdir(exist_ok=True)
    print("== %s  ->  %s" % (r["name"], d))
    run = runlog.Run(r["slug"], "prep", target=r["name"],
                     site=r["site"], url=r["url"], repos=len(r["repos"] or []))
    notes = []
    for url in r["repos"]:
        with run.step("скачать %s" % url.rsplit("/", 1)[-1], cmd=url) as s:
            out, how = fetch_repo(url, d / "src")
            files = sum(1 for _ in out.rglob("*")) if out.exists() else 0
            s.done(text=how, files=files, path=str(out))
        print("   %-58s %s" % (url, how))
        notes.append("%s — %s" % (url, how))
    if not r["repos"]:
        print("   репозиториев в скоупе НЕТ: исходник искать по адресам "
              "(deployed.py + Sourcify)")
        notes.append("репозиториев в скоупе нет")
        run.note("репозиториев в скоупе нет — исходник искать по адресам")
    with run.step("собрать BRIEF.md") as s:
        brief(r, d, notes)
        s.done(path=str(d / "BRIEF.md"), assets=len(r["assets"] or []))
    print("   BRIEF.md записан")
    with run.step("собрать scope.json") as s:
        import scope as _scope
        m = _scope.build(r)
        _scope.write(r["slug"], m)
        s.done(path=str(d / "scope.json"), exclude=len(m["exclude_globs"]),
               addresses=len(m["addresses"]))
    print("   scope.json записан (исключений: %d)" % len(m["exclude_globs"]))
    run.end()


# ----------------------------------------------------------------- проверка

def gh_pushed(url):
    """Когда в репозиторий последний раз что-то клали. Один дешёвый запрос."""
    owner, repo = url.rstrip("/").split("/")[3:5]
    repo = repo.replace(".git", "")
    api = "https://api.github.com/repos/%s/%s" % (owner, repo)
    head = {"User-Agent": "auditscout", "Accept": "application/vnd.github+json"}
    tok = os.environ.get("GITHUB_TOKEN")
    if tok:
        head["Authorization"] = "Bearer " + tok
    try:
        d = json.loads(urllib.request.urlopen(
            urllib.request.Request(api, headers=head), timeout=30).read())
        return d.get("pushed_at", "")[:10], bool(d.get("archived")), "ok"
    except Exception as e:
        # Различать ОБЯЗАТЕЛЬНО. Раньше и «репозиторий удалён», и «сеть
        # моргнула» возвращали одно и то же пустое значение, и мёртвая
        # ссылка в скоупе выглядела как «пока не знаем». У Spark так и
        # вышло: три ссылки из десяти вели в никуда (проект уехал с
        # marsfoundation на sparkdotfi), а --check молчал — потому что
        # смотрел только дату последнего push, которой у мёртвых нет.
        code = getattr(e, "code", None)
        if code in (404, 451):
            return "", False, "нет"
        return "", False, "?"


def check(rows):
    """Живы ли мишени и что с ними стало. Дёшево: снимок + по запросу на репо.

    Сравнивается ВЫБРАННОЕ против свежего снимка рынка, а не весь рынок
    против себя. Программ у нас единицы, репозиториев десятки — это секунды
    против минут, и именно это имеет смысл гонять хоть каждый день.
    """
    live = {"%s:%s" % (p.site, p.pid): p for p in programs()}
    today = dt.date.today()
    run = runlog.Run("_all", "check", target="все мишени", targets=len(rows))
    print("%-26s%-12s%8s%7s  %-22s%s"
          % ("мишень", "площадка", "заявок", "было", "правки в репо",
             "состояние"))
    print("-" * 100)
    for r in rows:
        p = live.get("%s:%s" % (r["site"], r["pid"]))
        state = "ЖИВА"
        if p is None:
            # Программа исчезла из снимка: закрыта, ушла в приват или
            # площадка сменила формат. Работать по ней нельзя — подать некуда.
            state = "НЕТ В СНИМКЕ — проверить руками"
        elif p.fee != r.get("fee") or p.kyc != r.get("kyc"):
            state = "УСЛОВИЯ ИЗМЕНИЛИСЬ (комиссия/KYC)"
        elif p.reports >= 0 and r.get("reports", -1) >= 0 and \
                p.reports > r["reports"] * 1.5:
            state = "ТЕСНЕЕТ"
        with run.step(r["name"][:40], site=r["site"]) as st:
            st.done(state=state,
                    reports_now=p.reports if p and p.reports >= 0 else None,
                    reports_was=r.get("reports"))
        pushed, dead = [], []
        for url in r.get("repos") or []:
            when, archived, status = gh_pushed(url)
            if status == "нет":
                dead.append(url)
                pushed.append("НЕТ")
            elif archived:
                pushed.append("архив")
            elif when:
                days = (today - dt.date.fromisoformat(when)).days
                pushed.append("%dд" % days)
        if dead:
            # Мёртвая ссылка в скоупе — не мелочь: скан по ней молча
            # недосчитается сигналов от дерева, а «ноль зацепок» прочтётся
            # как «чисто». Поэтому это состояние мишени, а не примечание.
            state = "%d МЁРТВЫХ ССЫЛОК В СКОУПЕ" % len(dead)
        print("%-26s%-12s%8s%7s  %-22s%s"
              % (r["name"][:25], r["site"],
                 p.reports if p and p.reports >= 0 else "?",
                 r.get("reports") if r.get("reports", -1) >= 0 else "?",
                 ", ".join(pushed[:3]) or "-", state))
        for u in dead:
            print("      МЁРТВАЯ ССЫЛКА: %s" % u)
            run.note("мёртвая ссылка в скоупе: %s" % u, dead=True)
        if p is not None:
            r.update({"reward": p.reward, "fee": p.fee, "kyc": p.kyc,
                      "reports": p.reports, "assets": list(p.assets),
                      "repos": list(p.repos)})
    save(rows)
    run.end()
    print("""
«правки» — сколько дней назад последний push в репозиторий скоупа. Свежий
код это код, которого не видел ни один аудитор; заброшенный (или «архив») —
мишень, где искать нечего и платить, скорее всего, некому.
«было» против «заявок» — рост тесноты с момента выбора.""")


# ------------------------------------------------------------------- сигналы

def run_tool(cmd, out_file):
    try:
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        p = subprocess.run([sys.executable] + cmd, cwd=str(ROOT), env=env,
                           capture_output=True, text=True, timeout=1800,
                           encoding="utf-8", errors="replace")
        text = (p.stdout or "") + (("\n[stderr]\n" + p.stderr) if p.stderr else "")
    except Exception as e:
        text = "ОШИБКА запуска: %s" % e
    out_file.write_text(text, encoding="utf-8")
    body = [l for l in text.splitlines() if l.strip()]
    return len(body), body[:6]


# Строки вида «путь.sol:123» — то, ради чего сигнал и запускался. Из них
# получаются «кандидаты» в журнале: файл, строка и чем он смущает.
HIT = re.compile(r"([\w./\-]+\.(?:sol|rs|vy|cairo|move|go)):(\d+)")


# Разделы вывода, ниже которых идут НЕ зацепки, а объяснения: что шлюз
# закрыл сам, что понижено (гейт в другом файле), что подавлено памятью.
# Инструменты печатают там те же «файл:строка», и без этой границы
# понижённое возвращалось в журнал как зацепка — работа по отсеву шума
# пропадала ровно на последнем шаге. Замерено на Spark: ungated ужался с
# 85 строк до 25, а зацепок в журнале осталось столько же.
NOT_LEADS = ("ПОНИЖЕНО", "УБИТО ШЛЮЗОМ", "ПОДАВЛЕНО ПАМЯТЬЮ",
             "ПРОПУЩЕНО", "ОТБРОШЕНО")


# Дефолтные публичные RPC по сети для deployed (read-only view-вызовы). Только
# сети, где у нас есть и verify-источник, и узел — иначе deployed не с чем
# сравнить. Нет сети в карте -> адрес пропускается.
DEPLOY_RPCS = {
    1: "https://ethereum-rpc.publicnode.com",
    10: "https://optimism-rpc.publicnode.com",
    8453: "https://base-rpc.publicnode.com",
    42161: "https://arbitrum-one-rpc.publicnode.com",
}
DEPLOY_CAP = 25          # максимум адресов на сеть за скан — потолок стоимости
XCHAIN_CAP = 6           # максимум пар L1<->L2 за скан
MIRROR_MIN = 5.0         # порог зеркальности (как у mirrorscan.py --min)


# Канонические имена файлов часто форкаемых протоколов -> апстрим на гитхабе.
# forkdiff нужен ИСТОЧНИК (против чего дифать), а он не выводится из scope. Но
# сам forkdiff подсказывает маркер: «просто имя контракта». Наличие в дереве
# файла с таким именем = дерево форкнуло этот протокол -> дифаем против апстрима.
# Только ФОРК-ЦЕЛИ (не библиотеки типа OZ/solmate — их «дифф» это шум).
FORK_MAP = {
    "uniswapv2pair.sol": "Uniswap/v2-core", "uniswapv2factory.sol": "Uniswap/v2-core",
    "uniswapv3pool.sol": "Uniswap/v3-core", "uniswapv3factory.sol": "Uniswap/v3-core",
    "comptroller.sol": "compound-finance/compound-protocol",
    "cerc20.sol": "compound-finance/compound-protocol",
    "ctoken.sol": "compound-finance/compound-protocol",
    "masterchef.sol": "sushiswap/sushiswap",
    "gaugev2.sol": "velodrome-finance/contracts",
}


def _fork_upstreams(tree, cap=2):
    """Апстримы, форк которых виден в дереве по каноническому имени файла.
    Возвращает список owner/repo (не больше cap). Пусто -> forkdiff не с чем
    сравнивать, не запускаем."""
    found = []
    for dirpath, dirnames, files in os.walk(str(tree)):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
        for f in files:
            up = FORK_MAP.get(f.lower())
            if up and up not in found:
                found.append(up)
                if len(found) >= cap:
                    return found
    return found


def _is_mirror(repos):
    """MIRROR-гейт: хоть один репозиторий выглядит зеркалом рынка (частые
    импорт-снапшоты, мало родных коммитов). Дорогой on-chain-разбор deployed
    имеет смысл только там — у faithfully-публикующей команды прод == репо.
    Сеть недоступна / mirrorscan упал -> считаем НЕ зеркалом (не гоняем)."""
    try:
        import mirrorscan
    except Exception:
        return False
    for url in repos or []:
        try:
            owner, repo = url.rstrip("/").split("/")[3:5]
            s = mirrorscan.score(owner, repo.replace(".git", ""))
            if isinstance(s.get("score"), (int, float)) and s["score"] >= MIRROR_MIN:
                return True
        except Exception:
            continue
    return False


def hits_in(path, limit=25):
    out = []
    try:
        for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
            if any(line.lstrip().startswith(k) for k in NOT_LEADS):
                break
            m = HIT.search(line)
            if m:
                out.append((m.group(1), int(m.group(2)), line.strip()[:160]))
            if len(out) >= limit:
                break
    except OSError:
        pass
    return out


def archive_signals(d, fresh):
    """Убрать прошлые сигналы в архив и вернуть (номер версии, что было).

    Зачем версии. Пайплайн меняется: добавился инструмент, поправился порог,
    обновился исходник. Перезапись «поверх» стирает то, с чем сравнивать, и
    вопрос «стало ли лучше» перестаёт иметь ответ. Поэтому текущий прогон
    всегда лежит в `signals/` (туда смотрят все скрипты и BRIEF), а прошлый
    уезжает в `archive/vN/` целиком.
    """
    sig = d / "signals"
    arch = d / "archive"
    have = sorted(sig.glob("*.txt")) if sig.exists() else []
    version = 1 + len(list(arch.glob("v*"))) if arch.exists() else 1
    if not have or not fresh:
        return version, {}
    prev = {f.stem: _tally(f) for f in have}
    dst = arch / ("v%d" % version)
    dst.mkdir(parents=True, exist_ok=True)
    for f in have:
        f.replace(dst / f.name)
    print("   прошлый скан убран в archive/v%d (%d файлов)" % (version, len(have)))
    return version + 1, prev


def _tally(path):
    """Сводка файла сигнала: строк и адресов файл:строка."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return {"lines": 0, "hits": 0}
    return {"lines": sum(1 for l in text.splitlines() if l.strip()),
            "hits": len(HIT.findall(text))}


def scan(r, fresh=False):
    d = WORK / r["slug"]
    sig = d / "signals"
    sig.mkdir(parents=True, exist_ok=True)
    version, prev = archive_signals(d, fresh)
    print("== сигналы по %s (скан v%d)" % (r["name"], version))
    trees = [x for x in (d / "src").glob("*") if x.is_dir()] if (d / "src").exists() else []

    # ШОВ market->scan: выбрал мишень — трек должен собраться САМ. Если в скоупе
    # есть репозитории, а дерева ещё нет (--prep не звали), скан прежде молча
    # пропускал ВСЕ сигналы от дерева и выглядел успешным пустым прогоном
    # (Starknet: 7 секунд, ноль зацепок — не «чисто», а «не смотрели»). Теперь
    # scan сам делает prep — один targets.py правит и CLI, и кнопку в UI.
    autoprep = False
    if r["repos"] and not trees:
        print("   дерева нет, а репозитории в скоупе есть — собираю (авто-prep)")
        autoprep = True
        prep(r)
        trees = [x for x in (d / "src").glob("*") if x.is_dir()] if (d / "src").exists() else []

    jobs = []
    # Сигнал от ЧУЖОГО корпуса: конкурсы Code4rena по этой мишени. Он не
    # зависит ни от репозитория, ни от скачанного дерева, поэтому идёт
    # первым и работает даже там, где исходника нет вовсе. Его задача —
    # сказать, какие файлы УЖЕ названы отчётами: без этого blindspots
    # объявляет нетронутым то, по чему прошёл целый конкурс.
    jobs.append(("c4_%s" % slug(r["name"]), ["c4.py", r["name"]]))
    for url in r["repos"]:
        # Отчёты Cantina связываются с мишенью ПО РЕПОЗИТОРИЮ: у них в
        # карточке лежит настоящая ссылка на код протокола, а не зеркало
        # площадки. Поэтому запрос по каждому репо, а не один по имени —
        # точное совпадение дороже одного лишнего вызова.
        owner, repo = url.rstrip("/").split("/")[3:5]
        jobs.append(("cantina_%s__%s" % (owner, repo.replace(".git", "")),
                     ["cantina.py", "--repo", "%s/%s" % (owner, repo)]))
    if not r["repos"]:
        # Репозиториев нет — связываемся по имени, как умеем.
        jobs.append(("cantina_%s" % slug(r["name"]),
                     ["cantina.py", r["name"]]))
    for url in r["repos"]:
        owner, repo = url.rstrip("/").split("/")[3:5]
        repo = repo.replace(".git", "")
        name = "%s__%s" % (owner, repo)
        # сигналы от ОТЧЁТА: заплатки, слепые пятна, скопированные рекомендации
        jobs.append(("audits_%s" % name, ["audits.py", "--repo", "%s/%s" % (owner, repo)]))
        jobs.append(("blindspots_%s" % name, ["blindspots.py", "%s/%s" % (owner, repo)]))
        jobs.append(("recodiff_%s" % name, ["recodiff.py", "%s/%s" % (owner, repo)]))
    for t in trees:
        # сигналы от ДЕРЕВА: они не зависят от отчётов и работают всегда.
        # ungated/msgauth получают --slug: их вердикты текут в память шлюза
        # (gatemem), а закрытое ранее руками/моделью на этом заходе гасится —
        # петля «kill|lead -> память -> следующий заход» замкнута.
        jobs.append(("siblings_%s" % t.name, ["siblings.py", str(t)]))
        jobs.append(("statesync_%s" % t.name, ["statesync.py", str(t)]))
        jobs.append(("ungated_%s" % t.name,
                     ["ungated.py", str(t), "--min", "5", "--slug", r["slug"],
                      "--all"]))
        jobs.append(("msgauth_%s" % t.name,
                     ["msgauth.py", str(t), "--slug", r["slug"], "--all"]))
        # Сильный инструмент, подключённый условно (есть дерево): callgraph
        # --bypass ловит класс, который ungated по построению НЕ видит — «гейт
        # ЕСТЬ, но валидация в ВЫЗЫВАЮЩЕМ, а цель стока из параметра». Ровно
        # слепое пятно, вскрытое bench.py. Механический, без сети.
        jobs.append(("callgraph_%s" % t.name,
                     ["callgraph.py", str(t), "--bypass"]))
        # custody — инварианты custodial-ЯДРА (инфляция долей/донат/округление),
        # куда ungated слеп по построению. Гейт внутри: только контракты, что
        # fundflow метит кастодианом. Механический, без сети.
        jobs.append(("custody_%s" % t.name,
                     ["custody.py", str(t)]))
        # forkdiff — маленькая правка в знакомом форк-файле. Условие: в дереве
        # виден форк канонического протокола (имя файла из FORK_MAP). Апстрим
        # тянется сам (--gh). Без обнаруженного форка — не с чем сравнивать.
        for up in _fork_upstreams(t):
            tag = up.split("/")[-1]
            jobs.append(("forkdiff_%s__%s" % (t.name, tag),
                         ["forkdiff.py", str(t), "--gh", up]))

    # Сильный инструмент, подключённый условно (есть адреса С СЕТЬЮ в scope):
    # unverified ловит боевой impl без исходника ни в Sourcify, ни на
    # Blockscout, ни на Etherscan — класс обоих хитов проекта. Свой
    # chain-handling и read-only; сеть берём из scope.addr_chains (атрибуция по
    # explorer-ссылке, не гадаем mainnet). Без chain-адресов — не запускаем.
    try:
        import scope as _sc
        _man0 = _sc.load(r["slug"])
    except Exception:
        _man0 = None
    if _man0 and _man0.get("addr_chains"):
        inv_path = d / "unverified_inv.json"
        inv_path.write_text(json.dumps({r["name"]: _man0["addr_chains"]},
                                       ensure_ascii=False), encoding="utf-8")
        jobs.append(("unverified_%s" % r["slug"],
                     ["unverified.py", "--inv", str(inv_path)]))

    # deployed — версия/размер боевого кода против репо. Подключён условно и за
    # ДВОЙНЫМ гейтом: (1) есть адреса с сетью [[scope-manifest]] addr_chains, и
    # (2) MIRROR-гейт — репо выглядит зеркалом (mirrorscan.score >= порога).
    # Зачем зеркальный гейт: у faithfully-публикующей команды прод == репо, и
    # десятки on-chain-проб дадут ноль — тратить сеть незачем; divergence бьёт
    # только на зеркале. Теперь сеть берём ПРАВИЛЬНУЮ (addr_chains), не chain=1.
    if _man0 and _man0.get("addr_chains") and trees and _is_mirror(r["repos"]):
        by_chain = {}
        for ch, ad in _man0["addr_chains"]:
            if ch in DEPLOY_RPCS:
                by_chain.setdefault(ch, []).append(ad)
        for ch, addrs in by_chain.items():
            addrs = addrs[:DEPLOY_CAP]      # ограничиваем сетевую стоимость скана
            jobs.append(("deployed_%s_%d" % (r["slug"], ch),
                         ["deployed.py", "--rpc", DEPLOY_RPCS[ch],
                          "--chain", str(ch), "--src", str(trees[0])] + addrs))

    # xchain — рассинхрон реестра L1<->L2: одно поле (owner/impl/paused/version)
    # разошлось у ОДНОГО логического контракта на двух сетях. Предусловие:
    # scope дал пары по имени ([[scope-manifest]] xchain_pairs) и обе сети в
    # карте RPC. Оба вызова read-only. Лимит XCHAIN_CAP пар — потолок стоимости.
    if _man0 and _man0.get("xchain_pairs"):
        n_xc = 0
        for pr in _man0["xchain_pairs"]:
            (ca, aa), (cb, ab) = pr["a"], pr["b"]
            if ca not in DEPLOY_RPCS or cb not in DEPLOY_RPCS:
                continue
            n_xc += 1
            if n_xc > XCHAIN_CAP:
                break
            jobs.append(("xchain_%s__%d_%d_%d" % (r["slug"], ca, cb, n_xc),
                         ["xchain.py", "--a", DEPLOY_RPCS[ca], aa,
                          "--b", DEPLOY_RPCS[cb], ab,
                          "--chainA", str(ca), "--chainB", str(cb)]))

    if not jobs:
        print("   нечего запускать: ни репозиториев, ни скачанного дерева")
        return

    # Сигналы «от дерева» (siblings, statesync, ungated, msgauth) работают
    # по скачанному исходнику. Если репозитории в скоупе ЕСТЬ, а дерева нет,
    # значит подготовка не делалась или ещё идёт — и скан пройдёт вхолостую,
    # выглядя при этом успешным. Молчать об этом нельзя.
    incomplete = bool(r["repos"]) and not trees
    run = runlog.Run(r["slug"], "scan", target=r["name"], site=r["site"],
                     url=r["url"], tools=len(jobs), trees=len(trees),
                     version=version, fresh=bool(fresh), autoprep=autoprep)
    r["_run"] = run.id
    if autoprep:
        # Скачивание идёт ДО этого журнала (у prep свой прогон), поэтому в
        # ленте скана оно выглядело бы дырой во времени. Оставляем след.
        run.note("дерева не было — подготовка сделана автоматически, "
                 "скачано репозиториев: %d (отдельный прогон prep)" % len(trees),
                 autoprep=True, trees=len(trees))
    if incomplete:
        msg = ("исходник не скачан: сигналы от дерева (siblings, statesync, "
               "ungated, msgauth) ПРОПУЩЕНЫ. Сперва --prep %s" % r["slug"])
        print("   ВНИМАНИЕ: %s" % msg)
        run.note(msg, incomplete=True)
    # SCOPE-гейт на кандидатов: OOS-файл (исключённая папка) не должен всплывать
    # даже сигналом — иначе он утекает в лиды и в подачу как НЕeligible. Тот же
    # манифест, что у judge ([[scope-manifest]]). Нет манифеста -> не режем.
    try:
        import scope as _scope
        _man = _scope.load(r["slug"])
    except Exception:
        _man = None
    n_oos = 0
    try:
        for name, cmd in jobs:
            f = sig / (name + ".txt")
            with run.step(name, cmd=" ".join(cmd), tool=cmd[0]) as s:
                n, head = run_tool(cmd, f)
                found = hits_in(f)
                kept = []
                for file, line, why in found:
                    if _man:
                        ok, _ = _scope.in_scope(_man, file)
                        if not ok:
                            n_oos += 1
                            continue
                    kept.append((file, line, why))
                s.done(lines=n, head=head[:6], out="signals/%s" % f.name,
                       hits=len(kept), oos=len(found) - len(kept))
                for file, line, why in kept:
                    run.candidate(file=file, line=line, why=why, source=cmd[0])
            print("   %-34s %5d строк  -> signals/%s" % (cmd[0], n, f.name))
            for line in head[2:5]:
                print("        %s" % line[:88])
    except BaseException as e:
        run.error(e, scope="run")
        run.end(status="err", error=str(e)[:300])
        raise
    if _man and n_oos:
        run.note("scope-гейт отсеял кандидатов вне скоупа: %d "
                 "(исключённые папки — не всплывут как лид)" % n_oos, oos=n_oos)
        print("   scope-гейт: отсеяно OOS-кандидатов %d" % n_oos)
    # Что изменилось против прошлого скана — единственный вопрос, ради
    # которого пересканируют. Считаем по тем же двум числам: строк и адресов.
    changed = []
    for name, _cmd in jobs:
        was = prev.get(name)
        if not was:
            continue
        now = _tally(sig / (name + ".txt"))
        if now["lines"] != was["lines"] or now["hits"] != was["hits"]:
            changed.append((name, was, now))
    if prev:
        run.note("против прошлого скана изменилось файлов: %d из %d"
                 % (len(changed), len(prev)), diff=True)
        print("\n   ПРОТИВ ПРОШЛОГО СКАНА (archive/v%d): изменилось %d из %d"
              % (version - 1, len(changed), len(prev)))
        for nm, was, now in changed[:12]:
            run.emit("delta", name=nm, lines_was=was["lines"],
                     lines_now=now["lines"], hits_was=was["hits"],
                     hits_now=now["hits"])
            print("     %-40s строк %d -> %d, адресов %d -> %d"
                  % (nm[:39], was["lines"], now["lines"],
                     was["hits"], now["hits"]))
        if not changed:
            print("     ничего не изменилось — пайплайн дал тот же ответ")
    run.end(incomplete=incomplete, version=version, changed=len(changed))
    if incomplete:
        print("\n   ПРОГОН НЕПОЛНЫЙ: прогнаны только сигналы от отчётов.")
    print("\n   Читать заходами. Порядок силы, по опыту: siblings -> recodiff ->"
          "\n   blindspots -> ungated/msgauth -> audits -> statesync.")
    return trees


def scan_loop(r, trees, model="heavy", steps=10):
    """Модельный проход agent.py по каждому дереву. Пишет ТОЛЬКО сверенные
    кандидаты в signals/agent_<дерево>.txt — выдумка отсеяна воротами."""
    d = WORK / r["slug"]
    sig = d / "signals"
    run = runlog.Run(r["slug"], "loop", target=r["name"], model=model,
                     steps=steps, trees=len(trees or []))
    for t in trees or []:
        print("== петля agent.py по %s (модель %s)" % (t.name, model))
        cmd = ["agent.py", "--root", str(t), "--model", model,
               "--steps", str(steps), "--runlog", r["slug"],
               "--parent", run.id]
        f = sig / ("agent_%s.txt" % t.name)
        with run.step("agent %s" % t.name, cmd=" ".join(cmd), tool="agent.py") as s:
            n, head = run_tool(cmd, f)
            found = hits_in(f)
            s.done(lines=n, head=head[:6], out="signals/%s" % f.name,
                   hits=len(found))
            for file, line, why in found:
                run.candidate(file=file, line=line, why=why, source="agent.py")
        print("   agent.py  %5d строк  -> signals/%s" % (n, f.name))
        # показать блок подтверждённых кандидатов, если есть
        txt = f.read_text(encoding="utf-8", errors="replace")
        if "ПОДТВЕРЖДЁННЫЕ КАНДИДАТЫ" in txt:
            tail = txt[txt.index("ПОДТВЕРЖДЁННЫЕ КАНДИДАТЫ"):]
            for line in tail.splitlines()[:12]:
                print("        %s" % line[:88])
        elif "ПОДТВЕРЖДЁННЫХ КАНДИДАТОВ: 0" in txt:
            print("        подтверждённых кандидатов: 0 (выдумки отсеяны)")
    run.end()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pick", action="store_true", help="выбрать из рынка")
    ap.add_argument("--add", help="site:pid или часть имени")
    ap.add_argument("--drop", help="убрать мишень")
    ap.add_argument("--prep", help="подготовить папку (или all)")
    ap.add_argument("--scan", help="прогнать сигналы (или all)")
    ap.add_argument("--fresh", action="store_true",
                    help="в --scan: пересканировать заново, прошлое в archive/vN")
    ap.add_argument("--loop", action="store_true",
                    help="в --scan: добавить модельный проход agent.py "
                         "(пишет сверенных кандидатов в signals/agent_*.txt)")
    ap.add_argument("--model", default="heavy", help="модель для --loop")
    ap.add_argument("--steps", type=int, default=10)
    ap.add_argument("--check", action="store_true",
                    help="живы ли мишени, теснеет ли, свежи ли репозитории")
    ap.add_argument("--site", choices=sorted(M.SOURCES))
    ap.add_argument("--all", action="store_true", help="в --pick: и не-контракты")
    ap.add_argument("--repos", action="store_true", help="в --pick: только с GitHub")
    ap.add_argument("--limit", type=int, default=30)
    args = ap.parse_args()

    if args.pick:
        pick(programs(), args)
        return
    if args.add:
        p = find(programs(), args.add)
        if not p:
            print("не найдено")
            return
        rows = picked()
        if any(r["site"] == p.site and r["pid"] == p.pid for r in rows):
            print("уже выбрано")
            return
        rows.append(rowdict(p))
        save(rows)
        print("добавлено: %s (%s)" % (p.name, p.url))
        return
    if args.drop:
        rows = picked()
        low = args.drop.lower()
        keep = [r for r in rows
                if low not in r["name"].lower() and r["slug"] != low
                and r["pid"].lower() != low]
        save(keep)
        print("убрано %d" % (len(rows) - len(keep)))
        return

    rows = picked()
    if args.check:
        if not rows:
            print("мишеней нет")
            return
        check(rows)
        return
    for flag, fn in (("prep", prep),
                     ("scan", lambda row: scan(row, fresh=args.fresh))):
        want = getattr(args, flag)
        if not want:
            continue
        low = want.lower()
        sel = rows if low == "all" else [
            r for r in rows if low in r["name"].lower() or r["slug"] == low
            or r["pid"].lower() == low]
        if not sel:
            print("мишень не выбрана: сперва --add или --pick")
            return
        for r in sel:
            trees = fn(r)
            if flag == "scan" and args.loop:
                scan_loop(r, trees, args.model, args.steps)
        return
    show(rows)


if __name__ == "__main__":
    main()
