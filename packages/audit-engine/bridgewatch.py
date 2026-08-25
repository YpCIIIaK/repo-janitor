# -*- coding: utf-8 -*-
"""ПЕРИОДИЧЕСКИЙ ОБХОД МОСТОВ: стухший peer / разъезд общего таргета / версии.

Зачем отдельно от xchain.py. xchain сравнивает ОДНО поле на двух цепях и
спрашивает «почему разошлось». Для мостов этого мало и местами НЕВЕРНО:
взаимный peer — это НЕ «A.peers(eidB) равно B.peers(eidA)». Наоборот:
    A.peers(eidB)  должно равняться АДРЕСУ B (кого A доверяет на цепи B),
    B.peers(eidA)  должно равняться АДРЕСУ A.
Это РАЗНЫЕ адреса, и требовать их равенства (как делал бы наивный cmp) —
всегда ложный разрыв. Настоящее ОКНО открывается, когда сохранённый у одной
стороны peer РАЗЪЕХАЛСЯ с ФАКТИЧЕСКИМ текущим адресом другой стороны:
B переехал/обновил адрес, а A всё ещё доверяет старому (или наоборот). Тогда
сообщение с новой стороны отвергается / сообщение старому адресу проходит.

Что проверяем на каждую пару моста:
  1) mutual peer   — A.peers(eidB) == addrB  И  B.peers(eidA) == addrA
                     (LayerZero v2: peers(uint32)->bytes32; сверяем с bytes32
                     адреса). Рассинхрон = ОКНО [9].
  2) общий таргет  — поля, на которые ОБЕ стороны должны указывать одинаково
                     (например обе L2 -> ОДИН L1-редимер). Разъезд = средства
                     не туда [8].
  3) version()     — одна реализация => одна версия. Разъезд = разный код на
                     сторонах, повод искать unfixed-half across chains [5].

Всё чтение — read-only eth_call на публичных узлах. Инструмент задуман под
ПЕРИОДИЧЕСКИЙ прогон (во время анонсированных апгрейдов окно узкое по времени).
Находки дописываются в data/bridgewatch.log с датой; чисто — тихо.

Мост описывается в data/bridgewatch.json списком записей:
  {
    "name": "Lombard LBTC OFT (eth<->base)",
    "a": {"rpc": "...", "addr": "0x..", "chain": 1,     "eid": 30101},
    "b": {"rpc": "...", "addr": "0x..", "chain": 8453,  "eid": 30184},
    "peers_sig": "peers(uint32)",            # опц., по умолч. LZ v2
    "shared": ["l1BtcRedeemerWormholeAddress():bytes32"]   # опц.
  }

    python bridgewatch.py            # обойти весь список
    python bridgewatch.py <name>     # только записи, чьё имя содержит <name>
"""
import datetime
import json
import os
import sys

import evmabi as E
import xchain as X

WATCH = os.path.join("data", "bridgewatch.json")
LOG = os.path.join("data", "bridgewatch.log")


def _as_bytes32_addr(hexval):
    """Нормализует адрес/bytes32 к сравнимому виду '0x'+40 hex (младшие 20 байт).
    peers() возвращает bytes32 = 12 нулей + 20 байт адреса; так сверяем с addr."""
    if hexval is None:
        return None
    s = str(hexval).lower().replace("0x", "")
    s = s[-40:].rjust(40, "0")  # младшие 20 байт
    return "0x" + s


def peer_check(entry):
    """(rows) — по одной строке на сторону. diverged=True => стухший peer."""
    a, b = entry["a"], entry["b"]
    sig = entry.get("peers_sig", "peers(uint32)")
    rows = []
    # A должен доверять ФАКТИЧЕСКОМУ адресу B на eidB
    sa = X.call(a["rpc"], a["addr"], sig, "bytes32", [("uint32", b["eid"])])
    if sa[0] == "ok":
        stored = _as_bytes32_addr(sa[1])
        want = _as_bytes32_addr(b["addr"])
        rows.append({"label": "peer A->B (A доверяет B?)", "kind": "cmp",
                     "a": stored, "b": want, "diverged": stored != want,
                     "note": "A.peers(eidB) должно == адрес B"})
    elif sa[0] == "ОШИБКА":
        rows.append({"label": "peer A->B", "kind": "не сравнить",
                     "a": str(sa[1])[:40], "b": "", "diverged": False})
    # B должен доверять ФАКТИЧЕСКОМУ адресу A на eidA
    sb = X.call(b["rpc"], b["addr"], sig, "bytes32", [("uint32", a["eid"])])
    if sb[0] == "ok":
        stored = _as_bytes32_addr(sb[1])
        want = _as_bytes32_addr(a["addr"])
        rows.append({"label": "peer B->A (B доверяет A?)", "kind": "cmp",
                     "a": stored, "b": want, "diverged": stored != want,
                     "note": "B.peers(eidA) должно == адрес A"})
    elif sb[0] == "ОШИБКА":
        rows.append({"label": "peer B->A", "kind": "не сравнить",
                     "a": str(sb[1])[:40], "b": "", "diverged": False})
    return rows


