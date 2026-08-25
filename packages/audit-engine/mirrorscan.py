# -*- coding: utf-8 -*-
"""ЗЕРКАЛЬНОСТЬ РЕПОЗИТОРИЯ: где публичный репо — снимок закрытого.

Зачем. Divergence-сигнал (deployed.py) реален, но РЕДОК, и замерено: разрыв
дают только протоколы с ЗАКРЫТЫМ основным репо и ОТСТАЮЩИМ публичным
зеркалом. Оба хита проекта (agglayer, infiniFi) — такие. Открытые монорепо
(TermMax, Arcadia) публикуют всё, разрыва нет по построению. Значит перед
дорогой проверкой адресов надо ДЁШЕВО отобрать мишени с профилем зеркала.

Зеркало видно по ИСТОРИИ КОММИТОВ, без единого адреса:

* мало коммитов на большой код (снимок, а не разработка);
* сообщения-срезы: «Update src folder», «sync», «snapshot», датированные;
* один автор/бот, нет ветвления и PR-merge'ей;
* огромные диффы на коммит (обновляют папку целиком).

У живого open-source всё наоборот: тысячи гранулярных коммитов, много
авторов, merge-коммиты PR, осмысленные сообщения.

ЧЕГО НЕ ЗНАЕТ. Высокий скор — это ПОДОЗРЕНИЕ на зеркало, а не доказанный
разрыв. Дальше по подозрительным гнать deployed.py с адресами: зеркало лишь
НЕОБХОДИМО для разрыва, но не достаточно. Зато отсев дешёвый — один запрос
истории на репо против часа поиска адресов вслепую.

использование:
    mirrorscan.py                     по всем репозиториям рынка, топ зеркал
    mirrorscan.py owner/repo [...]     конкретные
    mirrorscan.py --min 5.0            порог скора
"""
import json
import os
import re
import sys

import audits          # ради _get с токеном и ретраями

MARKET = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                      "data", "market.json")

# Сообщения-срезы и бампы конфига: у зеркала код меняется одним оптовым
# «Update src folder», а остальное — бампы addresses/config. Дата вместо сути.
SNAPSHOT_MSG = re.compile(
    r"update\s+(?:src|contracts?|source|code|folder|addresses|deployment|"
    r"config|abi)|update\s+\S+\.json|\bsync\b|snapshot|mirror|initial\s+commit|"
    r"import\s+(?:from|code)|push\s+code|^\d{4}[-/]\d\d[-/]\d\d|\bdump\b|"
    r"copy\s+(?:from|code)|\b(?:june|july|august|jan|feb|mar|apr|may|sept|"
    r"oct|nov|dec)\w*\s+\d|patch", re.I)

# КЛЮЧЕВОЙ разделитель: сообщения про реальную РАБОТУ С КОДОМ. У зеркала их
# почти нет (код приходит снимком), у живого репо — большинство. ВНИМАНИЕ:
# «Merge pull request» сюда НЕ входит — зеркала тоже льют патчи через PR.
DEV_MSG = re.compile(
    r"\bfix\b|\bbug\b|\brefactor|\btest\b|\brevert\b|\bfeat[:/ ]|feature|"
    r"\bimplement|\boptimiz|\bgas\b|\bvulnerab|\breentr|\boverflow|\brounding|"
    r"\badapter\b|\boracle\b|\bcalcul|\blogic\b|\brename\b|\bhandler\b|"
    r"\bmigrat|\bslippage|\ballowance|\bwithdraw|\bdeposit|\bliquidat", re.I)


def commits(owner, repo, n=40):
    url = ("https://api.github.com/repos/%s/%s/commits?per_page=%d"
           % (owner, repo, n))
    try:
        return audits._get(url)
    except Exception as e:
        return {"_error": str(e)}


