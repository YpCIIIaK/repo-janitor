# -*- coding: utf-8 -*-
"""UNFIXED-HALF ACROSS CHAINS: одна цепь на старом коде, другая на новом.

Зачем. Протокол, задеплоенный на несколько цепей, обновляется РАЗДЕЛЬНО. Часто
патч (в т.ч. фикс уязвимости) прилетает на mainnet, а на L2 — с задержкой в
недели, или вовсе забыт. Тогда на отстающей цепи ЖИВЁТ баг, который на ведущей
уже закрыт — и это законная находка ИМЕННО на отстающей цепи (в скоупе она есть).
Это кросс-чейн-версия приёма [[unfixed-half-technique]]: не «половина путей
пофикшена в одном контракте», а «одна цепь пофикшена, другая нет».

Сигнал дёшев и наблюдаем: у контракта, ведущего `version()` (или иной маркер
идентичности кода), читаем его на обеих цепях. Разъезд строки = разный код =
повод достать дифф релизов и искать, ЧТО именно поправили на ведущей цепи и
живо ли это на отстающей.

Чего НЕ делаем. Не сравниваем extcodehash/байткод: он расходится почти всегда
(иммутабли, метадата-хэш, конструктор-аргументы) — это шум, как impl-адрес в
[[xchain-desync]]. Опираемся на ЯВНЫЙ маркер версии, который ведёт сам протокол.
Нет маркера — молчим (дёшево не определить), не выдаём ложный сигнал.

Источник пар — scope.json `xchain_pairs` (один логический контракт на 2+ сетях),
их строит [[scope-manifest]]. Дедуп по имени: на контракт достаточно одной пары.

    python versionsweep.py <scope-slug> [--sig "revision():uint256"] [--cap 40]
"""
import json
import os
import sys

import xchain as X

# chainId -> публичный RPC (совпадает с targets.DEPLOY_RPCS; дублируем, чтобы
# не тянуть targets со всем его весом ради словаря).
RPCS = {
    1: "https://eth.llamarpc.com",
    10: "https://optimism-rpc.publicnode.com",
    8453: "https://base-rpc.publicnode.com",
    42161: "https://arbitrum-one-rpc.publicnode.com",
    137: "https://polygon-bor-rpc.publicnode.com",
}


def _parse_sig(spec):
    sig = spec.split(":")[0]
    rtype = spec.split(":")[1] if ":" in spec else "string"
    return sig, rtype


def sweep(slug, sig_spec="version():string", cap=40):
    path = os.path.join("data", "bounty", slug, "scope.json")
    if not os.path.exists(path):
        print("нет %s" % path)
        return
    pairs = json.load(open(path, encoding="utf-8")).get("xchain_pairs", [])
    sig, rtype = _parse_sig(sig_spec)

    seen = set()
    diverged, absent, same, uncmp = [], [], [], []
    for p in pairs:
        if p["name"] in seen:
            continue                      # дедуп: одной пары на имя хватает
        seen.add(p["name"])
        if len(seen) > cap:
            break
        (ca, aa), (cb, ab) = p["a"], p["b"]
        if ca not in RPCS or cb not in RPCS:
            continue
        ra = X.call(RPCS[ca], aa, sig, rtype, [])
        rb = X.call(RPCS[cb], ab, sig, rtype, [])
        if ra[0] == "ok" and rb[0] == "ok":
            (diverged if ra[1] != rb[1] else same).append(
                (p["name"], ca, ra[1], cb, rb[1]))
        elif "ОШИБКА" in (ra[0], rb[0]):
            uncmp.append(p["name"])
        else:
            absent.append(p["name"])      # маркера версии нет — молчим

    print("=" * 74)
    print("versionsweep %s  sig=%s  (пар-имён: %d)" % (slug, sig, len(seen)))
    print("совпало: %d | маркера нет: %d | не сравнить(ошибка узла): %d"
          % (len(same), len(absent), len(uncmp)))
    if not diverged:
        print("\nРазъезда версий нет по прочитанным. Если у контрактов нет")
        print("version() — попробуй --sig с реальным маркером (revision/VERSION).")
        return
    print("\n" + "!" * 74)
    print("РАЗЪЕХАЛАСЬ ВЕРСИЯ (%d) — кандидаты unfixed-half across chains:"
          % len(diverged))
    for name, ca, va, cb, vb in diverged:
        print("\n  %s" % name)
        print("     chain %-6s : %s" % (ca, va))
        print("     chain %-6s : %s" % (cb, vb))
    print("\n" + "-" * 74)
    print("Дальше: взять дифф релизов между версиями на ВЕДУЩЕЙ цепи, найти")
    print("что пофикшено, и проверить, живо ли это на ОТСТАЮЩЕЙ (она в скоупе).")


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    slug = a[0]
    sig = a[a.index("--sig") + 1] if "--sig" in a else "version():string"
    cap = int(a[a.index("--cap") + 1]) if "--cap" in a else 40
    sweep(slug, sig, cap)


if __name__ == "__main__":
    main()
