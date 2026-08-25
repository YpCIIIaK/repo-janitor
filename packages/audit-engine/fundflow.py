# -*- coding: utf-8 -*-
"""ДЕРЖИТ ЛИ КОНТРАКТ СРЕДСТВА В ПОКОЕ — механика, от которой зависит ИМПАКТ.

Зачем. Произвольный внешний вызов / отсутствие гейта опасны РОВНО настолько,
насколько есть что уводить. Обёртка defi-saver `takeOrder` даёт произвольный
`.call`, но средства приходят и свопаются в одной транзакции, а остаток
сметается вызывающему — в покое на ней НОЛЬ, и реальный импакт low. Кастодиан
же (хранилище с балансами) под тем же вызовом — HIGH. Модель из ТЕЛА функции
этого не видит; severity завышалась. Здесь этот факт добывается механически.

Два входа, дополняют друг друга:

* СТАТИКА (всегда, без адреса) — по коду: транзитный (сметает остаток
  вызывающему, funds in->out в одной функции) vs кастодиан (маппинг балансов/
  долей, withdraw своего баланса, payable-накопление). Это ЗАМЫСЕЛ.
* ON-CHAIN (по адресу) — правда: держит ли развёрнутый контракт баланс ПРЯМО
  СЕЙЧАС. Blockscout отдаёт ВСЕ токен-балансы адреса одним запросом плюс ETH.
  Только чтение.

Импакт-правило для произвольного вызова / ungated:
    кастодиан / держит сейчас  -> опасно (drain), severity вверх
    транзитный / в покое пусто  -> low, красть нечего кроме пыли

использование:
    fundflow.py <корень> [--contract Имя]     статика по дереву
    fundflow.py --addr <chain>:<0xADDR> [...]  on-chain балансы
как модуль:
    fundflow.verdict(contract) -> {"kind": "custodial|transient|unknown",
                                    "why": "...", "custodial": bool}
"""
import os
import re
import sys

import solsrc

# --- статические сигналы ---

# Маппинг пользовательских балансов/долей: контракт ХРАНИТ чужие средства.
BAL_MAP = re.compile(
    r"mapping\s*\(\s*address\s*=>\s*(?:uint\d*|int\d*)\s*\)\s*"
    r"(?:public\s+|internal\s+|private\s+)?"
    r"(balances?|deposits?|shares?|balanceOf|_balances|userBalances?|"
    r"staked|locked|deposited|collateral|principal)\b", re.I)

# Сметание остатка ВЫЗЫВАЮЩЕМУ в конце операции: транзитный паттерн обёртки.
SWEEP = re.compile(
    r"\b(sendLeftover|_?sweep\w*|returnLeftover|_?returnFunds|_?refund\w*|"
    r"skim|_?returnAll|withdrawLeftover|_?sendBack)\b", re.I)

# Приём чужих средств НА СЕБЯ: safeTransferFrom(*, address(this), *).
INCOMING = re.compile(
    r"(?:safeTransferFrom|transferFrom)\s*\([^,]+,\s*address\s*\(\s*this\s*\)",
    re.I)

# Выдача СОБСТВЕННОГО баланса наружу по учёту: withdraw/redeem/claim/collect,
# которые двигают средства (transfer/safeTransfer/call с value) — держит.
WITHDRAW_NAME = re.compile(
    r"^(?:withdraw\w*|redeem\w*|claim\w*|collect\w*|unstake\w*|unlock\w*|"
    r"exit|cashOut|release\w*)$", re.I)
MOVES_FUNDS = re.compile(
    r"\b(?:safeTransfer|transfer|sendValue|\.call\s*\{)\b", re.I)

# payable-накопление: receive/fallback payable без немедленной пересылки.
PAYABLE_RECV = re.compile(r"\b(receive|fallback)\b")


def verdict(contract):
    """Держит ли контракт средства в покое, по коду. Возвращает kind/why."""
    funcs = contract.funcs or []
    body_all = "\n".join((f.body or "") for f in funcs)
    varsrc = " ".join(contract.vars or []) if contract.vars else ""
    # плюс сырое тело контракта на случай, если vars не разобрались
    whole = (contract.body or "") + " " + varsrc

    # КАСТОДИАН — только СИЛЬНЫЕ сигналы хранения чужих средств. Пустой
    # `receive() payable {}` в обёртке — приём ETH в свопе, НЕ кастодия;
    # его в custody НЕ считаем (жёг: все sell-обёртки ложно «держали»).
    if BAL_MAP.search(whole):
        return _v("custodial", "маппинг балансов/долей — хранит чужие средства", True)
    for f in funcs:
        if WITHDRAW_NAME.match(f.name or "") and MOVES_FUNDS.search(f.body or ""):
            return _v("custodial",
                      "функция %s двигает средства по учёту — держит баланс" % f.name,
                      True)

    # НЕ кастодиан -> в покое, скорее всего, пусто (импакт произвольного вызова
    # low). Уточняем вид, но custodial=False в любом случае.
    if SWEEP.search(body_all):
        return _v("transient",
                  "сметает остаток вызывающему (sendLeftover/sweep) — в покое пусто",
                  False)
    if INCOMING.search(body_all):
        return _v("transient",
                  "тянет средства на себя и двигает дальше (адаптер) — транзит",
                  False)
    return _v("unknown",
              "не похоже на кастодиан (нет маппинга балансов/withdraw своего) — "
              "в покое вероятно пусто; подтвердить адресом", False)


