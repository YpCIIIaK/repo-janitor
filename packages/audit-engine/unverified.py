# -*- coding: utf-8 -*-
"""НЕВЕРИФИЦИРОВАННЫЙ ПРОД: боевой контракт (или его impl за прокси), исходника
которого НЕТ ни в Sourcify, ни на Blockscout — тот самый класс, что дал оба
реальных хита проекта (agglayer ConnectorLZ, infiniFi lzCompose).

Замерено (17.08.2026): «зеркало-снимок в репо» — слабый маркер, он давал только
синхронные зеркала (Fluid, avocado — прод совпадает с репо построчно). НАСТОЯЩИЙ
маркер обоих хитов был иной: развёрнутый impl не опубликован НИГДЕ, читать
пришлось из чужих источников, и потому туда не заходил ни один аудитор.

Этот скан переворачивает воронку: не «похоже ли на зеркало», а «есть ли вообще
исходник у того, что крутится в проде». Берём боевые адреса из assets рынка
(там, где Immunefi их указал), и для каждого:

    codesize=0                         -> EOA/пусто, пропуск
    EIP-1967 impl slot != 0            -> прокси; проверяем ИСХОДНИК impl
    impl не в Sourcify и не в Blockscout -> ХИТ (непубликуемая реализация)
    сам адрес не верифицирован         -> ХИТ послабее (контракт без исходника)

ТОЛЬКО ЧТЕНИЕ: eth_getCode, eth_getStorageAt. Ни одной транзакции.

использование:
    unverified.py --inv inv.json            по инвентарю {name:[[chain,addr],..]}
    unverified.py --market                  собрать адреса из data/market.json сам
    unverified.py 1:0xADDR [10:0xADDR ...]  точечно
    --min-code N   игнорировать контракты мельче N байт (по умолчанию 0)
"""
import json
import os
import re
import sys
import time

import deployed as D

# сети, где есть И публичный RPC, И Blockscout-фолбэк — только их и проверяем
RPCS = {
    1: "https://ethereum-rpc.publicnode.com",
    10: "https://optimism-rpc.publicnode.com",
    8453: "https://base-rpc.publicnode.com",
    42161: "https://arbitrum-one-rpc.publicnode.com",
}

# EIP-1967: impl, beacon; плюс старый OZ-слот
SLOTS = {
    "impl": "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc",
    "beacon": "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50",
    "ozimpl": "0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3",
}

ADDR = re.compile(r"0x[a-fA-F0-9]{40}")

# Etherscan — ДОМИНИРУЮЩИЙ верификатор, и Blockscout зеркалит его НЕПОЛНО
# (замерено: WBTC-controller верифицирован, но ни в Sourcify, ни на eth.
# blockscout его нет). Без прямой проверки Etherscan вердикт «БЕЗ ИСХОДНИКА»
# даёт ложные хиты — ровно тот класс ошибки, что жёг проект на TermMax. V2 —
# единый эндпоинт с chainid; требует ключ ETHERSCAN_API_KEY. Нет ключа ->
# Etherscan НЕ проверяется, и это честно отражается в метке (см. probe()).
ETHERSCAN_KEY = os.environ.get("ETHERSCAN_API_KEY", "")


def etherscan_verified(chain, addr):
    """Имя контракта, если верифицирован на Etherscan (V2). None если нет.
    Возвращает '?' если ключа нет — «не проверено», не «не верифицировано»."""
    if not ETHERSCAN_KEY:
        return "?"
    u = ("https://api.etherscan.io/v2/api?chainid=%d&module=contract"
         "&action=getsourcecode&address=%s&apikey=%s" % (chain, addr, ETHERSCAN_KEY))
    txt = D.get(u, timeout=30)
    if not txt:
        return None
    try:
        d = json.loads(txt)
    except Exception:
        return None
    res = d.get("result")
    if not isinstance(res, list) or not res:
        return None
    r0 = res[0]
    src = r0.get("SourceCode") or ""
    return (r0.get("ContractName") or "verified") if src.strip() else None


