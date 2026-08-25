# -*- coding: utf-8 -*-
"""ГЕЙТ «VERIFIED ИЛИ KILLED» — sandbox-PoC на форке mainnet (только чтение).

Зачем именно так. verify.py доказывает, что символ/строка существуют; judge даёт
severity по коду. Но ни один из них не доказывает ПОТЕРЮ СРЕДСТВ. В статьях
(A1/CyberChainBench) агенты сплошь считали эксплойт успешным, проверив не тот
актив или не сравнив баланс до/после — это и есть выдумка на последнем метре.
Здесь предложение прогоняется на ФОРКЕ и меряется дельта балансов до/после:
исполнился ли вызов и в ту ли сторону поехали средства.

Контракт (STATE.md, незыблемо): PoC ТОЛЬКО локально, mainnet ТОЛЬКО чтение.
Форк живёт в анвиле форджа, в live-сеть не уходит ни одной транзакции.

Три исхода v1 (net-delta минус газ/долг — вторая итерация, когда появится
ложный green):
  * revert    — вызов отвалился (нет standing-баланса / гейт / плохой calldata)
  * green     — вызов прошёл И у атакующего актив вырос, а у цели упал (та
                сторона). МАГНИТУДА печатается — 2 wei сам себя выдаёт как пыль.
  * no_delta  — вызов прошёл, но атакующий не в плюсе (или цель не в минусе):
                исполнилось, а красть нечем.
green != подаваемо: экономический порог (плюс минус газ) — итерация 2. v1 честно
кладёт факт и магнитуду в runlog, промоушена в submittable здесь НЕТ.

использование:
    poc.py --target 0xADDR --sig "my2Wei(address)" --args 0xTOKEN \\
           --asset 0xTOKEN --rpc <url> [--attacker 0x..] [--slug ..] [--label ..]
    poc.py --case data/bench/... .json   (те же поля из файла)
"""
import json
import os
import re
import subprocess
import sys
import tempfile

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.abspath(__file__))
FOUNDRY_BIN = os.path.expanduser("~/.foundry/bin")
DEFAULT_RPC = "https://ethereum-rpc.publicnode.com"
ATTACKER = "0x00000000000000000000000000000000000A11cE"
VM = "0x7109709ECfa91a80626fF3989D68f67F5b1DD12D"

# Минимальный интерфейс читалок баланса + нужных чит-кодов. forge-std НЕ тянем
# (git-clone, вес) — только то, что реально зовём.
TEST_TMPL = """// SPDX-License-Identifier: MIT
pragma solidity ^0.8.13;

interface Vm {
    function createSelectFork(string calldata) external returns (uint256);
    function prank(address) external;
    function writeFile(string calldata, string calldata) external;
    function toString(int256) external pure returns (string memory);
}

interface IERC20 { function balanceOf(address) external view returns (uint256); }

contract PoC {
    Vm constant vm = Vm(%(vm)s);

    function test_poc() external {
        vm.createSelectFork("%(rpc)s");
        address attacker = %(attacker)s;
        address target   = %(target)s;
        address asset    = %(asset)s;

        int256 a0 = int256(IERC20(asset).balanceOf(attacker));
        int256 t0 = int256(IERC20(asset).balanceOf(target));

        vm.prank(attacker);
        uint256 g0 = gasleft();
        (bool ok, ) = target.call(hex"%(calldata)s");
        uint256 gasUsed = g0 - gasleft();

        int256 da = int256(IERC20(asset).balanceOf(attacker)) - a0;
        int256 dt = int256(IERC20(asset).balanceOf(target))   - t0;

        string memory out = string(abi.encodePacked(
            '{"ok":', ok ? "true" : "false",
            ',"attacker_delta":"', vm.toString(da),
            '","target_delta":"',  vm.toString(dt),
            '","gas_used":"',      vm.toString(int256(gasUsed)),
            '","basefee":"',       vm.toString(int256(block.basefee)), '"}'));
        vm.writeFile("%(outfile)s", out);
    }
}
"""

FOUNDRY_TOML = """[profile.default]
src = "src"
test = "test"
fs_permissions = [{ access = "read-write", path = "./" }]
"""


WETH = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2".lower()
NATIVE = {WETH, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"}
# net > этого порога (в wei ETH) -> считаем profit, иначе экономически мёртво.
# 0.005 ETH: ниже — призовой шум / подарок / тестовый капитал, PoC не окупает.
PROFIT_MIN_WEI = 5 * 10 ** 15


def _forge_env():
    env = dict(os.environ)
    env["PATH"] = FOUNDRY_BIN + os.pathsep + env.get("PATH", "")
    return env


def _cast_call(target, sig, rpc):
    try:
        out = subprocess.check_output(
            [os.path.join(FOUNDRY_BIN, "cast"), "call", target, sig,
             "--rpc-url", rpc], env=_forge_env(), text=True, timeout=30).strip()
        return int(out, 16) if out.startswith("0x") else int(out)
    except Exception:
        return None


def _price_usd(chain, addr):
    """USD за ЦЕЛЫЙ токен из DefiLlama (read-only, без ключа). None если нет."""
    import urllib.request
    net = {1: "ethereum", 10: "optimism", 8453: "base",
           42161: "arbitrum"}.get(chain, "ethereum")
    key = "%s:%s" % (net, addr)
    url = "https://coins.llama.fi/prices/current/%s" % key
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "auditscout"})
        d = json.loads(urllib.request.urlopen(req, timeout=20).read())
        return d.get("coins", {}).get(key, {}).get("price")
    except Exception:
        return None


