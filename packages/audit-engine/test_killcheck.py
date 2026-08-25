# -*- coding: utf-8 -*-
"""Регрессия killcheck на гейты в вызванных хелперах — по известному ответу.

Из чего родился. На свежих custodial-мишенях (silo, strata) модель дала два
ложных HIGH; чтение показало: гейт есть, но killcheck его не доставал —
(A) Silo делегирует реализацию И `require(msg.sender==hookReceiver)` в library
`Actions` (killcheck ходил только по контракту+базам, не по библиотекам);
(B) strata `grantCall` гейтован модификатором `onlyRole` внутри OZ `grantRole`,
исходника которого в дереве нет. Тест запирает: оба убиваются, а реально
беззащитная функция ВЫЖИВАЕТ (не прячем настоящий баг).

    python -m unittest test_killcheck -v
"""
import unittest

import killcheck
import solsrc

# (A) гейт в БИБЛИОТЕЧНОМ вызове: Vault делегирует в library Lib, гейт там
LIBGATE = """pragma solidity ^0.8.0;
library Lib {
    function act(address target, bytes calldata data) internal {
        require(msg.sender == admin(), "only-admin");
        target.call(data);
    }
    function admin() internal view returns (address) { return address(0); }
}
contract Vault {
    function callOnBehalf(address target, bytes calldata data) external {
        Lib.act(target, data);
    }
}"""

# (B) гейт МОДИФИКАТОРОМ во внешнем OZ-хелпере (grantRole не в дереве)
OZGATE = """pragma solidity ^0.8.0;
contract Manager {
    function grantCall(address c, bytes4 sel, address who) public {
        bytes32 role = roleFor(c, sel);
        grantRole(role, who);
    }
    function roleFor(address, bytes4) internal pure returns (bytes32){return 0;}
}"""

# негативный контроль: РЕАЛЬНО беззащитный произвольный вызов -> выживает
OPEN = """pragma solidity ^0.8.0;
contract Bad {
    function anyCall(address target, bytes calldata data) external {
        target.call(data);
    }
}"""


def survives(src, contract, func):
    cons = list(solsrc.parse_file("m.sol", src))
    k = killcheck.Killer(cons)
    c = next(x for x in cons if x.name == contract)
    f = next(fn for fn in c.funcs if fn.name == func)
    return k.judge("ungated", f, c)["survives"]


class HelperGateTests(unittest.TestCase):
    def test_гейт_в_библиотечном_вызове_убивает(self):
        self.assertFalse(survives(LIBGATE, "Vault", "callOnBehalf"),
                         "гейт в library Lib.act должен убить кандидата")

    def test_модификаторный_OZ_гейт_grantRole_убивает(self):
        self.assertFalse(survives(OZGATE, "Manager", "grantCall"),
                         "grantRole — фикс-гейт OZ, кандидат мёртв")

    def test_реально_беззащитный_вызов_ВЫЖИВАЕТ(self):
        self.assertTrue(survives(OPEN, "Bad", "anyCall"),
                        "нет гейта нигде — не прячем, выживает")


if __name__ == "__main__":
    unittest.main()