def verified(chain, addr):
    """Есть ли исходник хоть где-то: Sourcify / Blockscout / Etherscan.

    Возвращает источник ('sourcify'/'blockscout'/'etherscan'), None если нигде,
    или 'etherscan?' если исходника нет в двух открытых базах, А Etherscan
    проверить нечем (нет ключа) — это НЕ подтверждённый хит, а «надо доверить»."""
    try:
        if D.sourcify_files(chain, addr):
            return "sourcify"
    except Exception:
        pass
    try:
        nm = D.blockscout_verified(chain, addr)
        if nm:
            return "blockscout"
    except Exception:
        pass
    es = etherscan_verified(chain, addr)
    if es == "?":
        return "etherscan?"        # не проверено — гейт ключа
    if es:
        return "etherscan"
    return None


def probe(chain, addr, min_code=0):
    url = RPCS.get(chain)
    if not url:
        return {"chain": chain, "addr": addr, "skip": "нет RPC для сети"}
    try:
        sz = D.codesize(url, addr)
    except Exception as e:
        return {"chain": chain, "addr": addr, "skip": "RPC: %s" % e}
    if sz < max(min_code, 1):
        return {"chain": chain, "addr": addr, "skip": "EOA/пусто (%d б)" % sz}

    impl = None
    for key in ("impl", "beacon", "ozimpl"):
        try:
            a = D.slot_addr(url, addr, SLOTS[key])
        except Exception:
            a = None
        if a:
            impl = a
            break

    if impl:
        # beacon-слот указывает на контракт-маяк; его impl читается вызовом,
        # но для маркера достаточно: верифицирован ли САМ таргет маяка? Берём
        # найденный адрес как реализацию (для обычного impl-слота это точно она).
        vimpl = verified(chain, impl)
        return {"chain": chain, "addr": addr, "size": sz, "impl": impl,
                "impl_verified": vimpl,
                "hit": vimpl is None, "pending": vimpl == "etherscan?"}
    # не прокси — проверим сам адрес
    vself = verified(chain, addr)
    return {"chain": chain, "addr": addr, "size": sz, "impl": None,
            "self_verified": vself, "hit": vself is None,
            "pending": vself == "etherscan?"}


def inv_from_market():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "data", "market.json")
    d = json.load(open(path, encoding="utf-8"))
    progs = d if isinstance(d, list) else (d.get("programs") or
            next(v for v in d.values() if isinstance(v, list)))
    # Явно перечисляем И поддерживаемые, И неподдерживаемые сети: неизвестный
    # домен НЕЛЬЗЯ молча считать mainnet. Так вышло с Vesper (Optimism), Olympus
    # (Berachain), GMX (Arbitrum/Avax), deBridge (Fantom): все проверились на
    # сети 1 и дали ложное «нет исходника» — контракт был на ДРУГОЙ сети.
    EXPL = {"etherscan.io": 1, "eth.blockscout": 1,
            "optimistic.etherscan": 10, "optimism.blockscout": 10,
            "basescan.org": 8453, "base.blockscout": 8453,
            "arbiscan.io": 42161, "arbitrum.blockscout": 42161,
            # известные, но НЕ поддержанные (verify+RPC нет) — узнаём, чтобы
            # осознанно пропустить, а не мис-чекнуть на mainnet
            "berascan": None, "ftmscan.com": 250, "snowtrace.io": 43114,
            "polygonscan.com": 137, "bscscan.com": 56, "gnosisscan.io": 100,
            "scrollscan.com": 534352, "lineascan.build": 59144}

    def chain_of(u):
        u = (u or "").lower()
        for dom, c in EXPL.items():
            if dom in u:
                return c
        return None            # неизвестно -> НЕ mainnet, скорее пропуск
    inv = {}
    for p in progs:
        name = p.get("name", "?")
        pairs = []
        for a in (p.get("assets") or []):
            if a.get("type") not in (None, "smart_contract", "contracts"):
                continue
            # сеть — ОДНА на asset, из explorer-ссылки; не из поля name
            ch = chain_of(a.get("url")) or chain_of(a.get("desc"))
            if ch is None:
                continue        # сеть не определить — не гадаем, пропускаем
            for field in (a.get("url"), a.get("desc"), a.get("name")):
                for m in ADDR.findall(field or ""):
                    pairs.append((ch, m))
        pairs = sorted(set(pairs))
        if pairs:
            inv[name] = pairs
    return inv