def shared_check(entry):
    """Поля, на которые ОБЕ стороны обязаны указывать одинаково."""
    a, b = entry["a"], entry["b"]
    rows = []
    for spec in entry.get("shared", []):
        sig = spec.split(":")[0] if ":" in spec else spec
        rtype = spec.split(":")[1] if ":" in spec else "address"
        ra = X.call(a["rpc"], a["addr"], sig, rtype, [])
        rb = X.call(b["rpc"], b["addr"], sig, rtype, [])
        rows.append(X.cmp_row("shared:%s" % sig.split("(")[0], ra, rb))
    return rows


def version_check(entry):
    a, b = entry["a"], entry["b"]
    ra = X.call(a["rpc"], a["addr"], "version()", "string", [])
    rb = X.call(b["rpc"], b["addr"], "version()", "string", [])
    if ra[0] == "ok" and rb[0] == "ok":
        return [X.cmp_row("version", ra, rb)]
    return []


def has_code(side):
    """У адреса есть байткод? Пустой '0x' => адрес неверен/контракт мёртв.
    Иначе все eth_call вернут 0x -> 'нет функции' -> ложное «синхронно»
    (молчаливый провал, ровно тот класс, что ловит [[silent-failure-tests]])."""
    try:
        code = X.D.rpc(side["rpc"], "eth_getCode", [side["addr"], "latest"])
        return bool(code) and code != "0x"
    except Exception:
        return None            # ошибка узла — не путать с отсутствием кода


def run_entry(entry):
    # СНАЧАЛА убеждаемся, что по обоим адресам есть код. Нет кода = тревога,
    # а не тишина: пустой адрес отвечает 0x на всё и мимикрирует под «синхронно».
    guard = []
    for tag in ("a", "b"):
        hc = has_code(entry[tag])
        if hc is False:
            guard.append({"label": "НЕТ КОДА (%s)" % tag, "kind": "cmp",
                          "a": entry[tag]["addr"], "b": "пусто", "diverged": True,
                          "note": "адрес без байткода — неверен или контракт мёртв"})
    if guard:
        return guard, guard      # не читаем поля у пустого адреса
    rows = peer_check(entry) + shared_check(entry) + version_check(entry)
    alarms = [r for r in rows if r.get("diverged")]
    return rows, alarms


def _stamp():
    return datetime.datetime.now().strftime("%Y-%m-%d %H:%M")


def main():
    if not os.path.exists(WATCH):
        print("нет %s — заполни список мостов (формат в шапке)" % WATCH)
        return
    entries = json.load(open(WATCH, encoding="utf-8"))
    flt = sys.argv[1] if len(sys.argv) > 1 else None
    if flt:
        entries = [e for e in entries if flt.lower() in e["name"].lower()]

    any_alarm = False
    loglines = []
    for e in entries:
        print("=" * 74)
        print(e["name"])
        rows, alarms = run_entry(e)
        for r in rows:
            mark = "!!" if r.get("diverged") else ("? " if r["kind"] ==
                                                   "не сравнить" else "= ")
            print("  %s %-28s A=%s B=%s" % (mark, r["label"],
                                            X._short(r["a"]), X._short(r["b"])))
        if alarms:
            any_alarm = True
            for r in alarms:
                loglines.append("%s  [%s]  %s  A=%s B=%s  %s" % (
                    _stamp(), e["name"], r["label"], r["a"], r["b"],
                    r.get("note", "")))
            print("  --> ОКНО: %d поле(й) разошлось, см. %s" %
                  (len(alarms), LOG))
        else:
            print("  синхронно (по обязанным совпадать полям)")

    if loglines:
        with open(LOG, "a", encoding="utf-8") as f:
            for ln in loglines:
                f.write(ln + "\n")
    if not any_alarm:
        print("\nПо всем мостам синхронно. Окно узко по времени — гонять")
        print("периодически, особенно вокруг анонсированных апгрейдов.")


if __name__ == "__main__":
    main()
