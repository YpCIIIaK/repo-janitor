# -*- coding: utf-8 -*-
"""РАССИНХРОН РЕЕСТРА L1↔L2: одно и то же авторитетное поле разошлось.

Зачем. Мосты держат ОДИН логический реестр, реплицированный на нескольких
цепях: доверенные пиры, роли, ожидаемые нонсы, версия реализации, флаг
паузы. Пока цепи синхронны, всё цело. Но обновляют их РАЗДЕЛЬНО, и между
обновлениями открывается ОКНО: L1 уже новый пир, L2 ещё старый — и
сообщение, отклонённое на одной стороне, проходит на другой. Это не гипотеза
из статьи: во время апгрейда Pectra в 2025 такое окно на непере­ехавшем L2
жило десять дней (redvolt, SmartAxe arXiv 2406.15999). Ronin, Wormhole,
Nomad — все про рассинхрон состояния между сторонами, суммарно за миллиард.

Почему это НАШ масштаб и почему локально. Полная символьная модель двух
состояний (COBALT-TLA) тяжёлая и самописи не по росту. Но окно РАССИНХРОНА
НАБЛЮДАЕМО ПРЯМО СЕЙЧАС: достаточно прочитать одно и то же авторитетное поле
на обеих цепях двумя `eth_call` и сравнить. Оба вызова read-only, оба к
публичным узлам, всё считается на ноутбуке за секунды. Симуляция нужна
только для PoC (двойной форк Foundry — рецепт в конце файла), а для
ОБНАРУЖЕНИЯ хватает чтения.

Что читаем по умолчанию (расширяется через --sig):

    version()       string    — реализации разъехались = разный код
    paused()        bool      — одна сторона на паузе, другая нет
    owner()         address   — владелец расходится
    EIP-1967 impl              — прокси указывают на разные реализации
    peers(uint32)   address   — доверенный пир (LayerZero), ЯДРО рассинхрона
    trustedRemoteLookup       — то же для v1

Сила поля. Расхождение ПИРА или impl — почти всегда окно атаки. Расхождение
паузы — вектор ЦОД или обход паузы. Владелец/версия — сигнал, что апгрейд
идёт и окно открыто прямо сейчас.

ЧЕГО ИНСТРУМЕНТ НЕ ЗНАЕТ. Он не отличает ЗАКОННЫЙ рассинхрон (стороны и
должны отличаться — у каждой свой локальный пир) от опасного. Поэтому вывод
— «эти поля разошлись, объясни почему». Но именно поля пиров и impl обязаны
быть согласованы по смыслу, и разрыв там — первое, что стоит проверить.

использование:
    xchain.py --a <rpcA> <addrA> --b <rpcB> <addrB>
              [--chainA 1] [--chainB 747474]
              [--sig "peers(uint32):address:30101"]   (повторяемо)
              [--eid-a 30101 --eid-b 30184]           (пир друг друга)
"""
import re
import sys

import deployed as D
import evmabi as E


# Селектор-проба: (метка, сигнатура, тип результата, аргументы[(тип,знач)]).
def default_probes():
    return [
        ("version", "version()", "string", []),
        ("paused", "paused()", "bool", []),
        ("owner", "owner()", "address", []),
        ("pendingOwner", "pendingOwner()", "address", []),
    ]


# ОЖИДАЕМ ли, что поле СОВПАДАЁТ между цепями?
#
# Ключевой урок threshold (L2BTCRedeemerProxy base<->arbitrum): impl-адрес и
# owner РАЗОШЛИСЬ — и тул выдал это как тревогу [9]/[6]. Ложняк: два НЕЗАВИСИМЫХ
# деплоя на разных цепях ВСЕГДА имеют разный адрес реализации и часто разного
# владельца. Это норма, не окно. Сравнивать адрес impl между цепями бессмысленно
# (одинакового кода на разных адресах достаточно). Тревога законна ТОЛЬКО для
# полей, которые по смыслу обязаны совпадать:
#   - version()  — одна реализация => одна строка версии (разъезд = разный код);
#   - paused     — операционно синхронны;
#   - peer друг друга / trustedRemote — взаимная ссылка, ядро рассинхрона;
#   - общий указатель (обе стороны -> ОДИН L1-таргет/редимер/шлюз).
# А impl-АДРЕС и owner/admin ожидаемо разные — это ИНФО, не алярм.
def expect_match(label):
    l = label.lower()
    # структурно-разные по построению независимых деплоев:
    # адреса реализации/владельца и ЛОКАЛЬНАЯ инфраструктура цепи (свой шлюз/
    # роутер/эндпоинт на каждой L2) обязаны отличаться. Урок threshold-2:
    # gateway base != gateway arb — это норма, не окно.
    if "impl" in l or "owner" in l or "admin" in l or "pendingowner" in l:
        return False
    if "gateway" in l or "router" in l or "messenger" in l or "endpoint" in l \
            or "dispatcher" in l:
        return False
    return True


