# -*- coding: utf-8 -*-
"""ПРОД ПРОТИВ ЗЕРКАЛА: что развёрнуто, но не опубликовано.

Зачем. Самая крупная находка проекта (`ConnectorLZ.lzCompose`, infiniFi)
пришла не из отчётов и не из кода репозитория, а из РАЗРЫВА между ними:

    прокси гейтвея  0x3f04b65D…  ->  реализация 0x750136ac…
    а в addresses.1.json значится  0xb44e4945…   (19031 против 18541 байт)

Развёрнутый `PortalBase` оказался 288 строк, а тот же файл в публичном
зеркале — 111. Вся межцепочечная подсистема в проде была не опубликована и
не аудирована. Читать её пришлось из Sourcify.

Это и есть самый сильный из известных нам сигналов, и он ПОЛНОСТЬЮ
механический: разрыв виден до чтения единой строки кода. Конкурентов там
нет не потому, что они ленивы, а потому что они читают репозиторий.

Правило проекта «развёрнутая версия ПЕРВЫМ делом» этим инструментом и
исполняется. Проверка стоит секунды и снимает целые вечера: у agglayer
`main` шёл на v1.1.1, а в проде стояла v0.5.1, и всё чтение заплаток по
`main` было выброшено.

ТОЛЬКО ЧТЕНИЕ. `eth_getCode`, `eth_getStorageAt`, `eth_call` публичных
view-функций. Ни одной транзакции — так требуют и правила программ, и
собственные правила из STATE.md.

использование:
    deployed.py --rpc <URL> --addr-file addresses.1.json [--src <корень>]
    deployed.py --rpc <URL> 0xAddr [0xAddr ...] [--src <корень>]

    --src    корень исходников: тогда для каждого верифицированного в
             Sourcify контракта сверяются ИМЕНА файлов, и те, которых нет в
             зеркале, помечаются как «в проде есть, в репозитории нет».
    --dump D сложить исходники из Sourcify в каталог D — дальше по ним
             сразу гонятся siblings.py и statesync.py.
    --chain N  идентификатор сети (по умолчанию 1).
"""
import json
import os
import re
import sys
import time
import urllib.request

# EIP-1967
SLOT_IMPL = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
SLOT_ADMIN = "0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
SLOT_BEACON = "0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50"

SOURCIFY = "https://repo.sourcify.dev/contracts/%s/%d/%s/"


