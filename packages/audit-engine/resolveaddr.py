# -*- coding: utf-8 -*-
"""КОНТРАКТ -> ЗАДЕПЛОЕННЫЙ АДРЕС — резолвер, который снимает ручной ввод у
[[fundflow-impact]] on-chain. Раньше `fundflow.onchain(chain, addr)` работал,
но адрес надо было дать руками; здесь он добывается из самого репозитория.

Откуда адреса. Протоколы кладут в репо конфиг развёртывания — список
`{"name": "BebopWrapper", "address": "0x..", "path": ".."}` в файле, чьё имя
называет сеть (`addresses/mainnet.json`, `optimism.json`, `base.json`). Это
готовая карта имя->адрес, сеть подразумевает имя файла. Резолвер сканирует
дерево мишени, собирает карту и отдаёт (сеть, адрес) по имени контракта.

Асимметрия та же, что везде в пайплайне: НЕ угадываем. Только точное совпадение
имени (без учёта регистра); если имени нет в карте — None, и fundflow остаётся
на статике (в покое вероятно пусто), НЕ на выдуманном адресе. Ложный адрес хуже
отсутствия: подтвердил бы drain там, где его нет.

использование:
    resolveaddr.py <slug> [Контракт]      карта / резолв одного имени
как модуль:
    resolveaddr.index(slug) -> {ИмяВнижнемрегистре: [(chain, addr, orig_name)]}
    resolveaddr.resolve(slug, "BebopWrapper") -> (chain, addr) | None
"""
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
ADDR_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")

# Имя файла/пути -> chainId. Сеть развёртывания подразумевает имя конфига.
CHAIN_WORDS = [
    ("arbitrum", 42161), ("arb", 42161),
    ("optimism", 10), ("opt", 10),
    ("base", 8453),
    ("mainnet", 1), ("ethereum", 1), ("eth", 1),
]


def _chain_of(path):
    """chainId по имени файла/каталога конфига развёртывания, иначе None."""
    low = path.replace("\\", "/").lower()
    for word, cid in CHAIN_WORDS:
        if re.search(r"[^a-z]%s[^a-z]|^%s|%s$" % (word, word, word), "/" + low):
            return cid
    return None


def _pairs(node):
    """(имя, адрес) из узла конфига любой формы — только записи, где ИМЯ рядом
    с адресом (name/contract + address). Голый адрес без имени пропускаем:
    резолв по имени, а не по позиции."""
    out = []
    if isinstance(node, dict):
        name = node.get("name") or node.get("contract") or node.get("contractName")
        addr = node.get("address") or node.get("addr")
        if isinstance(name, str) and isinstance(addr, str) and ADDR_RE.match(addr.strip()):
            out.append((name.strip(), addr.strip()))
        # запись вида {"BebopWrapper": "0x.."} — ключ это имя
        for k, v in node.items():
            if isinstance(v, str) and ADDR_RE.match(v.strip()) and k not in (
                    "address", "addr"):
                out.append((k.strip(), v.strip()))
            else:
                out += _pairs(v)
    elif isinstance(node, list):
        for v in node:
            out += _pairs(v)
    return out


def _is_config(path):
    low = os.path.basename(path).lower()
    return low.endswith(".json") and (
        "address" in low or "deploy" in low or _chain_of(path) is not None)


def index(slug):
    """Карта {имя_в_нижнем_регистре: [(chain, addr, оригинальное_имя)]} из всех
    конфигов развёртывания в дереве мишени. Один и тот же контракт может быть в
    нескольких сетях — держим список."""
    base = os.path.join(WORK, slug, "src")
    out = {}
    if not os.path.isdir(base):
        return out
    for dirpath, dirnames, files in os.walk(base):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
        for f in files:
            path = os.path.join(dirpath, f)
            if not _is_config(path):
                continue
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
            except Exception:
                continue
            chain = _chain_of(path)
            if chain is None:
                # общий конфиг без сети в имени: адреса без сети бесполезны
                # для on-chain, но запишем как chain=1 по умолчанию — на eth
                # смотрят чаще всего; сверим кодом позже.
                chain = 1
            for name, addr in _pairs(data):
                out.setdefault(name.lower(), [])
                key = (chain, addr.lower())
                if key not in {(c, a.lower()) for c, a, _ in out[name.lower()]}:
                    out[name.lower()].append((chain, addr, name))
    return out


def resolve(slug, contract, prefer_chain=None):
    """(chain, addr) по имени контракта или None. Только точное совпадение имени
    (без регистра). prefer_chain поднимает нужную сеть, если контракт в нескольких."""
    hits = index(slug).get((contract or "").lower())
    if not hits:
        return None
    if prefer_chain is not None:
        for c, a, _ in hits:
            if c == prefer_chain:
                return (c, a)
    c, a, _ = hits[0]
    return (c, a)


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    slug = a[0]
    idx = index(slug)
    if len(a) > 1:
        r = resolve(slug, a[1])
        print("%s -> %s" % (a[1], ("%d:%s" % r) if r else "не найден в конфигах"))
        return
    print("=" * 72)
    print("АДРЕСА %s: контрактов с адресом %d" % (slug, len(idx)))
    print("=" * 72)
    for name in sorted(idx)[:60]:
        locs = ", ".join("%d:%s" % (c, a[:10]) for c, a, _ in idx[name][:4])
        print("  %-34s %s" % (idx[name][0][2][:34], locs))
    if len(idx) > 60:
        print("  … ещё %d" % (len(idx) - 60))


if __name__ == "__main__":
    main()