# Насколько расхождение СОВПАДАЮЩЕГО-по-смыслу поля тревожно.
def weight(label):
    l = label.lower()
    if "peer" in l or "trustedremote" in l or "connector" in l:
        return 9.0
    # общий указатель, который обе цепи обязаны разделять (L1-таргет назначения:
    # обе L2 -> ОДИН L1-редимер). Локальный gateway сюда НЕ входит (он свой на
    # каждой цепи) — см. expect_match.
    if "shared" in l or "l1" in l or "target" in l or "redeemer" in l \
            or "remote" in l:
        return 8.0
    if "pause" in l:
        return 7.0
    if "version" in l:
        return 5.0
    return 3.0


def _short(v):
    s = str(v)
    return s if len(s) < 40 else s[:37] + "..."


# Ревертнувший вызов = функции на контракте нет (или require не прошёл): это
# ЧИСТЫЙ сравнимый ответ, а не сбой узла. Отличаем по коду/тексту JSON-RPC.
REVERT = re.compile(r"execution reverted|revert|out of gas|invalid opcode",
                    re.I)


def _classify_err(e):
    msg = ""
    if isinstance(e, RuntimeError) and e.args and isinstance(e.args[0], dict):
        d = e.args[0]
        if d.get("code") == 3 or REVERT.search(str(d.get("message", ""))):
            return "нет функции"
    if REVERT.search(str(e)):
        return "нет функции"
    return "ОШИБКА"


def call(url, addr, sig, rtype, args):
    data = E.calldata(sig, args)
    try:
        r = D.rpc(url, "eth_call", [{"to": addr, "data": data}, "latest"])
    except Exception as e:
        return (_classify_err(e), e)
    if r is None or r == "0x":
        return ("нет функции", None)
    return ("ok", E.dec_ret(rtype, r))


def impl_of(url, addr):
    """(статус, значение). Статус 'ok'|'нет'|'ОШИБКА' — ошибку RPC нельзя
    путать с отсутствием прокси, иначе ненадёжный узел даёт ложный разрыв."""
    try:
        v = D.slot_addr(url, addr, D.SLOT_IMPL)
        return ("ok", v) if v else ("нет", None)
    except Exception as e:
        return ("ОШИБКА", e)


def cmp_row(label, sa, sb):
    """Строку сравнения строим ТОЛЬКО когда обе стороны ответили чисто.

    Три исхода: обе ok → сравниваем значения; обе 'нет функции'/'нет' →
    совпадают (нечего сравнивать); хотя бы одна ОШИБКА → 'не сравнить',
    и это НЕ расхождение. Так ненадёжный публичный узел не превращается в
    фантомный рассинхрон — ровно на этом провалился первый негативный
    контроль."""
    ok_a = sa[0] == "ok"
    ok_b = sb[0] == "ok"
    err = "ОШИБКА" in (sa[0], sb[0])
    if err:
        return {"label": label, "kind": "не сравнить",
                "a": sa[1], "b": sb[1], "diverged": False}
    if ok_a and ok_b:
        return {"label": label, "kind": "cmp", "a": sa[1], "b": sb[1],
                "diverged": sa[1] != sb[1]}
    if not ok_a and not ok_b:
        return {"label": label, "kind": "нет у обоих",
                "a": sa[0], "b": sb[0], "diverged": False}
    # одна сторона имеет функцию, другая нет — это структурное различие,
    # но не «состояние разошлось»: отмечаем отдельно, слабым сигналом.
    return {"label": label, "kind": "есть у одного",
            "a": sa[1] if ok_a else sa[0], "b": sb[1] if ok_b else sb[0],
            "diverged": False, "structural": True}