def economics(asset, gain_units, gas_used, basefee, chain=1):
    """net в wei ETH и вердикт profit|dust|unpriced. Оценка добычи в ETH через
    цены DefiLlama; порог PROFIT_MIN_WEI. Без цены — честно unpriced, НЕ пыль."""
    tip = 10 ** 9                                   # 1 gwei приоритет
    gas_wei = int(gas_used) * (int(basefee) + tip)
    a = asset.lower()
    if a in NATIVE:
        gain_wei = int(gain_units)                  # уже ETH-номинал 1:1
    else:
        rpc = DEFAULT_RPC
        dec = _cast_call(asset, "decimals()(uint8)", rpc)
        pt = _price_usd(chain, asset)
        pe = _price_usd(chain, WETH)
        if dec is None or not pt or not pe:
            return {"verdict": "unpriced", "gas_wei": gas_wei,
                    "gain_wei": None, "net_wei": None}
        gain_whole = int(gain_units) / (10 ** int(dec))
        gain_eth = (gain_whole * pt) / pe            # добыча в ETH
        gain_wei = int(gain_eth * 10 ** 18)
    net = gain_wei - gas_wei
    return {"verdict": "profit" if net > PROFIT_MIN_WEI else "dust",
            "gas_wei": gas_wei, "gain_wei": gain_wei, "net_wei": net}


def calldata(sig, args):
    """abi-энкод вызова через cast (foundry уже стоит)."""
    cmd = [os.path.join(FOUNDRY_BIN, "cast"), "calldata", sig] + list(args)
    out = subprocess.check_output(cmd, env=_forge_env(), text=True).strip()
    return out[2:] if out.startswith("0x") else out