def _v(kind, why, custodial):
    return {"kind": kind, "why": why, "custodial": custodial}


def enrich(v, chain, addr):
    """Дополнить статический вердикт правдой из сети: держит ли адрес баланс
    ПРЯМО СЕЙЧАС. Сознательно НЕ переключаем custodial автоматически — сырой
    ненулевой баланс может быть пылью (децималы токена тут неизвестны), а
    механическое custodial=True погнало бы severity вверх на пыли. Отдаём ФАКТ
    (держит / пусто, какие токены) отдельным полем — судит модель. Best-effort:
    сеть флапнула — возвращаем вход как есть."""
    try:
        r = onchain(chain, addr)
    except Exception:
        return v
    v = dict(v)
    v["holds_live"] = r["holds"]
    v["onchain"] = {"holds": r["holds"], "eth": r["eth"],
                    "tokens": r["tokens"][:5], "addr": addr, "chain": chain}
    if r["holds"]:
        held = (("ETH+" if r["eth"] > 0 else "") +
                " ".join(t[0] for t in r["tokens"][:3])).strip()
        v["why"] = v["why"] + " | ON-CHAIN держит СЕЙЧАС: %s (%s)" % (
            held or "баланс", addr[:10])
    else:
        v["why"] = v["why"] + " | ON-CHAIN пусто сейчас (%s)" % addr[:10]
    return v


def analyze_tree(root, only=None):
    cons = (solsrc.parse_file(root) if os.path.isfile(root)
            else solsrc.parse_tree(root))
    out = {}
    for c in cons:
        if c.kind == "interface" or only and c.name != only:
            continue
        out[c.name] = verdict(c)
    return out


# --- on-chain: держит ли адрес баланс ПРЯМО СЕЙЧАС ---

def onchain(chain, addr):
    """{"holds": bool, "eth": wei, "tokens": [(symbol, raw)]}. Только чтение."""
    import deployed as D
    res = {"holds": False, "eth": 0, "tokens": []}
    host = D.BLOCKSCOUT.get(chain)
    # ETH/натив
    url = D.RPCS[chain] if hasattr(D, "RPCS") else None
    try:
        rpc = {1: "https://ethereum-rpc.publicnode.com",
               10: "https://optimism-rpc.publicnode.com",
               8453: "https://base-rpc.publicnode.com",
               42161: "https://arbitrum-one-rpc.publicnode.com"}.get(chain)
        if rpc:
            v = D.rpc(rpc, "eth_getBalance", [addr, "latest"])
            res["eth"] = int(v, 16) if v else 0
    except Exception:
        pass
    # токен-балансы одним запросом (Blockscout отдаёт все holdings)
    if host:
        txt = D.get("%s/api/v2/addresses/%s/token-balances" % (host, addr), timeout=30)
        if txt:
            try:
                import json
                for t in json.loads(txt):
                    raw = int(t.get("value") or 0)
                    if raw > 0:
                        sym = ((t.get("token") or {}).get("symbol")) or "?"
                        res["tokens"].append((sym, raw))
            except Exception:
                pass
    res["holds"] = bool(res["eth"] > 0 or res["tokens"])
    return res


def main():
    a = sys.argv[1:]
    if "--addr" in a:
        for x in a:
            if ":" in x and x.split(":")[0].isdigit():
                ch, ad = x.split(":", 1)
                r = onchain(int(ch), ad)
                print("%d:%s  держит=%s  ETH=%d  токенов=%d %s"
                      % (int(ch), ad, "ДА" if r["holds"] else "нет",
                         r["eth"], len(r["tokens"]),
                         ", ".join("%s=%d" % t for t in r["tokens"][:5])))
        return
    if not a:
        print(__doc__)
        return
    only = a[a.index("--contract") + 1] if "--contract" in a else None
    res = analyze_tree(a[0], only)
    print("=" * 72)
    print("FUND-FLOW по дереву — держит ли контракт средства в покое")
    print("=" * 72)
    order = {"custodial": 0, "unknown": 1, "transient": 2}
    for name, v in sorted(res.items(), key=lambda kv: order.get(kv[1]["kind"], 3)):
        tag = {"custodial": "ДЕРЖИТ ", "transient": "транзит", "unknown": "неясно "}[v["kind"]]
        print("  [%s] %-32s %s" % (tag, name[:32], v["why"]))
    print("\nИмпакт произвольного вызова/ungated: у ДЕРЖИТ — drain (high), у")
    print("транзита — low (красть нечего в покое). unknown — проверить адресом.")


if __name__ == "__main__":
    main()
