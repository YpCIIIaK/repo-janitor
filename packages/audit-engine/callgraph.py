# -*- coding: utf-8 -*-
"""ГРАФ ВЫЗОВОВ без компиляции: кто кого зовёт и КАКИМ вызовом.

Зачем. Ручной разбор лида `BebopWrapper.takeOrder` (defi-saver) держался на
одном шаге, который я делал глазами: `grep takeOrder` -> нашёл вызывающего
(`DFSExchangeCore:93`), увидел что это обычный `.call`, а НЕ delegatecall, и
что whitelist опасного входа (`exchangeAddr`) живёт в ВЫЗЫВАЮЩЕМ, а не в самой
public-функции. Вывод: прямой вызов `takeOrder` обходит проверку. Это чисто
механический шаг, и здесь он механизирован.

Что даёт:
* callers_of(F) — кто зовёт F и как (внутренний вызов / внешний член /
  low-level .call/.delegatecall/.staticcall);
* reachable_directly(F) — можно ли позвать F напрямую (public/external);
* BYPASS-детектор — public-функция с чувствительным стоком (произвольный
  .call/.delegatecall по адресу-параметру или апрув произвольного target),
  которую саму НИЧТО не валидирует, а вызывающий — валидирует. Прямой вызов
  обходит проверку. Это НЕ понижает лид, а ПОВЫШАЕТ: bypass-паттерн.

Точность честная: разрешение имён по контракту+базам (как в [killcheck]); тип
вызова по синтаксису (`x.call` vs прямой). Это не компилятор — это тот самый
grep, только структурный и полный. Дальше судит модель/человек, а финал —
зелёный PoC.

использование:
    callgraph.py <корень>                     сводка: входные точки, стоки
    callgraph.py <корень> --func Contract.fn  кто зовёт fn и как; достижима ли
    callgraph.py <корень> --bypass [--min-callers 1]  найти bypass-паттерн
"""
import os
import re
import sys

import solsrc

# low-level вызовы: тип примитива важен (delegatecall != call по последствиям)
LOWLEVEL = re.compile(
    r"([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*|\([^()]*\))\s*\.\s*"
    r"(delegatecall|staticcall|call)\s*[({]")
# член-вызов `recv.method(` — внешний или библиотечный
MEMBER = re.compile(r"\b([A-Za-z_]\w*)\s*\.\s*([A-Za-z_]\w*)\s*\(")
# любой вызов по имени `name(` — кандидат на внутренний
NAMECALL = re.compile(r"\b([A-Za-z_]\w*)\s*\(")
_KW = {"require", "assert", "revert", "if", "for", "while", "return", "emit",
       "new", "abi", "keccak256", "address", "payable", "bytes", "uint256",
       "uint", "int", "bool", "string", "memory", "storage", "calldata",
       "type", "super", "this", "sha256", "ecrecover", "delegatecall", "call",
       "staticcall", "sendValue", "safeTransfer", "safeTransferFrom"}

# delegatecall-ДИСПЕТЧЕР: центральный исполнитель дёргает модуль через
# delegatecall по селектору. Его наличие = архитектура «action-модулей»
# (DeFi Saver, прокси-кошельки): модуль исполняется в контексте ВЫЗЫВАЮЩЕГО,
# средства — его, поэтому «public без гейта» там по замыслу.
DISPATCH = re.compile(
    r"delegatecall\s*\([^;]*\.selector|encodeWithSelector|"
    r"encodeWithSignature|functionDelegateCall|_delegate\s*\(", re.I)

# whitelist/реестр-проверка опасного входа: именно она бывает ТОЛЬКО в
# вызывающем (isWrapper, isExchangeAggregatorAddr, require(...registry...))
WHITELIST = re.compile(
    r"\b(?:is[A-Z]\w*|_?in\w*Registry|registry\b|allowlist|allowList|"
    r"whitelist|isRegistered|isValid\w*|isAllowed|isTrusted\w*|isSupported)\b",
    re.I)

# чувствительный сток: произвольный low-level вызов или апрув произвольного
# target — оба принимают адрес и делают властное действие от имени контракта
SINK_APPROVE = re.compile(r"\b(?:safeApprove|approve|forceApprove)\s*\(")

VIS = re.compile(r"\b(public|external|internal|private)\b")
READONLY = re.compile(r"\b(?:view|pure)\b")
VENDOR = re.compile(
    r"(?:^|/)(?:lib|node_modules|@[\w-]+|forge-std|solmate|solady|"
    r"openzeppelin[\w-]*)/", re.I)


