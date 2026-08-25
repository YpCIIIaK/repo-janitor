# -*- coding: utf-8 -*-
"""РЕГРЕССИЯ ПРОТИВ ИЗВЕСТНЫХ БАГОВ — меряет то, на что вся архитектура молится,
но что ни разу не было измерено: НЕ РЕЖЕТ ЛИ НАШ ШЛЮЗ настоящие находки.

Зачем именно это. Единственный катастрофический отказ пайплайна — ложный CLEAN:
killcheck или порог веса выбросил функцию, где баг ЕСТЬ, и мы бы никогда не
узнали. Пороги (`min_w`), NONPROD-фильтры, философию gate крутили по интуиции и
одному анекдоту. Здесь то же самое проверяется числом на наборе ИЗВЕСТНЫХ багов.

Это НЕ «recall для полноты аудита» (метрика фирмы, обязанной покрыть скоуп). Мы
охотник: важны две вещи —
  * FALSE-KILL: убил ли killcheck функцию, где баг доказан (коммит-фикс есть)?
    ЛЮБОЙ ненулевой — красный флаг, чинить гейт.
  * RECALL/доходимость: всплыла ли уязвимая функция как выживший вообще, или
    отпала ниже порога / как non-prod (слепое пятно, тюнится порогом).
Разница между ними — диагностическая: below-threshold чинится числом, false-kill
чинится кодом гейта.

Метки — только НЕПРИДУМАННЫЕ: каждый кейс это реальный коммит-заплатка (из
[[unfixed-half-technique]]/LEDGER или отчёта). `ref` — коммит, где баг ЕСТЬ (до
фикса, обычно `<fix>^`). Дерево тянется тарболом гитхаба на этом коммите.

Лестница отсева повторяет `ungated.collect` СТУПЕНЬ В СТУПЕНЬ (та же прод-логика),
и печатается, на какой ступени функция отпала — иначе не отличить катастрофу от
настройки.

использование:
    bench.py                 прогнать все кейсы из data/bench/cases.jsonl
    bench.py --case <id>     один кейс
    bench.py --add           показать шаблон строки кейса
"""
import io
import json
import os
import sys
import tarfile
import urllib.request

import gating
import killcheck
import solsrc
import ungated

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.abspath(__file__))
BENCH = os.path.join(ROOT, "data", "bench")
CASES = os.path.join(BENCH, "cases.jsonl")
SRC = os.path.join(BENCH, "src")

# ступени отсева — по убыванию «серьёзности» для нас
STAGE_SURVIVED = "SURVIVED"          # хорошо: остался лидом
STAGE_KILL = "KILLED_BY_KILLCHECK"   # КАТАСТРОФА: гейт спрятал реальный баг
STAGE_GATED = "gated"                # оракул счёл закрытой
STAGE_DEMOTE = "demoted"             # гейт заведомо в другом файле
STAGE_LOWWEIGHT = "below_min_w"      # вес ниже порога — тюнится
STAGE_NOTOPEN = "not_open"           # не public/external или ERC-стандарт
STAGE_FILTERED = "file_filtered"     # interface/vendor/nonprod
STAGE_NOFUNC = "func_not_found"      # функцию не нашли в дереве на этом ref


def load_cases():
    if not os.path.isfile(CASES):
        return []
    out = []
    with open(CASES, encoding="utf-8") as fh:
        for ln in fh:
            ln = ln.strip()
            if ln and not ln.startswith("#"):
                out.append(json.loads(ln))
    return out


def fetch(case):
    """Дерево репозитория на коммите `ref` в кэш data/bench/src/<id>. Тарбол
    гитхаба отдаёт любой коммит по SHA. Возвращает путь корня или None."""
    dst = os.path.join(SRC, case["id"])
    if os.path.isdir(dst) and os.listdir(dst):
        return dst
    owner_repo = case["repo"]
    ref = case["ref"]
    url = "https://github.com/%s/archive/%s.tar.gz" % (owner_repo, ref)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "auditscout"})
        raw = urllib.request.urlopen(req, timeout=90).read()
    except Exception as e:
        sys.stderr.write("  fetch %s: %s\n" % (case["id"], e))
        return None
    os.makedirs(dst, exist_ok=True)
    try:
        with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tf:
            for m in tf.getmembers():
                if not m.name.endswith(".sol"):
                    continue
                # срезаем верхний каталог <repo>-<ref>/
                rel = m.name.split("/", 1)[1] if "/" in m.name else m.name
                p = os.path.join(dst, rel)
                os.makedirs(os.path.dirname(p), exist_ok=True)
                f = tf.extractfile(m)
                if f:
                    with open(p, "wb") as w:
                        w.write(f.read())
    except Exception as e:
        sys.stderr.write("  extract %s: %s\n" % (case["id"], e))
        return None
    return dst


def _find(cons, contract, func):
    for c in cons:
        if c.name != contract:
            continue
        for f in c.funcs:
            if f.name == func:
                return c, f
    return None, None