def score(owner, repo):
    cs = commits(owner, repo)
    if isinstance(cs, dict):
        return {"repo": "%s/%s" % (owner, repo), "err": cs.get("_error", "?")}
    if not cs:
        return {"repo": "%s/%s" % (owner, repo), "err": "нет коммитов"}

    msgs, authors, merges, snap, dev = [], set(), 0, 0, 0
    for c in cs:
        m = (c.get("commit") or {}).get("message", "").splitlines()[:1]
        m = m[0] if m else ""
        msgs.append(m)
        a = (c.get("author") or {}).get("login") or \
            ((c.get("commit") or {}).get("author") or {}).get("name", "?")
        authors.add(a)
        if len(c.get("parents") or []) > 1:
            merges += 1
        if SNAPSHOT_MSG.search(m):
            snap += 1
        if DEV_MSG.search(m):
            dev += 1

    n = len(msgs)
    # merge-коммиты НЕ считаем работой: сравниваем только содержательные
    # сообщения (у зеркала это бампы конфига, у живого — код).
    nonmerge = [m for m, c in zip(msgs, cs) if len(c.get("parents") or []) <= 1]
    nm = max(len(nonmerge), 1)
    uniq_msgs = len(set(nonmerge))
    dev_nm = sum(1 for m in nonmerge if DEV_MSG.search(m))
    snap_nm = sum(1 for m in nonmerge if SNAPSHOT_MSG.search(m))

    # КЛЮЧЕВОЙ признак: почти нет сообщений про код.
    f_no_dev = 1 - min(dev_nm / nm, 1.0)
    f_snap = snap_nm / nm                    # доля срезов/бампов конфига
    f_repeat = 1 - uniq_msgs / nm            # повторяемость (бампы одного файла)
    f_one_author = 1.0 if len(authors) <= 1 else (0.5 if len(authors) == 2 else 0)

    s = (f_no_dev * 4.0 + f_snap * 2.5 + f_repeat * 2.0 + f_one_author * 0.5)
    return {
        "repo": "%s/%s" % (owner, repo), "score": s,
        "commits": n, "authors": len(authors), "merges": merges,
        "snap": snap_nm, "dev": dev_nm, "sample": msgs[:3],
    }


def market_repos():
    with open(MARKET, encoding="utf-8") as fh:
        d = json.load(fh)
    progs = d if isinstance(d, list) else (
        d.get("programs") or next((v for v in d.values()
                                   if isinstance(v, list)), []))
    seen, out = set(), []
    for p in progs:
        for url in (p.get("repos") or []):
            m = re.match(r"https://github\.com/([^/]+)/([^/]+)", url.rstrip("/"))
            if not m:
                continue
            key = (m.group(1), m.group(2).replace(".git", ""))
            if key in seen:
                continue
            seen.add(key)
            out.append((p.get("name", "?"), key[0], key[1]))
    return out


def run(pairs, min_score, names=None):
    rows = []
    for i, (owner, repo) in enumerate(pairs):
        r = score(owner, repo)
        if names:
            r["prog"] = names.get((owner, repo), "")
        rows.append(r)
        sys.stderr.write("\r  %d/%d %-40s" % (i + 1, len(pairs),
                                              ("%s/%s" % (owner, repo))[:40]))
        sys.stderr.flush()
    sys.stderr.write("\n")
    good = [r for r in rows if "score" in r]
    good.sort(key=lambda r: -r["score"])
    print("=" * 84)
    print("ЗЕРКАЛЬНОСТЬ — топ (порог %.1f). Высокий скор = снимок закрытого репо."
          % min_score)
    print("=" * 84)
    for r in good:
        if r["score"] < min_score:
            continue
        tag = (" [%s]" % r["prog"]) if r.get("prog") else ""
        print("\n[%.1f] %s%s" % (r["score"], r["repo"], tag))
        print("      коммитов %d, авторов %d, merge %d, срезовых %d, dev %d"
              % (r["commits"], r["authors"], r["merges"], r["snap"], r["dev"]))
        for m in r["sample"]:
            print("      · %s" % m[:76])
    errs = [r for r in rows if "err" in r]
    if errs:
        print("\n(ошибок/пустых: %d)" % len(errs))
    print("\n" + "-" * 84)
    print("Дальше по верхним: найти боевые адреса и прогнать deployed.py.")
    print("Зеркало — НЕОБХОДИМО для разрыва, но не достаточно; проверять адресами.")


def main():
    a = sys.argv[1:]
    min_score = 5.0
    if "--min" in a:
        min_score = float(a[a.index("--min") + 1])
        a = [x for i, x in enumerate(a)
             if x != "--min" and (i == 0 or a[i - 1] != "--min")]
    explicit = [x for x in a if "/" in x]
    if explicit:
        pairs = [tuple(x.split("/")[:2]) for x in explicit]
        run(pairs, min_score)
        return
    entries = market_repos()
    names = {(o, r): nm for nm, o, r in entries}
    pairs = [(o, r) for _, o, r in entries]
    run(pairs, min_score, names)


if __name__ == "__main__":
    main()
