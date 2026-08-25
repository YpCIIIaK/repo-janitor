# -*- coding: utf-8 -*-
"""SCOPE.JSON — машиночитаемый манифест скоупа, собираемый при prep.

Зачем. BRIEF.md человекочитаем, но ни один сигнал/judge/отчёт не может спросить у
него «этот файл в скоупе?». Из-за этого бюджет утекает на НЕeligible: программа
пишет «excluding the 'mocks' and 'views' folders», а мы гоним модель по
`DFSPricesView` из папки views и готовим лид, который площадка отклонит как OOS
(потеря $38 комиссии + репутация). Манифест делает границу скоупа машинной:
in-scope типы, exclude-глобы из текста исключений, адреса, поле known_issues и
наши automated_findings (чтобы не подать дубль своей же прошлой находки).

Провенанс честный: exclude-глобы и типы извлекаются НАДЁЖНО (из структуры и явных
«excluding ...»). known_issues на странице программы прозой — авто их НЕ выдираем,
оставляем пустыми с пометкой «сверить руками», чтобы пустое поле не сошло за
«известных проблем нет».

использование:
    scope.py <slug>              показать манифест (собрать из BRIEF/записи)
    scope.py <slug> <путь>       в скоупе ли файл (in/OOS + причина)
как модуль:
    scope.build(record) -> dict ;  scope.load(slug) -> dict|None
    scope.in_scope(manifest, relpath) -> (bool, reason)
"""
import fnmatch
import json
import os
import re
import sys

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.abspath(__file__))
WORK = os.path.join(ROOT, "data", "bounty")
ADDR = re.compile(r"0x[0-9a-fA-F]{40}")

# типы активов площадок -> в скоупе ли для аудита КОДА
CODE_TYPES = {"smart_contract", "blockchain_dlt", "blockchain_dlt_module"}
OOS_TYPES = {"websites_and_applications", "web", "mobile", "api"}

# домен explorer-ссылки -> chainId. Сеть адреса — ОДНА на asset, из ссылки, НЕ
# из поля name (та же таблица, что у unverified.py: делят один источник правды
# про атрибуцию, чтобы deployed/unverified/scope не расходились). None —
# известная сеть без RPC/verify: узнаём, чтобы ОСОЗНАННО пропустить, а не
# мис-чекнуть на mainnet.
EXPL = {"etherscan.io": 1, "eth.blockscout": 1,
        "optimistic.etherscan": 10, "optimism.blockscout": 10,
        "basescan.org": 8453, "base.blockscout": 8453,
        "arbiscan.io": 42161, "arbitrum.blockscout": 42161,
        "berascan": None, "ftmscan.com": 250, "snowtrace.io": 43114,
        "polygonscan.com": 137, "bscscan.com": 56, "gnosisscan.io": 100,
        "scrollscan.com": 534352, "lineascan.build": 59144}


def chain_of(url):
    u = (url or "").lower()
    for dom, c in EXPL.items():
        if dom in u:
            return c
    return None            # неизвестно -> НЕ mainnet, скорее пропуск

# «excluding the 'mocks' and 'views' folders», «except X and Y», «excludes ...»
_EXCL = re.compile(r"(?:exclud\w*|except)\b(.*?)(?:$|\.)", re.I | re.S)
_QUOTED = re.compile(r"['\"`]([^'\"`]{2,40})['\"`]")
_BAREWORD = re.compile(r"\b([a-zA-Z_][\w-]{2,40})\b")


def _exclusions(text):
    """Имена папок/файлов из фразы-исключения. Кавычки в приоритете; если их
    нет — слова рядом с 'folder(s)'/'file(s)', иначе пусто (не угадываем весь
    текст)."""
    names = set()
    for m in _EXCL.finditer(text or ""):
        clause = m.group(1)
        q = _QUOTED.findall(clause)
        if q:
            names.update(x.strip() for x in q)
        elif re.search(r"folder|file|dir|contract", clause, re.I):
            # без кавычек — берём слова, кроме служебных
            for w in _BAREWORD.findall(clause):
                if w.lower() not in ("the", "and", "folders", "folder", "files",
                                     "file", "dir", "dirs", "contracts",
                                     "contract", "only", "all", "from", "of"):
                    names.add(w)
    return sorted(names)


def _globs(names):
    """Имя папки/файла -> глобы пути. 'views' -> **/views/**; 'Mock.sol' ->
    **/Mock.sol."""
    out = []
    for n in names:
        n = n.strip("/")
        if "." in n:                       # похоже на файл
            out.append("**/%s" % n)
        else:                               # папка
            out += ["**/%s/**" % n, "**/%s" % n]
    return out