class Graph(object):
    def __init__(self, contracts):
        self.contracts = contracts
        self.by_contract = {}
        for c in contracts:
            self.by_contract.setdefault(c.name, c)
        # индекс функций: имя -> список Func (одно имя бывает в разных контрактах)
        self.by_name = {}
        for c in contracts:
            for f in c.funcs:
                if f.kind == "modifier":
                    continue
                self.by_name.setdefault(f.name, []).append(f)

    # --- область видимости по наследованию (как в killcheck) ---
    def _bases(self, c, seen=None):
        seen = seen if seen is not None else set()
        if c.name in seen:
            return []
        seen.add(c.name)
        out = [c]
        for b in (c.bases or []):
            bc = self.by_contract.get(b)
            if bc:
                out += self._bases(bc, seen)
        return out

    def _scope_names(self, c):
        idx = {}
        for cc in self._bases(c):
            for f in cc.funcs:
                idx.setdefault(f.name, f)
        return idx

    # --- вызовы из тела функции ---
    def calls_in(self, func, contract):
        """Список (target, kind): kind in
        {delegatecall,call,staticcall,internal,external}."""
        body = func.body or ""
        out = []
        for m in LOWLEVEL.finditer(body):
            out.append((m.group(1).strip(), m.group(2)))
        members = {(m.group(1), m.group(2)) for m in MEMBER.finditer(body)}
        for recv, meth in members:
            if meth in _KW:
                continue
            out.append(("%s.%s" % (recv, meth), "external"))
        scope = self._scope_names(contract)
        called = set()
        for m in NAMECALL.finditer(body):
            nm = m.group(1)
            if nm in _KW or nm == func.name or nm in called:
                continue
            # исключить член-вызовы (там перед именем точка)
            i = m.start()
            if i > 0 and body[i - 1] == ".":
                continue
            if nm in scope:
                called.add(nm)
                out.append((nm, "internal"))
        return out

    # --- обратный граф: кто зовёт функцию с данным ИМЕНЕМ ---
    def callers_of(self, name):
        """[(caller_func, caller_contract, kind)] — кто вызывает name."""
        out = []
        for c in self.contracts:
            for f in c.funcs:
                if f.kind == "modifier" or f.name == name:
                    continue
                body = f.body or ""
                # внешний член .name( или внутренний name(
                for m in NAMECALL.finditer(body):
                    if m.group(1) != name:
                        continue
                    i = m.start()
                    kind = "member" if (i > 0 and body[i - 1] == ".") else "internal"
                    out.append((f, c, kind))
                    break
        return out

    def has_delegatecall_dispatcher(self):
        """В дереве есть исполнитель, дёргающий модули через delegatecall по
        селектору? Кешируем — зовётся на каждый survivor."""
        if getattr(self, "_disp", None) is None:
            self._disp = any(DISPATCH.search(f.body or "")
                             for c in self.contracts for f in c.funcs
                             if f.kind != "modifier")
        return self._disp

    def no_direct_caller(self, name):
        """Никто в дереве не зовёт эту функцию обычным вызовом (ни member, ни
        internal). Значит вход только снаружи — EOA или delegatecall-диспетчер."""
        return len(self.callers_of(name)) == 0

    _disp = None

    def reachable_directly(self, func):
        if func.kind == "constructor" or "initializer" in (func.mods or []):
            return False
        header = func.header or ""
        if READONLY.search(header):
            return False
        m = VIS.search(header)
        vis = m.group(1) if m else "public"
        return vis in ("public", "external")

    # --- BYPASS-детектор ---
    def bypass(self, min_callers=1):
        """public-функции с чувствительным стоком, которые САМИ не валидируют
        опасный вход, а их вызывающий — валидирует. Прямой вызов обходит."""
        hits = []
        for c in self.contracts:
            if VENDOR.search(c.path.replace("\\", "/")) or c.kind == "interface":
                continue
            for f in c.funcs:
                if f.kind == "modifier" or not self.reachable_directly(f):
                    continue
                body = f.body or ""
                params = _param_names(f)
                # сток УПРАВЛЯЕМ пользователем: цель низкоуровневого вызова или
                # апрува ссылается на ПАРАМЕТР. Константный роутер (CURVE_ROUTER_
                # NG) — НЕ bypass, даже если вызывающий делает isWrapper: обходить
                # нечего, произвольного адреса нет. Это дискриминатор takeOrder
                # (exchangeAddr из _exData) vs sell (роутер-константа).
                low = [tgt for tgt, k in self.calls_in(f, c)
                       if k in ("call", "delegatecall") and _refs_param(tgt, params)]
                appr = [m.group(1) for m in
                        re.finditer(r"(?:safeApprove|approve|forceApprove)\s*\(\s*([^,]+),", body)
                        if _refs_param(m.group(1), params)]
                if not (low or appr):
                    continue
                is_delegate = any(k == "delegatecall" for tgt, k in self.calls_in(f, c)
                                  if _refs_param(tgt, params))
                # сама функция валидирует опасный вход?
                if WHITELIST.search(body):
                    continue
                # а вызывающие — валидируют?
                gated_callers = []
                for cf, cc, kind in self.callers_of(f.name):
                    cbody = cf.body or ""
                    # проверка стоит ДО вызова f в теле вызывающего
                    idx = cbody.find(f.name)
                    pre = cbody[:idx] if idx > 0 else cbody
                    if WHITELIST.search(pre):
                        gated_callers.append("%s.%s" % (cc.name, cf.name))
                if len(gated_callers) >= min_callers:
                    hits.append({
                        "key": "%s.%s" % (c.name, f.name),
                        "file": solsrc.rel(f.path, self._root),
                        "line": f.line,
                        "sink": "delegatecall" if is_delegate else
                                ("low-level call" if low else "произвольный approve"),
                        "gated_callers": gated_callers})
        return hits

    _root = ""