def run(rpc_a, addr_a, rpc_b, addr_b, probes, eid_a=None, eid_b=None):
    print("=" * 78)
    print("A: %s @ %s" % (addr_a, rpc_a))
    print("B: %s @ %s" % (addr_b, rpc_b))
    print("=" * 78)

    rows = []

    # EIP-1967 реализация — отдельно, через слот
    ia, ib = impl_of(rpc_a, addr_a), impl_of(rpc_b, addr_b)
    if not (ia[0] == "нет" and ib[0] == "нет"):
        rows.append(cmp_row("impl (EIP-1967)", ia, ib))

    # Пир друг друга: на A читаем peers(eid_b), на B читаем peers(eid_a).
    # Это НЕ должно расходиться по смыслу: каждая сторона должна доверять
    # актуальному адресу другой. Разрыв здесь — прямое окно.
    if eid_a is not None and eid_b is not None:
        for sig in ("peers(uint32)", "peers(uint256)"):
            sa = call(rpc_a, addr_a, sig, "address", [("uint32", eid_b)])
            sb = call(rpc_b, addr_b, sig, "address", [("uint32", eid_a)])
            if sa[0] == "ok" or sb[0] == "ok":
                rows.append(cmp_row("peer друг друга (%s)" % sig, sa, sb))
                break

    for label, sig, rtype, args in probes:
        ra = call(rpc_a, addr_a, sig, rtype, args)
        rb = call(rpc_b, addr_b, sig, rtype, args)
        if ra[0] == "нет функции" and rb[0] == "нет функции":
            continue                         # функции нет ни там, ни там
        rows.append(cmp_row(label, ra, rb))

    # Разъезд поля, ОБЯЗАННОГО совпадать -> тревога. Разъезд поля, ожидаемо
    # разного (impl-адрес, owner) -> лишь инфо, не окно (урок threshold).
    diverged = [r for r in rows if r["diverged"] and expect_match(r["label"])]
    expected_diff = [r for r in rows
                     if r["diverged"] and not expect_match(r["label"])]
    uncmp = [r for r in rows if r["kind"] == "не сравнить"]
    struct = [r for r in rows if r.get("structural")]
    same = [r for r in rows if r["kind"] == "cmp" and not r["diverged"]]

    print("\nСОВПАДАЮТ (%d):" % len(same))
    for r in same:
        print("  = %-24s %s" % (r["label"], r["a"]))

    if uncmp:
        print("\nНЕ СРАВНИТЬ (%d) — узел ответил ошибкой, это НЕ рассинхрон:"
              % len(uncmp))
        for r in uncmp:
            print("  ? %-24s A=%s  B=%s"
                  % (r["label"], _short(r["a"]), _short(r["b"])))
        print("  (сменить публичный RPC и перегнать; ошибка узла ≠ разрыв)")

    if struct:
        print("\nЕСТЬ У ОДНОГО (%d) — структурное различие, не состояние:"
              % len(struct))
        for r in struct:
            print("  ~ %-24s A=%s  B=%s" % (r["label"], r["a"], r["b"]))

    if expected_diff:
        print("\nОТЛИЧАЮТСЯ (ОЖИДАЕМО) (%d) — независимые деплои, НЕ окно:"
              % len(expected_diff))
        for r in expected_diff:
            print("  · %-24s A=%s  B=%s"
                  % (r["label"], _short(r["a"]), _short(r["b"])))
        print("  (impl-адрес и owner у разных цепей и должны отличаться;")
        print("   код сверяй по version(), а не по адресу реализации)")

    if not diverged:
        print("\nРасхождений СОСТОЯНИЯ (по обязанным совпадать полям) нет.")
        print("Это НЕ доказывает отсутствие окна — оно бывает узким по времени.")
        print("Гонять периодически во время анонсированных апгрейдов. И проверь")
        print("общий указатель (обе L2 -> ОДИН L1-таргет) через --sig.")
        return

    diverged.sort(key=lambda r: -weight(r["label"]))
    print("\n" + "!" * 78)
    print("РАЗОШЛИСЬ (%d) — по убыванию тревожности:" % len(diverged))
    for r in diverged:
        print("\n[%.0f] %s" % (weight(r["label"]), r["label"]))
        print("      A = %s" % r["a"])
        print("      B = %s" % r["b"])
    print("\n" + "-" * 78)
    print("Вопрос к строке: это поле ДОЛЖНО быть согласовано между цепями?")
    print("Пир/trustedRemote — да, разрыв там открывает приём/подделку сообщения")
    print("на отстающей стороне. Общий указатель (обе L2 -> один L1-таргет) —")
    print("разрыв ведёт средства не туда. Пауза — обход паузы или ЦОД. version —")
    print("разный код на сторонах (проверь unfixed-half). impl-адрес/owner сюда")
    print("НЕ попадают: у независимых деплоев они и должны отличаться.")
    print("Для PoC — двойной форк Foundry, рецепт в шапке xchain.py.")


