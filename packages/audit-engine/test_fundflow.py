# -*- coding: utf-8 -*-
"""Проверки fund-flow на известном ответе.

Из чего родился. Модель завышала severity takeOrder до high, увидев произвольный
вызов, потому что из тела не видела: обёртка ТРАНЗИТНА (сметает остаток), в покое
на ней ноль — реальный импакт low. fundflow добывает этот факт механически. Тест
запирает оба конца: кастодиан (маппинг балансов) -> держит; обёртка (sendLeftover)
-> транзит; и что пустой `receive() payable` НЕ делает обёртку кастодианом
(на этом первая версия ложно пометила все sell-обёртки «держит»).

    python -m unittest test_fundflow -v
"""
import unittest

import fundflow
import solsrc

CUSTODIAN = """pragma solidity ^0.8.0;
contract Vault {
    mapping(address => uint256) public balances;
    function deposit() external payable { balances[msg.sender] += msg.value; }
    function withdraw(uint256 a) external {
        balances[msg.sender] -= a;
        payable(msg.sender).transfer(a);
    }
}"""

WRAPPER = """pragma solidity ^0.8.0;
contract Wrapper {
    function takeOrder(address ex, bytes calldata d) external returns (bool ok) {
        (ok, ) = ex.call(d);
        sendLeftover(msg.sender);
    }
    function sendLeftover(address to) internal {}
    receive() external payable {}
}"""

# Пустой payable-receive без учёта — приём ETH в свопе, НЕ кастодия.
PASSTHROUGH = """pragma solidity ^0.8.0;
contract SellWrapper {
    function sell(address src, uint256 amt) external returns (uint256) {
        ISwap(ROUTER).exchange(src, amt);
    }
    address constant ROUTER = address(0x1234);
    receive() external payable {}
}
interface ISwap { function exchange(address, uint256) external returns (uint256); }"""


def one(src, name):
    return next(c for c in solsrc.parse_file("mem.sol", src) if c.name == name)


class FundFlowTests(unittest.TestCase):
    def test_маппинг_балансов_это_кастодиан(self):
        v = fundflow.verdict(one(CUSTODIAN, "Vault"))
        self.assertEqual(v["kind"], "custodial")
        self.assertTrue(v["custodial"])

    def test_обёртка_со_сметанием_транзитна_не_держит(self):
        v = fundflow.verdict(one(WRAPPER, "Wrapper"))
        self.assertFalse(v["custodial"], v["why"])
        self.assertEqual(v["kind"], "transient")

    def test_пустой_payable_receive_НЕ_делает_кастодианом(self):
        v = fundflow.verdict(one(PASSTHROUGH, "SellWrapper"))
        self.assertFalse(v["custodial"],
                         "пустой receive() — приём в свопе, не кастодия: " + v["why"])


if __name__ == "__main__":
    unittest.main()