def main():
    a = sys.argv[1:]
    min_code = 0
    if "--min-code" in a:
        i = a.index("--min-code")
        min_code = int(a[i + 1])
        a = a[:i] + a[i + 2:]

    if "--market" in a:
        inv = inv_from_market()
    elif "--inv" in a:
        inv = json.load(open(a[a.index("--inv") + 1]))
    else:
        inv = {"cli": [tuple([int(x.split(":")[0]), x.split(":")[1]])
                       for x in a if ":" in x]}

    # только поддерживаемые сети
    flat = []
    for name, pairs in inv.items():
        for ch, addr in pairs:
            ch = int(ch)
            if ch in RPCS:
                flat.append((name, ch, addr))
    # дедуп по адресу
    seen, uniq = set(), []
    for name, ch, addr in flat:
        k = (ch, addr.lower())
        if k in seen:
            continue
        seen.add(k)
        uniq.append((name, ch, addr))

    key_note = ("с ключом Etherscan" if ETHERSCAN_KEY else
                "БЕЗ ключа Etherscan — хиты НЕ подтверждены (только Sourcify+Blockscout)")
    sys.stderr.write("адресов к проверке: %d (сети 1/10/8453/42161; %s)\n"
                     % (len(uniq), key_note))
    hits, pending, probed = [], [], []
    for i, (name, ch, addr) in enumerate(uniq):
        r = probe(ch, addr, min_code)
        r["prog"] = name
        probed.append(r)
        if r.get("hit"):
            hits.append(r)
        elif r.get("pending"):
            pending.append(r)
        sys.stderr.write("\r  %d/%d  хитов %d  ждут %d  %-26s" %
                         (i + 1, len(uniq), len(hits), len(pending), name[:26]))
        sys.stderr.flush()
        time.sleep(0.15)
    sys.stderr.write("\n")

    def dump_group(items, verdict):
        byprog = {}
        for h in items:
            byprog.setdefault(h["prog"], []).append(h)
        for name in sorted(byprog, key=lambda n: -len(byprog[n])):
            print("\n[%s] — %d" % (name, len(byprog[name])))
            for h in byprog[name]:
                if h.get("impl"):
                    print("   %d:%s  прокси -> impl %s  %s  (%d б)"
                          % (h["chain"], h["addr"], h["impl"], verdict, h["size"]))
                else:
                    print("   %d:%s  контракт %s  (%d б)"
                          % (h["chain"], h["addr"], verdict, h["size"]))

    print("=" * 84)
    if ETHERSCAN_KEY:
        print("НЕПУБЛИКУЕМЫЙ ПРОД — %d ПОДТВЕРЖДЁННЫХ хитов из %d адресов"
              % (len(hits), len(uniq)))
        print("Нет исходника ни в Sourcify, ни на Blockscout, ни на Etherscan.")
        print("=" * 84)
        dump_group(hits, "БЕЗ ИСХОДНИКА НИГДЕ")
    else:
        print("КАНДИДАТЫ (НЕ подтверждены) — %d без исходника в Sourcify+Blockscout"
              % len(pending))
        print("Etherscan НЕ проверен (нет ключа). Пока Etherscan не проверен, это")
        print("НЕ находки: WBTC-контроллер прошёл бы сюда ложно. Дать ETHERSCAN_")
        print("API_KEY и перегнать — тогда останутся только настоящие непубликуемые.")
        print("=" * 84)
        dump_group(pending, "нет в Sourcify/Blockscout (Etherscan?)")
    out = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       "data", "unverified_scan.json")
    json.dump(probed, open(out, "w"), indent=0)
    print("\nполный лог: %s" % out)


if __name__ == "__main__":
    main()