def parse_probes(argv):
    probes = default_probes()
    i = 0
    while i < len(argv):
        if argv[i] == "--sig":
            spec = argv[i + 1]
            # "peers(uint32):address:30101"  ->  sig, rtype, arg
            parts = spec.split(":")
            sig, rtype = parts[0], parts[1]
            args = []
            if len(parts) > 2 and parts[2]:
                atype = sig[sig.find("(") + 1:sig.find(")")].split(",")[0]
                args = [(atype, parts[2])]
            probes.append((sig.split("(")[0], sig, rtype, args))
        i += 1
    return probes


def main():
    a = sys.argv[1:]
    if "--a" not in a or "--b" not in a:
        print(__doc__)
        return
    ia = a.index("--a")
    ib = a.index("--b")
    rpc_a, addr_a = a[ia + 1], a[ia + 2]
    rpc_b, addr_b = a[ib + 1], a[ib + 2]
    eid_a = int(a[a.index("--eid-a") + 1]) if "--eid-a" in a else None
    eid_b = int(a[a.index("--eid-b") + 1]) if "--eid-b" in a else None
    probes = parse_probes(a)
    run(rpc_a, addr_a, rpc_b, addr_b, probes, eid_a, eid_b)


if __name__ == "__main__":
    main()


# ============================================================================
# РЕЦЕПТ PoC: двойной форк Foundry (локально, read-only, на ноутбуке)
# ============================================================================
#
# Обнаружение — этим файлом. ДОКАЗАТЕЛЬСТВО — форком, потому что надо
# показать, что сообщение, отклонённое на одной стороне, ПРОХОДИТ на другой
# в окне рассинхрона. Ни одной транзакции в mainnet: форк живёт в памяти.
#
#   // test/Desync.t.sol
#   contract DesyncTest is Test {
#       uint256 l1; uint256 l2;
#       function setUp() public {
#           l1 = vm.createFork(vm.envString("RPC_L1"));   // Ethereum
#           l2 = vm.createFork(vm.envString("RPC_L2"));   // Katana/L2
#       }
#       function test_window() public {
#           // 1. на L2 читаем актуального пира и ожидаемый нонс
#           vm.selectFork(l2);
#           address peerL2 = IPortal(portal).peers(EID_L1);
#           // 2. на L1 видим, что пир УЖЕ обновлён (окно открыто)
#           vm.selectFork(l1);
#           address peerL1 = IPortal(portalL1).peers(EID_L2);
#           // 3. собираем сообщение, ЛЕГАЛЬНОЕ для устаревшей стороны,
#           //    и подаём его — проверяем, что оно принято там, где не должно
#           //    (assert на изменение баланса/учёта, без единой tx в сеть)
#       }
#   }
#
# Foundry уже стоит: $env:USERPROFILE\.foundry\bin (STATE.md). RPC обеих
# цепей — публичные. Форк читает состояние по мере надобности и кеширует;
# сам он ничего не отправляет.