def rpc(url, method, params, tries=4):
    """Публичные узлы режут частоту — без отступа проход рвётся посередине."""
    body = json.dumps({"jsonrpc": "2.0", "id": 1,
                       "method": method, "params": params}).encode()
    last = None
    for k in range(tries):
        req = urllib.request.Request(
            url, body, {"Content-Type": "application/json",
                        "User-Agent": "auditscout/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                out = json.loads(r.read())
            if "error" in out:
                raise RuntimeError(out["error"])
            return out["result"]
        except Exception as e:
            last = e
            time.sleep(0.5 * (k + 1))
    raise last


def get(url, timeout=30):
    try:
        req = urllib.request.Request(url, headers={"User-Agent":
                                                   "auditscout/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read().decode("utf-8", "replace")
    except Exception:
        return None


def slot_addr(url, addr, slot):
    v = rpc(url, "eth_getStorageAt", [addr, slot, "latest"])
    a = "0x" + v[-40:]
    return None if int(a, 16) == 0 else a


def codesize(url, addr):
    c = rpc(url, "eth_getCode", [addr, "latest"])
    return (len(c) - 2) // 2


def call_str(url, addr, selector):
    """Вызвать view-функцию, возвращающую string. None если нет такой."""
    try:
        r = rpc(url, "eth_call", [{"to": addr, "data": selector}, "latest"])
    except Exception:
        return None
    if not r or len(r) < 130:
        return None
    try:
        n = int(r[130:194], 16)
        return bytes.fromhex(r[194:194 + n * 2]).decode("utf-8", "replace")
    except Exception:
        return None


VERSION_SEL = "0x54fd4d50"     # version()
NAME_SEL = "0x06fdde03"        # name()


def sourcify_files(chain, addr, dump=None):
    """Исходники из Sourcify (API v2). None если контракт не верифицирован.

    Старый путь `repo.sourcify.dev/contracts/full_match/...` отвечает 400:
    репозиторий переехал на API v2, и метаданные отдаются вместе с телами
    файлов одним запросом. При `dump` файлы кладутся на диск — это и есть
    «тянуть из Sourcify целиком».
    """
    url = ("https://sourcify.dev/server/v2/contract/%d/%s"
           "?fields=sources,compilation,proxyResolution" % (chain, addr))
    txt = get(url, timeout=60)
    if not txt:
        return None
    try:
        data = json.loads(txt)
    except Exception:
        return None
    srcs = data.get("sources") or {}
    if not srcs:
        return None
    comp = data.get("compilation") or {}
    if dump:
        base = os.path.join(dump, addr.lower())
        for path, node in srcs.items():
            dst = os.path.join(base, path.replace("\\", "/"))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with open(dst, "w", encoding="utf-8") as fh:
                fh.write(node.get("content") or "")
    return {"match": data.get("match") or "verified",
            "files": [os.path.basename(s) for s in srcs],
            "paths": list(srcs),
            "compiler": comp.get("compilerVersion"),
            "target": [comp.get("name")] if comp.get("name") else []}


# Blockscout: открытый эксплорер, зеркалит верификацию Etherscan. Sourcify —
# НЕ единственное место исходников: проект часто верифицируется на Etherscan
# и не льёт в Sourcify. Без этой проверки divergence-сигнал кричит «кода нет
# НИГДЕ» на публичном коде — ложная тревога, стоившая бы целого лида.
BLOCKSCOUT = {
    1: "https://eth.blockscout.com",
    10: "https://optimism.blockscout.com",
    8453: "https://base.blockscout.com",
    42161: "https://arbitrum.blockscout.com",
}


def blockscout_verified(chain, addr):
    """Имя контракта, если он верифицирован на Blockscout, иначе None."""
    host = BLOCKSCOUT.get(chain)
    if not host:
        return None
    txt = get("%s/api/v2/smart-contracts/%s" % (host, addr), timeout=25)
    if not txt:
        return None
    try:
        d = json.loads(txt)
    except Exception:
        return None
    return d.get("name") if d.get("is_verified") else None


def repo_names(root):
    out = set()
    for dirpath, dirnames, files in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in (".git", "node_modules")]
        for f in files:
            if f.endswith(".sol"):
                out.add(f)
    return out


ADDR_RE = re.compile(r"0x[0-9a-fA-F]{40}")


def addrs_from_json(path):
    """Пары (имя, адрес) из конфига развёртывания любой формы."""
    with open(path, encoding="utf-8") as fh:
        data = json.load(fh)
    out = []

    def walk(node, name):
        if isinstance(node, str):
            if ADDR_RE.fullmatch(node.strip()):
                out.append((name, node.strip()))
        elif isinstance(node, dict):
            # частый вид конфигов — список записей {"name": …, "addr": …}:
            # тогда имя записи важнее ключа поля.
            label = node.get("name") or node.get("label") or node.get("contract")
            for k, v in node.items():
                if isinstance(label, str) and k not in ("name", "label",
                                                        "contract"):
                    walk(v, label if k in ("addr", "address")
                         else "%s.%s" % (label, k))
                else:
                    walk(v, k if not name else "%s.%s" % (name, k))
        elif isinstance(node, list):
            for i, v in enumerate(node):
                walk(v, "%s[%d]" % (name, i))
    walk(data, "")
    seen, uniq = set(), []
    for n, a in out:
        if a.lower() in seen:
            continue
        seen.add(a.lower())
        uniq.append((n, a))
    return uniq


def run(url, targets, chain, src_root=None, dump=None):
    have = repo_names(src_root) if src_root else None
    print("=" * 78)
    print("адресов %d, сеть %d%s"
          % (len(targets), chain,
             ", зеркало %d файлов" % len(have) if have else ""))
    print("=" * 78)
    gaps = []
    for name, addr in targets:
        try:
            size = codesize(url, addr)
        except Exception as e:
            print("\n%-28s %s  ОШИБКА %s" % (name[:28], addr, e))
            continue
        if size == 0:
            print("\n%-28s %s  КОДА НЕТ (EOA или ещё не развёрнут)"
                  % (name[:28], addr))
            continue
        impl = beacon = None
        try:
            impl = slot_addr(url, addr, SLOT_IMPL)
            beacon = slot_addr(url, addr, SLOT_BEACON)
        except Exception:
            pass
        head = "\n%-28s %s  %6d байт" % (name[:28], addr, size)
        ver = call_str(url, addr, VERSION_SEL)
        if ver:
            head += "  version=%s" % ver.strip()
        print(head)
        if beacon:
            print("      маяк %s" % beacon)
        code_at = addr
        if impl:
            isize = codesize(url, impl)
            print("      реализация %s  %d байт" % (impl, isize))
            code_at = impl
            # разошлись ли прокси и то, что записано в конфиге
            known = set(a.lower() for _, a in targets)
            if impl.lower() not in known:
                print("      !! реализации НЕТ в конфиге развёртывания")
                gaps.append((name, addr, impl, "impl вне конфига"))

        sf = sourcify_files(chain, code_at, dump)
        if sf is None:
            # Sourcify молчит — но код может быть на Etherscan/Blockscout
            bs = blockscout_verified(chain, code_at)
            if bs:
                print("      верифицирован на Blockscout как %s "
                      "(не на Sourcify — исходник ПУБЛИЧЕН, не разрыв)" % bs)
            else:
                print("      НЕ верифицирован ни на Sourcify, ни на Blockscout "
                      "— исходника нет НИГДЕ")
                gaps.append((name, addr, code_at, "не верифицирован НИГДЕ"))
            continue
        tgt = sf["target"][0] if sf["target"] else "?"
        print("      Sourcify %s: %s, файлов %d, solc %s"
              % (sf["match"], tgt, len(sf["files"]), sf["compiler"]))
        if have is not None:
            # Чужие библиотеки отсеиваем ПО ПУТИ, а не по имени: зеркало их
            # не вендорит, и по именам вывод утонул бы в OpenZeppelin.
            own = [p for p in sf["paths"]
                   if not re.search(r"(?:^|/)(?:lib|node_modules|"
                                    r"@[\w-]+|forge-std|solady|solmate)/", p)]
            missing = sorted(set(os.path.basename(p) for p in own) - have)
            if missing:
                print("      !! В ПРОДЕ ЕСТЬ, В ЗЕРКАЛЕ НЕТ: %s"
                      % ", ".join(missing[:12]))
                gaps.append((name, addr, code_at,
                             "нет в зеркале: " + ", ".join(missing[:6])))

    print("\n" + "=" * 78)
    if not gaps:
        print("разрывов нет: всё развёрнутое опубликовано и лежит в зеркале")
        return
    print("РАЗРЫВЫ — %d. Это очередь на чтение, и она дороже любой другой:" % len(gaps))
    for name, addr, code_at, why in gaps:
        print("   %-24s %s -> %s  (%s)" % (name[:24], addr, code_at, why))
    print("\nКод, которого нет в зеркале, не видел ни один аудитор и ни один")
    print("конкурент. Тянуть его из Sourcify целиком и читать первым.")


def main():
    a = sys.argv[1:]
    if not a or "--rpc" not in a:
        print(__doc__)
        return
    url = a[a.index("--rpc") + 1]
    chain = int(a[a.index("--chain") + 1]) if "--chain" in a else 1
    src = a[a.index("--src") + 1] if "--src" in a else None
    dump = a[a.index("--dump") + 1] if "--dump" in a else None
    if "--addr-file" in a:
        targets = addrs_from_json(a[a.index("--addr-file") + 1])
    else:
        targets = [("—", x) for x in a if ADDR_RE.fullmatch(x)]
    if not targets:
        print("адресов не задано")
        return
    run(url, targets, chain, src, dump)


if __name__ == "__main__":
    main()
