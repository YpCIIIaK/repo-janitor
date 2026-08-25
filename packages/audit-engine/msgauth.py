# -*- coding: utf-8 -*-
"""ВХОДЯЩЕЕ БЕЗ ПРОВЕРКИ: обработчик сообщения или подписи не связал источник.

Откуда приём. Единственный кандидат в находки за проект — infiniFi
`ConnectorLZ.lzCompose`: параметр `_from` объявлен БЕЗ ИМЕНИ и нигде в теле
не сверяется, а в LayerZero V2 его задаёт кто угодно. Аутентификация была
только на бумаге. SmartAxe (arXiv 2406.15999) называет это классом:
кросс-чейн-приёмники «непоследовательно аутентифицируют», и большинство
взломов мостов (Ronin, Wormhole, Nomad — суммарно за миллиард) — именно
подделка или реплей входящего сообщения.

Что механизируется. У обработчика входящего есть параметры, называющие
ИСТОЧНИК (`_from`, `origin`, `srcAddress`, `sender`, `peer`, `srcChainId`).
Если такой параметр объявлен, но в теле НИ РАЗУ не стоит в require/сравнении
и не идёт ключом в маппинг доверенных — источник не связан. То же для
подписи: `ecrecover`/`ECDSA.recover` есть, а результат не сверяется с
ожидаемым адресом, либо в хэшируемое не входят nonce/deadline/chainId.

Три оси проверки на каждый обработчик:

    ИСТОЧНИК  сверяется ли, откуда пришло (peer/chainId/signer)
    РЕПЛЕЙ    защита от повтора (nonce / used[hash] / dedup)
    ОТПРАВИТЕЛЬ  ограничен ли вызывающий (onlyRole / require msg.sender)

Пусто хотя бы по одной оси И при этом есть властное действие (минт, перевод,
исполнение из очереди, delegatecall) — это кандидат уровня критической.

ЧЕГО ИНСТРУМЕНТ НЕ ЗНАЕТ. Он не прослеживает, куда параметр уходит через
внутренние вызовы: `_from` могут проверить в `_validate(_from)`. Поэтому
вывод — «объясни, где связан источник». Но именно эта слепота у аудитора
тоже есть, а находка `lzCompose` показала, что и авторы связать забывают.

использование:
    msgauth.py <корень> [--file X.sol] [--all]
"""
import os
import re
import sys

import gating
import gatemem
import killcheck
import solsrc

# Имена обработчиков входящего. Точное совпадение или префикс.
HANDLER = re.compile(
    r"^(?:lzReceive|lzCompose|_?nonblockingLzReceive|_?blockingLzReceive|"
    r"ccipReceive|_ccipReceive|receiveMessage|processMessage|onMessage\w*|"
    r"handle\w*|_?execute\w*Message|receiveWormholeMessages|"
    r"_?executeMessage|onRecv\w*|receive\w*Message|_?credit)$", re.I)

# Параметры, называющие источник сообщения. Их наличие обязывает к сверке.
SRC_PARAM = re.compile(
    r"\b(_?from|_?origin\w*|_?srcAddress|_?sourceAddress|_?sender\w*|"
    r"_?peer|_?srcChain\w*|_?sourceChain\w*|_?remoteChain\w*|"
    r"_?srcEid|_?remote\w*)\b", re.I)

# Кросс-чейн КОНТЕКСТ: без него параметр `from` — это обычный ERC20, а не
# сообщение. Требуем полезную нагрузку (bytes) ИЛИ идентификатор цепи рядом,
# иначе transferFrom/burn(_from,...) ложно летят в обработчики.
MSG_CONTEXT = re.compile(
    r"\bbytes\s+(?:calldata|memory)?\s*_?(?:data|message|payload|msg|"
    r"instruction|callbackData)\b|\b(?:uint\d*|uint)\s+_?(?:chainId|srcEid|"
    r"srcChain\w*|sourceChain\w*|eid|network|originNetwork)\b", re.I)

# Подпись.
SIG = re.compile(r"\b(?:ecrecover|ECDSA\.recover|\.recover\s*\(|"
                 r"SignatureChecker|isValidSignature)\b")

