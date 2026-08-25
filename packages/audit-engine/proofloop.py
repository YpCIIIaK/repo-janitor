# -*- coding: utf-8 -*-
"""ИТЕРАТИВНЫЙ PROOF-LOOP: доказать сложный эксплойт за 3–5 форк-итераций.

Зачем поверх [[poc-gate]]. poc.py строит ПРЯМОЙ вызов с конкретными аргументами —
хватает на my2Wei, но не на takeOrder-класс, где нужен struct/offchain-calldata,
несколько шагов, flash-loan. A1/CyberChainBench: основной прирост приходит ПОСЛЕ
первого запуска — compile-ошибка, revert-reason, trace и state-delta направляют
следующую гипотезу. Здесь модель пишет контракт-эксплойт, форк его судит, ошибка
возвращается модели, и так до N итераций.

АНТИ-ФАБРИКАЦИЯ — почему модели нельзя соврать. Модель пишет ТОЛЬКО `contract
Exploit { function run(address target, address asset) external }`. Всё остальное —
форк, ЗАМЕР баланса, вывод — владеет harness (Runner ниже). Атакующий это СВЕЖИЙ
Exploit с нулём актива; сколько увёл из цели, столько harness и намерил по
address(Exploit). Дельту не подделать: её считает НАШ код, не проза модели.
Вердикт даёт [[poc-gate]] economics (net минус газ), а не «модель так сказала».

Исходы: profit (net>0 сверх порога) / dust (добыча<=газ) / no_gain (da<=0) /
revert / compile_fail. Лучшая попытка (profit, иначе последняя некрашнутая)
сохраняется; profit останавливает цикл сразу.

использование:
    proofloop.py --target 0xADDR --asset 0xTOKEN --slug X --key C.f \\
        [--src <дерево>] [--iters 4] [--rpc URL] [--ctx файл.sol] \\
        [--model ID] [--code файл.sol]
"""
import json
import os
import re
import subprocess
import sys
import tempfile

import llm
import poc

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

VM = poc.VM
DEFAULT_RPC = poc.DEFAULT_RPC
FOUNDRY_BIN = poc.FOUNDRY_BIN

SYSTEM = """Ты пишешь эксплойт-контракт для ЛОКАЛЬНОГО форка (mainnet, только
чтение сети — форк, ни одной live-транзакции). Тебе дают адрес цели, адрес
актива и исходник уязвимой функции. Верни РОВНО Solidity-код: любые нужные
`interface`/вспомогательные контракты И один `contract Exploit` с функцией
`function run(address target, address asset) external`, которая ПРОВОДИТ атаку
так, чтобы украденный актив оказался НА БАЛАНСЕ самого Exploit (address(this)).

ПРАВИЛА:
* НЕ пиши тест, Runner, vm-читкоды, forge-std, pragma, SPDX — только interface'ы
  и `contract Exploit`. Их обернёт harness.
* Exploit стартует с НУЛЁМ актива. Нужен капитал — бери flash-loan ВНУТРИ run.
* Двигай средства к address(this): что украл, то harness и намеряет.
* Если прошлая попытка дала ошибку компиляции или revert — ИСПРАВЬ по причине,
  не повторяй тот же код. Не выдумывай интерфейсы, которых нет: сверяйся с
  исходником функции.
Верни ТОЛЬКО код в одном ```solidity блоке, без пояснений вокруг."""