def _param_names(f):
    """Имена параметров функции (последний идентификатор в каждом): для
    `ExchangeData memory _exData` -> `_exData`, безымянный `address` пропускаем."""
    out = []
    for part in (f.params or "").split(","):
        toks = re.findall(r"[A-Za-z_]\w*", part)
        # тип(ы)+имя: имя последнее, но только если их >1 (иначе безымянный)
        skip = {"memory", "calldata", "storage", "payable"}
        toks = [t for t in toks if t not in skip]
        if len(toks) >= 2:
            out.append(toks[-1])
    return out


def _refs_param(expr, params):
    """Выражение-цель ссылается на параметр (user-controlled)? `_exData.
    offchainData.exchangeAddr` -> да; `address(exchangeContract)` где
    exchangeContract из константы -> нет."""
    if not params:
        return False
    words = set(re.findall(r"[A-Za-z_]\w*", expr or ""))
    return any(p in words for p in params)


def build(root):
    if os.path.isfile(root):
        cons = solsrc.parse_file(root)
        root = os.path.dirname(root)
    else:
        cons = solsrc.parse_tree(root)
    g = Graph(cons)
    g._root = root
    return g


def main():
    a = sys.argv[1:]
    if not a:
        print(__doc__)
        return
    root = a[0]
    g = build(root)

    if "--func" in a:
        key = a[a.index("--func") + 1]
        cname, _, fname = key.partition(".")
        callers = g.callers_of(fname)
        target = None
        for c in g.contracts:
            for f in c.funcs:
                if c.name == cname and f.name == fname:
                    target = (f, c)
        print("=" * 74)
        print("ФУНКЦИЯ %s" % key)
        if target:
            print("  достижима напрямую: %s"
                  % ("ДА (public/external)" if g.reachable_directly(target[0])
                     else "нет (internal/view/ctor)"))
            print("  что зовёт:")
            for tgt, kind in g.calls_in(*target)[:20]:
                print("     %-14s %s" % (kind, tgt))
        print("  КТО ЗОВЁТ (%d):" % len(callers))
        for cf, cc, kind in callers:
            print("     %-9s %s.%s  (%s:%d)"
                  % (kind, cc.name, cf.name, solsrc.rel(cf.path, g._root), cf.line))
        return

    if "--bypass" in a:
        mc = int(a[a.index("--min-callers") + 1]) if "--min-callers" in a else 1
        hits = g.bypass(mc)
        print("=" * 74)
        print("BYPASS-ПАТТЕРН — %d: public-сток без своей валидации, "
              "вызывающий валидирует" % len(hits))
        print("Прямой вызов обходит проверку из вызывающего. ПОВЫШАЕТ лид.")
        print("=" * 74)
        for h in sorted(hits, key=lambda x: -len(x["gated_callers"])):
            print("\n[%s]  сток: %s" % (h["key"], h["sink"]))
            print("   %s:%d" % (h["file"], h["line"]))
            print("   валидируют, но лишь у себя: %s"
                  % ", ".join(h["gated_callers"][:4]))
        print("\n" + "-" * 74)
        print("Вопрос к строке: если сток исполним прямым вызовом мимо этой")
        print("валидации — что мешает? Дальше: держит ли контракт средства/апрувы")
        print("в покое (импакт), и зелёный PoC до заявки.")
        return

    # сводка
    eps = [(c, f) for c in g.contracts for f in c.funcs
           if f.kind != "modifier" and g.reachable_directly(f)
           and not VENDOR.search(c.path.replace("\\", "/"))]
    print("контрактов %d, входных точек (public/external) %d"
          % (len(g.contracts), len(eps)))
    print("bypass-паттернов: %d (callgraph.py <root> --bypass)"
          % len(g.bypass()))


if __name__ == "__main__":
    main()