def run_poc(target, sig, args, asset, rpc=DEFAULT_RPC, attacker=ATTACKER,
            block=None, timeout=180, chain=1):
    """{outcome, ok, attacker_delta, target_delta, raw}. outcome in
    green|no_delta|revert|error."""
    work = tempfile.mkdtemp(prefix="poc_")
    os.makedirs(os.path.join(work, "src"), exist_ok=True)
    os.makedirs(os.path.join(work, "test"), exist_ok=True)
    outfile = os.path.join(work, "result.json").replace("\\", "/")
    try:
        cd = calldata(sig, args)
    except Exception as e:
        return {"outcome": "error", "why": "calldata: %s" % e}
    rpc_full = rpc + ("@%s" % block if block else "")
    src = TEST_TMPL % {"vm": VM, "rpc": rpc_full, "attacker": attacker,
                       "target": target, "asset": asset, "calldata": cd,
                       "outfile": outfile}
    with open(os.path.join(work, "foundry.toml"), "w") as f:
        f.write(FOUNDRY_TOML)
    with open(os.path.join(work, "test", "PoC.t.sol"), "w") as f:
        f.write(src)
    cmd = [os.path.join(FOUNDRY_BIN, "forge"), "test",
           "--match-test", "test_poc", "-vv"]
    try:
        p = subprocess.run(cmd, cwd=work, env=_forge_env(), text=True,
                           capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        return {"outcome": "error", "why": "forge timeout %ds" % timeout}
    raw = (p.stdout or "") + (p.stderr or "")
    if not os.path.isfile(outfile):
        # тест не дошёл до writeFile — компиляция/форк упали
        return {"outcome": "error", "why": "нет result.json (компиляция/форк?)",
                "raw": raw[-1200:]}
    with open(outfile, encoding="utf-8") as f:
        r = json.load(f)
    da = int(r["attacker_delta"])
    dt = int(r["target_delta"])
    res = {"ok": r["ok"], "attacker_delta": da, "target_delta": dt,
           "asset": asset, "target": target, "sig": sig, "work": work,
           "gas_used": int(r.get("gas_used", 0)),
           "basefee": int(r.get("basefee", 0))}
    if not r["ok"]:
        res["outcome"] = "revert"
        return res
    if not (da > 0 and dt < 0):
        res["outcome"] = "no_delta"    # исполнилось, но красть нечем
        return res
    # та сторона (атакующий +, цель −) — ИТЕРАЦИЯ 2: экономика минус газ
    econ = economics(asset, da, res["gas_used"], res["basefee"], chain=chain)
    res["econ"] = econ
    # profit -> кандидат; dust -> экономически мёртво (my2Wei-класс);
    # unpriced -> оценить не смогли, оставляем green (не хороним прибыль вслепую)
    res["outcome"] = {"profit": "profit", "dust": "dust",
                      "unpriced": "green"}[econ["verdict"]]
    return res


def _log_gate(slug, res, key):
    """Исход PoC в память шлюза -> виден на странице мишени единообразно с
    killcheck/model/scope. dust/revert/no_delta закрывают лид (source=poc);
    profit оставляют лидом-КАНДИДАТОМ; green(unpriced) — лид «оценить»."""
    if not (slug and key and "." in key):
        return
    econ = res.get("econ") or {}
    def _eth(w):
        return "—" if w is None else "%.6f ETH" % (w / 1e18)
    out = res["outcome"]
    if out == "profit":
        verdict, reason = "lead", ("PoC PROFIT net %s — КАНДИДАТ, готовить подачу"
                                   % _eth(econ.get("net_wei")))
    elif out == "dust":
        verdict, reason = "clean", ("PoC dust: добыча не окупает газ (net %s) — "
                                    "экономически мёртво" % _eth(econ.get("net_wei")))
    elif out == "revert":
        verdict, reason = "clean", "PoC revert: вызов отвалился (нет баланса/гейт)"
    elif out == "no_delta":
        verdict, reason = "clean", "PoC no_delta: исполнилось, атакующий не в плюсе"
    else:  # green unpriced
        verdict, reason = "lead", "PoC green (unpriced): направление верно, оценить цену"
    try:
        import gatemem
        m = gatemem.Mem(slug)
        m.record(key, verdict, reason, "poc")
        m.save()
        if verdict == "clean":
            gatemem.mirror_kill(reason, slug, key)
    except Exception as e:
        sys.stderr.write("gatemem: %s\n" % e)


def _log_run(slug, res, label):
    try:
        import runlog
        run = runlog.Run(slug or "_all", "poc", target=res.get("target"),
                         label=label)
        econ = res.get("econ") or {}
        with run.step("poc", sig=res.get("sig"), asset=res.get("asset")):
            run.verdict(res["outcome"] == "profit", outcome=res["outcome"],
                        attacker_delta=str(res.get("attacker_delta")),
                        target_delta=str(res.get("target_delta")),
                        net_wei=str(econ.get("net_wei")),
                        gas_wei=str(econ.get("gas_wei")),
                        why=res.get("why", ""))
        run.end(status="ok", outcome=res["outcome"])
        return run.id
    except Exception as e:
        sys.stderr.write("runlog: %s\n" % e)
        return None


def main():
    a = sys.argv[1:]

    def opt(name, default=None):
        return a[a.index(name) + 1] if name in a else default

    if "--case" in a:
        with open(opt("--case"), encoding="utf-8") as f:
            c = json.load(f)
        target, sig = c["target"], c["sig"]
        args = c.get("args", [])
        asset, rpc = c.get("asset", args[0] if args else None), c.get("rpc", DEFAULT_RPC)
        slug, label = c.get("slug"), c.get("label", c.get("id", ""))
    else:
        target, sig = opt("--target"), opt("--sig")
        args = opt("--args", "").split(",") if opt("--args") else []
        asset = opt("--asset") or (args[0] if args else None)
        rpc, slug, label = opt("--rpc", DEFAULT_RPC), opt("--slug"), opt("--label", "")
    if not (target and sig and asset):
        print(__doc__)
        return
    block = opt("--block")

    print("PoC форк: %s.%s asset=%s" % (target[:12], sig, asset[:12]))
    res = run_poc(target, sig, args, asset, rpc=rpc,
                  attacker=opt("--attacker", ATTACKER), block=block)
    print("=" * 70)
    if res["outcome"] == "error":
        print("ИСХОД: error — %s" % res.get("why"))
        if res.get("raw"):
            print(res["raw"])
        return
    print("ИСХОД: %s" % res["outcome"].upper())
    print("  вызов прошёл: %s" % res["ok"])
    print("  дельта атакующего: %+d (wei актива)" % res["attacker_delta"])
    print("  дельта цели:       %+d" % res["target_delta"])
    econ = res.get("econ")
    if econ:
        def _eth(w):
            return "—" if w is None else "%.6f ETH" % (w / 1e18)
        print("  газ: %d ед., стоимость %s" % (res["gas_used"], _eth(econ["gas_wei"])))
        print("  добыча в ETH: %s   NET (добыча−газ): %s"
              % (_eth(econ["gain_wei"]), _eth(econ["net_wei"])))
    if res["outcome"] == "profit":
        print("  PROFIT: net положительный сверх порога — КАНДИДАТ, готовить подачу.")
    elif res["outcome"] == "dust":
        print("  DUST: добыча не окупает газ — экономически мёртво (класс my2Wei). "
              "Убить как лид.")
    elif res["outcome"] == "green":
        print("  GREEN (unpriced): направление верное, но цену актива не достали — "
              "не хороним вслепую, оценить руками.")
    elif res["outcome"] == "no_delta":
        print("  исполнилось, но атакующий не в плюсе — красть нечем.")
    elif res["outcome"] == "revert":
        print("  вызов отвалился — нет баланса / гейт / плохой calldata.")
    rid = _log_run(slug, res, label)
    _log_gate(slug, res, opt("--key") or label)
    if rid:
        print("runlog: %s (slug %s)" % (rid, slug or "_all"))


if __name__ == "__main__":
    main()