RUNNER = """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface Vm {
    function createSelectFork(string calldata) external returns (uint256);
    function writeFile(string calldata, string calldata) external;
    function toString(int256) external pure returns (string memory);
}
interface IERC20v { function balanceOf(address) external view returns (uint256); }

/*__MODEL__*/

contract Runner {
    Vm constant vm = Vm(/*__VM__*/);
    function test_poc() external {
        vm.createSelectFork(/*__RPC__*/);
        address target = /*__TARGET__*/;
        address asset  = /*__ASSET__*/;
        Exploit e = new Exploit();
        int256 e0 = int256(IERC20v(asset).balanceOf(address(e)));
        int256 t0 = int256(IERC20v(asset).balanceOf(target));
        uint256 g0 = gasleft();
        try e.run(target, asset) {
            uint256 gasUsed = g0 - gasleft();
            int256 da = int256(IERC20v(asset).balanceOf(address(e))) - e0;
            int256 dt = int256(IERC20v(asset).balanceOf(target)) - t0;
            _w(string(abi.encodePacked(
                '{"ok":true,"attacker_delta":"', vm.toString(da),
                '","target_delta":"', vm.toString(dt),
                '","gas_used":"', vm.toString(int256(gasUsed)),
                '","basefee":"', vm.toString(int256(block.basefee)), '"}')));
        } catch Error(string memory reason) {
            _fail(reason);
        } catch Panic(uint256 code) {
            _fail(string(abi.encodePacked("panic ", vm.toString(int256(code)))));
        } catch (bytes memory) {
            _fail("low-level revert (no reason string)");
        }
    }
    function _fail(string memory reason) internal {
        _w(string(abi.encodePacked('{"ok":false,"reason":"', reason,
            '","attacker_delta":"0","target_delta":"0","gas_used":"0","basefee":"0"}')));
    }
    function _w(string memory s) internal { vm.writeFile(/*__OUT__*/, s); }
}
"""

FOUNDRY_TOML = ('[profile.default]\nsrc="src"\ntest="test"\n'
                'fs_permissions=[{access="read-write",path="./"}]\n')


def _extract_code(text):
    """Solidity-код из ответа модели: блок ```solidity … ``` или крупнейший
    фрагмент с `contract Exploit`."""
    m = re.search(r"```(?:solidity|sol)?\s*(.+?)```", text or "", re.S)
    code = m.group(1) if m else (text or "")
    # срезаем то, что harness добавит сам — иначе двойные объявления
    code = re.sub(r"^\s*//\s*SPDX[^\n]*\n", "", code)
    code = re.sub(r"^\s*pragma solidity[^\n]*\n", "", code, flags=re.M)
    return code.strip()


def _render(code, rpc, target, asset, outfile):
    """Склеить Runner + код модели. Не через % — модель может написать `%`."""
    src = RUNNER
    src = src.replace("/*__MODEL__*/", code)
    src = src.replace("/*__VM__*/", VM)
    src = src.replace("/*__RPC__*/", json.dumps(rpc))
    src = src.replace("/*__TARGET__*/", target)
    src = src.replace("/*__ASSET__*/", asset)
    src = src.replace("/*__OUT__*/", json.dumps(outfile))
    return src


def _forge(work, timeout):
    cmd = [os.path.join(FOUNDRY_BIN, "forge"), "test",
           "--match-test", "test_poc", "-vv"]
    try:
        p = subprocess.run(cmd, cwd=work, env=poc._forge_env(), text=True,
                           capture_output=True, timeout=timeout)
        return (p.stdout or "") + (p.stderr or "")
    except subprocess.TimeoutExpired:
        return "__timeout__"


def _say(log, msg):
    if log:
        log(msg)
    sys.stdout.flush()
    sys.stderr.flush()