# Признаки того, что ИСТОЧНИК связан.
BIND_SRC = re.compile(
    r"\b(?:isConnector|isTrusted\w*|trustedRemote|trustedSender|peers?\b|"
    r"allowedSource|require\s*\([^;]*(?:==|!=)[^;]*(?:from|origin|peer|"
    r"sender|src|remote|chain)|_checkSource|validateSource|onlyPeer)\b", re.I)

# Признаки защиты от реплея.
BIND_REPLAY = re.compile(
    r"\b(?:nonce|sequence|seq\b|used\w*\s*\[|processed\s*\[|consumed\s*\[|"
    r"inboundHashes|_markConsumed|deadline|expiry|expires|usedNonces)\b", re.I)

# Признаки ограничения вызывающего.
BIND_CALLER = re.compile(
    r"\b(?:onlyRole|onlyOwner|only\w+|require\s*\([^;]*msg\.sender|"
    r"_checkRole|hasRole|isConnector|authorized|endpoint\s*==|"
    r"msg\.sender\s*==)\b", re.I)

# Властное действие в теле (иначе связывать нечего). Диспетчер, уводящий в
# `_executeInboundMessage`/`_handleX`, тоже властен — власть просто на шаг
# ниже, поэтому допускаем \w* между корнем и скобкой.
POWER = re.compile(
    r"\b(?:_?mint|_?burn|safeTransfer\w*|transfer(?:From)?|"
    r"delegatecall|\.call\s*[({]|withdraw\w*|release\w*|unlock\w*|"
    r"_?execute\w*|receiveMessage|_?handle\w*)\s*[({]", re.I)


INTERNAL_VIS = re.compile(r"\b(internal|private)\b")


def check_handler(f, oracle=None):
    """Оси, по которым обработчик НЕ связан. Пустой список — чисто.

    internal/private обработчики ПРОПУСКАЕМ: снаружи их не вызвать, значит
    аутентификация — на внешнем входе (в базе), а не тут. Ровно этот случай
    (OFT `_credit/_debit`) трижды давал ложь."""
    body = f.body or ""
    header = f.header or ""
    whole = header + " " + body
    if INTERNAL_VIS.search(header):
        return None
    is_sig = bool(SIG.search(body))
    params = f.params or ""
    # источник считаем «источником сообщения» только при кросс-чейн контексте
    # (payload/chainId) — иначе `from` это ERC20, а не мост
    has_src_param = bool(SRC_PARAM.search(params) and MSG_CONTEXT.search(params))
    if not (is_sig or has_src_param or HANDLER.match(f.name)):
        return None
    if not POWER.search(body):
        return None

    missing = []
    # ИСТОЧНИК: для сигнатуры — сверка результата recover; для сообщения —
    # сверка source-параметра с доверенным множеством.
    if is_sig:
        # результат recover должен сравниваться с ожидаемым
        recovered_checked = re.search(
            r"(?:require|==|!=)[^;]*(?:recover|ecrecover|signer)", body, re.I)
        if not recovered_checked:
            missing.append("подпись: результат recover не сверяется")
        if not re.search(r"\b(?:deadline|expiry|expires|block\.timestamp)\b",
                         body, re.I):
            missing.append("подпись: нет deadline/expiry")
        if not re.search(r"\bnonce", body, re.I):
            missing.append("подпись: нет nonce (реплей)")
    else:
        if has_src_param and not BIND_SRC.search(body):
            missing.append("источник объявлен, но не сверяется")
        if not BIND_REPLAY.search(body):
            missing.append("нет защиты от реплея (nonce/dedup)")
        # «отправитель ограничен» — через оракул: ловит модификаторы из БАЗ
        # (onlyLxLyBridge и т.п.), а не только локальные.
        caller_gated = (oracle.gated(f) if oracle is not None
                        else BIND_CALLER.search(whole))
        if not caller_gated:
            missing.append("вызывающий ничем не ограничен")
    return missing


def which_src(params):
    hits = SRC_PARAM.findall(params or "")
    return ", ".join(dict.fromkeys(h if isinstance(h, str) else h[0]
                                   for h in hits)) or "—"