def build(r):
    """Манифест из записи мишени (targets.py)."""
    assets = []
    excl_names = set()
    for a in r.get("assets") or []:
        typ = (a.get("type") or "").lower()
        name = a.get("name") or a.get("url") or ""
        in_s = typ in CODE_TYPES
        if in_s:
            excl_names.update(_exclusions(name))
        assets.append({"name": name[:200], "type": typ, "url": a.get("url"),
                       "in_scope": in_s})
    addrs = sorted({x for a in (r.get("assets") or [])
                    for x in ADDR.findall(json.dumps(a))})
    # адреса С СЕТЬЮ: сеть из explorer-ссылки актива (ОДНА на asset). Это то,
    # чего не хватало deployed/unverified — они не умеют читать flat-адрес без
    # сети. Сеть не определить -> пропускаем (не гадаем mainnet).
    addr_chains = []
    for a in (r.get("assets") or []):
        typ = (a.get("type") or "").lower()
        if typ not in CODE_TYPES and typ:
            continue
        ch = chain_of(a.get("url")) or chain_of(a.get("desc"))
        if ch is None:
            continue
        for field in (a.get("url"), a.get("desc"), a.get("name")):
            for m in ADDR.findall(field or ""):
                addr_chains.append([ch, m])
    addr_chains = [list(x) for x in sorted({tuple(p) for p in addr_chains})]
    # ПАРЫ для xchain: один логический контракт на РАЗНЫХ сетях. Сигнал пары —
    # одинаковое ИМЯ актива на 2+ сетях (spark ALM_RATE_LIMITS на 1/8453/42161).
    # Канон — младшая сеть, паруем с каждой другой. Первый адрес на сеть.
    byname = {}
    for a in (r.get("assets") or []):
        typ = (a.get("type") or "").lower()
        if typ and typ not in CODE_TYPES:
            continue
        ch = chain_of(a.get("url")) or chain_of(a.get("desc"))
        nm = (a.get("name") or "").strip()
        if ch is None or not nm:
            continue
        for m in ADDR.findall(json.dumps(a)):
            byname.setdefault(nm, {}).setdefault(ch, m)  # первый адрес на сеть
    xchain_pairs = []
    for nm, perchain in byname.items():
        chains = sorted(perchain)
        if len(chains) < 2:
            continue
        a0 = chains[0]
        for b in chains[1:]:
            xchain_pairs.append({"name": nm[:80],
                                 "a": [a0, perchain[a0]], "b": [b, perchain[b]]})
    return {
        "slug": r.get("slug"), "name": r.get("name"), "url": r.get("url"),
        "reward": r.get("reward"), "fee": r.get("fee"), "kyc": r.get("kyc"),
        "repos": list(r.get("repos") or []),
        "code_types": sorted(CODE_TYPES),
        "exclude_names": sorted(excl_names),
        "exclude_globs": _globs(sorted(excl_names)),
        "addresses": addrs,
        "addr_chains": addr_chains,   # [[chain, addr], ...] для deployed/unverified
        "xchain_pairs": xchain_pairs,  # [{name, a:[ch,addr], b:[ch,addr]}] для xchain
        "assets": assets,
        "known_issues": [],          # проза на странице программы — сверить руками
        "known_issues_note": "НЕ извлечено автоматически — сверить на странице "
                             "программы перед подачей (пустой список != нет проблем)",
        "automated_findings": [],    # наши лиды/находки — не подавать дубль
    }


def path_of(slug):
    return os.path.join(WORK, slug, "scope.json")


def write(slug, manifest):
    with open(path_of(slug), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)


def load(slug):
    p = path_of(slug)
    if not os.path.isfile(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)


def in_scope(manifest, relpath):
    """(bool, причина). relpath — путь ОТНОСИТЕЛЬНО дерева репо (как в сигналах).
    OOS если попал под exclude-глоб. Отсутствие манифеста трактуется вызывающим,
    не тут."""
    rp = (relpath or "").replace("\\", "/")
    for g in manifest.get("exclude_globs") or []:
        if fnmatch.fnmatch(rp, g) or fnmatch.fnmatch(rp, g.lstrip("*/")):
            return False, "исключён скоупом: %s" % g
    return True, "в скоупе"


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    slug = a[0]
    m = load(slug)
    if not m:
        print("нет scope.json для %s — собрать при prep (targets.py --prep %s)"
              % (slug, slug))
        return
    if len(a) > 1:
        ok, why = in_scope(m, a[1])
        print("%s -> %s (%s)" % (a[1], "В СКОУПЕ" if ok else "OOS", why))
        return
    print("=" * 72)
    print("SCOPE %s — %s" % (m["name"], m["url"]))
    print("=" * 72)
    print("  репозиториев: %d  адресов: %d  активов: %d"
          % (len(m["repos"]), len(m["addresses"]), len(m["assets"])))
    if m["exclude_names"]:
        print("  ИСКЛЮЧЕНО из скоупа: %s" % ", ".join(m["exclude_names"]))
        print("    глобы: %s" % ", ".join(m["exclude_globs"]))
    else:
        print("  явных исключений в тексте активов нет")
    oos = [x for x in m["assets"] if not x["in_scope"]]
    if oos:
        print("  активы НЕ-код (OOS для аудита кода): %d — %s"
              % (len(oos), ", ".join(x["type"] for x in oos[:5])))
    print("  known_issues: %s" % (m["known_issues"] or "пусто — " + m["known_issues_note"]))


if __name__ == "__main__":
    main()