def iterate(target, asset, func_src, rpc=DEFAULT_RPC, iters=4, chain=1,
            timeout=200, log=None, model=None, seed_code=None):
    """Крутит генерацию->форк->фидбек. Возвращает лучший результат-словарь."""
    work = tempfile.mkdtemp(prefix="ploop_")
    os.makedirs(os.path.join(work, "src"), exist_ok=True)
    os.makedirs(os.path.join(work, "test"), exist_ok=True)
    outfile = os.path.join(work, "result.json").replace("\\", "/")
    with open(os.path.join(work, "foundry.toml"), "w") as f:
        f.write(FOUNDRY_TOML)

    model = model or llm.HEAVY
    base_prompt = ("Цель: %s\nАктив (что уводим): %s\n\nИсходник уязвимой "
                   "функции/контракта:\n```solidity\n%s\n```\n" % (
                       target, asset, func_src[:4000]))
    feedback = ("Первая попытка. Напиши contract Exploit. Вызови уязвимую "
                "функцию из исходника; награбленное оставь на address(this).")
    best = {"outcome": "compile_fail", "iter": 0, "why": "ни одной сборки"}

    for it in range(1, iters + 1):
        if it == 1 and seed_code:
            code = _extract_code(seed_code)
            _say(log, "iter %d: код из --code, модель не зовём" % it)
        else:
            prompt = base_prompt + "\nСостояние прошлой попытки: " + feedback
            _say(log, "iter %d: зову модель %s …" % (it, model.split("/")[-1]))
            try:
                r = llm.ask(prompt, kind="exploit", system=SYSTEM, model=model,
                            max_tokens=2500, temperature=0.2, tries=2,
                            timeout=180)
            except Exception as e:
                feedback = "вызов модели упал: %s. Напиши код заново." % e
                _say(log, "iter %d: llm error — %s" % (it, e))
                best = _keep(best, {"outcome": "compile_fail", "iter": it,
                                    "why": str(e)[:200]})
                continue
            _say(log, "iter %d: модель %s, %s токенов" % (
                it, r.get("model", "?"), r.get("usage", {})))
            code = _extract_code((r or {}).get("text") or "")
        if "contract Exploit" not in code:
            feedback = "в ответе не было `contract Exploit`. Верни только код."
            _say(log, "iter %d: модель не дала contract Exploit" % it)
            continue
        src = _render(code, rpc, target, asset, outfile)
        with open(os.path.join(work, "test", "PoC.t.sol"), "w",
                  encoding="utf-8") as f:
            f.write(src)
        if os.path.exists(outfile):
            os.remove(outfile)
        _say(log, "iter %d: forge test на форке …" % it)
        raw = _forge(work, timeout)

        if not os.path.isfile(outfile):
            # компиляция/форк упали — вернуть модели хвост ошибки
            tail = "\n".join(l for l in raw.splitlines()
                             if "Error" in l or "error" in l or "-->" in l)[:900]
            feedback = ("НЕ СКОМПИЛИРОВАЛОСЬ/форк упал. Ошибки:\n%s\nИсправь."
                        % (tail or raw[-700:]))
            best = _keep(best, {"outcome": "compile_fail", "iter": it,
                                "why": tail[:200]})
            if log:
                log("iter %d: compile_fail" % it)
            continue

        with open(outfile, encoding="utf-8") as f:
            res = json.load(f)
        da = int(res.get("attacker_delta", 0))
        dt = int(res.get("target_delta", 0))
        if not res.get("ok"):
            reason = res.get("reason", "revert")
            feedback = ("run() РЕВЕРТНУЛ: «%s». Пересмотри гипотезу/интерфейсы."
                        % reason)
            best = _keep(best, {"outcome": "revert", "iter": it, "why": reason,
                                "attacker_delta": da})
            if log:
                log("iter %d: revert — %s" % (it, reason[:60]))
            continue
        if da <= 0:
            feedback = ("исполнилось, но добыча da=%d (<=0): актив к тебе НЕ "
                        "пришёл. Другой вектор/актив." % da)
            best = _keep(best, {"outcome": "no_gain", "iter": it,
                                "attacker_delta": da, "target_delta": dt})
            if log:
                log("iter %d: no_gain da=%d" % (it, da))
            continue
        # добыча положительная -> экономика (net минус газ)
        econ = poc.economics(asset, da, res.get("gas_used", 0),
                             res.get("basefee", 0), chain=chain)
        outcome = {"profit": "profit", "dust": "dust",
                   "unpriced": "green"}[econ["verdict"]]
        cur = {"outcome": outcome, "iter": it, "attacker_delta": da,
               "target_delta": dt, "econ": econ, "code": code, "work": work}
        best = _keep(best, cur)
        if log:
            log("iter %d: %s da=%d net=%s" % (
                it, outcome, da, econ.get("net_wei")))
        if outcome in ("profit", "dust"):
            break        # profit — кандидат; dust — доказано и экономически мёртво
    return best