def trace(tree, case, min_w):
    """На какой ступени лестницы ungated.collect отпала бы уязвимая функция.
    Повторяет collect ступень в ступень, но для ОДНОЙ известной функции."""
    cons = solsrc.parse_tree(tree)
    c, f = _find(cons, case["contract"], case["func"])
    if not c or not f:
        return STAGE_NOFUNC, "нет %s.%s в дереве на %s" % (
            case["contract"], case["func"], case["ref"][:10])
    path = c.path.replace("\\", "/")
    if c.kind == "interface" or ungated.VENDOR.search(path) or \
            ungated.NONPROD.search(path):
        return STAGE_FILTERED, "файл отсеян (interface/vendor/nonprod): " + path
    if f.kind == "modifier" or not ungated.is_open(f) or f.name in ungated.ERC_STD:
        return STAGE_NOTOPEN, "не public/external или ERC-стандарт"
    oracle = gating.Oracle(cons)
    if ungated.gated(f, oracle):
        return STAGE_GATED, "оракул счёл закрытой (модификатор/тело)"
    acts = ungated.actions_of(f)
    if not acts or max(a[0] for a in acts) < min_w:
        w = max((a[0] for a in acts), default=0)
        return STAGE_LOWWEIGHT, "вес %.1f < порог %.1f" % (w, min_w)
    if ungated.demote_reason(c, f):
        return STAGE_DEMOTE, "понижена: " + ungated.demote_reason(c, f)
    killer = killcheck.Killer(cons)
    v = killer.judge("ungated", f, c)
    if not v["survives"]:
        return STAGE_KILL, v["note"]
    return STAGE_SURVIVED, v["note"]


def run(cases, min_w=5.0):
    print("=" * 78)
    print("РЕГРЕССИЯ ПРОТИВ ИЗВЕСТНЫХ БАГОВ: кейсов %d, порог min_w=%.1f"
          % (len(cases), min_w))
    print("=" * 78)
    tally = {}
    kills, survived, misses = [], [], []
    for case in cases:
        tree = fetch(case)
        if not tree:
            stage, why = "FETCH_FAIL", "дерево не скачалось"
        else:
            stage, why = trace(tree, case, min_w)
        tally[stage] = tally.get(stage, 0) + 1
        mark = {STAGE_SURVIVED: "  OK  ", STAGE_KILL: " KILL!",
                STAGE_LOWWEIGHT: " miss ", STAGE_NOFUNC: " ???  "}.get(stage, " drop ")
        print("%s %-18s %-30s %s" % (mark, case["id"], stage, why[:60]))
        if stage == STAGE_SURVIVED:
            survived.append(case["id"])
        elif stage == STAGE_KILL:
            kills.append(case["id"])
        elif stage in (STAGE_LOWWEIGHT, STAGE_FILTERED, STAGE_NOTOPEN,
                       STAGE_GATED, STAGE_DEMOTE):
            misses.append((case["id"], stage))
    n = len(cases)
    print("\n" + "-" * 78)
    print("ИТОГ по %d кейсам:" % n)
    print("  SURVIVED (гейт не тронул баг):   %d" % len(survived))
    print("  KILLED_BY_KILLCHECK (КАТАСТРОФА): %d  %s"
          % (len(kills), " ".join(kills)))
    print("  доходимость не дошла (recall):   %d  %s"
          % (len(misses), " ".join("%s/%s" % m for m in misses)))
    print("\nЧто из этого следует:")
    if kills:
        print("  * FALSE-KILL НЕНУЛЕВОЙ — killcheck прячет доказанные баги. Это")
        print("    чинится КОДОМ ГЕЙТА (класс %s), не порогом. Разобрать поимённо."
              % ", ".join(kills))
    else:
        print("  * false-kill = 0 на этом наборе: killcheck пока не убил ни один")
        print("    доказанный баг. Держать этот прогон зелёным при правках гейта.")
    lw = [i for i, s in misses if s == STAGE_LOWWEIGHT]
    if lw:
        print("  * ниже порога веса: %s — это НАСТРОЙКА (min_w), не поломка гейта."
              % ", ".join(lw))
    return {"survived": survived, "kills": kills, "misses": misses}


TEMPLATE = {
    "id": "проект-краткое", "repo": "owner/name",
    "ref": "<коммит где баг ЕСТЬ, обычно <fix>^>",
    "file": "Path/To/Vuln.sol", "contract": "VulnContract", "func": "vulnFunc",
    "severity": "high", "source": "ссылка на отчёт/PR", "note": "чем баг"}


def main():
    a = sys.argv[1:]
    if "--add" in a:
        print("Строка в data/bench/cases.jsonl (одна на баг):")
        print(json.dumps(TEMPLATE, ensure_ascii=False))
        return
    cases = load_cases()
    if "--case" in a:
        cid = a[a.index("--case") + 1]
        cases = [c for c in cases if c["id"] == cid]
    if not cases:
        print("нет кейсов в %s (шаблон: bench.py --add)" % CASES)
        return
    min_w = float(a[a.index("--min") + 1]) if "--min" in a else 5.0
    run(cases, min_w)


if __name__ == "__main__":
    main()