def run(root, only=None, show_clean=False, slug=None):
    if os.path.isfile(root):
        cons = solsrc.parse_file(root)
        root = os.path.dirname(root)
    else:
        cons = solsrc.parse_tree(root)
    if only:
        cons = [c for c in cons if os.path.basename(c.path) == only]

    oracle = gating.Oracle(cons)
    killer = killcheck.Killer(cons)      # шлюз: осевое связывание через хелперы

    rows, clean, killed = [], [], []
    for c in cons:
        if c.kind == "interface":
            continue
        low = c.path.replace("\\", "/").lower()
        if re.search(r"(?:^|/)(?:lib|node_modules|@[\w-]+)/", low):
            continue
        for f in c.funcs:
            if f.kind == "modifier":
                continue
            miss = check_handler(f, oracle)
            if miss is None:
                continue
            if not miss:
                clean.append({"c": c, "f": f, "miss": miss})
                continue
            # ШЛЮЗ: снять оси, закрытые во внутренних вызовах (_validate(_from)
            # связывает источник и т.п.). Осталось пусто -> всё связано ниже.
            remain = killer.msgauth_recover(f, c, miss)
            if remain:
                rows.append({"c": c, "f": f, "miss": remain,
                             "closed": [m for m in miss if m not in remain]})
            else:
                killed.append({"c": c, "f": f, "miss": miss})

    # приоритет: больше пустых осей — выше; исходник-параметр без сверки
    # (тот самый lzCompose) поднимаем в самый верх
    def prio(e):
        p = len(e["miss"])
        if any("источник" in m for m in e["miss"]):
            p += 2
        return -p
    rows.sort(key=prio)

    # ПАМЯТЬ ШЛЮЗА (п.3): при --slug вердикты в память, закрытое ранее гасим.
    suppressed = []
    if slug:
        def _key(e):
            return "%s.%s" % (e["c"].name, e["f"].name)
        gm = ([{"key": _key(e), "survives": True,
                "why": "; ".join(e["miss"])} for e in rows] +
              [{"key": _key(e), "survives": False,
                "reason": "все оси связаны в хелперах"} for e in killed])
        _l, _k, supp = gatemem.apply_gate(slug, gm)
        supp_keys = {s["key"] for s in supp}
        suppressed = [e for e in rows if _key(e) in supp_keys]
        rows = [e for e in rows if _key(e) not in supp_keys]

    total = len(rows) + len(clean) + len(killed) + len(suppressed)
    print("=" * 78)
    if suppressed:
        print("подавлено памятью (закрыто ранее): %d" % len(suppressed))
    print("обработчиков входящего: %d (чистых %d, шлюз убил %d, лиды %d)"
          % (total, len(clean), len(killed), len(rows)))
    print("=" * 78)
    for e in rows:
        f = e["f"]
        print("\n[!] %s.%s(%s)" % (e["c"].name, f.name,
                                   (f.params or "").strip()[:44]))
        print("    источник в параметрах: %s" % which_src(f.params))
        print("    %s:%d" % (solsrc.rel(f.path, root), f.line))
        for m in e["miss"]:
            print("      — НЕ СВЯЗАНО: %s" % m)
        for m in e.get("closed", []):
            print("      · шлюз снял (связано в хелпере): %s" % m)

    if killed and show_clean:
        print("\n" + "·" * 78)
        print("УБИТО ШЛЮЗОМ (все оси связаны во внутренних вызовах):")
        for e in killed:
            print("    %s.%s  %s:%d" % (e["c"].name, e["f"].name,
                                        solsrc.rel(e["f"].path, root), e["f"].line))
    elif killed:
        print("\n(убито шлюзом: %d; показать с --all)" % len(killed))

    if show_clean and clean:
        print("\n" + "-" * 78)
        print("ЧИСТЫЕ (связаны по всем осям) — контроль ложных срабатываний:")
        for e in clean:
            print("    %s.%s  %s:%d"
                  % (e["c"].name, e["f"].name,
                     solsrc.rel(e["f"].path, root), e["f"].line))

    print("\n" + "-" * 78)
    print("Вопрос к строке: чем доказано, что сообщение пришло ОТ ДОВЕРЕННОГО")
    print("источника и НЕ повторно? Если параметр-источник задаётся вызывающим")
    print("и нигде не сверяется — это класс lzCompose: аутентификация только на")
    print("бумаге. Проверить, не связан ли источник во внутреннем вызове,")
    print("прежде чем писать PoC.")


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    only = a[a.index("--file") + 1] if "--file" in a else None
    slug = a[a.index("--slug") + 1] if "--slug" in a else None
    run(a[0], only, "--all" in a, slug=slug)


if __name__ == "__main__":
    main()