_RANK = {"profit": 5, "green": 4, "dust": 3, "no_gain": 2, "revert": 1,
         "compile_fail": 0}


def _keep(a, b):
    return b if _RANK.get(b["outcome"], 0) >= _RANK.get(a["outcome"], 0) else a


def _load_func_src(src_root, contract, func):
    """Исходник контракта (для контекста модели) из дерева."""
    try:
        import solsrc
        for c in solsrc.parse_tree(src_root):
            if c.name == contract:
                return (c.body or "")[:6000]
    except Exception:
        pass
    return "(исходник не найден: %s.%s)" % (contract, func)


def _log_gate(slug, key, best):
    if not (slug and key and "." in key):
        return
    o = best["outcome"]
    econ = best.get("econ") or {}
    def _eth(w):
        return "—" if w is None else "%.6f ETH" % (w / 1e18)
    if o == "profit":
        v, why = "lead", ("proof-loop PROFIT net %s (итер %d) — КАНДИДАТ" %
                          (_eth(econ.get("net_wei")), best["iter"]))
    elif o in ("dust", "green"):
        v, why = ("clean" if o == "dust" else "lead",
                  "proof-loop %s (итер %d)" % (o, best["iter"]))
    else:
        # revert/no_gain/compile_fail — НЕ закрываем: не доказали ни атаку, ни
        # её отсутствие (модель могла просто не осилить). Остаётся лидом.
        v, why = "lead", ("proof-loop не доказал (%s, итер %d) — остаётся лидом"
                          % (o, best["iter"]))
    try:
        import gatemem
        m = gatemem.Mem(slug)
        m.record(key, v, why, "proofloop")
        m.save()
        if v == "clean":
            gatemem.mirror_kill(why, slug, key)
    except Exception as e:
        sys.stderr.write("gatemem: %s\n" % e)


def main():
    a = sys.argv[1:]

    def opt(n, d=None):
        return a[a.index(n) + 1] if n in a else d

    target, asset = opt("--target"), opt("--asset")
    slug, key = opt("--slug"), opt("--key", "")
    if not (target and asset):
        print(__doc__)
        return
    rpc = opt("--rpc", DEFAULT_RPC)
    iters = int(opt("--iters", "4"))
    src_root = opt("--src")
    model = opt("--model", llm.HEAVY)
    seed = None
    if opt("--code"):
        with open(opt("--code"), encoding="utf-8") as f:
            seed = f.read()
    ctx = ""
    if opt("--ctx"):
        with open(opt("--ctx"), encoding="utf-8") as f:
            ctx = f.read()
    elif src_root and key and "." in key:
        c, fn = key.split(".", 1)
        ctx = _load_func_src(src_root, c, fn)

    print("PROOF-LOOP: %s asset=%s, до %d итераций, модель %s" % (
        target[:12], asset[:12], iters, model.split("/")[-1]))
    print("=" * 70)
    sys.stdout.flush()
    best = iterate(target, asset, ctx or "(контекста нет)", rpc=rpc,
                   iters=iters, model=model, seed_code=seed,
                   log=lambda s: (print("  " + s), sys.stdout.flush()))
    print("-" * 70)
    print("ЛУЧШИЙ ИСХОД: %s (итерация %d)" % (best["outcome"].upper(),
                                              best.get("iter", 0)))
    econ = best.get("econ")
    if econ:
        def _eth(w):
            return "—" if w is None else "%.6f ETH" % (w / 1e18)
        print("  добыча %+d ед., net %s" % (best.get("attacker_delta", 0),
                                            _eth(econ.get("net_wei"))))
    if best["outcome"] == "profit":
        print("  ДОКАЗАНО и окупается — КАНДИДАТ на подачу. Код в %s" % best.get("work"))
    elif best["outcome"] in ("revert", "no_gain", "compile_fail"):
        print("  НЕ доказано (%s) — остаётся лидом, не закрыто (модель могла не "
              "осилить, не путать с «бага нет»)." % best.get("why", "")[:80])
    _log_gate(slug, key, best)


if __name__ == "__main__":
    main()
